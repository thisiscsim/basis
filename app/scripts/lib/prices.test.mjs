import { describe, expect, it } from "vitest";
import { closeOnOrBefore, latestClose, parseYahooChart, yahooSymbol } from "./prices.mjs";

describe("yahooSymbol", () => {
  it("uppercases and dashes class-share dots", () => {
    expect(yahooSymbol("aapl")).toBe("AAPL");
    expect(yahooSymbol("BRK.B")).toBe("BRK-B");
  });
});

describe("parseYahooChart", () => {
  const day = 24 * 3600;
  const t0 = Math.floor(new Date("2026-07-16T14:30:00Z").getTime() / 1000);
  const payload = {
    chart: {
      result: [
        {
          timestamp: [t0, t0 + day, t0 + 2 * day],
          indicators: {
            quote: [{ close: [211.3, 214.8, 215.1] }],
            adjclose: [{ adjclose: [211.0, 214.5, null] }],
          },
        },
      ],
    },
  };

  it("prefers adjusted closes and skips null gaps", () => {
    const series = parseYahooChart(payload);
    expect(series).toEqual([
      { date: "2026-07-16", close: 211.0 },
      { date: "2026-07-17", close: 214.5 },
    ]);
  });

  it("falls back to raw closes when adjclose is absent", () => {
    const raw = structuredClone(payload);
    delete raw.chart.result[0].indicators.adjclose;
    expect(parseYahooChart(raw)[0].close).toBe(211.3);
  });

  it("tolerates malformed payloads", () => {
    expect(parseYahooChart(null)).toEqual([]);
    expect(parseYahooChart({ chart: { result: [] } })).toEqual([]);
    expect(parseYahooChart({ chart: { result: [{ timestamp: "x" }] } })).toEqual([]);
  });
});

describe("series helpers", () => {
  const series = [
    { date: "2026-07-10", close: 100 },
    { date: "2026-07-13", close: 104 },
    { date: "2026-07-17", close: 110 },
  ];

  it("latestClose returns the last row", () => {
    expect(latestClose(series)).toEqual({ date: "2026-07-17", close: 110 });
    expect(latestClose([])).toBeNull();
  });

  it("closeOnOrBefore rolls back over weekends/holidays", () => {
    expect(closeOnOrBefore(series, "2026-07-13")).toEqual({ date: "2026-07-13", close: 104 });
    // Sunday the 12th -> Friday the 10th
    expect(closeOnOrBefore(series, "2026-07-12")).toEqual({ date: "2026-07-10", close: 100 });
    // ISO timestamps work too
    expect(closeOnOrBefore(series, "2026-07-15T18:30:00.000Z")?.close).toBe(104);
    // Before the series starts
    expect(closeOnOrBefore(series, "2026-07-01")).toBeNull();
  });
});
