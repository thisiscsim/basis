// Digest: compose a short "what happened and why it matters" readout from the
// workspace's recent alerts, x-ray, and portfolio. LLM-written when a model is
// configured; otherwise a deterministic fallback lists the recent filings so
// the surface is never empty.
//
// Usage: node app/scripts/digest-llm.mjs --slug <workspace>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import {
  extractJson,
  parseAlerts,
  parseDigest,
  parsePortfolio,
  parseWatchlist,
  parseXray,
} from "@basis/schema";
import { isLlmConfigured, llmConfig, reasoningEffort, resolveModel } from "./llm.mjs";
import { arg, readJsonMaybe, tsvCell } from "./lib/cli.mjs";
import { resolveWorkspaceDir } from "./lib/workspace-dir.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const RECENT_DAYS = 14;

function recentAlerts(alerts) {
  const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
  return alerts.alerts.filter((a) => a.filedAt >= cutoff || !a.read).slice(0, 25);
}

function deterministicDigest(alerts) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    periodLabel: `Last ${RECENT_DAYS} days`,
    bullets: alerts.slice(0, 8).map((a) => ({
      title: `${a.ticker}: ${a.form} filed ${a.filedAt}`,
      body: (a.summary ?? a.title ?? "").slice(0, 2000),
      tickers: [a.ticker],
    })),
    generatedBy: "deterministic",
  };
}

function buildPrompt({ alerts, xray, portfolio, watchlist, retryErrors }) {
  const parts = [
    "You are a calm research assistant writing a short digest for a beginner investor.",
    "Summarize what happened recently around their watchlist/portfolio and why it matters.",
    "Rules:",
    "- Only use the data below. No outside knowledge, no price talk, no buy/sell advice, no predictions.",
    "- 3-7 bullets, most decision-relevant first. Plain language; explain filing types in-line when relevant.",
    "- The x-ray numbers are ground truth; never contradict them.",
    "",
    "Return ONLY this JSON (no prose, no code fences):",
    "{",
    '  "periodLabel": "<e.g. Week of Jul 14>",',
    '  "bullets": [ { "title": "<= 12 words", "body": "2-4 sentences", "tickers": ["AAPL"] } ],',
    '  "portfolioNote": "<1-2 sentences tying the week back to their actual exposure, if the x-ray is present>"',
    "}",
    "",
    "=== RECENT FILINGS (with diff summaries when available) ===",
    JSON.stringify(
      alerts.map((a) => ({ ticker: a.ticker, form: a.form, filedAt: a.filedAt, summary: a.summary ?? null })),
      null,
      2,
    ),
    "",
    "=== PORTFOLIO X-RAY (deterministic ground truth) ===",
    xray ? JSON.stringify({ ...xray, narrative: undefined }, null, 2) : "(none yet)",
    "",
    "=== HOLDINGS ===",
    JSON.stringify(portfolio.holdings.map((h) => h.ticker)),
    "",
    "=== WATCHLIST ===",
    JSON.stringify(watchlist.entries.map((e) => e.ticker)),
  ];
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
  const slug = arg("slug");
  if (!slug) fail("usage: digest-llm.mjs --slug <workspace>");
  const dir = resolveWorkspaceDir(REPO_ROOT, slug);
  if (!fs.existsSync(dir)) fail(`workspace not found: ${slug}`);

  const alerts = recentAlerts(parseAlerts(readJsonMaybe(path.join(dir, "alerts.json"))));
  const portfolio = parsePortfolio(readJsonMaybe(path.join(dir, "portfolio.json")));
  const watchlist = parseWatchlist(readJsonMaybe(path.join(dir, "watchlist.json")));
  let xray = null;
  try {
    const rawXray = readJsonMaybe(path.join(dir, "xray.json"));
    if (rawXray) xray = parseXray(rawXray);
  } catch {
    // stale/invalid x-ray: digest proceeds without it
  }
  if (alerts.length === 0 && !xray) {
    fail("nothing to digest yet — run Update filings (and optionally the X-ray) first");
  }

  let digest = null;
  if (isLlmConfigured()) {
    phase(`composing digest with ${llmConfig().model}`);
    const model = resolveModel();
    let errors = null;
    for (let attempt = 0; attempt < 2 && !digest; attempt++) {
      try {
        const { text } = await generateText({
          model,
          prompt: buildPrompt({ alerts, xray, portfolio, watchlist, retryErrors: errors }),
          maxOutputTokens: 4000,
          providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
        });
        const parsed = parseDigest({ ...extractJson(text), generatedBy: "llm" });
        if (parsed.ok) digest = parsed.digest;
        else errors = parsed.errors;
      } catch (err) {
        errors = [String(err?.message ?? err)];
      }
      progress(40 + attempt * 30);
    }
  }
  if (!digest) {
    phase("composing deterministic digest");
    const parsed = parseDigest(deterministicDigest(alerts));
    if (!parsed.ok) fail(`deterministic digest failed validation: ${(parsed.errors ?? []).join("; ")}`);
    digest = parsed.digest;
  }
  digest.generatedAt = new Date().toISOString();

  const digestsDir = path.join(dir, "digests");
  fs.mkdirSync(digestsDir, { recursive: true });
  const outFile = path.join(digestsDir, `${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(digest, null, 2)}\n`);
  progress(100);
  console.log(`DONE ${path.basename(outFile)}`);
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
