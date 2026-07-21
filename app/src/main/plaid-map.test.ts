import { describe, expect, it } from "vitest";
import { mapPlaidHoldings } from "./plaid-map";
import type { Portfolio } from "@basis/schema";

const emptyPortfolio: Portfolio = { version: 1, currency: "USD", holdings: [] };

const resp = {
  securities: [
    { security_id: "s-aapl", ticker_symbol: "AAPL", name: "Apple Inc.", type: "equity" },
    { security_id: "s-cash", ticker_symbol: "CUR:USD", name: "US Dollar", type: "cash" },
    { security_id: "s-fund", ticker_symbol: null, name: "Some Private Fund", type: "mutual fund" },
  ],
  holdings: [
    { security_id: "s-aapl", quantity: 10, cost_basis: 1500, institution_price: 210 },
    { security_id: "s-aapl", quantity: 5, cost_basis: 900, institution_price: 210 }, // second account
    { security_id: "s-cash", quantity: 2000, cost_basis: 2000, institution_price: 1 },
    { security_id: "s-fund", quantity: 3, cost_basis: 300, institution_price: 100 },
  ],
};

describe("mapPlaidHoldings", () => {
  it("aggregates across accounts, tags source=broker, skips cash/unmapped", () => {
    const { portfolio, imported, skipped } = mapPlaidHoldings(resp, emptyPortfolio);
    expect(imported).toBe(1);
    expect(skipped).toBe(2);
    expect(portfolio.holdings).toHaveLength(1);
    expect(portfolio.holdings[0]).toMatchObject({
      ticker: "AAPL",
      shares: 15,
      costBasis: 2400,
      lastPrice: 210,
      source: "broker",
    });
    expect(portfolio.lastSyncedAt).toBeTruthy();
  });

  it("keeps manual rows but drops manual duplicates of broker tickers", () => {
    const existing: Portfolio = {
      ...emptyPortfolio,
      holdings: [
        { ticker: "AAPL", shares: 99, source: "manual" }, // would double-count
        { ticker: "VTI", shares: 20, source: "manual" },
        { ticker: "MSFT", shares: 1, source: "broker" }, // stale broker row, replaced wholesale
      ],
    };
    const { portfolio } = mapPlaidHoldings(resp, existing);
    const tickers = portfolio.holdings.map((h) => h.ticker);
    expect(tickers).toContain("AAPL");
    expect(tickers).toContain("VTI");
    expect(tickers).not.toContain("MSFT");
    expect(portfolio.holdings.find((h) => h.ticker === "AAPL")?.shares).toBe(15);
  });

  it("rejects hostile ticker symbols via the schema", () => {
    const hostile = {
      securities: [{ security_id: "s1", ticker_symbol: "../ETC", name: "Evil", type: "equity" }],
      holdings: [{ security_id: "s1", quantity: 1, cost_basis: 1, institution_price: 1 }],
    };
    const { imported, skipped } = mapPlaidHoldings(hostile, emptyPortfolio);
    expect(imported).toBe(0);
    expect(skipped).toBe(1);
  });
});
