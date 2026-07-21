// Knowledge-graph extraction: for watched/held tickers with cached filings,
// pull business relationships (suppliers, customers, partners, competitors)
// out of 10-K Item 1/1A text — every edge carrying an exact verbatim quote,
// verified against the filing before it reaches disk. Edges merge into
// graph.json; unverified claims are dropped, not shown. Capped per run to
// keep token spend sane.
//
// Usage: node app/scripts/graph-llm.mjs
// Exit codes: 0 ok, 1 unexpected, 2 domain failure, 3 LLM not configured.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { extractJson, parseGraph, parsePortfolio, parseWatchlist, TickerSchema } from "@basis/schema";
import { isLlmConfigured, reasoningEffort, resolveModel } from "./llm.mjs";
import { readJsonMaybe, readMaybe, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { extractItem, htmlToText, truncate, verifyQuote } from "./lib/filings.mjs";
import { edgeId, mergeEdges } from "./lib/graph.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const MAX_TICKERS_PER_RUN = 3;
const REEXTRACT_AFTER_MS = 30 * 24 * 3600_000;
const RELS = new Set(["supplier", "customer", "partner", "competitor", "investor", "subsidiary", "other"]);
const SECTION_BUDGET = 16_000;

function buildPrompt(ticker, excerpts, retryError) {
  const parts = [
    `You are extracting business relationships for ${ticker} from its own SEC filing text.`,
    "Hard rules:",
    "- Use ONLY the excerpts below. Every relationship MUST include an exact verbatim quote (<= 2 sentences, copied character-for-character). Relationships whose quotes are not exact excerpts will be deleted.",
    `- rel must be one of: "supplier" (they supply ${ticker}), "customer", "partner", "competitor", "investor", "subsidiary", "other".`,
    "- toTicker: include the counterparty's stock ticker ONLY if the excerpt itself makes the company unambiguous and it is a well-known US-listed company; otherwise omit it.",
    "- Only concrete named companies. No generic categories ('our suppliers'), no speculation.",
    "",
    "Return ONLY this JSON (no prose, no code fences):",
    '{ "edges": [ { "to": "<company name as written>", "toTicker": "<TICKER or omit>", "rel": "supplier", "quote": "<verbatim excerpt>" } ] }',
    "",
    "3-12 edges. Fewer is fine; fabricating is not.",
  ];
  for (const ex of excerpts) parts.push("", `=== ${ex.label} ===`, ex.text);
  if (retryError)
    parts.push("", `Your previous output was invalid: ${retryError}`, "Return corrected JSON only.");
  return parts.join("\n");
}

async function extractForTicker(ticker, cikDir, filing, model) {
  const raw = readMaybe(path.join(cikDir, filing.accession, filing.primaryDoc));
  if (!raw) return null;
  const text = htmlToText(raw);
  const excerpts = [];
  for (const [item, label] of [
    ["1", "Business"],
    ["1A", "Risk Factors"],
  ]) {
    const section = extractItem(text, item);
    if (section)
      excerpts.push({
        label: `${filing.form} Item ${item} (${label})`,
        text: truncate(section, SECTION_BUDGET),
      });
  }
  if (excerpts.length === 0)
    excerpts.push({ label: `${filing.form} (front matter)`, text: truncate(text, SECTION_BUDGET) });

  const cik = path.basename(cikDir);
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replace(/-/g, "")}/${filing.primaryDoc}`;
  const source = `${filing.form} filed ${filing.filedAt}`;

  let parsedEdges = null;
  let retryError = null;
  for (let attempt = 0; attempt < 2 && !parsedEdges; attempt++) {
    try {
      const { text: out } = await generateText({
        model,
        prompt: buildPrompt(ticker, excerpts, retryError),
        maxOutputTokens: 4000,
        providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
      });
      const data = extractJson(out);
      if (!Array.isArray(data?.edges)) throw new Error("no edges array");
      parsedEdges = data.edges;
    } catch (err) {
      retryError = String(err?.message ?? err);
    }
  }
  if (!parsedEdges) return { edges: [], dropped: 0 };

  // Deterministic verification + shaping: quotes must be verbatim, rels sane.
  const edges = [];
  let dropped = 0;
  for (const e of parsedEdges.slice(0, 20)) {
    const to = String(e?.to ?? "")
      .trim()
      .slice(0, 256);
    const quote = String(e?.quote ?? "")
      .trim()
      .slice(0, 1500);
    const rel = RELS.has(e?.rel) ? e.rel : "other";
    const toTickerParse = TickerSchema.safeParse(
      String(e?.toTicker ?? "")
        .toUpperCase()
        .trim(),
    );
    if (!to || !quote || !verifyQuote(quote, text)) {
      dropped++;
      continue;
    }
    const edge = {
      id: "",
      from: ticker,
      to,
      toTicker: toTickerParse.success ? toTickerParse.data : undefined,
      rel,
      quote,
      source,
      sourceUrl,
      accession: filing.accession,
      verified: true,
      extractedAt: new Date().toISOString(),
    };
    edge.id = edgeId(edge);
    edges.push(edge);
  }
  return { edges, dropped };
}

async function main() {
  if (!isLlmConfigured()) fail("No model configured.", 3);
  const dir = ensureDataDir(REPO_ROOT);

  const watchlist = parseWatchlist(readJsonMaybe(path.join(dir, "watchlist.json")));
  const portfolio = parsePortfolio(readJsonMaybe(path.join(dir, "portfolio.json")));
  const graphFile = path.join(dir, "graph.json");
  const graph = parseGraph(readJsonMaybe(graphFile));

  // Tickers with a cached CIK dir, skipping ones extracted recently.
  const cutoff = Date.now() - REEXTRACT_AFTER_MS;
  const recentlyExtracted = new Set(
    graph.edges.filter((e) => e.extractedAt && new Date(e.extractedAt).getTime() > cutoff).map((e) => e.from),
  );
  const cikByTicker = new Map(watchlist.entries.filter((e) => e.cik).map((e) => [e.ticker, e.cik]));
  const candidates = [
    ...new Set([...watchlist.entries.map((e) => e.ticker), ...portfolio.holdings.map((h) => h.ticker)]),
  ]
    .filter((t) => cikByTicker.has(t) && !recentlyExtracted.has(t))
    .slice(0, MAX_TICKERS_PER_RUN);

  if (candidates.length === 0) {
    console.log("DONE 0 new edges (nothing to extract — run Update filings first, or all fresh)");
    return;
  }

  const model = resolveModel();
  let totalAdded = 0;
  let totalDropped = 0;
  for (let i = 0; i < candidates.length; i++) {
    const ticker = candidates[i];
    phase(`extracting relationships for ${ticker}`);
    try {
      const cikDir = path.join(dir, "filings", cikByTicker.get(ticker));
      const index = readJsonMaybe(path.join(cikDir, "index.json"));
      const annual = index?.filings?.find((f) => (f.form === "10-K" || f.form === "20-F") && f.primaryDoc);
      if (!annual) continue; // no cached annual yet
      const result = await extractForTicker(ticker, cikDir, annual, model);
      if (result) {
        const merged = mergeEdges(graph.edges, result.edges);
        graph.edges = merged.edges;
        totalAdded += merged.added;
        totalDropped += result.dropped;
      }
    } catch (err) {
      console.error(`ERROR ${ticker}: ${err?.message ?? err}`);
    }
    progress(((i + 1) / candidates.length) * 100);
  }

  fs.writeFileSync(graphFile, `${JSON.stringify(parseGraph(graph), null, 2)}\n`);
  console.log(
    `DONE ${totalAdded} new edge${totalAdded === 1 ? "" : "s"}${totalDropped ? ` (${totalDropped} dropped by citation check)` : ""}`,
  );
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
