// Pure portfolio math shared by the X-ray. No fs, no network — unit-tested in
// portfolio.test.mjs.

/**
 * Derive each holding's weight (percent of portfolio), plus which basis was
 * used. Priority: explicit weightPct on EVERY holding (normalized to 100) ->
 * costBasis on every holding -> equal weight. Mixed/partial data falls back to
 * equal so a single missing field can't silently skew the analysis.
 */
export function deriveWeights(holdings) {
  const withWeight = holdings.filter((h) => typeof h.weightPct === "number" && h.weightPct > 0);
  if (withWeight.length === holdings.length) {
    const total = holdings.reduce((s, h) => s + h.weightPct, 0);
    if (total > 0) {
      return { weighting: "weights", weights: holdings.map((h) => (h.weightPct / total) * 100) };
    }
  }
  const withCost = holdings.filter((h) => typeof h.costBasis === "number" && h.costBasis > 0);
  if (withCost.length === holdings.length) {
    const total = holdings.reduce((s, h) => s + h.costBasis, 0);
    if (total > 0) {
      return { weighting: "costBasis", weights: holdings.map((h) => (h.costBasis / total) * 100) };
    }
  }
  return { weighting: "equal", weights: holdings.map(() => 100 / holdings.length) };
}
