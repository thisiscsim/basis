import { describe, expect, it } from "vitest";
import { alignSeries, computeMetrics, downsampleCurve, runPreset } from "./backtest.mjs";

/** Synthetic daily series: `days` trading days with a constant daily return. */
function syntheticSeries(days, dailyReturn, start = 100) {
  const out = [];
  const d0 = new Date("2020-01-01T00:00:00Z").getTime();
  let close = start;
  for (let i = 0; i < days; i++) {
    // Weekdays only, so date logic resembles real series.
    const date = new Date(d0 + i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    out.push({ date, close: Math.round(close * 1e6) / 1e6 });
    close *= 1 + dailyReturn;
  }
  return out;
}

describe("alignSeries", () => {
  it("intersects trading days and respects the window", () => {
    const a = syntheticSeries(10, 0.01);
    const b = syntheticSeries(10, 0.01).slice(2); // starts 2 days later
    const { dates, closes } = alignSeries({ A: a, B: b }, "2020-01-01", "2020-01-08");
    expect(dates[0]).toBe("2020-01-03");
    expect(dates[dates.length - 1]).toBe("2020-01-08");
    expect(closes.A).toHaveLength(dates.length);
  });

  it("throws when there is no overlap", () => {
    expect(() => alignSeries({ A: syntheticSeries(5, 0) }, "2030-01-01")).toThrow();
  });
});

describe("buy-and-hold known answers", () => {
  it("zero-cost hold of a constant-growth asset reproduces the asset's CAGR, zero drawdown", () => {
    const daily = 0.001;
    const series = { SPY: syntheticSeries(505, daily) };
    const run = runPreset("buy-and-hold", series, { from: "2020-01-01", costBps: 0 });
    const m = computeMetrics(run);
    const expectedCagr = (Math.pow(1 + daily, 252) - 1) * 100;
    expect(Math.abs(m.cagrPct - expectedCagr)).toBeLessThan(0.5);
    expect(m.maxDrawdownPct).toBe(0);
    expect(m.trades).toBe(1);
  });

  it("costs reduce the final value by ~costBps", () => {
    const series = { SPY: syntheticSeries(100, 0) }; // flat market
    const free = runPreset("buy-and-hold", series, { from: "2020-01-01", costBps: 0 });
    const costly = runPreset("buy-and-hold", series, { from: "2020-01-01", costBps: 100 }); // 1%
    const last = free.equity.length - 1;
    expect(free.equity[last]).toBeCloseTo(10_000, 6);
    expect(costly.equity[last]).toBeCloseTo(9_900, 6);
  });
});

describe("dca-monthly", () => {
  it("contributes once per calendar month as external flows (time-weighted returns unaffected)", () => {
    const series = { VTI: syntheticSeries(65, 0) }; // ~3 months flat
    const run = runPreset("dca-monthly", series, { from: "2020-01-01", costBps: 0 });
    const months = new Set(run.dates.map((d) => d.slice(0, 7))).size;
    const contributed = run.flows.reduce((s, f) => s + f, 0);
    expect(contributed).toBeCloseTo((10_000 / 12) * months, 6);
    const m = computeMetrics(run);
    expect(m.cagrPct).toBeCloseTo(0, 4); // flat market: no time-weighted return
    expect(m.totalReturnPct).toBeCloseTo(0, 4);
  });
});

describe("ma200-trend", () => {
  it("stays invested through a monotonic uptrend once the SMA warms up", () => {
    const series = { SPY: syntheticSeries(400, 0.002) };
    const run = runPreset("ma200-trend", series, { from: "2020-01-01", costBps: 0 });
    const m = computeMetrics(run);
    expect(m.trades).toBe(1); // one entry, never exits
    expect(run.equity[run.equity.length - 1]).toBeGreaterThan(10_000);
  });

  it("goes to cash in a monotonic downtrend and avoids most of the loss", () => {
    // Up for 250 days (warms up the SMA invested), then down hard.
    const up = syntheticSeries(250, 0.002);
    const lastClose = up[up.length - 1].close;
    const down = syntheticSeries(150, -0.01, lastClose).map((r, i) => ({
      date: new Date(new Date(up[up.length - 1].date).getTime() + (i + 1) * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10),
      close: r.close,
    }));
    const series = { SPY: [...up, ...down] };
    const strategy = computeMetrics(runPreset("ma200-trend", series, { from: "2020-01-01", costBps: 0 }));
    const hold = computeMetrics(runPreset("buy-and-hold", series, { from: "2020-01-01", costBps: 0 }));
    expect(strategy.maxDrawdownPct).toBeLessThan(hold.maxDrawdownPct);
  });
});

describe("momentum-rotation", () => {
  it("rotates into the stronger asset", () => {
    const strong = syntheticSeries(300, 0.002);
    const weak = syntheticSeries(300, -0.001);
    const run = runPreset(
      "momentum-rotation",
      { STRONG: strong, WEAK: weak },
      { from: "2020-01-01", costBps: 0 },
    );
    const holdWeak = runPreset("buy-and-hold", { WEAK: weak }, { from: "2020-01-01", costBps: 0 });
    expect(run.equity[run.equity.length - 1]).toBeGreaterThan(holdWeak.equity[holdWeak.equity.length - 1]);
  });

  it("requires two tickers", () => {
    expect(() =>
      runPreset("momentum-rotation", { A: syntheticSeries(300, 0) }, { from: "2020-01-01" }),
    ).toThrow();
  });
});

describe("downsampleCurve", () => {
  it("caps points and always keeps the last one", () => {
    const dates = Array.from({ length: 1000 }, (_, i) => `d${i}`);
    const values = dates.map((_, i) => i);
    const out = downsampleCurve(dates, values, values, 100);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out[out.length - 1].date).toBe("d999");
  });
});
