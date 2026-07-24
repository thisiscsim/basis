// Pure life-plan projection math. No fs, no network, no LLM — every number
// the plan shows comes from here, and the model may not contradict it.
// Deliberately simple, explainable models (documented per function); the UI
// always shows the assumptions next to the outputs.

const MONTHS_CAP = 1200; // 100 years: beyond this a debt "never pays off"

const round2 = (n) => Math.round(n * 100) / 100;

/** Nominal annual % -> real (inflation-adjusted) monthly rate. */
export function realMonthlyRate(annualReturnPct, inflationPct) {
  const real = (1 + annualReturnPct / 100) / (1 + inflationPct / 100) - 1;
  return Math.pow(1 + real, 1 / 12) - 1;
}

/**
 * The monthly surplus breakdown: net income minus fixed costs, debt
 * minimums, committed savings, and goal reserves (recurring goals reserve
 * annualCost/12; lifestyle goals reserve their monthlyDelta; purchase goals
 * are funded FROM the surplus, so they don't reserve here).
 */
export function monthlySurplus(finances, goals) {
  const sum = (rows, pick) => rows.reduce((s, r) => s + pick(r), 0);
  const netMonthlyIncome = finances.income.netMonthly;
  const fixedMonthly = sum(finances.fixedMonthly, (r) => r.amount);
  const debtMinimums = sum(finances.debts, (r) => r.minimumMonthly);
  const savingsMonthly = sum(finances.savingsMonthly, (r) => r.amount);
  const goalReserveMonthly = sum(goals.goals, (g) =>
    g.kind === "recurring" ? (g.annualCost ?? 0) / 12 : g.kind === "lifestyle" ? (g.monthlyDelta ?? 0) : 0,
  );
  const monthly = netMonthlyIncome - fixedMonthly - debtMinimums - savingsMonthly - goalReserveMonthly;
  return {
    netMonthlyIncome: round2(netMonthlyIncome),
    fixedMonthly: round2(fixedMonthly),
    debtMinimums: round2(debtMinimums),
    savingsMonthly: round2(savingsMonthly),
    goalReserveMonthly: round2(goalReserveMonthly),
    monthly: round2(monthly),
  };
}

/**
 * Debt avalanche: every month, interest accrues (APR/12), minimums are paid
 * on every debt, and `extraMonthly` attacks the highest-APR balance. Returns
 * per-debt payoff months/dates and interest paid. Debts whose payments don't
 * cover interest are flagged `neverPaysOff`.
 */
export function debtAvalanche(debts, extraMonthly = 0, startDate = new Date()) {
  const live = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({
      label: d.label,
      balance: d.balance,
      monthlyRate: d.aprPct / 100 / 12,
      minimum: d.minimumMonthly,
      interestPaid: 0,
      monthsToPayoff: null,
    }));
  const extra = Math.max(0, extraMonthly);
  let month = 0;
  while (live.some((d) => d.balance > 0.005) && month < MONTHS_CAP) {
    month++;
    // Interest accrues first.
    for (const d of live) {
      if (d.balance <= 0.005) continue;
      const interest = d.balance * d.monthlyRate;
      d.balance += interest;
      d.interestPaid += interest;
    }
    // Minimums on everything.
    for (const d of live) {
      if (d.balance <= 0.005) continue;
      d.balance = Math.max(0, d.balance - d.minimum);
      if (d.balance <= 0.005 && d.monthsToPayoff == null) d.monthsToPayoff = month;
    }
    // Extra to the highest-APR live balance (plus freed-up minimums roll in
    // implicitly: paid-off debts stop consuming their minimum, which we model
    // by redirecting those minimums into the extra pool).
    const freed = live.filter((d) => d.balance <= 0.005).reduce((s, d) => s + d.minimum, 0);
    let pool = extra + freed;
    const order = live.filter((d) => d.balance > 0.005).sort((a, b) => b.monthlyRate - a.monthlyRate);
    for (const d of order) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.balance);
      d.balance -= pay;
      pool -= pay;
      if (d.balance <= 0.005 && d.monthsToPayoff == null) d.monthsToPayoff = month;
    }
  }

  const monthToDate = (m) => {
    const dt = new Date(startDate);
    dt.setUTCMonth(dt.getUTCMonth() + m);
    return dt.toISOString().slice(0, 7);
  };
  const perDebt = live.map((d) => ({
    label: d.label,
    monthsToPayoff: d.monthsToPayoff ?? undefined,
    payoffDate: d.monthsToPayoff != null ? monthToDate(d.monthsToPayoff) : undefined,
    interestPaid: round2(d.interestPaid),
    neverPaysOff: d.monthsToPayoff == null,
  }));
  const paidMonths = perDebt.filter((d) => d.monthsToPayoff != null).map((d) => d.monthsToPayoff);
  return {
    perDebt,
    totalInterest: round2(live.reduce((s, d) => s + d.interestPaid, 0)),
    debtFreeDate:
      perDebt.every((d) => !d.neverPaysOff) && paidMonths.length > 0
        ? monthToDate(Math.max(...paidMonths))
        : undefined,
  };
}

/**
 * Net-worth projection in TODAY'S dollars, per scenario. Model (simple on
 * purpose): investable assets (portfolio + retirement + monthly
 * contributions) compound at the scenario's real return; cash and property
 * hold their real value; debts amortize on the avalanche schedule. One point
 * per year.
 */
export function projectNetWorth({
  finances,
  portfolioValue = 0,
  contributionsMonthly = 0,
  scenarios,
  inflationPct = 3,
  years = 25,
  startDate = new Date(),
}) {
  const startYear = startDate.getUTCFullYear();
  const cashLike = finances.assets
    .filter((a) => a.kind === "cash" || a.kind === "property" || a.kind === "other")
    .reduce((s, a) => s + a.value, 0);
  const investedStart =
    portfolioValue + finances.assets.filter((a) => a.kind === "retirement").reduce((s, a) => s + a.value, 0);

  // Debt balances by month from the avalanche run (minimums only here; the
  // surplus is modeled as invested, which keeps the two sides comparable).
  const schedule = debtAvalanche(finances.debts, 0, startDate);
  const debtAtMonth = (m) => {
    // Approximate: linear amortization per debt toward its payoff month.
    return finances.debts.reduce((s, d, i) => {
      const row = schedule.perDebt[i];
      if (!row || row.neverPaysOff || row.monthsToPayoff == null) return s + d.balance;
      if (m >= row.monthsToPayoff) return s;
      return s + d.balance * (1 - m / row.monthsToPayoff);
    }, 0);
  };

  const contribution = Math.max(0, contributionsMonthly);
  const out = [];
  for (let y = 0; y <= years; y++) {
    const byScenario = scenarios.map((sc) => {
      const r = realMonthlyRate(sc.annualReturnPct, inflationPct);
      const months = y * 12;
      const growth = Math.pow(1 + r, months);
      // Future value of the starting pot + an ordinary annuity of contributions.
      const invested =
        investedStart * growth + (r > 0 ? contribution * ((growth - 1) / r) : contribution * months);
      const value = invested + cashLike - debtAtMonth(months);
      return { name: sc.name, value: round2(Math.min(Math.max(value, -1e15), 1e15)) };
    });
    out.push({ year: startYear + y, byScenario });
  }
  return out;
}

/**
 * Purchase-goal feasibility per scenario: goals are funded sequentially in
 * priority order from the monthly surplus, compounding at the scenario's
 * real return. Returns funded-by month or the shortfall at targetDate.
 */
export function goalFeasibility(goals, surplusMonthly, scenarios, inflationPct = 3, startDate = new Date()) {
  const purchases = goals.goals
    .filter((g) => g.kind === "purchase" && (g.targetAmount ?? 0) > 0)
    .sort((a, b) => a.priority - b.priority);
  const monthToDate = (m) => {
    const dt = new Date(startDate);
    dt.setUTCMonth(dt.getUTCMonth() + m);
    return dt.toISOString().slice(0, 7);
  };
  const out = [];
  for (const sc of scenarios) {
    const r = realMonthlyRate(sc.annualReturnPct, inflationPct);
    let startMonth = 0;
    for (const g of purchases) {
      const target = g.targetAmount ?? 0;
      const contribution = Math.max(0, surplusMonthly);
      let fundedMonth = null;
      if (contribution > 0) {
        let pot = 0;
        for (let m = startMonth + 1; m <= MONTHS_CAP; m++) {
          pot = pot * (1 + r) + contribution;
          if (pot >= target) {
            fundedMonth = m;
            break;
          }
        }
      }
      const deadlineMonth = g.targetDate
        ? Math.max(
            0,
            (Number(g.targetDate.slice(0, 4)) - startDate.getUTCFullYear()) * 12 +
              Number(g.targetDate.slice(5, 7)) -
              (startDate.getUTCMonth() + 1),
          )
        : null;
      const feasible = fundedMonth != null && (deadlineMonth == null || fundedMonth <= deadlineMonth);
      let shortfall;
      if (!feasible && deadlineMonth != null && contribution >= 0) {
        let pot = 0;
        for (let m = startMonth + 1; m <= deadlineMonth; m++) pot = pot * (1 + r) + contribution;
        shortfall = round2(Math.max(0, target - pot));
      }
      out.push({
        goalId: g.id,
        label: g.label,
        scenario: sc.name,
        feasible,
        fundedBy: fundedMonth != null ? monthToDate(fundedMonth) : undefined,
        shortfall,
      });
      // Sequential funding: the next goal starts saving after this one is done.
      startMonth = fundedMonth ?? MONTHS_CAP;
    }
  }
  return out;
}
