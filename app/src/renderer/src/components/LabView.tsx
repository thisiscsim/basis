import { useEffect, useState } from "react";
import type { Backtest, BacktestPreset, PaperAccount, Plan } from "@basis/schema";
import { useApp } from "../store";
import { runJob } from "../lib/jobs";
import { relativeTime } from "../lib/time";
import { gauntletProgress } from "../lib/lab";
import { Badge, Button, Field, Icon, Input, Select } from "./ui";

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,11}$/;

const PRESETS: { id: BacktestPreset; label: string; hint: string }[] = [
  { id: "buy-and-hold", label: "Buy and hold", hint: "The benchmark everything else must beat" },
  { id: "dca-monthly", label: "DCA monthly", hint: "Fixed contribution on the first trading day each month" },
  { id: "ma200-trend", label: "200-day trend", hint: "Hold when above the 200-day average, cash below" },
  {
    id: "momentum-rotation",
    label: "Momentum rotation",
    hint: "Hold last 6 months' best performer, rotate monthly",
  },
];

/** The Lab: backtest copilot, paper-trading gauntlet, and plan reminders. */
export function LabView(): JSX.Element {
  const data = useApp((s) => s.data);
  if (!data) return <div className="surface" />;
  return (
    <div className="surface">
      <BacktestCard />
      <PaperCard />
      <PlanCard />
      <p className="disclaimer">
        The Lab exists to teach why simple approaches are hard to beat, not to find signals. Backtests are
        in-sample by construction; paper results are the cheapest tuition you will ever pay. Basis never
        executes real trades.
      </p>
    </div>
  );
}

/* ---------------- Backtests ---------------- */

function BacktestCard(): JSX.Element {
  const backtests = useApp((s) => s.data?.backtests ?? []);
  const job = useApp((s) => s.jobs.backtest);
  const pushNotice = useApp((s) => s.pushNotice);
  const [preset, setPreset] = useState<BacktestPreset>("ma200-trend");
  const [tickers, setTickers] = useState("SPY");
  const [from, setFrom] = useState("2015-01-01");
  const [costBps, setCostBps] = useState("5");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [open, setOpen] = useState<Backtest | null>(null);

  // Auto-open the newest result (e.g. right after a run).
  const newest = backtests[0]?.file ?? null;
  useEffect(() => {
    const target = openFile ?? newest;
    if (!target) return;
    let alive = true;
    window.api
      ?.loadBacktest(target)
      .then((bt) => alive && bt && setOpen(bt))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [openFile, newest]);

  const run = async () => {
    const list = tickers
      .split(/[\s,]+/)
      .map((t) => t.toUpperCase().trim())
      .filter(Boolean);
    if (list.length === 0 || list.some((t) => !TICKER_RE.test(t))) {
      pushNotice("error", "Enter 1-10 valid tickers (comma separated).");
      return;
    }
    if (preset === "momentum-rotation" && list.length < 2) {
      pushNotice("error", "Momentum rotation needs at least 2 tickers.");
      return;
    }
    setOpenFile(null); // the effect opens the fresh result after reload
    await runJob("backtest", () =>
      window.api.startBacktest({ preset, tickers: list, from, costBps: Number(costBps) || 0 }),
    );
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Backtest copilot</h2>
        {job.running && <span className="card-head-meta">{job.phase}</span>}
      </div>
      <div className="lab-form">
        <Field label="Preset">
          <Select value={preset} onChange={(e) => setPreset(e.target.value as BacktestPreset)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.hint}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tickers">
          <Input
            value={tickers}
            placeholder="SPY, QQQ"
            onChange={(e) => setTickers(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="From">
          <Input value={from} placeholder="2015-01-01" onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Cost (bps)">
          <Input value={costBps} inputMode="numeric" onChange={(e) => setCostBps(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          size="sm"
          icon="magic-wand"
          disabled={job.running}
          onClick={() => void run()}
        >
          {job.running ? "Running…" : "Run backtest"}
        </Button>
      </div>
      <p className="muted small">{PRESETS.find((p) => p.id === preset)?.hint}</p>

      {backtests.length > 0 && (
        <div className="backtest-list">
          {backtests.slice(0, 6).map((bt) => (
            <button
              key={bt.file}
              className={`backtest-item ${open?.id === bt.id ? "active" : ""}`}
              onClick={() => setOpenFile(bt.file)}
            >
              <span>
                {bt.preset} · {bt.tickers.join(", ")}
              </span>
              <span className="muted">
                {bt.cagrPct}% vs {bt.benchmarkCagrPct}% · {relativeTime(bt.generatedAt) ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && <BacktestResult bt={open} />}
    </section>
  );
}

function BacktestResult({ bt }: { bt: Backtest }): JSX.Element {
  const beat = bt.metrics.cagrPct - bt.benchmarkMetrics.cagrPct;
  return (
    <div className="backtest-result">
      <div className="lab-stats">
        <Stat label="CAGR" value={`${bt.metrics.cagrPct}%`} sub={`hold: ${bt.benchmarkMetrics.cagrPct}%`} />
        <Stat label="Sharpe" value={String(bt.metrics.sharpe)} sub={`hold: ${bt.benchmarkMetrics.sharpe}`} />
        <Stat
          label="Max drawdown"
          value={`-${bt.metrics.maxDrawdownPct}%`}
          sub={`hold: -${bt.benchmarkMetrics.maxDrawdownPct}%`}
        />
        <Stat label="Trades" value={String(bt.metrics.trades)} sub={`cost ${bt.config.costBps} bps`} />
      </div>
      <p className={`lab-verdict ${beat >= 0 ? "" : "muted"}`}>
        {beat >= 0
          ? `Beat buy-and-hold by ${Math.round(beat * 100) / 100} pts CAGR in this window — read the audit before believing it.`
          : `Underperformed buy-and-hold by ${Math.round(-beat * 100) / 100} pts CAGR. That's the usual lesson.`}
      </p>
      <EquitySparkline curve={bt.equityCurve} />
      {(bt.warnings.length > 0 || bt.auditNotes.length > 0) && (
        <div className="audit-block">
          <h3 className="drift-title">
            <Icon name="circle-questionmark" size={12} /> Honesty audit
          </h3>
          <ul className="audit-list">
            {bt.auditNotes.map((n, i) => (
              <li key={`a${i}`}>{n}</li>
            ))}
            {bt.warnings.map((w, i) => (
              <li key={`w${i}`} className="muted">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="lab-stat">
      <span className="lab-stat-label">{label}</span>
      <span className="lab-stat-value">{value}</span>
      {sub && <span className="lab-stat-sub">{sub}</span>}
    </div>
  );
}

/** Strategy vs benchmark equity curves as a plain SVG — no chart dependency. */
function EquitySparkline({
  curve,
}: {
  curve: { date: string; value: number; benchmarkValue?: number }[];
}): JSX.Element | null {
  if (curve.length < 2) return null;
  const w = 640;
  const h = 120;
  const values = curve.flatMap((p) => [p.value, p.benchmarkValue ?? p.value]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (curve.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 8) - 4;
  const line = (pick: (p: (typeof curve)[number]) => number | undefined) =>
    curve
      .map((p, i) => {
        const v = pick(p);
        return v != null ? `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}` : "";
      })
      .join(" ");
  return (
    <svg
      className="equity-spark"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Equity curve vs buy-and-hold"
    >
      <path d={line((p) => p.benchmarkValue)} className="equity-benchmark" />
      <path d={line((p) => p.value)} className="equity-strategy" />
    </svg>
  );
}

/* ---------------- Paper trading ---------------- */

function PaperCard(): JSX.Element {
  const data = useApp((s) => s.data);
  const savePaper = useApp((s) => s.savePaper);
  const reloadData = useApp((s) => s.reloadData);
  const job = useApp((s) => s.jobs.paper);
  const pushNotice = useApp((s) => s.pushNotice);
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  if (!data) return <section className="card" />;
  const paper = data.paper;

  const { day, target } = gauntletProgress(paper);
  const latest = paper.equity[paper.equity.length - 1];
  const pnl = latest ? latest.value - paper.startCash : 0;
  const benchPnl = latest?.benchmarkValue != null ? latest.benchmarkValue - paper.startCash : null;

  const placeOrder = async () => {
    const t = ticker.toUpperCase().trim();
    const qty = Number(shares);
    if (!TICKER_RE.test(t) || !Number.isFinite(qty) || qty <= 0) {
      pushNotice("error", "Enter a valid ticker and share count.");
      return;
    }
    const next: PaperAccount = {
      ...paper,
      startedAt: paper.startedAt ?? new Date().toISOString(),
      orders: [
        {
          id: `po-${Date.now().toString(36)}`,
          at: new Date().toISOString(),
          ticker: t,
          side,
          shares: qty,
          status: "pending" as const,
        },
        ...paper.orders,
      ].slice(0, 500),
    };
    setTicker("");
    setShares("");
    await savePaper(next);
    pushNotice("info", `Paper ${side} for ${qty} ${t} queued — fills at the next market close.`);
  };

  const cancel = (id: string) =>
    savePaper({
      ...paper,
      orders: paper.orders.map((o) => (o.id === id ? { ...o, status: "cancelled" as const } : o)),
    });

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Paper-trading gauntlet</h2>
        <span className="card-head-meta">{paper.startedAt ? `day ${day} of ${target}` : "not started"}</span>
      </div>
      {paper.startedAt && (
        <div className="bar job-bar" aria-hidden>
          <div className="bar-fill" style={{ width: `${Math.min((day / target) * 100, 100)}%` }} />
        </div>
      )}
      <p className="muted small">
        ${paper.startCash.toLocaleString()} of pretend money. Orders fill at the <em>next</em> day's close
        (same-day fills would be lookahead). If a strategy can't survive {target} days here, it never touches
        real money — most ideas should die here, and that's the system working.
      </p>

      <div className="lab-form">
        <Field label="Side">
          <Select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </Select>
        </Field>
        <Field label="Ticker">
          <Input
            value={ticker}
            placeholder="AAPL"
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Shares">
          <Input
            value={shares}
            inputMode="decimal"
            placeholder="10"
            onChange={(e) => setShares(e.target.value)}
          />
        </Field>
        <Button variant="primary" size="sm" onClick={() => void placeOrder()}>
          Queue order
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon="arrow-rotate"
          disabled={job.running}
          onClick={() => {
            void runJob("paper", () => window.api.startPaperMark()).then(() => reloadData());
          }}
        >
          {job.running ? job.phase || "Marking…" : "Mark to market"}
        </Button>
      </div>

      {latest && (
        <div className="lab-stats">
          <Stat label="Equity" value={`$${latest.value.toLocaleString()}`} sub={latest.date} />
          <Stat
            label="P&L"
            value={`${pnl >= 0 ? "+" : ""}$${Math.round(pnl).toLocaleString()}`}
            sub={
              benchPnl != null
                ? `SPY: ${benchPnl >= 0 ? "+" : ""}$${Math.round(benchPnl).toLocaleString()}`
                : undefined
            }
          />
          <Stat label="Cash" value={`$${Math.round(paper.cash).toLocaleString()}`} />
          <Stat label="Positions" value={String(paper.positions.length)} />
        </div>
      )}

      {paper.positions.length > 0 && (
        <div className="clip-list clip-list-capped">
          {paper.positions.map((p) => (
            <div key={p.ticker} className="clip-row">
              <span className="name">
                {p.ticker} — {p.shares} sh
              </span>
            </div>
          ))}
        </div>
      )}

      {paper.orders.length > 0 && (
        <div className="clip-list clip-list-capped">
          {paper.orders.slice(0, 10).map((o) => (
            <div key={o.id} className="clip-row" title={o.note}>
              <span className="name">
                {o.side} {o.shares} {o.ticker} · {o.status}
                {o.fillPrice != null ? ` @ $${o.fillPrice}` : ""}
              </span>
              {o.status === "pending" && (
                <button
                  className="clip-row-remove"
                  title="Cancel order"
                  aria-label={`Cancel ${o.side} ${o.ticker}`}
                  onClick={() => void cancel(o.id)}
                >
                  <Icon name="trash-can" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {paper.equity.length >= 2 && (
        <EquitySparkline
          curve={paper.equity.map((e) => ({
            date: e.date,
            value: e.value,
            benchmarkValue: e.benchmarkValue,
          }))}
        />
      )}
    </section>
  );
}

/* ---------------- Plan reminders ---------------- */

function PlanCard(): JSX.Element {
  const data = useApp((s) => s.data);
  const savePlan = useApp((s) => s.savePlan);
  const [amount, setAmount] = useState(data?.plan.dca ? String(data.plan.dca.amount) : "");
  const [dayOfMonth, setDayOfMonth] = useState(data?.plan.dca ? String(data.plan.dca.dayOfMonth) : "1");
  const [band, setBand] = useState(String(data?.plan.rebalanceBandPct ?? 5));
  const pushNotice = useApp((s) => s.pushNotice);
  if (!data) return <section className="card" />;

  const save = async () => {
    const amt = Number(amount);
    const day = Number(dayOfMonth);
    const bandPct = Number(band);
    if (amount.trim() && (!Number.isFinite(amt) || amt <= 0)) {
      pushNotice("error", "DCA amount must be a positive number (or blank to disable).");
      return;
    }
    if (amount.trim() && (!Number.isInteger(day) || day < 1 || day > 28)) {
      pushNotice("error", "DCA day must be 1-28.");
      return;
    }
    if (!Number.isFinite(bandPct) || bandPct < 0 || bandPct > 50) {
      pushNotice("error", "Rebalance band must be 0-50 points.");
      return;
    }
    const next: Plan = {
      ...data.plan,
      dca: amount.trim() ? { amount: amt, dayOfMonth: day } : undefined,
      rebalanceBandPct: bandPct,
    };
    await savePlan(next);
    pushNotice("info", "Plan saved. Reminders land in the alerts inbox on Update filings.");
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Plan reminders</h2>
        <Badge variant="neutral">reminders only — never executes</Badge>
      </div>
      <p className="muted small">
        The "boring bots": a monthly DCA nudge and a drift-band check, delivered as alerts when you run Update
        filings. Automating discipline, not prediction.
      </p>
      <div className="lab-form">
        <Field label="DCA amount ($, blank = off)">
          <Input
            value={amount}
            inputMode="decimal"
            placeholder="500"
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Day of month">
          <Input value={dayOfMonth} inputMode="numeric" onChange={(e) => setDayOfMonth(e.target.value)} />
        </Field>
        <Field label="Rebalance band (pts)">
          <Input value={band} inputMode="numeric" onChange={(e) => setBand(e.target.value)} />
        </Field>
        <Button variant="primary" size="sm" onClick={() => void save()}>
          Save plan
        </Button>
      </div>
    </section>
  );
}
