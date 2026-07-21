// Daily-close price layer. Default provider is Yahoo Finance's public chart
// API (free JSON, no key or account — Stooq was the original pick but now
// fronts a JavaScript proof-of-work wall); Tiingo is an optional keyed
// upgrade. Everything downstream (drift, idea grading, backtests, paper
// fills) works on end-of-day closes only.
//
//   BASIS_PRICES_PROVIDER   yahoo | tiingo     (default: yahoo)
//   BASIS_PRICES_API_KEY    Tiingo token       (required for tiingo)
//   BASIS_CACHE_DIR         shared cache root (series cached ~20h)
import fs from "node:fs";
import path from "node:path";

const CACHE_MAX_AGE_MS = 20 * 3600_000;

export function pricesProvider() {
  const v = (process.env.BASIS_PRICES_PROVIDER || "yahoo").toLowerCase();
  return v === "tiingo" && process.env.BASIS_PRICES_API_KEY ? "tiingo" : "yahoo";
}

/** Map a ticker to Yahoo's symbol convention (class shares use dashes: BRK.B -> BRK-B). */
export function yahooSymbol(ticker) {
  return String(ticker).toUpperCase().replace(/\./g, "-");
}

/**
 * Parse a Yahoo v8 chart response into `{date, close}[]`, oldest first.
 * Prefers adjusted closes (splits/dividends) and skips null gaps.
 */
export function parseYahooChart(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  if (!result || !Array.isArray(timestamps)) return [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const raw = result.indicators?.quote?.[0]?.close;
  const closes = Array.isArray(adj) ? adj : Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = Number(timestamps[i]);
    const close = Number(closes[i]);
    if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close });
  }
  return out;
}

/** Latest close in a series (or null). */
export function latestClose(series) {
  return series.length > 0 ? series[series.length - 1] : null;
}

/**
 * The close on the given ISO date, or the nearest earlier trading day
 * (weekends/holidays). Null when the series starts after the date.
 */
export function closeOnOrBefore(series, isoDate) {
  const day = String(isoDate).slice(0, 10);
  let best = null;
  for (const row of series) {
    if (row.date > day) break;
    best = row;
  }
  return best;
}

// Polite fetching: small gap between requests, one retry on 429/503.
let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(url, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + 250 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const res = await fetch(url, { headers });
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      await sleep(2000);
      continue;
    }
    if (!res.ok) throw new Error(`prices HTTP ${res.status} for ${url}`);
    return res.text();
  }
}

function cacheFile(cacheDir, provider, ticker) {
  return path.join(cacheDir, "prices", `${provider}-${String(ticker).toUpperCase()}.json`);
}

async function fetchYahoo(ticker) {
  // Explicit period1/period2 — `range=max` silently downsamples to monthly
  // rows, which would poison every daily computation downstream.
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(ticker))}?period1=0&period2=${period2}&interval=1d`;
  // Yahoo rejects requests without a browser-ish User-Agent.
  const text = await politeFetch(url, { "User-Agent": "Mozilla/5.0 (Basis local research app)" });
  return parseYahooChart(JSON.parse(text));
}

async function fetchTiingo(ticker) {
  const token = process.env.BASIS_PRICES_API_KEY;
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(String(ticker).toLowerCase())}/prices?startDate=1990-01-01&token=${encodeURIComponent(token)}`;
  const rows = JSON.parse(await politeFetch(url, { Accept: "application/json" }));
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ date: String(r.date).slice(0, 10), close: Number(r.adjClose ?? r.close) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.close) && r.close > 0);
}

/**
 * Full daily-close history for a ticker, oldest first, cached on disk for
 * ~20h. Returns [] when the ticker can't be resolved (foreign listings,
 * private funds) — callers degrade gracefully.
 */
export async function fetchDailyCloses(ticker, cacheDir) {
  const provider = pricesProvider();
  const file = cacheFile(cacheDir, provider, ticker);
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < CACHE_MAX_AGE_MS) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {
    // no cache / stale
  }
  let series = [];
  try {
    series = provider === "tiingo" ? await fetchTiingo(ticker) : await fetchYahoo(ticker);
  } catch {
    // Network/provider failure: fall back to a stale cache if one exists.
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(series));
  } catch {
    // caching is best-effort
  }
  return series;
}
