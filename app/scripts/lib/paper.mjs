// Pure paper-trading account logic (fills, marking). No fs, no network —
// unit-tested in paper.test.mjs. Fills happen at the NEXT trading day's
// close after the order was placed: same-day fills would be lookahead, and
// the whole point of the gauntlet is honesty.
import { closeOnOrBefore, latestClose } from "./prices.mjs";

/** First close strictly AFTER the given ISO timestamp's date. */
export function closeAfter(series, isoDate) {
  const day = String(isoDate).slice(0, 10);
  for (const row of series) {
    if (row.date > day) return row;
  }
  return null;
}

/**
 * Fill pending orders against per-ticker series. Mutates a copy of the
 * account; returns { account, fills, rejections }. Orders whose next-day
 * close doesn't exist yet stay pending.
 */
export function applyFills(account, seriesByTicker) {
  const next = structuredClone(account);
  let fills = 0;
  let rejections = 0;
  const positionOf = (ticker) => next.positions.find((p) => p.ticker === ticker);

  for (const order of next.orders) {
    if (order.status !== "pending") continue;
    const series = seriesByTicker[order.ticker] ?? [];
    const fill = closeAfter(series, order.at);
    if (!fill) continue; // market hasn't traded since the order — stays pending

    const notional = order.shares * fill.close;
    if (order.side === "buy") {
      if (notional > next.cash + 1e-9) {
        order.status = "rejected";
        order.note = `insufficient cash (need $${notional.toFixed(2)}, have $${next.cash.toFixed(2)})`;
        rejections++;
        continue;
      }
      next.cash -= notional;
      const pos = positionOf(order.ticker);
      if (pos) pos.shares += order.shares;
      else next.positions.push({ ticker: order.ticker, shares: order.shares });
    } else {
      const pos = positionOf(order.ticker);
      if (!pos || pos.shares < order.shares - 1e-9) {
        order.status = "rejected";
        order.note = "not enough shares to sell";
        rejections++;
        continue;
      }
      pos.shares -= order.shares;
      if (pos.shares <= 1e-9) next.positions = next.positions.filter((p) => p !== pos);
      next.cash += notional;
    }
    order.status = "filled";
    order.filledAt = fill.date;
    order.fillPrice = fill.close;
    fills++;
  }
  return { account: next, fills, rejections };
}

/**
 * Mark the account to market: append today's equity point (idempotent per
 * date) and the SPY-normalized benchmark line. Mutates a copy.
 */
export function markToMarket(account, seriesByTicker, benchmarkSeries, today = new Date()) {
  const next = structuredClone(account);
  const date = today.toISOString().slice(0, 10);

  let value = next.cash;
  for (const pos of next.positions) {
    const close = latestClose(seriesByTicker[pos.ticker] ?? [])?.close;
    if (close != null) value += pos.shares * close;
  }

  if (!next.startedAt) next.startedAt = new Date(today).toISOString();
  if (next.benchmarkStartPrice == null) {
    next.benchmarkStartPrice = closeOnOrBefore(benchmarkSeries, next.startedAt)?.close ?? undefined;
  }
  const benchNow = latestClose(benchmarkSeries)?.close;
  const benchmarkValue =
    next.benchmarkStartPrice != null && benchNow != null
      ? (next.startCash * benchNow) / next.benchmarkStartPrice
      : undefined;

  const point = { date, value: Math.round(value * 100) / 100 };
  if (benchmarkValue != null) point.benchmarkValue = Math.round(benchmarkValue * 100) / 100;
  const existing = next.equity.findIndex((e) => e.date === date);
  if (existing >= 0) next.equity[existing] = point;
  else next.equity.push(point);
  next.equity = next.equity.slice(-400);
  return next;
}

/** Days elapsed in the 180-day gauntlet (0 when not started). */
export function gauntletDay(account, today = new Date()) {
  if (!account.startedAt) return 0;
  const ms = today.getTime() - new Date(account.startedAt).getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600_000)));
}
