import { useState } from "react";
import type { FinAsset, Finances, FinDebt, FixedCost, Goal, Goals } from "@basis/schema";
import { useApp } from "../store";
import { Button, Field, Icon, Input, Modal, Select } from "./ui";

/**
 * Editors for the financial snapshot and goals. Same draft-row philosophy as
 * the portfolio editor: numbers stay strings while editing, converted +
 * validated on save; blank rows are skipped.
 */

const num = (raw: string, max: number): number | null => {
  if (!raw.trim()) return 0;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= max ? v : null;
};

interface Row {
  label: string;
  a: string; // primary amount
  b: string; // secondary (apr / minimum)
  c: string; // tertiary (minimum)
  kind: string;
  source: "manual" | "bank";
}

const blankRow = (kind: string): Row => ({ label: "", a: "", b: "", c: "", kind, source: "manual" });

export function FinancesModal({ onClose }: { onClose: () => void }): JSX.Element {
  const finances = useApp((s) => s.data?.finances ?? null);
  const saveFinances = useApp((s) => s.saveFinances);
  const [income, setIncome] = useState(
    finances && finances.income.netMonthly > 0 ? String(finances.income.netMonthly) : "",
  );
  const [fixed, setFixed] = useState<Row[]>(
    (finances?.fixedMonthly ?? []).map((r) => ({
      ...blankRow(""),
      label: r.label,
      a: String(r.amount),
      source: r.source,
    })),
  );
  const [debts, setDebts] = useState<Row[]>(
    (finances?.debts ?? []).map((r) => ({
      label: r.label,
      a: String(r.balance),
      b: String(r.aprPct),
      c: String(r.minimumMonthly),
      kind: r.kind,
      source: r.source,
    })),
  );
  const [assets, setAssets] = useState<Row[]>(
    (finances?.assets ?? []).map((r) => ({
      ...blankRow(r.kind),
      label: r.label,
      a: String(r.value),
      source: r.source,
    })),
  );
  const [savings, setSavings] = useState<Row[]>(
    (finances?.savingsMonthly ?? []).map((r) => ({ ...blankRow(""), label: r.label, a: String(r.amount) })),
  );
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const netMonthly = num(income, 1e9);
    if (netMonthly == null) return setError("Net monthly income must be a non-negative number.");

    const fixedMonthly: FixedCost[] = [];
    for (const r of fixed) {
      if (!r.label.trim()) continue;
      const amount = num(r.a, 1e9);
      if (amount == null) return setError(`${r.label}: invalid amount.`);
      fixedMonthly.push({ label: r.label.trim().slice(0, 64), amount, source: r.source });
    }
    const debtRows: FinDebt[] = [];
    for (const r of debts) {
      if (!r.label.trim()) continue;
      const balance = num(r.a, 1e12);
      const aprPct = num(r.b, 400);
      const minimumMonthly = num(r.c, 1e9);
      if (balance == null || aprPct == null || minimumMonthly == null)
        return setError(`${r.label}: invalid balance/APR/minimum.`);
      debtRows.push({
        label: r.label.trim().slice(0, 64),
        kind: (["credit-card", "student", "auto", "mortgage", "personal", "other"].includes(r.kind)
          ? r.kind
          : "other") as FinDebt["kind"],
        balance,
        aprPct,
        minimumMonthly,
        source: r.source,
      });
    }
    const assetRows: FinAsset[] = [];
    for (const r of assets) {
      if (!r.label.trim()) continue;
      const value = num(r.a, 1e12);
      if (value == null) return setError(`${r.label}: invalid value.`);
      assetRows.push({
        label: r.label.trim().slice(0, 64),
        kind: (["cash", "property", "retirement", "other"].includes(r.kind)
          ? r.kind
          : "other") as FinAsset["kind"],
        value,
        source: r.source,
      });
    }
    const savingsRows: Finances["savingsMonthly"] = [];
    for (const r of savings) {
      if (!r.label.trim()) continue;
      const amount = num(r.a, 1e9);
      if (amount == null) return setError(`${r.label}: invalid amount.`);
      savingsRows.push({ label: r.label.trim().slice(0, 64), amount });
    }

    const next: Finances = {
      ...(finances ?? {
        version: 1,
        income: { netMonthly: 0 },
        fixedMonthly: [],
        debts: [],
        assets: [],
        savingsMonthly: [],
      }),
      income: { ...(finances?.income ?? {}), netMonthly },
      fixedMonthly,
      debts: debtRows,
      assets: assetRows,
      savingsMonthly: savingsRows,
    };
    await saveFinances(next);
    onClose();
  };

  return (
    <Modal
      title="Your financial picture"
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
        Conscious-spending-plan style: what comes in, what's committed, what you owe, what you own. Brokerage
        holdings live in the Portfolio and are valued automatically.
      </p>
      <Field label="Net monthly income (take-home)">
        <Input
          value={income}
          inputMode="decimal"
          placeholder="8000"
          onChange={(e) => setIncome(e.target.value)}
        />
      </Field>

      <RowTable
        label="Fixed monthly costs"
        head={["Label", "$/mo"]}
        rows={fixed}
        setRows={setFixed}
        cols={["a"]}
        placeholder={["Rent", "2500"]}
        newRow={() => blankRow("")}
      />
      <RowTable
        label="Debts"
        head={["Label", "Balance", "APR %", "Min $/mo"]}
        rows={debts}
        setRows={setDebts}
        cols={["a", "b", "c"]}
        placeholder={["Visa", "4200", "24.99", "120"]}
        kinds={["credit-card", "student", "auto", "mortgage", "personal", "other"]}
        newRow={() => blankRow("credit-card")}
      />
      <RowTable
        label="Assets (excl. brokerage)"
        head={["Label", "Value"]}
        rows={assets}
        setRows={setAssets}
        cols={["a"]}
        placeholder={["Checking", "10000"]}
        kinds={["cash", "property", "retirement", "other"]}
        newRow={() => blankRow("cash")}
      />
      <RowTable
        label="Committed monthly savings"
        head={["Label", "$/mo"]}
        rows={savings}
        setRows={setSavings}
        cols={["a"]}
        placeholder={["401k", "500"]}
        newRow={() => blankRow("")}
      />
      {error && <p className="ui-form-error">{error}</p>}
    </Modal>
  );
}

function RowTable({
  label,
  head,
  rows,
  setRows,
  cols,
  placeholder,
  kinds,
  newRow,
}: {
  label: string;
  head: string[];
  rows: Row[];
  setRows: (fn: (prev: Row[]) => Row[]) => void;
  cols: ("a" | "b" | "c")[];
  placeholder: string[];
  kinds?: string[];
  newRow: () => Row;
}): JSX.Element {
  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const gridClass = kinds ? "fin-row fin-row-kinded" : cols.length > 1 ? "fin-row fin-row-wide" : "fin-row";
  return (
    <Field label={label}>
      <div className="holdings-table">
        {rows.length > 0 && (
          <div className={`${gridClass} holding-row-head`}>
            {head.map((hd) => (
              <span key={hd}>{hd}</span>
            ))}
            {kinds && <span>Kind</span>}
            <span />
          </div>
        )}
        {rows.map((row, i) => (
          <div key={i} className={gridClass}>
            <input
              className="url-input"
              value={row.label}
              placeholder={placeholder[0]}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            {cols.map((c, ci) => (
              <input
                key={c}
                className="url-input"
                value={row[c]}
                inputMode="decimal"
                placeholder={placeholder[ci + 1]}
                onChange={(e) => update(i, { [c]: e.target.value } as Partial<Row>)}
              />
            ))}
            {kinds && (
              <Select value={row.kind} onChange={(e) => update(i, { kind: e.target.value })}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            )}
            <button
              className="clip-row-remove"
              title="Remove row"
              aria-label={`Remove ${row.label || "row"}`}
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
        onClick={() => setRows((prev) => [...prev, newRow()])}
      >
        Add row
      </Button>
    </Field>
  );
}

/* ---------------- Goals ---------------- */

interface GoalDraft {
  id: string;
  label: string;
  kind: Goal["kind"];
  amount: string;
  date: string;
  priority: string;
}

export function GoalsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const goals = useApp((s) => s.data?.goals ?? null);
  const saveGoals = useApp((s) => s.saveGoals);
  const [rows, setRows] = useState<GoalDraft[]>(
    (goals?.goals ?? []).map((g) => ({
      id: g.id,
      label: g.label,
      kind: g.kind,
      amount: String(
        g.kind === "purchase"
          ? (g.targetAmount ?? "")
          : g.kind === "recurring"
            ? (g.annualCost ?? "")
            : (g.monthlyDelta ?? ""),
      ),
      date: g.targetDate ?? "",
      priority: String(g.priority),
    })),
  );
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const out: Goal[] = [];
    for (const r of rows) {
      if (!r.label.trim()) continue;
      const amount = num(r.amount, 1e12);
      if (amount == null) return setError(`${r.label}: invalid amount.`);
      const priority = Number(r.priority);
      if (!Number.isInteger(priority) || priority < 1 || priority > 5)
        return setError(`${r.label}: priority must be 1-5.`);
      if (r.date && !/^\d{4}-\d{2}(-\d{2})?$/.test(r.date))
        return setError(`${r.label}: date must be YYYY-MM.`);
      out.push({
        id:
          r.id ||
          `goal-${r.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 40)}`,
        label: r.label.trim().slice(0, 128),
        kind: r.kind,
        targetAmount: r.kind === "purchase" ? amount : undefined,
        targetDate: r.kind === "purchase" && r.date ? r.date : undefined,
        annualCost: r.kind === "recurring" ? amount : undefined,
        monthlyDelta: r.kind === "lifestyle" ? amount : undefined,
        priority,
      });
    }
    const next: Goals = { ...(goals ?? { version: 1, goals: [] }), goals: out.slice(0, 50) };
    await saveGoals(next);
    onClose();
  };

  return (
    <Modal
      title="Goals"
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
        What the money is for. <strong>Purchase</strong>: save toward an amount (house down payment) — the
        amount field is the target. <strong>Recurring</strong>: an every-year cost (3 business-class trips) —
        the amount is $/year. <strong>Lifestyle</strong>: a permanent upgrade (nicer apartment) — the amount
        is the extra $/month. Priority 1 gets funded first.
      </p>
      <div className="holdings-table">
        {rows.length > 0 && (
          <div className="goal-row holding-row-head">
            <span>Goal</span>
            <span>Kind</span>
            <span>Amount</span>
            <span>By (YYYY-MM)</span>
            <span>Pri</span>
            <span />
          </div>
        )}
        {rows.map((row, i) => (
          <div key={i} className="goal-row">
            <input
              className="url-input"
              value={row.label}
              placeholder="House down payment"
              onChange={(e) =>
                setRows((p) => p.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)))
              }
            />
            <Select
              value={row.kind}
              onChange={(e) =>
                setRows((p) =>
                  p.map((r, idx) => (idx === i ? { ...r, kind: e.target.value as Goal["kind"] } : r)),
                )
              }
            >
              <option value="purchase">purchase</option>
              <option value="recurring">recurring</option>
              <option value="lifestyle">lifestyle</option>
            </Select>
            <input
              className="url-input"
              value={row.amount}
              inputMode="decimal"
              placeholder={
                row.kind === "recurring" ? "24000 /yr" : row.kind === "lifestyle" ? "400 /mo" : "120000"
              }
              onChange={(e) =>
                setRows((p) => p.map((r, idx) => (idx === i ? { ...r, amount: e.target.value } : r)))
              }
            />
            <input
              className="url-input"
              value={row.date}
              placeholder={row.kind === "purchase" ? "2030-06" : "—"}
              disabled={row.kind !== "purchase"}
              onChange={(e) =>
                setRows((p) => p.map((r, idx) => (idx === i ? { ...r, date: e.target.value } : r)))
              }
            />
            <input
              className="url-input"
              value={row.priority}
              inputMode="numeric"
              onChange={(e) =>
                setRows((p) => p.map((r, idx) => (idx === i ? { ...r, priority: e.target.value } : r)))
              }
            />
            <button
              className="clip-row-remove"
              title="Remove goal"
              aria-label={`Remove ${row.label || "goal"}`}
              onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
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
          setRows((p) => [...p, { id: "", label: "", kind: "purchase", amount: "", date: "", priority: "3" }])
        }
      >
        Add goal
      </Button>
      {error && <p className="ui-form-error">{error}</p>}
    </Modal>
  );
}
