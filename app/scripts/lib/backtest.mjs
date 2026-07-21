// Deterministic, preset-based backtest engine over daily closes. Pure — no
// fs, no network, unit-tested with known-answer tests. Design constraints:
//
// - Presets only, no user-authored strategy DSL: the Lab exists to teach why
//   simple approaches are hard to beat, not to help mine noise.
// - No lookahead by construction: all signals (SMA, momentum lookback) use
//   only data strictly before the decision day; trades execute at that day's
//   close with `costBps` friction on the traded notional.
// - Returns are time-weighted (contributions in dca-monthly are external
//   flows), so CAGR/Sharpe compare cleanly against buy-and-hold.

const START_VALUE = 10_000;
const TRADING_DAYS = 252;

/**
 * Align per-ticker series onto their common trading days.
 * Returns { dates, closes } where closes[ticker] is aligned to dates.
 * Throws when there is no overlap.
 */
export function alignSeries(seriesByTicker, from, to) {
  const tickers = Object.keys(seriesByTicker);
  const maps = tickers.map((t) => new Map(seriesByTicker[t].map((r) => [r.date, r.close])));
  const dates = seriesByTicker[tickers[0]]
    .map((r) => r.date)
    .filter((d) => d >= from && (!to || d <= to) && maps.every((m) => m.has(d)));
  if (dates.length < 2) throw new Error("not enough overlapping price history in the window");
  const closes = {};
  tickers.forEach((t, i) => {
    closes[t] = dates.map((d) => maps[i].get(d));
  });
  return { dates, closes };
}

/** Simple moving average of the trailing `window` values ENDING BEFORE index i (no lookahead). */
function smaBefore(values, i, window) {
  if (i < window) return null;
  let sum = 0;
  for (let k = i - window; k < i; k++) sum += values[k];
  return sum / window;
}

/** Trailing return over `lookback` days ending before index i (no lookahead). */
function momentumBefore(values, i, lookback) {
  if (i < lookback + 1) return null;
  return values[i - 1] / values[i - 1 - lookback] - 1;
}

/**
 * Run one preset. `seriesByTicker` maps ticker -> [{date, close}] (oldest
 * first). Returns { dates, equity, flows, trades } where equity[i] is
 * portfolio value at close of dates[i] and flows[i] is external cash added
 * that day (dca contributions).
 */
export function runPreset(preset, seriesByTicker, { from, to, costBps = 5 }) {
  const { dates, closes } = alignSeries(seriesByTicker, from, to);
  const tickers = Object.keys(closes);
  const cost = costBps / 10_000;
  const equity = new Array(dates.length).fill(0);
  const flows = new Array(dates.length).fill(0);
  let trades = 0;

  // Portfolio state: cash + per-ticker shares.
  let cash = 0;
  const shares = Object.fromEntries(tickers.map((t) => [t, 0]));
  const valueAt = (i) => cash + tickers.reduce((s, t) => s + shares[t] * closes[t][i], 0);
  const buyEqualWeight = (amount, i) => {
    const spend = amount * (1 - cost);
    for (const t of tickers) shares[t] += spend / tickers.length / closes[t][i];
    cash -= amount;
    trades += tickers.length;
  };
  const liquidate = (i) => {
    for (const t of tickers) {
      if (shares[t] > 0) {
        cash += shares[t] * closes[t][i] * (1 - cost);
        shares[t] = 0;
        trades++;
      }
    }
  };

  switch (preset) {
    case "buy-and-hold": {
      cash = START_VALUE;
      flows[0] = START_VALUE;
      buyEqualWeight(START_VALUE, 0);
      break;
    }
    case "dca-monthly": {
      // Contribute on the first trading day of each month in the window.
      let lastMonth = "";
      for (let i = 0; i < dates.length; i++) {
        const month = dates[i].slice(0, 7);
        if (month !== lastMonth) {
          lastMonth = month;
          cash += START_VALUE / 12;
          flows[i] += START_VALUE / 12;
          buyEqualWeight(START_VALUE / 12, i);
        }
        equity[i] = valueAt(i);
      }
      break;
    }
    case "ma200-trend": {
      // Equal-weight basket index; invested when the index closes above its
      // 200-day SMA (computed on data strictly before the decision day).
      const index = dates.map((_, i) => tickers.reduce((s, t) => s + closes[t][i] / closes[t][0], 0));
      cash = START_VALUE;
      flows[0] = START_VALUE;
      let invested = false;
      for (let i = 0; i < dates.length; i++) {
        const sma = smaBefore(index, i, 200);
        const shouldHold = sma != null ? index[i - 1] > sma : false;
        if (shouldHold && !invested) {
          buyEqualWeight(cash, i);
          invested = true;
        } else if (!shouldHold && invested) {
          liquidate(i);
          invested = false;
        }
        equity[i] = valueAt(i);
      }
      break;
    }
    case "momentum-rotation": {
      // Monthly: hold the single ticker with the best trailing 126-day return.
      if (tickers.length < 2) throw new Error("momentum-rotation needs at least 2 tickers");
      cash = START_VALUE;
      flows[0] = START_VALUE;
      let held = null;
      let lastMonth = "";
      for (let i = 0; i < dates.length; i++) {
        const month = dates[i].slice(0, 7);
        if (month !== lastMonth) {
          lastMonth = month;
          let best = null;
          let bestMom = -Infinity;
          for (const t of tickers) {
            const mom = momentumBefore(closes[t], i, 126);
            if (mom != null && mom > bestMom) {
              bestMom = mom;
              best = t;
            }
          }
          if (best && best !== held) {
            liquidate(i);
            const spend = cash * (1 - cost);
            shares[best] += spend / closes[best][i];
            cash = 0;
            trades++;
            held = best;
          }
        }
        equity[i] = valueAt(i);
      }
      break;
    }
    default:
      throw new Error(`unknown preset: ${preset}`);
  }

  // Fill equity for presets that only trade at i=0.
  for (let i = 0; i < dates.length; i++) {
    if (equity[i] === 0) equity[i] = valueAt(i);
  }
  return { dates, equity, flows, trades };
}

/**
 * Metrics from an equity curve with external flows, using time-weighted
 * daily returns: r_t = (V_t - flow_t) / V_{t-1} - 1.
 */
export function computeMetrics({ equity, flows, trades }) {
  const returns = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] > 0) returns.push((equity[i] - flows[i]) / equity[i - 1] - 1);
  }
  const growth = returns.reduce((p, r) => p * (1 + r), 1);
  const years = returns.length / TRADING_DAYS;
  const cagrPct = years > 0 ? (Math.pow(growth, 1 / years) - 1) * 100 : 0;
  const mean = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length || 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(TRADING_DAYS) : 0;

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  let contributed = 0;
  for (let i = 0; i < equity.length; i++) {
    contributed += flows[i];
    // Drawdown on a contribution-adjusted basis would be fairer for DCA, but
    // peak-to-trough on raw equity is the conventional (and more damning) read.
    if (equity[i] > peak) peak = equity[i];
    else if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity[i]) / peak) * 100);
  }
  const totalReturnPct = contributed > 0 ? (equity[equity.length - 1] / contributed - 1) * 100 : 0;

  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    cagrPct: round2(clamp(cagrPct, -100, 100_000)),
    sharpe: round2(clamp(sharpe, -100, 100)),
    maxDrawdownPct: round2(clamp(maxDrawdownPct, 0, 100)),
    trades,
    totalReturnPct: round2(clamp(totalReturnPct, -100, 1_000_000)),
  };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Downsample two aligned curves to at most `max` points (always keeps the ends). */
export function downsampleCurve(dates, strategy, benchmark, max = 365) {
  const step = Math.max(1, Math.ceil(dates.length / max));
  const out = [];
  for (let i = 0; i < dates.length; i += step) {
    out.push({ date: dates[i], value: r2(strategy[i]), benchmarkValue: r2(benchmark[i]) });
  }
  const last = dates.length - 1;
  if (out[out.length - 1]?.date !== dates[last]) {
    out.push({ date: dates[last], value: r2(strategy[last]), benchmarkValue: r2(benchmark[last]) });
  }
  return out.slice(0, 400);
}

const r2 = (n) => Math.round(n * 100) / 100;
