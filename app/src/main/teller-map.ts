import type { Finances } from "@basis/schema";
import type { TellerAccount, TellerBalance, TellerTransaction } from "./teller";

/**
 * Pure mapping from Teller data onto finances.json (unit-tested). Bank rows
 * (`source: "bank"`) are replaced wholesale on every sync; manual rows
 * survive. Depository accounts become cash assets; credit accounts become
 * credit-card debts (Teller doesn't expose APR/minimums, so those stay
 * user-editable on the ingested rows — merged back from the previous sync's
 * row when present).
 */
export function mapTellerAccounts(
  accounts: TellerAccount[],
  balances: Map<string, TellerBalance>,
  existing: Finances,
): { finances: Finances; assets: number; debts: number; skipped: number } {
  const bankAssets: Finances["assets"] = [];
  const bankDebts: Finances["debts"] = [];
  let skipped = 0;

  const prevDebtByAccount = new Map(
    existing.debts.filter((d) => d.source === "bank" && d.accountId).map((d) => [d.accountId, d]),
  );

  for (const account of accounts) {
    const ledger = Number(balances.get(account.id)?.ledger);
    if (!Number.isFinite(ledger) || ledger < 0) {
      skipped++;
      continue;
    }
    const label = `${account.name}${account.institution?.name ? ` (${account.institution.name})` : ""}`.slice(
      0,
      64,
    );
    if (account.type === "depository") {
      bankAssets.push({ label, kind: "cash", value: ledger, source: "bank", accountId: account.id });
    } else if (account.type === "credit") {
      const prev = prevDebtByAccount.get(account.id);
      bankDebts.push({
        label,
        kind: "credit-card",
        balance: ledger,
        // APR/minimum aren't in Teller's data: preserve what the user typed
        // onto this account's row last time, else leave 0 for them to fill.
        aprPct: prev?.aprPct ?? 0,
        minimumMonthly: prev?.minimumMonthly ?? 0,
        source: "bank",
        accountId: account.id,
      });
    } else {
      skipped++;
    }
  }

  return {
    finances: {
      ...existing,
      assets: [...existing.assets.filter((a) => a.source !== "bank"), ...bankAssets].slice(0, 100),
      debts: [...existing.debts.filter((d) => d.source !== "bank"), ...bankDebts].slice(0, 50),
      lastSyncedAt: new Date().toISOString(),
    },
    assets: bankAssets.length,
    debts: bankDebts.length,
    skipped,
  };
}

export interface RecurringSuggestion {
  label: string;
  amount: number;
  occurrences: number;
}

/** A transaction's outflow in dollars (spending only, sign-normalized per account type). */
function outflow(tx: TellerTransaction, accountType: string): number {
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount)) return 0;
  // Depository: outflows are negative. Credit: charges are positive.
  if (accountType === "depository") return amount < 0 ? -amount : 0;
  if (accountType === "credit") return amount > 0 ? amount : 0;
  return 0;
}

const normalizeMerchant = (tx: TellerTransaction): string =>
  (tx.details?.counterparty?.name || tx.description || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);

/**
 * Detect recurring monthly outflows from ~90 days of transactions: same
 * merchant, similar amount (±15%), seen in at least `minMonths` distinct
 * months. Returns suggested fixed-cost rows plus the measured average total
 * monthly spend (the "declared vs measured" honesty number).
 */
export function detectRecurring(
  transactions: { tx: TellerTransaction; accountType: string }[],
  { minMonths = 2 } = {},
): { suggestions: RecurringSuggestion[]; measuredMonthlySpend: number } {
  const byMerchant = new Map<string, { month: string; amount: number }[]>();
  let totalOutflow = 0;
  const months = new Set<string>();

  for (const { tx, accountType } of transactions) {
    const spend = outflow(tx, accountType);
    if (spend <= 0) continue;
    const month = tx.date.slice(0, 7);
    months.add(month);
    totalOutflow += spend;
    const merchant = normalizeMerchant({ ...tx });
    const rows = byMerchant.get(merchant) ?? [];
    rows.push({ month, amount: spend });
    byMerchant.set(merchant, rows);
  }

  const suggestions: RecurringSuggestion[] = [];
  for (const [merchant, rows] of byMerchant) {
    // One representative charge per month, then require a monthly cadence
    // with stable amounts.
    const perMonth = new Map<string, number>();
    for (const row of rows) {
      if (!perMonth.has(row.month)) perMonth.set(row.month, row.amount);
    }
    if (perMonth.size < minMonths) continue;
    const amounts = [...perMonth.values()];
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const stable = amounts.every((a) => Math.abs(a - mean) <= mean * 0.15);
    if (!stable || mean < 5) continue;
    suggestions.push({
      label: merchant.replace(/\b\w/g, (c) => c.toUpperCase()),
      amount: Math.round(mean * 100) / 100,
      occurrences: perMonth.size,
    });
  }
  suggestions.sort((a, b) => b.amount - a.amount);

  const measuredMonthlySpend = months.size > 0 ? Math.round((totalOutflow / months.size) * 100) / 100 : 0;
  return { suggestions: suggestions.slice(0, 30), measuredMonthlySpend };
}
