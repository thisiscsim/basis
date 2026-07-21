import {
  AlertsSchema,
  BriefSchema,
  DigestSchema,
  IdeasSchema,
  IpsSchema,
  MetaSchema,
  PortfolioSchema,
  WatchlistSchema,
  XraySchema,
} from "./schema.js";
import type { Alerts, Brief, Digest, Ideas, Ips, Meta, Portfolio, Watchlist, Xray } from "./types.js";

export * from "./schema.js";
export * from "./types.js";
export * from "./llm-config.js";
export { extractJson } from "./extract-json.js";

/**
 * Two parse strategies, matched to the producer:
 * - Defaults-filling `parse*` (throwing) for files the app owns end-to-end
 *   (meta, portfolio, ips, watchlist, alerts, xray): old/partial files keep
 *   parsing, a programmer error throws.
 * - `ParseResult`-returning for LLM-authored documents (brief, digest): the
 *   path-prefixed errors are designed to be fed back to the model in the
 *   repair retry, and the app treats !ok as "not worth rendering".
 */

export function parseMeta(input: unknown): Meta {
  return MetaSchema.parse(input ?? {});
}

export function parsePortfolio(input: unknown): Portfolio {
  return PortfolioSchema.parse(input ?? {});
}

export function parseIps(input: unknown): Ips {
  return IpsSchema.parse(input ?? {});
}

export function parseWatchlist(input: unknown): Watchlist {
  return WatchlistSchema.parse(input ?? {});
}

export function parseAlerts(input: unknown): Alerts {
  return AlertsSchema.parse(input ?? {});
}

export function parseXray(input: unknown): Xray {
  return XraySchema.parse(input ?? {});
}

export function parseIdeas(input: unknown): Ideas {
  return IdeasSchema.parse(input ?? {});
}

export interface BriefParseResult {
  ok: boolean;
  brief?: Brief;
  errors?: string[];
}

export function parseBrief(input: unknown): BriefParseResult {
  const result = BriefSchema.safeParse(input);
  if (result.success) return { ok: true, brief: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

export interface DigestParseResult {
  ok: boolean;
  digest?: Digest;
  errors?: string[];
}

export function parseDigest(input: unknown): DigestParseResult {
  const result = DigestSchema.safeParse(input);
  if (result.success) return { ok: true, digest: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
