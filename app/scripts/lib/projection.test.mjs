import { describe, expect, it } from "vitest";
import {
  debtAvalanche,
  goalFeasibility,
  monthlySurplus,
  projectNetWorth,
  realMonthlyRate,
} from "./projection.mjs";

const START = new Date("2026-01-01T00:00:00Z");

const finances = {
  income: { netMonthly: 8000 },
  fixedMonthly: [
    { label: "Rent", amount: 2500, source: "manual" },
    { label: "Utilities", amount: 300, source: "manual" },
  ],
  debts: [
    { label: "Visa", kind: "credit-card", balance: 6000, aprPct: 24, minimumMonthly: 200, source: "manual" },
    { label: "Car", kind: "auto", balance: 12000, aprPct: 6, minimumMonthly: 400, source: "manual" },
  ],
  assets: [
    { label: "Checking", kind: "cash", value: 10000, source: "manual" },
    { label: "401k", kind: "retirement", value: 50000, source: "manual" },
  ],
  savingsMonthly: [{ label: "401k contribution", amount: 500 }],
};

const goals = {
  goals: [
    { id: "trips", label: "Trips", kind: "recurring", annualCost: 12000, priority: 2 },
    { id: "apt", label: "Nicer apartment", kind: "lifestyle", monthlyDelta: 400, priority: 3 },
    { id: "house", label: "House", kind: "purchase", targetAmount: 60000, priority: 1 },
  ],
};

describe("monthlySurplus", () => {
  it("nets income against fixed, minimums, savings, and goal reserves", () => {
    const s = monthlySurplus(finances, goals);
    expect(s.fixedMonthly).toBe(2800);
    expect(s.debtMinimums).toBe(600);
    expect(s.goalReserveMonthly).toBe(1400); // 12000/12 + 400
    expect(s.monthly).toBe(8000 - 2800 - 600 - 500 - 1400); // 2700
  });
});

describe("debtAvalanche", () => {
  it("known answer: single debt, zero APR pays off in balance/payment months", () => {
    const { perDebt, totalInterest } = debtAvalanche(
      [{ label: "Loan", balance: 1200, aprPct: 0, minimumMonthly: 100 }],
      0,
      START,
    );
    expect(perDebt[0].monthsToPayoff).toBe(12);
    expect(perDebt[0].payoffDate).toBe("2027-01");
    expect(totalInterest).toBe(0);
  });

  it("attacks the highest APR first; freed minimums roll forward", () => {
    const { perDebt } = debtAvalanche(finances.debts, 1000, START);
    const visa = perDebt.find((d) => d.label === "Visa");
    const car = perDebt.find((d) => d.label === "Car");
    expect(visa.monthsToPayoff).toBeLessThan(car.monthsToPayoff);
    expect(visa.interestPaid).toBeGreaterThan(0);
  });

  it("flags debts whose payment doesn't cover interest", () => {
    const { perDebt, debtFreeDate } = debtAvalanche(
      [{ label: "Trap", balance: 10000, aprPct: 30, minimumMonthly: 100 }],
      0,
      START,
    );
    expect(perDebt[0].neverPaysOff).toBe(true);
    expect(debtFreeDate).toBeUndefined();
  });

  it("interest math sanity: ~2%/mo on 1000 with a 1020 one-shot payment", () => {
    const { perDebt } = debtAvalanche(
      [{ label: "X", balance: 1000, aprPct: 24, minimumMonthly: 1020 }],
      0,
      START,
    );
    expect(perDebt[0].monthsToPayoff).toBe(1);
    expect(perDebt[0].interestPaid).toBeCloseTo(20, 1);
  });
});

describe("projectNetWorth", () => {
  const scenarios = [{ name: "flat", annualReturnPct: 3 }]; // == inflation -> 0 real

  it("zero real return: net worth grows by contributions only (cash holds value)", () => {
    const noDebt = { ...finances, debts: [] };
    const series = projectNetWorth({
      finances: noDebt,
      portfolioValue: 0,
      contributionsMonthly: 1000,
      scenarios,
      inflationPct: 3,
      years: 2,
      startDate: START,
    });
    // start: 10k cash + 50k retirement; +12k/yr contributions, 0 real growth
    expect(series[0].byScenario[0].value).toBeCloseTo(60_000, 0);
    expect(series[2].byScenario[0].value).toBeCloseTo(60_000 + 24_000, 0);
  });

  it("known answer: pure compounding matches closed form", () => {
    const only = {
      income: { netMonthly: 0 },
      fixedMonthly: [],
      debts: [],
      assets: [],
      savingsMonthly: [],
    };
    const series = projectNetWorth({
      finances: only,
      portfolioValue: 10_000,
      contributionsMonthly: 0,
      scenarios: [{ name: "e", annualReturnPct: 9.2 }],
      inflationPct: 3,
      years: 10,
      startDate: START,
    });
    const realAnnual = 1.092 / 1.03;
    expect(series[10].byScenario[0].value).toBeCloseTo(10_000 * Math.pow(realAnnual, 10), 0);
  });

  it("debts subtract and amortize toward zero", () => {
    const series = projectNetWorth({
      finances,
      portfolioValue: 0,
      contributionsMonthly: 0,
      scenarios,
      inflationPct: 3,
      years: 5,
      startDate: START,
    });
    expect(series[0].byScenario[0].value).toBeLessThan(60_000); // debts bite at t0
    expect(series[5].byScenario[0].value).toBeGreaterThan(series[0].byScenario[0].value);
  });
});

describe("goalFeasibility", () => {
  const scenarios = [{ name: "expected", annualReturnPct: 3 }]; // 0 real

  it("funds purchase goals sequentially by priority from the surplus", () => {
    const rows = goalFeasibility(
      { goals: [{ id: "house", label: "House", kind: "purchase", targetAmount: 12_000, priority: 1 }] },
      1000,
      scenarios,
      3,
      START,
    );
    expect(rows[0].feasible).toBe(true);
    expect(rows[0].fundedBy).toBe("2027-01"); // 12 months at 1000/mo, 0 real return
  });

  it("reports the shortfall at the deadline when infeasible", () => {
    const rows = goalFeasibility(
      {
        goals: [
          {
            id: "h",
            label: "House",
            kind: "purchase",
            targetAmount: 50_000,
            targetDate: "2027-01",
            priority: 1,
          },
        ],
      },
      1000,
      scenarios,
      3,
      START,
    );
    expect(rows[0].feasible).toBe(false);
    expect(rows[0].shortfall).toBeCloseTo(38_000, 0); // 50k - 12 x 1k
  });

  it("zero surplus means nothing gets funded", () => {
    const rows = goalFeasibility(
      { goals: [{ id: "h", label: "H", kind: "purchase", targetAmount: 1000, priority: 1 }] },
      0,
      scenarios,
      3,
      START,
    );
    expect(rows[0].feasible).toBe(false);
  });
});

describe("realMonthlyRate", () => {
  it("return == inflation -> zero real rate", () => {
    expect(realMonthlyRate(3, 3)).toBeCloseTo(0, 10);
  });
});
