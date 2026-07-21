// Due-diligence brief: fetch the company's latest annual (and quarterly)
// filing from EDGAR, have the model write a structured brief where EVERY
// claim carries an exact quote from the source, then verify each quote
// against the source text and drop anything that doesn't check out. The
// verification pass is the product: a fabricated partnership in a brief is
// worse than no brief.
//
// Usage: node app/scripts/brief-llm.mjs --slug <workspace> --ticker <TICKER>
// Exit codes: 0 ok, 1 unexpected, 2 domain failure, 3 LLM not configured.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { extractJson, parseBrief, TickerSchema } from "@basis/schema";
import { isLlmConfigured, llmConfig, reasoningEffort, resolveModel } from "./llm.mjs";
import { arg, tsvCell } from "./lib/cli.mjs";
import { resolveWorkspaceDir } from "./lib/workspace-dir.mjs";
import { cikForTicker, edgarCacheDir, fetchFilingDoc, getSubmissions, recentFilings } from "./lib/edgar.mjs";
import { extractItem, htmlToText, truncate, verifyQuote } from "./lib/filings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const SECTION_BUDGET = 14_000; // chars of excerpt per section fed to the model

function buildPrompt({ ticker, excerpts, retryErrors }) {
  const parts = [
    "You are a rigorous equity research analyst writing a due-diligence brief for a beginner investor.",
    "",
    "Hard rules:",
    "- Use ONLY the filing excerpts below. No outside knowledge, no price targets, no buy/sell advice.",
    "- Every claim MUST include an exact verbatim quote (<= 2 sentences, copied character-for-character from an excerpt), the source label, and that source's URL. Claims whose quotes are not exact excerpts will be deleted.",
    "- Write plainly; explain jargon in the claim text itself.",
    "- Include the bear case and red flags honestly — this brief is a 'did you actually check?' gate, not a pitch.",
    "",
    "Return ONLY this JSON (no prose, no code fences):",
    "{",
    '  "ticker": "' + ticker + '",',
    '  "company": "<company name>",',
    '  "summary": "<4-6 sentence plain-language overview>",',
    '  "sections": [',
    '    { "key": "business", "label": "Business model", "claims": [ { "text": "...", "quote": "...", "source": "<e.g. 10-K FY2025, Item 1>", "sourceUrl": "<url of that source>" } ] },',
    '    { "key": "financials", "label": "Financials & trends", "claims": [ ... ] },',
    '    { "key": "competition", "label": "Competition", "claims": [ ... ] },',
    '    { "key": "bear_case", "label": "The bear case", "claims": [ ... ] },',
    '    { "key": "red_flags", "label": "Red flags", "claims": [ ... ] }',
    "  ]",
    "}",
    "",
    "2-6 claims per section. Skip a section only if the excerpts genuinely contain nothing for it.",
  ];
  for (const ex of excerpts) {
    parts.push("", `=== SOURCE: ${ex.label} (${ex.url}) ===`, ex.text);
  }
  if (retryErrors) {
    parts.push(
      "",
      "Your previous output was invalid:",
      ...retryErrors.map((e) => `- ${e}`),
      "Return corrected JSON only.",
    );
  }
  return parts.join("\n");
}

async function main() {
  if (!isLlmConfigured()) fail("No model configured (set an API key in Settings or app/.env.local).", 3);

  const slug = arg("slug");
  const rawTicker = (arg("ticker") || "").toUpperCase().trim();
  const tickerParse = TickerSchema.safeParse(rawTicker);
  if (!slug || !tickerParse.success) fail("usage: brief-llm.mjs --slug <workspace> --ticker <TICKER>");
  const ticker = tickerParse.data;
  const dir = resolveWorkspaceDir(REPO_ROOT, slug);
  if (!fs.existsSync(dir)) fail(`workspace not found: ${slug}`);
  const cacheDir = edgarCacheDir(REPO_ROOT);

  phase(`looking up ${ticker} on EDGAR`);
  const company = await cikForTicker(ticker, cacheDir);
  if (!company) fail(`ticker ${ticker} not found on EDGAR (US-listed companies only)`);
  progress(10);

  phase("fetching filing index");
  const submissions = await getSubmissions(company.cik, cacheDir);
  const annual = recentFilings(submissions, { forms: ["10-K", "20-F"], limit: 1 })[0];
  const quarterly = recentFilings(submissions, { forms: ["10-Q"], limit: 1 })[0];
  if (!annual && !quarterly) fail(`no 10-K/10-Q filings found for ${ticker}`);
  progress(20);

  const filingsDir = path.join(dir, "filings", company.cik);
  const excerpts = [];
  const sourceTexts = [];
  const sources = [];

  const addFiling = async (filing, kind, items) => {
    phase(`fetching ${filing.form} (${filing.filedAt})`);
    const doc = await fetchFilingDoc(company.cik, filing.accession, filing.primaryDoc, filingsDir);
    const text = htmlToText(doc.text);
    sourceTexts.push(text);
    sources.push({ url: doc.url, title: `${filing.form} filed ${filing.filedAt}` });
    for (const [item, label] of items) {
      const section = extractItem(text, item);
      if (section) {
        excerpts.push({
          label: `${kind}, Item ${item} (${label})`,
          url: doc.url,
          text: truncate(section, SECTION_BUDGET),
        });
      }
    }
    // Fallback: if item extraction found nothing (formatting varies), feed the
    // front of the document so the model still has real source text to quote.
    if (!excerpts.some((e) => e.url === doc.url)) {
      excerpts.push({
        label: `${kind} (front matter)`,
        url: doc.url,
        text: truncate(text, SECTION_BUDGET * 2),
      });
    }
  };

  if (annual) {
    await addFiling(annual, `${annual.form} FY (${annual.filedAt})`, [
      ["1", "Business"],
      ["1A", "Risk Factors"],
      ["7", "Management's Discussion and Analysis"],
    ]);
  }
  progress(45);
  if (quarterly) {
    await addFiling(quarterly, `10-Q (${quarterly.filedAt})`, [["2", "MD&A"]]);
  }
  progress(55);

  phase(`drafting brief with ${llmConfig().model}`);
  const model = resolveModel();
  let brief = null;
  let errors = null;
  for (let attempt = 0; attempt < 2 && !brief; attempt++) {
    const { text } = await generateText({
      model,
      prompt: buildPrompt({ ticker, excerpts, retryErrors: errors }),
      maxOutputTokens: 8000,
      providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
    });
    try {
      const parsed = parseBrief(extractJson(text));
      if (parsed.ok) brief = parsed.brief;
      else errors = parsed.errors;
    } catch (err) {
      errors = [String(err?.message ?? err)];
    }
  }
  if (!brief) fail(`model returned an invalid brief: ${(errors ?? []).join("; ")}`);
  progress(80);

  phase("verifying citations");
  const combinedSource = sourceTexts.join("\n\n");
  const knownUrls = new Set(sources.map((s) => s.url));
  let dropped = 0;
  brief.sections = brief.sections
    .map((section) => {
      const claims = section.claims.filter((claim) => {
        const ok = knownUrls.has(claim.sourceUrl) && verifyQuote(claim.quote, combinedSource);
        if (ok) claim.verified = true;
        else dropped++;
        return ok;
      });
      return { ...section, claims };
    })
    .filter((section) => section.claims.length > 0);
  if (brief.sections.length === 0) fail("every claim failed citation verification; not writing a brief");

  brief.ticker = ticker;
  brief.company = brief.company || company.name;
  brief.generatedAt = new Date().toISOString();
  brief.model = llmConfig().model;
  brief.sources = sources;
  brief.droppedClaims = dropped;

  const final = parseBrief(brief);
  if (!final.ok) fail(`post-verification brief failed validation: ${(final.errors ?? []).join("; ")}`);

  const briefsDir = path.join(dir, "briefs");
  fs.mkdirSync(briefsDir, { recursive: true });
  const outFile = path.join(briefsDir, `${ticker}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(final.brief, null, 2)}\n`);
  progress(100);
  console.log(`DONE ${path.basename(outFile)}`);
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
