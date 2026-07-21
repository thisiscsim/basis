import { type Holding, type Portfolio, TickerSchema } from "@basis/schema";
import type { PlaidHoldingsResponse } from "./plaid";

/**
 * Map a Plaid /investments/holdings/get response onto portfolio.json.
 * Pure (unit-tested): broker rows are replaced wholesale on every sync;
 * manual rows survive unless a broker row now covers the same ticker (which
 * would double-count). Securities without a usable ticker (cash, some funds,
 * foreign listings) are skipped and counted so the UI can say so honestly.
 */
export function mapPlaidHoldings(
  resp: PlaidHoldingsResponse,
  existing: Portfolio,
): { portfolio: Portfolio; imported: number; skipped: number } {
  const securities = new Map(resp.securities.map((s) => [s.security_id, s]));

  // Aggregate across accounts per ticker.
  const byTicker = new Map<string, Holding>();
  let skipped = 0;
  for (const holding of resp.holdings) {
    const security = securities.get(holding.security_id);
    const rawTicker = (security?.ticker_symbol ?? "").toUpperCase().trim();
    const parsed = TickerSchema.safeParse(rawTicker);
    const quantity = Number(holding.quantity);
    if (
      !security ||
      !parsed.success ||
      security.type === "cash" ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      skipped++;
      continue;
    }
    const ticker = parsed.data;
    const prev = byTicker.get(ticker);
    const costBasis = Number(holding.cost_basis);
    const price = Number(holding.institution_price);
    byTicker.set(ticker, {
      ticker,
      name: security.name?.slice(0, 256) || prev?.name,
      shares: (prev?.shares ?? 0) + quantity,
      costBasis:
        Number.isFinite(costBasis) && costBasis > 0 ? (prev?.costBasis ?? 0) + costBasis : prev?.costBasis,
      lastPrice: Number.isFinite(price) && price > 0 ? price : prev?.lastPrice,
      source: "broker",
    });
  }

  const brokerRows = [...byTicker.values()];
  const brokerTickers = new Set(byTicker.keys());
  const manualRows = existing.holdings.filter((h) => h.source !== "broker" && !brokerTickers.has(h.ticker));

  return {
    portfolio: {
      ...existing,
      holdings: [...brokerRows, ...manualRows].slice(0, 500),
      lastSyncedAt: new Date().toISOString(),
    },
    imported: brokerRows.length,
    skipped,
  };
}
