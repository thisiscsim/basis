import { describe, expect, it } from "vitest";
import { computeDrift } from "./drift.mjs";

const weights = { AAPL: 40, MSFT: 25, JNJ: 20, BND: 15 };

describe("computeDrift", () => {
  it("computes actual vs target per bucket and the drift delta", () => {
    const { drift, unassignedPct } = computeDrift(weights, [
      { label: "US equities", pct: 70, tickers: ["AAPL", "MSFT", "JNJ"] },
      { label: "Bonds", pct: 30, tickers: ["BND"] },
    ]);
    expect(drift).toEqual([
      { label: "US equities", targetPct: 70, actualPct: 85, driftPct: 15 },
      { label: "Bonds", targetPct: 30, actualPct: 15, driftPct: -15 },
    ]);
    expect(unassignedPct).toBe(0);
  });

  it("reports weight not claimed by any bucket", () => {
    const { drift, unassignedPct } = computeDrift(weights, [
      { label: "Equities", pct: 100, tickers: ["AAPL"] },
    ]);
    expect(drift[0].actualPct).toBe(40);
    expect(unassignedPct).toBe(60);
  });

  it("first bucket wins when a ticker is assigned twice", () => {
    const { drift } = computeDrift(weights, [
      { label: "A", pct: 50, tickers: ["AAPL"] },
      { label: "B", pct: 50, tickers: ["AAPL", "MSFT"] },
    ]);
    expect(drift[0].actualPct).toBe(40);
    expect(drift[1].actualPct).toBe(25); // AAPL not double-counted
  });

  it("no buckets -> no drift", () => {
    expect(computeDrift(weights, [])).toEqual({ drift: [], unassignedPct: 0 });
  });
});
