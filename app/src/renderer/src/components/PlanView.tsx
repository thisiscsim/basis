import { useState } from "react";
import type { LifePlan } from "@basis/schema";
import { useApp } from "../store";
import { runJob } from "../lib/jobs";
import { relativeTime } from "../lib/time";
import { Badge, Button, Icon } from "./ui";
import { FinancesModal, GoalsModal } from "./plan-editors";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString()}`;

/**
 * The Plan tab: your financial snapshot + goals in, a deterministic plan
 * (surplus, debt schedule, goal feasibility, 25-year projections) out. The
 * LLM narrative (PR C) layers cited steps on top; the numbers rule either way.
 */
export function PlanView(): JSX.Element {
  const data = useApp((s) => s.data);
  const job = useApp((s) => s.jobs.lifeplan);
  const [editing, setEditing] = useState<"finances" | "goals" | null>(null);
  if (!data) return <div className="surface" />;
  const { finances, goals, lifeplan } = data;

  const hasInputs = finances.income.netMonthly > 0 || finances.assets.length > 0 || finances.debts.length > 0;

  return (
    <div className="surface">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Your financial picture</h2>
          {finances.updatedAt && (
            <span className="card-head-meta">updated {relativeTime(finances.updatedAt)}</span>
          )}
        </div>
        <div className="lab-stats">
          <PlanStat label="Net income /mo" value={money(finances.income.netMonthly)} />
          <PlanStat
            label="Fixed costs /mo"
            value={money(finances.fixedMonthly.reduce((s, r) => s + r.amount, 0))}
          />
          <PlanStat
            label="Debts"
            value={money(finances.debts.reduce((s, r) => s + r.balance, 0))}
            sub={`${finances.debts.length} account${finances.debts.length === 1 ? "" : "s"}`}
          />
          <PlanStat
            label="Assets"
            value={money(finances.assets.reduce((s, r) => s + r.value, 0))}
            sub="excl. brokerage"
          />
        </div>
        <div className="lab-form">
          <Button variant="secondary" size="sm" icon="input-form" onClick={() => setEditing("finances")}>
            Edit finances
          </Button>
          <Button variant="secondary" size="sm" icon="input-form" onClick={() => setEditing("goals")}>
            Edit goals ({goals.goals.length})
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="magic-wand"
            disabled={job.running || !hasInputs}
            title={hasInputs ? undefined : "Fill in your finances first"}
            onClick={() => void runJob("lifeplan", () => window.api.startLifePlan())}
          >
            {job.running ? job.phase || "Computing…" : "Compute plan"}
          </Button>
        </div>
      </section>

      {lifeplan ? (
        <PlanResult plan={lifeplan} />
      ) : (
        <section className="card">
          <p className="empty-note">
            No plan yet. Enter your income, fixed costs, debts, and assets; add your goals (a house, the
            trips, the nicer apartment); then <strong>Compute plan</strong>. Everything you'll see is
            deterministic math with its assumptions attached — not a prediction.
          </p>
        </section>
      )}

      {editing === "finances" && <FinancesModal onClose={() => setEditing(null)} />}
      {editing === "goals" && <GoalsModal onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlanStat({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="lab-stat">
      <span className="lab-stat-label">{label}</span>
      <span className="lab-stat-value">{value}</span>
      {sub && <span className="lab-stat-sub">{sub}</span>}
    </div>
  );
}

function PlanResult({ plan }: { plan: LifePlan }): JSX.Element {
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Monthly reality</h2>
          <span className="card-head-meta">{relativeTime(plan.generatedAt) ?? ""}</span>
        </div>
        <div className="lab-stats">
          <PlanStat label="Income" value={money(plan.surplus.netMonthlyIncome)} />
          <PlanStat label="Fixed" value={`-${money(plan.surplus.fixedMonthly)}`} />
          <PlanStat label="Debt minimums" value={`-${money(plan.surplus.debtMinimums)}`} />
          <PlanStat label="Savings" value={`-${money(plan.surplus.savingsMonthly)}`} />
          <PlanStat label="Goal reserves" value={`-${money(plan.surplus.goalReserveMonthly)}`} />
          <PlanStat label="Surplus" value={money(plan.surplus.monthly)} sub="what the plan works with" />
        </div>
        {plan.warnings.length > 0 && (
          <ul className="xray-warnings">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      {plan.debtSchedule.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Debt payoff (avalanche)</h2>
            {plan.debtTotals.debtFreeDate && (
              <span className="card-head-meta">debt-free {plan.debtTotals.debtFreeDate}</span>
            )}
          </div>
          <div className="clip-list">
            {plan.debtSchedule.map((d) => (
              <div key={d.label} className="clip-row">
                <span className="name">
                  {d.label} —{" "}
                  {d.neverPaysOff
                    ? "never pays off at current payments"
                    : `paid off ${d.payoffDate} (${money(d.interestPaid)} interest)`}
                </span>
              </div>
            ))}
          </div>
          <p className="muted small">
            Highest APR first; your monthly surplus attacks the top of the stack, and freed-up minimums roll
            forward. Total interest on this path: {money(plan.debtTotals.interestPaid)}.
          </p>
        </section>
      )}

      {plan.goalFunding.length > 0 && <GoalFundingCard plan={plan} />}

      {plan.netWorth.length > 1 && <NetWorthCard plan={plan} />}

      {plan.steps.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">The plan</h2>
            {plan.playbooksUsed.length > 0 && (
              <span className="card-head-meta">grounded in {plan.playbooksUsed.join(", ")}</span>
            )}
          </div>
          {plan.steps.map((step, i) => (
            <div key={i} className="digest-bullet">
              <div className="digest-bullet-title">
                {i + 1}. {step.title}
              </div>
              {step.body && <p className="digest-bullet-body">{step.body}</p>}
            </div>
          ))}
        </section>
      )}

      <p className="disclaimer">
        Projections are assumption math, not predictions — the assumptions are printed on every chart. Tax and
        legal specifics vary; verify anything load-bearing with a professional. Basis never moves money.
      </p>
    </>
  );
}

function GoalFundingCard({ plan }: { plan: LifePlan }): JSX.Element {
  const byGoal = new Map<string, typeof plan.goalFunding>();
  for (const row of plan.goalFunding) {
    const rows = byGoal.get(row.goalId) ?? [];
    rows.push(row);
    byGoal.set(row.goalId, rows);
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Goal funding</h2>
        <span className="card-head-meta">purchase goals, funded in priority order</span>
      </div>
      {[...byGoal.values()].map((rows) => (
        <div key={rows[0].goalId} className="digest-bullet">
          <div className="digest-bullet-title">
            {rows[0].label}
            {rows.every((r) => r.feasible) ? (
              <Badge variant="accent">on track</Badge>
            ) : rows.some((r) => r.feasible) ? (
              <Badge variant="neutral">depends on returns</Badge>
            ) : (
              <Badge variant="neutral">not funded</Badge>
            )}
          </div>
          <p className="digest-bullet-body">
            {rows
              .map(
                (r) =>
                  `${r.scenario}: ${
                    r.feasible
                      ? `funded by ${r.fundedBy}`
                      : r.shortfall != null
                        ? `short ${money(r.shortfall)} at the deadline`
                        : "not funded within 100 years"
                  }`,
              )
              .join(" · ")}
          </p>
        </div>
      ))}
    </section>
  );
}

/** 25-year net-worth projection, one line per scenario, today's dollars. */
function NetWorthCard({ plan }: { plan: LifePlan }): JSX.Element {
  const scenarios = plan.assumptions.scenarios;
  const w = 640;
  const h = 160;
  const points = plan.netWorth;
  const values = points.flatMap((p) => p.byScenario.map((s) => s.value));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 12) - 6;
  const line = (name: string) =>
    points
      .map((p, i) => {
        const v = p.byScenario.find((s) => s.name === name)?.value;
        return v != null ? `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}` : "";
      })
      .join(" ");
  const last = points[points.length - 1];

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Net worth, projected</h2>
        <span className="card-head-meta">
          today's dollars · inflation {plan.assumptions.inflationPct}% ·{" "}
          {scenarios.map((s) => `${s.name} ${s.annualReturnPct}%`).join(" / ")}
        </span>
      </div>
      <svg
        className="equity-spark networth-chart"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Net worth projection"
      >
        {y(0) <= h && y(0) >= 0 && <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="networth-zero" />}
        {scenarios.map((s, i) => (
          <path key={s.name} d={line(s.name)} className={`networth-line networth-${i}`} />
        ))}
      </svg>
      <div className="lab-stats">
        {last.byScenario.map((s) => (
          <PlanStat key={s.name} label={`${s.name} · ${last.year}`} value={money(s.value)} />
        ))}
      </div>
      <p className="muted small">
        <Icon name="circle-questionmark" size={12} /> Model: investable assets compound at each scenario's
        inflation-adjusted return, cash/property hold real value, debts amortize on the avalanche schedule.
        Simple on purpose — you can read every assumption above.
      </p>
    </section>
  );
}
