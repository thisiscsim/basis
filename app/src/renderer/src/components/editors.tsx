import { useState } from "react";
import type { Holding, Ips, Portfolio } from "@basis/schema";
import { useApp } from "../store";
import { Button, Field, Icon, Input, Modal, Select, TextArea } from "./ui";

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,11}$/;

/**
 * Draft-row shape for the holdings table: numbers stay strings while editing
 * so partial input ("12.") doesn't fight the user; converted on save.
 */
interface HoldingDraft {
  ticker: string;
  shares: string;
  weightPct: string;
  costBasis: string;
  account: string;
  /** Carried through so hand-edits to a synced row don't lose its provenance. */
  source: Holding["source"];
}

function toDraft(h: Holding): HoldingDraft {
  return {
    ticker: h.ticker,
    shares: h.shares != null ? String(h.shares) : "",
    weightPct: h.weightPct != null ? String(h.weightPct) : "",
    costBasis: h.costBasis != null ? String(h.costBasis) : "",
    account: h.account ?? "",
    source: h.source,
  };
}

function fromDraft(d: HoldingDraft): Holding | string {
  const ticker = d.ticker.toUpperCase().trim();
  if (!TICKER_RE.test(ticker)) return `"${d.ticker}" is not a valid ticker`;
  const num = (raw: string, label: string, max: number): number | undefined | string => {
    if (!raw.trim()) return undefined;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > max) return `${ticker}: invalid ${label}`;
    return v;
  };
  const shares = num(d.shares, "share count", 1e9);
  if (typeof shares === "string") return shares;
  const weightPct = num(d.weightPct, "weight %", 100);
  if (typeof weightPct === "string") return weightPct;
  const costBasis = num(d.costBasis, "cost basis", 1e12);
  if (typeof costBasis === "string") return costBasis;
  return {
    ticker,
    shares,
    weightPct,
    costBasis,
    account: d.account.trim() || undefined,
    source: d.source,
  };
}

export function PortfolioModal({ onClose }: { onClose: () => void }): JSX.Element {
  const portfolio = useApp((s) => s.data?.portfolio ?? null);
  const savePortfolio = useApp((s) => s.savePortfolio);
  const [rows, setRows] = useState<HoldingDraft[]>(() => (portfolio?.holdings ?? []).map(toDraft));
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<HoldingDraft>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const save = async () => {
    const holdings: Holding[] = [];
    for (const row of rows) {
      if (!row.ticker.trim()) continue; // skip blank rows
      const parsed = fromDraft(row);
      if (typeof parsed === "string") {
        setError(parsed);
        return;
      }
      holdings.push(parsed);
    }
    const next: Portfolio = { ...(portfolio ?? { version: 1, currency: "USD", holdings: [] }), holdings };
    await savePortfolio(next);
    onClose();
  };

  return (
    <Modal
      title="Portfolio holdings"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <p className="muted small">
        Enter what you own. Weight % (or cost basis) makes the X-ray meaningful; leave blank for
        equal-weighting. No broker linking — nothing leaves your machine except EDGAR lookups.
      </p>
      <div className="holdings-table" role="table" aria-label="Holdings">
        <div className="holding-row holding-row-head" role="row">
          <span>Ticker</span>
          <span>Shares</span>
          <span>Weight %</span>
          <span>Cost basis</span>
          <span>Account</span>
          <span />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="holding-row" role="row">
            <input
              className="url-input"
              value={row.ticker}
              placeholder="AAPL"
              onChange={(e) => update(i, { ticker: e.target.value.toUpperCase() })}
            />
            <input
              className="url-input"
              value={row.shares}
              placeholder="—"
              inputMode="decimal"
              onChange={(e) => update(i, { shares: e.target.value })}
            />
            <input
              className="url-input"
              value={row.weightPct}
              placeholder="—"
              inputMode="decimal"
              onChange={(e) => update(i, { weightPct: e.target.value })}
            />
            <input
              className="url-input"
              value={row.costBasis}
              placeholder="—"
              inputMode="decimal"
              onChange={(e) => update(i, { costBasis: e.target.value })}
            />
            <input
              className="url-input"
              value={row.account}
              placeholder="e.g. IRA"
              onChange={(e) => update(i, { account: e.target.value })}
            />
            <button
              className="clip-row-remove"
              title="Remove holding"
              aria-label={`Remove ${row.ticker || "row"}`}
              onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
            >
              <Icon name="trash-can" size={12} />
            </button>
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon="plus-large"
        onClick={() =>
          setRows((prev) => [
            ...prev,
            { ticker: "", shares: "", weightPct: "", costBasis: "", account: "", source: "manual" },
          ])
        }
      >
        Add holding
      </Button>
      {error && <p className="ui-form-error">{error}</p>}
    </Modal>
  );
}

/** Draft row for one target-allocation bucket (tickers edited as a comma list). */
interface BucketDraft {
  label: string;
  pct: string;
  tickers: string;
}

export function IpsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const ips = useApp((s) => s.data?.ips ?? null);
  const saveIps = useApp((s) => s.saveIps);
  const [goals, setGoals] = useState(ips?.goals ?? "");
  const [horizon, setHorizon] = useState(ips?.horizonYears != null ? String(ips.horizonYears) : "");
  const [risk, setRisk] = useState(ips?.riskTolerance ?? "");
  const [rules, setRules] = useState<string[]>(ips?.rules ?? []);
  const [ruleDraft, setRuleDraft] = useState("");
  const [buckets, setBuckets] = useState<BucketDraft[]>(() =>
    (ips?.targetAllocation ?? []).map((b) => ({
      label: b.label,
      pct: String(b.pct),
      tickers: b.tickers.join(", "),
    })),
  );
  const [error, setError] = useState<string | null>(null);

  const addRule = () => {
    const rule = ruleDraft.trim();
    if (!rule) return;
    setRules((prev) => [...prev, rule].slice(0, 50));
    setRuleDraft("");
  };

  const updateBucket = (i: number, patch: Partial<BucketDraft>) =>
    setBuckets((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const save = async () => {
    let horizonYears: number | undefined;
    if (horizon.trim()) {
      const v = Number(horizon);
      if (!Number.isFinite(v) || v < 0 || v > 120) {
        setError("Horizon must be a number of years (0-120).");
        return;
      }
      horizonYears = v;
    }
    const targetAllocation: Ips["targetAllocation"] = [];
    for (const bucket of buckets) {
      const label = bucket.label.trim();
      if (!label) continue; // skip blank rows
      const pct = Number(bucket.pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setError(`${label}: target % must be 0-100.`);
        return;
      }
      const tickers = bucket.tickers
        .split(/[\s,]+/)
        .map((t) => t.toUpperCase().trim())
        .filter(Boolean);
      for (const t of tickers) {
        if (!TICKER_RE.test(t)) {
          setError(`${label}: "${t}" is not a valid ticker.`);
          return;
        }
      }
      targetAllocation.push({ label: label.slice(0, 64), pct, tickers: tickers.slice(0, 100) });
    }
    const next: Ips = {
      ...(ips ?? { version: 1, goals: "", targetAllocation: [], rules: [] }),
      goals: goals.slice(0, 4000),
      horizonYears,
      riskTolerance: risk === "low" || risk === "medium" || risk === "high" ? risk : undefined,
      targetAllocation: targetAllocation.slice(0, 32),
      rules,
    };
    await saveIps(next);
    onClose();
  };

  return (
    <Modal
      title="Investment Policy Statement"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <p className="muted small">
        Your goals and rules, written when you're calm. The coach quotes these back to you before impulsive
        trades — most retail losses are psychology, not analysis.
      </p>
      <Field label="Goals">
        <TextArea
          rows={3}
          value={goals}
          placeholder='e.g. "Retire at 55. College fund ready by 2035. Sleep well during crashes."'
          onChange={(e) => setGoals(e.target.value)}
        />
      </Field>
      <div className="ips-grid">
        <Field label="Horizon (years)">
          <Input
            value={horizon}
            placeholder="20"
            inputMode="numeric"
            onChange={(e) => setHorizon(e.target.value)}
          />
        </Field>
        <Field label="Risk tolerance">
          <Select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
            <option value="">Not set</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
      </div>
      <Field label="Target allocation (drives drift detection)">
        <div className="holdings-table" role="table" aria-label="Target allocation">
          {buckets.length > 0 && (
            <div className="bucket-row holding-row-head" role="row">
              <span>Bucket</span>
              <span>Target %</span>
              <span>Tickers in this bucket</span>
              <span />
            </div>
          )}
          {buckets.map((bucket, i) => (
            <div key={i} className="bucket-row" role="row">
              <input
                className="url-input"
                value={bucket.label}
                placeholder="US equities"
                onChange={(e) => updateBucket(i, { label: e.target.value })}
              />
              <input
                className="url-input"
                value={bucket.pct}
                placeholder="70"
                inputMode="decimal"
                onChange={(e) => updateBucket(i, { pct: e.target.value })}
              />
              <input
                className="url-input"
                value={bucket.tickers}
                placeholder="VTI, AAPL"
                onChange={(e) => updateBucket(i, { tickers: e.target.value.toUpperCase() })}
              />
              <button
                className="clip-row-remove"
                title="Remove bucket"
                aria-label={`Remove ${bucket.label || "bucket"}`}
                onClick={() => setBuckets((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Icon name="trash-can" size={12} />
              </button>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon="plus-large"
          onClick={() => setBuckets((prev) => [...prev, { label: "", pct: "", tickers: "" }])}
        >
          Add bucket
        </Button>
      </Field>
      <Field label="Rules">
        <div className="url-row">
          <input
            className="url-input"
            value={ruleDraft}
            placeholder='e.g. "No selling on drawdowns under 25%"'
            onChange={(e) => setRuleDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRule()}
          />
          <Button variant="secondary" size="sm" onClick={addRule} disabled={!ruleDraft.trim()}>
            Add
          </Button>
        </div>
        {rules.length > 0 && (
          <div className="clip-list clip-list-capped" style={{ marginTop: 6 }}>
            {rules.map((rule, i) => (
              <div key={`${i}-${rule}`} className="clip-row" title={rule}>
                <span className="name">{rule}</span>
                <button
                  className="clip-row-remove"
                  title="Remove rule"
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Icon name="trash-can" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Field>
      {error && <p className="ui-form-error">{error}</p>}
    </Modal>
  );
}
