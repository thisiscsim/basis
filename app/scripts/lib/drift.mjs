// Pure drift math: actual portfolio weights vs the IPS target allocation.
// No fs, no network — unit-tested in drift.test.mjs.

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Compare actual weights (percent, keyed by ticker) against the IPS target
 * buckets. Returns `{ drift, unassignedPct }` where drift rows are
 * `{label, targetPct, actualPct, driftPct}` (driftPct = actual - target,
 * clamped to ±100). Buckets without assigned tickers score 0 actual; weight
 * not claimed by any bucket is reported as `unassignedPct` so the UI can
 * prompt the user to finish the mapping.
 */
export function computeDrift(weightsByTicker, targetAllocation) {
  const buckets = (targetAllocation ?? []).filter((b) => b && typeof b.label === "string");
  if (buckets.length === 0) return { drift: [], unassignedPct: 0 };

  const claimed = new Set();
  const drift = buckets.map((bucket) => {
    let actual = 0;
    for (const ticker of bucket.tickers ?? []) {
      const t = String(ticker).toUpperCase();
      if (claimed.has(t)) continue; // first bucket wins on double-assignment
      if (weightsByTicker[t] != null) {
        actual += weightsByTicker[t];
        claimed.add(t);
      }
    }
    const targetPct = Math.min(Math.max(bucket.pct ?? 0, 0), 100);
    const actualPct = Math.min(Math.max(actual, 0), 100);
    return {
      label: bucket.label,
      targetPct: round1(targetPct),
      actualPct: round1(actualPct),
      driftPct: round1(Math.min(Math.max(actualPct - targetPct, -100), 100)),
    };
  });

  let unassigned = 0;
  for (const [ticker, pct] of Object.entries(weightsByTicker)) {
    if (!claimed.has(String(ticker).toUpperCase())) unassigned += pct;
  }
  return { drift, unassignedPct: round1(Math.min(Math.max(unassigned, 0), 100)) };
}
