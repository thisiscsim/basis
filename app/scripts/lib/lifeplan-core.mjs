// The deterministic life-plan core, shared by lifeplan.mjs (numbers-only)
// and lifeplan-llm.mjs (numbers + cited narrative). Everything computed here
// is ground truth the model may not contradict.
import path from "node:path";
import { parseFinances, parseGoals, parseLifePlan, parsePortfolio } from "@basis/schema";
import { readJsonMaybe, round } from "./cli.mjs";
import { edgarCacheDir } from "./edgar.mjs";
import { fetchDailyCloses, latestClose } from "./prices.mjs";
import { debtAvalanche, goalFeasibility, monthlySurplus, projectNetWorth } from "./projection.mjs";

/** Named assumptions shown on every chart. Nominal returns; inflation applied. */
export const SCENARIOS = [
  { name: "conservative", annualReturnPct: 4 },
  { name: "expected", annualReturnPct: 7 },
  { name: "optimistic", annualReturnPct: 10 },
];
export const INFLATION_PCT = 3;

/**
 * Compute the deterministic plan core from the data dir. Returns the
 * lifeplan.json fields (minus LLM parts) plus the previously stored plan so
 * callers can preserve or replace steps/narrative.
 */
export async function computeCore(dir, repoRoot) {
  const finances = parseFinances(readJsonMaybe(path.join(dir, "finances.json")));
  const goals = parseGoals(readJsonMaybe(path.join(dir, "goals.json")));
  const portfolio = parsePortfolio(readJsonMaybe(path.join(dir, "portfolio.json")));
  if (finances.income.netMonthly === 0 && finances.assets.length === 0 && finances.debts.length === 0) {
    throw new Error("finances.json is empty — fill in your snapshot on the Plan tab first");
  }

  // Portfolio market value (best effort: shares x latest close).
  const cacheDir = edgarCacheDir(repoRoot);
  let portfolioValue = 0;
  let unvaluedHoldings = 0;
  for (const h of portfolio.holdings) {
    if (typeof h.shares === "number" && h.shares > 0) {
      const close = latestClose(await fetchDailyCloses(h.ticker, cacheDir))?.close;
      if (close != null) {
        portfolioValue += h.shares * close;
        continue;
      }
    }
    unvaluedHoldings++;
  }

  const surplus = monthlySurplus(finances, goals);
  const extraToDebt = Math.max(0, surplus.monthly);
  const schedule = debtAvalanche(finances.debts, extraToDebt);
  const netWorth = projectNetWorth({
    finances,
    portfolioValue,
    contributionsMonthly: Math.max(0, surplus.monthly) + surplus.savingsMonthly,
    scenarios: SCENARIOS,
    inflationPct: INFLATION_PCT,
    years: 25,
  });
  const goalFunding = goalFeasibility(goals, Math.max(0, surplus.monthly), SCENARIOS, INFLATION_PCT);

  const warnings = [];
  if (surplus.monthly < 0) {
    warnings.push(
      `You're running a ${round(-surplus.monthly)}/month deficit after fixed costs, minimums, savings, and goal reserves — the plan can't fund anything until this flips positive.`,
    );
  }
  for (const row of schedule.perDebt) {
    if (row.neverPaysOff) {
      warnings.push(
        `${row.label}: payments don't cover the interest — this balance grows forever as configured.`,
      );
    }
  }
  const highApr = finances.debts.filter((d) => d.aprPct > 8 && d.balance > 0);
  if (highApr.length > 0) {
    warnings.push(
      `High-interest debt (${highApr.map((d) => `${d.label} @ ${d.aprPct}%`).join(", ")}) beats any expected market return — the schedule attacks it first.`,
    );
  }
  for (const g of goalFunding.filter((row) => row.scenario === "expected" && !row.feasible).slice(0, 3)) {
    warnings.push(
      `Goal "${g.label}" isn't funded under expected assumptions${g.shortfall != null ? ` (short ~$${g.shortfall} at the deadline)` : ""}.`,
    );
  }
  if (unvaluedHoldings > 0) {
    warnings.push(
      `${unvaluedHoldings} portfolio holding(s) without shares/prices were excluded from net worth.`,
    );
  }
  if (finances.measuredMonthlySpend != null && finances.measuredMonthlySpend > surplus.fixedMonthly * 1.1) {
    warnings.push(
      `Your accounts show ~$${round(finances.measuredMonthlySpend)}/mo of spending vs the $${round(surplus.fixedMonthly)}/mo you declared — the plan is only as honest as its inputs.`,
    );
  }

  const existing = parseLifePlan(readJsonMaybe(path.join(dir, "lifeplan.json")));
  return {
    core: {
      version: 1,
      generatedAt: new Date().toISOString(),
      assumptions: { scenarios: SCENARIOS, inflationPct: INFLATION_PCT },
      surplus,
      debtSchedule: schedule.perDebt.map((d) => ({
        label: d.label,
        monthsToPayoff: d.monthsToPayoff,
        payoffDate: d.payoffDate,
        interestPaid: d.interestPaid,
        neverPaysOff: d.neverPaysOff,
      })),
      debtTotals: { interestPaid: schedule.totalInterest, debtFreeDate: schedule.debtFreeDate },
      goalFunding,
      netWorth: netWorth.slice(0, 26),
      warnings: warnings.slice(0, 20),
    },
    existing,
    finances,
    goals,
  };
}

/**
 * Deterministic citation validation: keep only steps whose citations all
 * resolve to real playbook principles. Returns { steps, droppedSteps }.
 */
export function validateSteps(steps, playbooks) {
  const known = new Set();
  for (const pb of playbooks) {
    for (const principle of pb.principles) known.add(`${pb.id}|${principle.id}`);
  }
  const kept = [];
  let droppedSteps = 0;
  for (const step of steps ?? []) {
    const citations = Array.isArray(step?.citations) ? step.citations : [];
    const allResolve =
      citations.length > 0 && citations.every((c) => known.has(`${c?.playbookId}|${c?.principleId}`));
    if (allResolve) kept.push(step);
    else droppedSteps++;
  }
  return { steps: kept.slice(0, 12), droppedSteps };
}
