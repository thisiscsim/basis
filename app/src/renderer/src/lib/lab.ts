import type { PaperAccount } from "@basis/schema";

/** The PRD's paper-trading gauntlet length, in days. */
export const GAUNTLET_DAYS = 180;

/** Days elapsed in the gauntlet (0 when not started) + the target. */
export function gauntletProgress(
  account: PaperAccount,
  now: Date = new Date(),
): { day: number; target: number } {
  if (!account.startedAt) return { day: 0, target: GAUNTLET_DAYS };
  const ms = now.getTime() - new Date(account.startedAt).getTime();
  return { day: Math.max(0, Math.floor(ms / (24 * 3600_000))), target: GAUNTLET_DAYS };
}
