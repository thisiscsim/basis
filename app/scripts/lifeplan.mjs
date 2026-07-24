// Deterministic life-plan pass: read finances/goals/portfolio, compute the
// plan core (surplus, debt avalanche, goal feasibility, 3-scenario net-worth
// projection) and write lifeplan.json. No LLM — the numbers ARE the plan's
// ground truth; lifeplan-llm.mjs layers cited narrative steps on top and may
// not contradict them. Projections are assumption math, not predictions.
//
// Usage: node app/scripts/lifeplan.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFinances, parseGoals, parseLifePlan, parsePortfolio } from "@basis/schema";
import { readJsonMaybe, round, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { edgarCacheDir } from "./lib/edgar.mjs";
import { fetchDailyCloses, latestClose } from "./lib/prices.mjs";
import { debtAvalanche, goalFeasibility, monthlySurplus, projectNetWorth } from "./lib/projection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

/** Named assumptions shown on every chart. Nominal returns; inflation applied. */
const SCENARIOS = [
  { name: "conservative", annualReturnPct: 4 },
  { name: "expected", annualReturnPct: 7 },
  { name: "optimistic", annualReturnPct: 10 },
];
const INFLATION_PCT = 3;

async function main() {
  const dir = ensureDataDir(REPO_ROOT);
  const finances = parseFinances(readJsonMaybe(path.join(dir, "finances.json")));
  const goals = parseGoals(readJsonMaybe(path.join(dir, "goals.json")));
  const portfolio = parsePortfolio(readJsonMaybe(path.join(dir, "portfolio.json")));
  if (finances.income.netMonthly === 0 && finances.assets.length === 0 && finances.debts.length === 0) {
    fail("finances.json is empty — fill in your snapshot on the Plan tab first");
  }

  // Portfolio market value (best effort: shares x latest close; weight-only
  // rows can't be valued and are skipped with a warning).
  phase("valuing portfolio");
  const cacheDir = edgarCacheDir(REPO_ROOT);
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
  progress(30);

  phase("computing the plan");
  const surplus = monthlySurplus(finances, goals);
  // The surplus splits: extra debt payments first while high-APR debt exists,
  // else investing. Model: all surplus attacks debt until debt-free, then all
  // surplus invests. For the projection we use the post-debt investing rate;
  // debt amortization is carried by the avalanche schedule itself.
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
  progress(70);

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
  const infeasiblePriority = goalFunding.filter((g) => g.scenario === "expected" && !g.feasible);
  for (const g of infeasiblePriority.slice(0, 3)) {
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

  // Preserve LLM-authored parts; the deterministic core is always fresh.
  const existing = parseLifePlan(readJsonMaybe(path.join(dir, "lifeplan.json")));
  const plan = parseLifePlan({
    version: 1,
    generatedAt: new Date().toISOString(),
    model: existing.model,
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
    netWorth: netWorth.filter((_, i) => i % 1 === 0).slice(0, 26),
    steps: existing.steps,
    narrative: existing.narrative,
    warnings: warnings.slice(0, 20),
    playbooksUsed: existing.playbooksUsed,
  });
  fs.writeFileSync(path.join(dir, "lifeplan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  progress(100);
  console.log("DONE lifeplan.json");
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
