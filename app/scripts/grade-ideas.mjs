// Grade the idea log: for every idea with a ticker, pin the close at log
// time (lazily, first run after logging) and compute the since-log return vs
// SPY. Deterministic — no LLM. The output is the honest mirror: did the
// system's (and the user's) ideas actually have any edge?
//
// Usage: node app/scripts/grade-ideas.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIdeas } from "@basis/schema";
import { readJsonMaybe, round, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { edgarCacheDir } from "./lib/edgar.mjs";
import { closeOnOrBefore, fetchDailyCloses, latestClose } from "./lib/prices.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const BENCHMARK = "SPY";

async function main() {
  const dir = ensureDataDir(REPO_ROOT);
  const file = path.join(dir, "ideas.json");
  const ideas = parseIdeas(readJsonMaybe(file));
  const gradable = ideas.ideas.filter((i) => i.ticker);
  if (gradable.length === 0) {
    console.log("DONE 0 ideas graded (none carry a ticker)");
    return;
  }

  const cacheDir = edgarCacheDir(REPO_ROOT);
  phase("fetching benchmark history");
  const benchmark = await fetchDailyCloses(BENCHMARK, cacheDir);
  const benchmarkNow = latestClose(benchmark)?.close ?? null;

  let graded = 0;
  for (let i = 0; i < gradable.length; i++) {
    const idea = gradable[i];
    phase(`grading ${idea.ticker}`);
    try {
      const series = await fetchDailyCloses(idea.ticker, cacheDir);
      const now = latestClose(series)?.close;
      if (now == null) continue; // unresolvable ticker: leave ungraded

      // Pin the at-log prices once; later runs only refresh the return.
      if (idea.priceAtLog == null) idea.priceAtLog = closeOnOrBefore(series, idea.at)?.close ?? undefined;
      if (idea.benchmarkPriceAtLog == null)
        idea.benchmarkPriceAtLog = closeOnOrBefore(benchmark, idea.at)?.close ?? undefined;
      if (idea.priceAtLog == null) continue;

      idea.returnPct = round((now / idea.priceAtLog - 1) * 100);
      if (idea.benchmarkPriceAtLog != null && benchmarkNow != null) {
        idea.benchmarkReturnPct = round((benchmarkNow / idea.benchmarkPriceAtLog - 1) * 100);
      }
      idea.gradedAt = new Date().toISOString();
      graded++;
    } catch {
      // one ticker failing shouldn't sink the run
    }
    progress(((i + 1) / gradable.length) * 100);
  }

  fs.writeFileSync(file, `${JSON.stringify(parseIdeas(ideas), null, 2)}\n`);
  console.log(`DONE ${graded} idea${graded === 1 ? "" : "s"} graded vs ${BENCHMARK}`);
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
