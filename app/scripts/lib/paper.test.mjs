import { describe, expect, it } from "vitest";
import { applyFills, closeAfter, gauntletDay, markToMarket } from "./paper.mjs";

const series = {
  AAPL: [
    { date: "2026-07-15", close: 200 },
    { date: "2026-07-16", close: 210 },
    { date: "2026-07-17", close: 220 },
  ],
};
const spy = [
  { date: "2026-07-15", close: 500 },
  { date: "2026-07-17", close: 510 },
];

const baseAccount = {
  version: 1,
  startCash: 100_000,
  cash: 100_000,
  positions: [],
  orders: [],
  equity: [],
};

describe("closeAfter", () => {
  it("returns the first close strictly after the order date (no same-day fills)", () => {
    expect(closeAfter(series.AAPL, "2026-07-15T20:00:00Z")).toEqual({ date: "2026-07-16", close: 210 });
    expect(closeAfter(series.AAPL, "2026-07-17")).toBeNull(); // nothing after yet
  });
});

describe("applyFills", () => {
  it("fills a buy at the next close and updates cash/positions", () => {
    const account = {
      ...baseAccount,
      orders: [
        { id: "o1", at: "2026-07-15T20:00:00Z", ticker: "AAPL", side: "buy", shares: 10, status: "pending" },
      ],
    };
    const { account: next, fills } = applyFills(account, series);
    expect(fills).toBe(1);
    expect(next.orders[0]).toMatchObject({ status: "filled", filledAt: "2026-07-16", fillPrice: 210 });
    expect(next.cash).toBe(100_000 - 2100);
    expect(next.positions).toEqual([{ ticker: "AAPL", shares: 10 }]);
  });

  it("rejects buys beyond cash and sells beyond position", () => {
    const account = {
      ...baseAccount,
      cash: 100,
      orders: [
        { id: "o1", at: "2026-07-15", ticker: "AAPL", side: "buy", shares: 10, status: "pending" },
        { id: "o2", at: "2026-07-15", ticker: "AAPL", side: "sell", shares: 1, status: "pending" },
      ],
    };
    const { account: next, rejections } = applyFills(account, series);
    expect(rejections).toBe(2);
    expect(next.orders.every((o) => o.status === "rejected")).toBe(true);
    expect(next.cash).toBe(100);
  });

  it("leaves orders pending when the market hasn't traded since", () => {
    const account = {
      ...baseAccount,
      orders: [{ id: "o1", at: "2026-07-17", ticker: "AAPL", side: "buy", shares: 1, status: "pending" }],
    };
    const { account: next, fills } = applyFills(account, series);
    expect(fills).toBe(0);
    expect(next.orders[0].status).toBe("pending");
  });
});

describe("markToMarket", () => {
  it("marks equity (cash + positions) and the SPY benchmark, idempotent per day", () => {
    const account = {
      ...baseAccount,
      cash: 97_900,
      positions: [{ ticker: "AAPL", shares: 10 }],
      startedAt: "2026-07-15T12:00:00Z",
    };
    const today = new Date("2026-07-17T21:00:00Z");
    const once = markToMarket(account, series, spy, today);
    expect(once.equity).toHaveLength(1);
    expect(once.equity[0]).toMatchObject({ date: "2026-07-17", value: 97_900 + 2200 });
    // benchmark: started at SPY 500, now 510 -> 100k * 1.02
    expect(once.equity[0].benchmarkValue).toBe(102_000);
    const twice = markToMarket(once, series, spy, today);
    expect(twice.equity).toHaveLength(1); // same-day re-mark replaces, not appends
  });
});

describe("gauntletDay", () => {
  it("counts days since the account started", () => {
    expect(
      gauntletDay({ ...baseAccount, startedAt: "2026-07-01T00:00:00Z" }, new Date("2026-07-17T12:00:00Z")),
    ).toBe(16);
    expect(gauntletDay(baseAccount)).toBe(0);
  });
});
