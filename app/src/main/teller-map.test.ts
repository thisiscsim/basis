import { describe, expect, it } from "vitest";
import { detectRecurring, mapTellerAccounts } from "./teller-map";
import type { Finances } from "@basis/schema";
import type { TellerTransaction } from "./teller";

const emptyFinances: Finances = {
  version: 1,
  income: { netMonthly: 0 },
  fixedMonthly: [],
  debts: [],
  assets: [],
  savingsMonthly: [],
};

const accounts = [
  {
    id: "acc_chk",
    name: "My Checking",
    type: "depository",
    subtype: "checking",
    institution: { name: "Chase" },
  },
  {
    id: "acc_cc",
    name: "Platinum Card",
    type: "credit",
    subtype: "credit_card",
    institution: { name: "Chase" },
  },
  { id: "acc_weird", name: "Mystery", type: "loan", subtype: "?" },
];
const balances = new Map([
  ["acc_chk", { account_id: "acc_chk", ledger: "12345.67" }],
  ["acc_cc", { account_id: "acc_cc", ledger: "4655.77" }],
  ["acc_weird", { account_id: "acc_weird", ledger: "not-a-number" }],
]);

describe("mapTellerAccounts", () => {
  it("maps depository->cash asset, credit->credit-card debt, skips the rest", () => {
    const { finances, assets, debts, skipped } = mapTellerAccounts(accounts, balances, emptyFinances);
    expect(assets).toBe(1);
    expect(debts).toBe(1);
    expect(skipped).toBe(1);
    expect(finances.assets[0]).toMatchObject({
      label: "My Checking (Chase)",
      kind: "cash",
      value: 12345.67,
      source: "bank",
      accountId: "acc_chk",
    });
    expect(finances.debts[0]).toMatchObject({ kind: "credit-card", balance: 4655.77, source: "bank" });
    expect(finances.lastSyncedAt).toBeTruthy();
  });

  it("replaces bank rows wholesale, keeps manual rows, preserves user-entered APR/minimum", () => {
    const existing: Finances = {
      ...emptyFinances,
      assets: [
        { label: "Old bank row", kind: "cash", value: 1, source: "bank", accountId: "acc_gone" },
        { label: "Cash under mattress", kind: "cash", value: 500, source: "manual" },
      ],
      debts: [
        {
          label: "Old card",
          kind: "credit-card",
          balance: 1,
          aprPct: 24.99,
          minimumMonthly: 120,
          source: "bank",
          accountId: "acc_cc",
        },
      ],
    };
    const { finances } = mapTellerAccounts(accounts, balances, existing);
    expect(finances.assets.map((a) => a.label)).toEqual(["Cash under mattress", "My Checking (Chase)"]);
    const card = finances.debts.find((d) => d.accountId === "acc_cc")!;
    expect(card.balance).toBe(4655.77); // fresh balance
    expect(card.aprPct).toBe(24.99); // user-entered terms preserved
    expect(card.minimumMonthly).toBe(120);
  });
});

const tx = (date: string, amount: string, name: string): TellerTransaction => ({
  id: `t-${date}-${name}`,
  account_id: "acc_cc",
  date,
  amount,
  description: name,
  details: { counterparty: { name } },
});

describe("detectRecurring", () => {
  it("finds monthly same-merchant stable-amount charges and measures total spend", () => {
    const transactions = [
      { tx: tx("2026-05-15", "15.99", "NETFLIX.COM"), accountType: "credit" },
      { tx: tx("2026-06-15", "15.99", "NETFLIX.COM"), accountType: "credit" },
      { tx: tx("2026-07-15", "15.99", "NETFLIX.COM"), accountType: "credit" },
      { tx: tx("2026-06-02", "84.12", "WHOLE FOODS"), accountType: "credit" }, // one-off
      { tx: tx("2026-07-01", "-2500.00", "LANDLORD LLC"), accountType: "depository" },
      { tx: tx("2026-06-01", "-2500.00", "LANDLORD LLC"), accountType: "depository" },
      { tx: tx("2026-06-20", "500.00", "PAYCHECK"), accountType: "depository" }, // inflow: ignored
    ];
    const { suggestions, measuredMonthlySpend } = detectRecurring(transactions);
    expect(suggestions.map((s) => s.label)).toEqual(["Landlord Llc", "Netflix Com"]);
    expect(suggestions[1].amount).toBe(15.99);
    // 3 months seen: (15.99*3 + 84.12 + 2500*2) / 3
    expect(measuredMonthlySpend).toBeCloseTo((15.99 * 3 + 84.12 + 5000) / 3, 1);
  });

  it("rejects unstable amounts and tiny charges", () => {
    const transactions = [
      { tx: tx("2026-06-10", "40.00", "SHELL"), accountType: "credit" },
      { tx: tx("2026-07-10", "90.00", "SHELL"), accountType: "credit" }, // varies too much
      { tx: tx("2026-06-05", "1.00", "APPLE"), accountType: "credit" },
      { tx: tx("2026-07-05", "1.00", "APPLE"), accountType: "credit" }, // under $5 floor
    ];
    expect(detectRecurring(transactions).suggestions).toEqual([]);
  });
});
