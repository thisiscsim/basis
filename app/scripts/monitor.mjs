// Watchlist monitor: for every ticker in watchlist.json, check EDGAR for
// filings newer than the stored cursor, append them to alerts.json, and cache
// the primary documents of 10-K/10-Q filings (current + prior of the same
// form) so diff-llm.mjs can compare them offline. Deterministic — no LLM.
//
// Usage: node app/scripts/monitor.mjs --slug <workspace>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAlerts, parseWatchlist } from "@basis/schema";
import { arg, readJsonMaybe, tsvCell } from "./lib/cli.mjs";
import { resolveWorkspaceDir } from "./lib/workspace-dir.mjs";
import {
  cikForTicker,
  edgarCacheDir,
  fetchFilingDoc,
  filingDocUrl,
  getSubmissions,
  recentFilings,
} from "./lib/edgar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const WATCHED_FORMS = ["10-K", "10-Q", "8-K", "20-F", "DEF 14A"];
const DIFFABLE_FORMS = new Set(["10-K", "10-Q", "20-F"]);
const FIRST_RUN_ALERTS = 3;
const MAX_NEW_PER_TICKER = 20;

/** Record what we cached for a CIK so diff-llm can find prior filings without re-hitting EDGAR. */
function updateFilingIndex(cikDir, entry) {
  const file = path.join(cikDir, "index.json");
  const index = readJsonMaybe(file) ?? { filings: [] };
  if (!index.filings.some((f) => f.accession === entry.accession)) {
    index.filings.push(entry);
    index.filings.sort((a, b) => String(b.filedAt).localeCompare(String(a.filedAt)));
    fs.mkdirSync(cikDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`);
  }
}

async function cacheFiling(cik, filing, cikDir) {
  if (!filing.primaryDoc) return;
  try {
    const doc = await fetchFilingDoc(cik, filing.accession, filing.primaryDoc, cikDir);
    updateFilingIndex(cikDir, {
      accession: filing.accession,
      form: filing.form,
      filedAt: filing.filedAt,
      primaryDoc: path.basename(filing.primaryDoc),
      file: path.relative(cikDir, doc.file),
    });
  } catch {
    // caching is best-effort; the alert still lands with its URL
  }
}

async function main() {
  const slug = arg("slug");
  if (!slug) fail("usage: monitor.mjs --slug <workspace>");
  const dir = resolveWorkspaceDir(REPO_ROOT, slug);
  if (!fs.existsSync(dir)) fail(`workspace not found: ${slug}`);

  const watchlistFile = path.join(dir, "watchlist.json");
  const watchlist = parseWatchlist(readJsonMaybe(watchlistFile));
  if (watchlist.entries.length === 0) {
    console.log("DONE 0 new filings (watchlist is empty)");
    return;
  }
  const alertsFile = path.join(dir, "alerts.json");
  const alerts = parseAlerts(readJsonMaybe(alertsFile));
  const known = new Set(alerts.alerts.map((a) => a.id));
  const cacheDir = edgarCacheDir(REPO_ROOT);

  let totalNew = 0;
  for (let i = 0; i < watchlist.entries.length; i++) {
    const entry = watchlist.entries[i];
    phase(`checking ${entry.ticker}`);
    try {
      if (!entry.cik) {
        const company = await cikForTicker(entry.ticker, cacheDir);
        if (!company) {
          progress(((i + 1) / watchlist.entries.length) * 100);
          continue;
        }
        entry.cik = company.cik;
        if (!entry.name) entry.name = company.name;
      }
      // Force a fresh submissions read — monitoring stale data is pointless.
      const submissions = await getSubmissions(entry.cik, cacheDir, { maxAgeMs: 10 * 60_000 });
      const filings = recentFilings(submissions, { forms: WATCHED_FORMS, limit: 40 });

      const firstRun = !entry.lastSeenAccession;
      const fresh = [];
      for (const filing of filings) {
        if (!firstRun && filing.accession === entry.lastSeenAccession) break;
        fresh.push(filing);
        if (fresh.length >= (firstRun ? FIRST_RUN_ALERTS : MAX_NEW_PER_TICKER)) break;
      }

      const cikDir = path.join(dir, "filings", entry.cik);
      for (const filing of fresh) {
        if (known.has(filing.accession)) continue;
        alerts.alerts.unshift({
          id: filing.accession,
          ticker: entry.ticker,
          form: filing.form,
          filedAt: filing.filedAt,
          accession: filing.accession,
          title: `${entry.ticker} filed a ${filing.form}${filing.title && filing.title !== filing.form ? ` — ${filing.title}` : ""}`,
          url: filing.primaryDoc ? filingDocUrl(entry.cik, filing.accession, filing.primaryDoc) : undefined,
          read: false,
        });
        known.add(filing.accession);
        totalNew++;
        if (DIFFABLE_FORMS.has(filing.form)) {
          phase(`caching ${entry.ticker} ${filing.form} for diffing`);
          await cacheFiling(entry.cik, filing, cikDir);
          // Also cache the PRIOR same-form filing so the diff has a baseline.
          const prior = recentFilings(submissions, { forms: [filing.form], limit: 10 }).find(
            (f) => f.accession !== filing.accession && f.filedAt <= filing.filedAt,
          );
          if (prior) await cacheFiling(entry.cik, prior, cikDir);
        }
      }
      if (filings[0]) entry.lastSeenAccession = filings[0].accession;
      entry.lastCheckedAt = new Date().toISOString();
    } catch (err) {
      // One ticker failing (rate limit, network) shouldn't sink the run.
      console.error(`ERROR ${entry.ticker}: ${err?.message ?? err}`);
    }
    progress(((i + 1) / watchlist.entries.length) * 100);
  }

  alerts.alerts = alerts.alerts.slice(0, 500);
  fs.writeFileSync(alertsFile, `${JSON.stringify(parseAlerts(alerts), null, 2)}\n`);
  fs.writeFileSync(watchlistFile, `${JSON.stringify(parseWatchlist(watchlist), null, 2)}\n`);
  console.log(`DONE ${totalNew} new filing${totalNew === 1 ? "" : "s"}`);
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
