import { describe, expect, it } from "vitest";
import { deriveWeights } from "./portfolio.mjs";

describe("deriveWeights", () => {
  it("uses explicit weights when every holding has one, normalized to 100", () => {
    const { weighting, weights } = deriveWeights([
      { ticker: "AAPL", weightPct: 20 },
      { ticker: "MSFT", weightPct: 20 },
      { ticker: "JNJ", weightPct: 10 },
    ]);
    expect(weighting).toBe("weights");
    expect(weights.map(Math.round)).toEqual([40, 40, 20]);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });

  it("falls back to cost basis when weights are incomplete but cost is complete", () => {
    const { weighting, weights } = deriveWeights([
      { ticker: "AAPL", weightPct: 50, costBasis: 3000 },
      { ticker: "MSFT", costBasis: 1000 },
    ]);
    expect(weighting).toBe("costBasis");
    expect(weights.map(Math.round)).toEqual([75, 25]);
  });

  it("equal-weights when neither weights nor cost basis are complete", () => {
    const { weighting, weights } = deriveWeights([
      { ticker: "AAPL", weightPct: 50 },
      { ticker: "MSFT" },
      { ticker: "JNJ" },
    ]);
    expect(weighting).toBe("equal");
    expect(weights.map(Math.round)).toEqual([33, 33, 33]);
  });

  it("ignores zero/garbage weights rather than dividing by zero", () => {
    const { weighting } = deriveWeights([
      { ticker: "AAPL", weightPct: 0 },
      { ticker: "MSFT", weightPct: 0 },
    ]);
    expect(weighting).toBe("equal");
  });
});
