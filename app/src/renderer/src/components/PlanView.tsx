import { useEffect, useState } from "react";
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
  const pushNotice = useApp((s) => s.pushNotice);
  const reloadData = useApp((s) => s.reloadData);
  const [editing, setEditing] = useState<"finances" | "goals" | null>(null);
  const [teller, setTeller] = useState({ configured: false, linked: false });
  const [bankBusy, setBankBusy] = useState(false);

  useEffect(() => {
    window.api
      ?.getSettings()
      .then((s) => setTeller({ configured: Boolean(s.tellerAppId), linked: s.tellerLinked }))
      .catch(() => {});
  }, [editing]); // re-check after modals close (Settings may have changed)

  const bankAction = async () => {
    if (bankBusy) return;
    setBankBusy(true);
    try {
      const res = teller.linked ? await window.api.tellerSync() : await window.api.tellerLink();
      if (res.ok) {
        setTeller((t) => ({ ...t, linked: true }));
        await reloadData();
        pushNotice(
          "info",
          `Bank sync: ${res.assets ?? 0} account${res.assets === 1 ? "" : "s"}, ${res.debts ?? 0} card${
            res.debts === 1 ? "" : "s"
          }${res.suggestions ? `, ${res.suggestions} recurring cost${res.suggestions === 1 ? "" : "s"} detected` : ""}. Read-only.`,
        );
      } else if (!res.cancelled) {
        pushNotice("error", res.error ?? "Bank sync failed.");
      }
    } finally {
      setBankBusy(false);
    }
  };

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
        {finances.measuredMonthlySpend != null && (
          <p className="muted small">
            Declared fixed costs: {money(finances.fixedMonthly.reduce((s, r) => s + r.amount, 0))}/mo · your
            accounts show ~{money(finances.measuredMonthlySpend)}/mo of actual spending
            {finances.lastSyncedAt ? ` (synced ${relativeTime(finances.lastSyncedAt)})` : ""}.
          </p>
        )}
        <div className="lab-form">
          <Button variant="secondary" size="sm" icon="input-form" onClick={() => setEditing("finances")}>
            Edit finances
          </Button>
          <Button variant="secondary" size="sm" icon="input-form" onClick={() => setEditing("goals")}>
            Edit goals ({goals.goals.length})
          </Button>
          {teller.configured && (
            <Button
              variant="secondary"
              size="sm"
              icon="arrow-rotate"
              disabled={bankBusy}
              onClick={() => void bankAction()}
            >
              {bankBusy ? "Syncing…" : teller.linked ? "Sync banks" : "Connect bank"}
            </Button>
          )}
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

      <PlaybooksCard />

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

/**
 * Playbooks: distilled, cited principle sets from books/notes the user drops
 * in. The cited plan grounds every step in these.
 */
function PlaybooksCard(): JSX.Element {
  const playbooks = useApp((s) => s.data?.playbooks ?? []);
  const job = useApp((s) => s.jobs.playbook);
  const pushNotice = useApp((s) => s.pushNotice);
  const reloadData = useApp((s) => s.reloadData);
  const [sources, setSources] = useState<string[]>([]);
  const [browsing, setBrowsing] = useState<string | null>(null);

  useEffect(() => {
    window.api
      ?.listPlaybookSources()
      .then(setSources)
      .catch(() => {});
  }, [playbooks.length, job.running]);

  const importSource = async () => {
    const res = await window.api.importPlaybookSource();
    if (res.ok && res.file) {
      setSources((prev) => (prev.includes(res.file!) ? prev : [...prev, res.file!]));
      pushNotice("info", `Imported ${res.file}. Now distill it into a playbook.`);
    } else if (!res.canceled && res.error) {
      pushNotice("error", res.error);
    }
  };

  const extractedFor = (file: string) => playbooks.find((pb) => pb.sourceFile === file);
  const browsingPb = browsing ? playbooks.find((pb) => pb.id === browsing) : null;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Playbooks</h2>
        <span className="card-head-meta">your sources, distilled with verified quotes</span>
      </div>
      <p className="muted small">
        Drop in a book or your own notes (PDF/EPUB/txt/md — e.g. your copy of "I Will Teach You To Be Rich").
        Basis distills it into cited principles; the plan then grounds every step in them. Sources stay local
        and are never uploaded anywhere except your model provider, in excerpts.
      </p>
      <div className="lab-form">
        <Button variant="secondary" size="sm" icon="arrow-out-of-box" onClick={() => void importSource()}>
          Import source…
        </Button>
      </div>
      {(sources.length > 0 || playbooks.length > 0) && (
        <div className="clip-list clip-list-capped">
          {sources.map((file) => {
            const pb = extractedFor(file);
            const partial = pb && pb.chunksDone < pb.chunksTotal;
            return (
              <div key={file} className="clip-row" title={file}>
                <span className="name">
                  {file}
                  {pb
                    ? ` — ${pb.principles.length} principle${pb.principles.length === 1 ? "" : "s"}${
                        partial ? ` (part ${pb.chunksDone}/${pb.chunksTotal})` : ""
                      }${pb.droppedPrinciples ? `, ${pb.droppedPrinciples} dropped` : ""}`
                    : " — not distilled yet"}
                </span>
                {pb && pb.principles.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setBrowsing(pb.id)}>
                    Browse
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={job.running || (pb != null && !partial)}
                  onClick={() => {
                    void runJob("playbook", () => window.api.startPlaybook(file)).then(() => reloadData());
                  }}
                >
                  {job.running
                    ? job.phase || "Distilling…"
                    : pb
                      ? partial
                        ? "Continue"
                        : "Done"
                      : "Distill"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {job.running && (
        <div className="bar job-bar" aria-hidden>
          <div className="bar-fill" style={{ width: `${job.progress}%` }} />
        </div>
      )}
      {browsingPb && <PrinciplesModal playbook={browsingPb} onClose={() => setBrowsing(null)} />}
    </section>
  );
}

function PrinciplesModal({
  playbook,
  onClose,
}: {
  playbook: NonNullable<ReturnType<typeof useApp.getState>["data"]>["playbooks"][number];
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gate-card principles-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="gate-title">{playbook.title || playbook.id}</h2>
        <p className="muted small">
          {playbook.principles.length} principles, every quote verified verbatim against the source.
        </p>
        <div className="principle-list">
          {playbook.principles.map((p) => (
            <div key={p.id} className="claim">
              <p className="claim-text">
                <Badge variant="neutral">{p.topic}</Badge> {p.text}
              </p>
              <blockquote className="claim-quote">
                "{p.quote}"<span className="muted small">{p.location ? ` — ${p.location}` : ""}</span>
              </blockquote>
            </div>
          ))}
        </div>
        <div className="gate-actions">
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
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
          {plan.narrative && <p className="brief-summary">{plan.narrative}</p>}
          {plan.steps.map((step, i) => (
            <PlanStepRow key={i} index={i} step={step} />
          ))}
          <p className="muted small">
            Every step cites a principle from your playbooks (click a citation to see the verified quote);
            steps with citations that didn't resolve were dropped.
          </p>
        </section>
      )}

      <p className="disclaimer">
        Projections are assumption math, not predictions — the assumptions are printed on every chart. Tax and
        legal specifics vary; verify anything load-bearing with a professional. Basis never moves money.
      </p>
    </>
  );
}

function PlanStepRow({ index, step }: { index: number; step: LifePlan["steps"][number] }): JSX.Element {
  const playbooks = useApp((s) => s.data?.playbooks ?? []);
  const [openCitation, setOpenCitation] = useState<number | null>(null);
  const resolve = (c: { playbookId: string; principleId: string }) => {
    const pb = playbooks.find((p) => p.id === c.playbookId);
    const principle = pb?.principles.find((p) => p.id === c.principleId);
    return pb && principle ? { pb, principle } : null;
  };
  return (
    <div className="digest-bullet">
      <div className="digest-bullet-title">
        {index + 1}. {step.title}
        {step.citations.map((c, ci) => {
          const resolved = resolve(c);
          if (!resolved) return null;
          return (
            <button
              key={ci}
              className="citation-chip"
              title={`${resolved.pb.title || resolved.pb.id} — click for the quote`}
              onClick={() => setOpenCitation(openCitation === ci ? null : ci)}
            >
              [{ci + 1}]
            </button>
          );
        })}
      </div>
      {step.body && <p className="digest-bullet-body">{step.body}</p>}
      {openCitation != null &&
        (() => {
          const resolved = resolve(step.citations[openCitation]);
          if (!resolved) return null;
          return (
            <blockquote className="claim-quote">
              "{resolved.principle.quote}"
              <span className="muted small">
                — {resolved.pb.title || resolved.pb.id}
                {resolved.principle.location ? `, ${resolved.principle.location}` : ""}
              </span>
            </blockquote>
          );
        })()}
    </div>
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
