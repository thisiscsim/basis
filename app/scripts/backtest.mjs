// Run one preset backtest over real daily closes and write the result (with
// deterministic warnings + an optional LLM bias audit) to lab/backtests/.
// The engine is lib/backtest.mjs; the copilot's job here is to explain why
// results are suspicious — it never generates signals.
//
// Usage: node app/scripts/backtest.mjs --preset ma200-trend --tickers SPY,QQQ [--from 2015-01-01] [--to ...] [--costBps 5]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { BacktestConfigSchema, parseBacktest } from "@basis/schema";
import { isLlmConfigured, llmConfig, reasoningEffort, resolveModel } from "./llm.mjs";
import { arg, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { edgarCacheDir } from "./lib/edgar.mjs";
import { fetchDailyCloses } from "./lib/prices.mjs";
import { computeMetrics, downsampleCurve, runPreset } from "./lib/backtest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

function deterministicWarnings(config, dates) {
  const warnings = ["In-sample only: this window was chosen after the fact, which flatters every strategy."];
  if (config.costBps === 0) {
    warnings.push("Zero trading costs modeled — real spreads/slippage would eat part of any edge.");
  }
  const years = dates.length / 252;
  if (years < 3) {
    warnings.push(
      `Short window (~${Math.round(years * 10) / 10}y): too little history to distinguish edge from luck.`,
    );
  }
  warnings.push(
    "Survivorship bias: you picked tickers that exist today; strategies tested on them look better than they were.",
  );
  if (config.preset !== "buy-and-hold") {
    warnings.push("Short-term gains are taxed as ordinary income — after-tax results are worse than shown.");
  }
  return warnings;
}

async function auditNotes(config, metrics, benchmarkMetrics, warnings) {
  if (!isLlmConfigured()) return [];
  phase(`bias audit with ${llmConfig().model}`);
  try {
    const { text } = await generateText({
      model: resolveModel(),
      prompt: [
        "You are a skeptical quant reviewer auditing a beginner's backtest for methodological problems.",
        "Rules: the numbers below are ground truth; never contradict them, never suggest new strategies or trades.",
        "Review for: lookahead bias, survivorship bias, overfitting/data mining, unrealistic costs, regime dependence, and whether the strategy actually beats buy-and-hold AFTER honesty adjustments.",
        "Return 3-5 short bullet lines (no markdown bullets, one note per line, <= 2 sentences each), most important first.",
        "",
        "=== CONFIG ===",
        JSON.stringify(config),
        "=== STRATEGY METRICS ===",
        JSON.stringify(metrics),
        "=== BUY-AND-HOLD BENCHMARK (same tickers, same window) ===",
        JSON.stringify(benchmarkMetrics),
        "=== DETERMINISTIC WARNINGS ALREADY SHOWN ===",
        JSON.stringify(warnings),
      ].join("\n"),
      maxOutputTokens: 1200,
      providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
    });
    return text
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter((l) => l.length > 10)
      .slice(0, 10)
      .map((l) => l.slice(0, 1000));
  } catch {
    return []; // the deterministic result stands on its own
  }
}

async function main() {
  const rawConfig = {
    preset: arg("preset"),
    tickers: (arg("tickers") ?? "")
      .split(/[\s,]+/)
      .map((t) => t.toUpperCase().trim())
      .filter(Boolean),
    from: arg("from") ?? "2015-01-01",
    to: arg("to") || undefined,
    costBps: arg("costBps") != null ? Number(arg("costBps")) : undefined,
  };
  const parsed = BacktestConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    fail(`invalid config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const config = parsed.data;
  const dir = ensureDataDir(REPO_ROOT);
  const cacheDir = edgarCacheDir(REPO_ROOT);

  phase("fetching price history");
  const seriesByTicker = {};
  const missing = [];
  for (let i = 0; i < config.tickers.length; i++) {
    const t = config.tickers[i];
    const series = await fetchDailyCloses(t, cacheDir);
    if (series.length === 0) missing.push(t);
    else seriesByTicker[t] = series;
    progress(5 + (i / config.tickers.length) * 40);
  }
  if (missing.length > 0) fail(`no price history for: ${missing.join(", ")}`);

  phase(`running ${config.preset}`);
  let run;
  let benchmarkRun;
  try {
    run = runPreset(config.preset, seriesByTicker, config);
    benchmarkRun = runPreset("buy-and-hold", seriesByTicker, { ...config, costBps: config.costBps });
  } catch (err) {
    fail(err?.message ?? String(err));
  }
  const metrics = computeMetrics(run);
  const benchmarkMetrics = computeMetrics(benchmarkRun);
  const warnings = deterministicWarnings(config, run.dates);
  progress(60);

  const notes = await auditNotes(config, metrics, benchmarkMetrics, warnings);
  progress(90);

  const id = `${config.preset}-${Date.now().toString(36)}`;
  const backtest = parseBacktest({
    version: 1,
    id,
    generatedAt: new Date().toISOString(),
    config,
    metrics,
    benchmarkMetrics,
    equityCurve: downsampleCurve(run.dates, run.equity, benchmarkRun.equity),
    warnings,
    auditNotes: notes,
  });

  const outDir = path.join(dir, "lab", "backtests");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${id}.json`), `${JSON.stringify(backtest, null, 2)}\n`);
  progress(100);
  console.log(`DONE ${id}.json`);
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
