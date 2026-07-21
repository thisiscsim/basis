// Minimal SEC EDGAR client (plain fetch, no key needed). Fair-access rules:
// a declarative User-Agent with contact info and <= 10 requests/second —
// https://www.sec.gov/os/accessing-edgar-data. All responses are cached on
// disk so re-runs (and the diff step) don't re-hit the API.
//
//   BASIS_EDGAR_UA       full User-Agent override (optional)
//   BASIS_EDGAR_CONTACT  contact email interpolated into the default UA
//   BASIS_CACHE_DIR      shared cache root (the app exports this; dev fallback <repo>/.cache)
import fs from "node:fs";
import path from "node:path";

const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const TICKER_MAP_MAX_AGE_MS = 7 * 24 * 3600_000;
const SUBMISSIONS_MAX_AGE_MS = 3600_000;

export function edgarUserAgent() {
  if (process.env.BASIS_EDGAR_UA) return process.env.BASIS_EDGAR_UA;
  const contact = process.env.BASIS_EDGAR_CONTACT || "unset-contact@example.com";
  return `Basis research assistant ${contact}`;
}

/** Shared on-disk cache root for EDGAR responses. */
export function edgarCacheDir(repoRoot) {
  const root = process.env.BASIS_CACHE_DIR || path.join(repoRoot, ".cache");
  const dir = path.join(root, "edgar");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- polite fetching: >=120ms between requests (comfortably under 10/s),
// one retry with backoff on 429/503. ----
let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function edgarFetch(url, { asText = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + 120 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const res = await fetch(url, {
      headers: { "User-Agent": edgarUserAgent(), "Accept-Encoding": "gzip, deflate" },
    });
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      await sleep(2000);
      continue;
    }
    if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
    return asText ? res.text() : res.json();
  }
}

function readCache(file, maxAgeMs) {
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < maxAgeMs) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {
    // no cache / stale / unreadable
  }
  return null;
}

function writeCache(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

/** Zero-pad a CIK to the 10 digits data.sec.gov expects. */
export function padCik(cik) {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

/**
 * Resolve a ticker to `{ cik, name }` via the SEC's company_tickers.json
 * (cached for a week). Returns null for unknown tickers.
 */
export async function cikForTicker(ticker, cacheDir) {
  const file = path.join(cacheDir, "company_tickers.json");
  let map = readCache(file, TICKER_MAP_MAX_AGE_MS);
  if (!map) {
    map = await edgarFetch(TICKER_MAP_URL);
    writeCache(file, map);
  }
  const want = String(ticker).toUpperCase();
  for (const row of Object.values(map)) {
    if (String(row.ticker).toUpperCase() === want) {
      return { cik: String(row.cik_str), name: row.title };
    }
  }
  return null;
}

/** Fetch (with a 1h cache) a company's submissions index from data.sec.gov. */
export async function getSubmissions(cik, cacheDir, { maxAgeMs = SUBMISSIONS_MAX_AGE_MS } = {}) {
  const padded = padCik(cik);
  const file = path.join(cacheDir, "submissions", `CIK${padded}.json`);
  const cached = readCache(file, maxAgeMs);
  if (cached) return cached;
  const data = await edgarFetch(`https://data.sec.gov/submissions/CIK${padded}.json`);
  writeCache(file, data);
  return data;
}

/**
 * Flatten the columnar `filings.recent` structure into row objects
 * (newest first, as EDGAR returns them). `forms` filters by exact form type.
 */
export function recentFilings(submissions, { forms, limit = 40 } = {}) {
  const r = submissions?.filings?.recent;
  if (!r || !Array.isArray(r.accessionNumber)) return [];
  const out = [];
  for (let i = 0; i < r.accessionNumber.length && out.length < limit; i++) {
    const form = r.form?.[i] ?? "";
    if (forms && !forms.includes(form)) continue;
    out.push({
      accession: r.accessionNumber[i],
      form,
      filedAt: r.filingDate?.[i] ?? "",
      primaryDoc: r.primaryDocument?.[i] ?? "",
      title: r.primaryDocDescription?.[i] || form,
    });
  }
  return out;
}

/** Human-viewable URL for a filing document on sec.gov. */
export function filingDocUrl(cik, accession, primaryDoc) {
  const bare = String(accession).replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(padCik(cik))}/${bare}/${primaryDoc}`;
}

/**
 * Fetch a filing's primary document into `destDir/<accession>/<basename>`
 * (skips the network when already cached). Returns { file, text, url }.
 */
export async function fetchFilingDoc(cik, accession, primaryDoc, destDir) {
  const url = filingDocUrl(cik, accession, primaryDoc);
  // primaryDoc can contain a subpath (e.g. "xslF345X05/form4.xml"); flatten it.
  const name = path.basename(primaryDoc) || "document.htm";
  const file = path.join(destDir, accession, name);
  if (fs.existsSync(file)) {
    return { file, text: fs.readFileSync(file, "utf8"), url };
  }
  const text = await edgarFetch(url, { asText: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { file, text, url };
}
