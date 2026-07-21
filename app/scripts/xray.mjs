// Portfolio X-ray: deterministic exposure math over portfolio.json (sector
// groups via each company's EDGAR SIC description, weights, concentration,
// warnings), plus an optional LLM narrative that may not contradict the
// numbers. Works fully offline-from-the-model: without a configured model it
// still writes the deterministic analysis.
//
// Usage: node app/scripts/xray.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { parsePortfolio, parseXray } from "@basis/schema";
import { isLlmConfigured, llmConfig, reasoningEffort, resolveModel } from "./llm.mjs";
import { readJsonMaybe, round, tsvCell } from "./lib/cli.mjs";
import { deriveWeights } from "./lib/portfolio.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { cikForTicker, edgarCacheDir, getSubmissions } from "./lib/edgar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

async function main() {
  const dir = ensureDataDir(REPO_ROOT);

  const portfolio = parsePortfolio(readJsonMaybe(path.join(dir, "portfolio.json")));
  if (portfolio.holdings.length === 0) fail("portfolio.json has no holdings — add positions first");

  const { weighting, weights } = deriveWeights(portfolio.holdings);
  const cacheDir = edgarCacheDir(REPO_ROOT);

  phase("classifying holdings by sector (EDGAR)");
  const sectors = [];
  for (let i = 0; i < portfolio.holdings.length; i++) {
    const h = portfolio.holdings[i];
    let sector = "Unknown";
    try {
      const company = await cikForTicker(h.ticker, cacheDir);
      if (company) {
        const sub = await getSubmissions(company.cik, cacheDir, { maxAgeMs: 7 * 24 * 3600_000 });
        sector = sub?.sicDescription || "Unknown";
      }
    } catch {
      // network failure on one ticker shouldn't sink the whole x-ray
    }
    sectors.push(sector);
    progress(5 + (i / portfolio.holdings.length) * 60);
  }

  // Group + rank.
  const byLabel = new Map();
  portfolio.holdings.forEach((h, i) => {
    const g = byLabel.get(sectors[i]) ?? { label: sectors[i], pct: 0, tickers: [] };
    g.pct += weights[i];
    if (!g.tickers.includes(h.ticker)) g.tickers.push(h.ticker);
    byLabel.set(sectors[i], g);
  });
  const bySector = [...byLabel.values()]
    .map((g) => ({ ...g, pct: round(Math.min(g.pct, 100)) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 64);

  const ranked = portfolio.holdings
    .map((h, i) => ({ ticker: h.ticker, pct: weights[i] }))
    .sort((a, b) => b.pct - a.pct);
  const topHoldings = ranked
    .slice(0, 20)
    .map((h) => ({ ticker: h.ticker, pct: round(Math.min(h.pct, 100)) }));
  const top1Pct = round(Math.min(ranked[0]?.pct ?? 0, 100));
  const top5Pct = round(
    Math.min(
      ranked.slice(0, 5).reduce((s, h) => s + h.pct, 0),
      100,
    ),
  );
  const sectorMaxPct = bySector[0]?.pct ?? 0;

  const warnings = [];
  if (weighting === "equal") {
    warnings.push(
      "No weights or cost basis provided — holdings were weighted equally. Add weights for a real read.",
    );
  }
  if (top1Pct > 20)
    warnings.push(`Single-position concentration: ${ranked[0].ticker} is ~${top1Pct}% of the portfolio.`);
  if (top5Pct > 60 && portfolio.holdings.length > 5)
    warnings.push(
      `Top-5 concentration: your five largest positions are ~${round(top5Pct)}% of the portfolio.`,
    );
  if (sectorMaxPct > 40 && bySector[0].label !== "Unknown")
    warnings.push(`Sector concentration: ~${sectorMaxPct}% sits in ${bySector[0].label}.`);
  if (portfolio.holdings.length < 5) warnings.push("Fewer than 5 positions — idiosyncratic risk is high.");
  const unknownCount = sectors.filter((s) => s === "Unknown").length;
  if (unknownCount > 0)
    warnings.push(
      `${unknownCount} holding(s) could not be classified (funds/ETFs and non-US listings have no EDGAR sector).`,
    );

  const xray = {
    version: 1,
    generatedAt: new Date().toISOString(),
    weighting,
    bySector,
    topHoldings,
    concentration: { top1Pct, top5Pct, sectorMaxPct },
    warnings: warnings.slice(0, 20),
  };

  if (isLlmConfigured()) {
    phase(`writing narrative with ${llmConfig().model}`);
    try {
      const { text } = await generateText({
        model: resolveModel(),
        prompt: [
          "You are a calm, plain-spoken portfolio coach for a beginner investor.",
          "Explain what this portfolio is actually exposed to, in 2-4 short paragraphs.",
          "Rules: the DETERMINISTIC METRICS below are ground truth — never contradict them or invent numbers.",
          "No buy/sell recommendations, no predictions. Explain risks and trade-offs; be honest, not alarmist.",
          "Plain text only (no markdown headings).",
          "",
          "=== DETERMINISTIC METRICS (ground truth) ===",
          JSON.stringify(
            { weighting, bySector, topHoldings, concentration: xray.concentration, warnings },
            null,
            2,
          ),
        ].join("\n"),
        maxOutputTokens: 2000,
        providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
      });
      xray.narrative = text.trim().slice(0, 8000);
    } catch {
      // Narrative is a bonus; the deterministic x-ray still lands.
    }
  }
  progress(95);

  const validated = parseXray(xray);
  fs.writeFileSync(path.join(dir, "xray.json"), `${JSON.stringify(validated, null, 2)}\n`);
  progress(100);
  console.log("DONE xray.json");
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
