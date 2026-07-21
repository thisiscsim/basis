// Paper-trading maintenance: fill pending orders at the next day's close and
// mark the account to market vs buy-and-hold SPY. Deterministic — no LLM.
// Chained into Update filings and runnable on demand from the Lab.
//
// Usage: node app/scripts/paper-mark.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePaper } from "@basis/schema";
import { readJsonMaybe, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { edgarCacheDir } from "./lib/edgar.mjs";
import { fetchDailyCloses } from "./lib/prices.mjs";
import { applyFills, markToMarket } from "./lib/paper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const BENCHMARK = "SPY";

async function main() {
  const dir = ensureDataDir(REPO_ROOT);
  const file = path.join(dir, "paper.json");
  const account = parsePaper(readJsonMaybe(file));
  const tickers = new Set([
    ...account.positions.map((p) => p.ticker),
    ...account.orders.filter((o) => o.status === "pending").map((o) => o.ticker),
  ]);
  if (tickers.size === 0 && !account.startedAt) {
    console.log("DONE paper account idle (no positions or pending orders)");
    return;
  }

  const cacheDir = edgarCacheDir(REPO_ROOT);
  phase("fetching closes for paper account");
  const seriesByTicker = {};
  for (const t of tickers) {
    seriesByTicker[t] = await fetchDailyCloses(t, cacheDir);
  }
  const benchmark = await fetchDailyCloses(BENCHMARK, cacheDir);

  phase("filling pending orders");
  const { account: filled, fills, rejections } = applyFills(account, seriesByTicker);
  phase("marking to market");
  const marked = markToMarket(filled, seriesByTicker, benchmark);

  fs.writeFileSync(file, `${JSON.stringify(parsePaper(marked), null, 2)}\n`);
  console.log(
    `DONE ${fills} fill${fills === 1 ? "" : "s"}${rejections ? `, ${rejections} rejected` : ""}, equity marked`,
  );
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
