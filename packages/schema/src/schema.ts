import { z } from "zod";

/**
 * Workspace sidecar files are the contract between the Electron app, the
 * engine scripts, and the LLM. Every file under workspaces/<slug>/ is a
 * shareable interchange format that LLMs author, so treat every field as
 * untrusted: numerics are finite and bounded, URLs are https-only (they are
 * rendered as clickable links and handed to shell.openExternal), and strings
 * and arrays all carry explicit caps.
 */

/** Finite, non-negative number with an explicit ceiling. */
const bounded = (max: number) => z.number().finite().nonnegative().max(max);

/** A percentage in 0..100. */
const pct = () => z.number().finite().min(0).max(100);

/** Exchange ticker symbol (e.g. AAPL, BRK.B). Normalized uppercase. */
export const TickerSchema = z
  .string()
  .min(1)
  .max(12)
  .regex(/^[A-Z][A-Z0-9.-]{0,11}$/, { message: "must be an uppercase ticker symbol" });

/** SEC Central Index Key: digits only (unpadded or zero-padded). */
export const CikSchema = z.string().regex(/^\d{1,10}$/, { message: "must be a numeric CIK" });

/** SEC accession number, e.g. 0000320193-25-000079 (dashed or bare). */
export const AccessionSchema = z
  .string()
  .regex(/^[0-9-]{10,32}$/, { message: "must be an accession number" });

/**
 * A link we are willing to render and hand to shell.openExternal. https only:
 * file://, smb://, and custom schemes are RCE-adjacent when opened by the OS.
 */
export const HttpsUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (u) => {
      try {
        return new URL(u).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an https URL" },
  );

/**
 * Per-workspace metadata (workspaces/<slug>/meta.json). Identity + lifecycle,
 * not content.
 */
export const MetaSchema = z.object({
  title: z.string().max(512).default("Untitled"),
  createdAt: z.string().max(64).optional(),
  updatedAt: z.string().max(64).optional(),
  status: z.enum(["new", "active", "archived"]).default("active"),
  /** Home-page album this workspace belongs to (registry lives at the workspaces root). */
  albumId: z.string().max(64).optional(),
});

/** One position the user holds (user-entered; no broker linking in Phase 1-2). */
export const HoldingSchema = z.object({
  ticker: TickerSchema,
  name: z.string().max(256).optional(),
  /** Share count (fractional allowed). */
  shares: bounded(1e9).optional(),
  /** Portfolio weight in percent — used by the X-ray when present. */
  weightPct: pct().optional(),
  /** Total cost basis in `currency`. */
  costBasis: bounded(1e12).optional(),
  account: z.string().max(64).optional(),
  notes: z.string().max(500).optional(),
});

/** workspaces/<slug>/portfolio.json — the user's holdings. */
export const PortfolioSchema = z.object({
  version: z.literal(1).default(1),
  currency: z.string().max(8).default("USD"),
  holdings: z.array(HoldingSchema).max(500).default([]),
  updatedAt: z.string().max(64).optional(),
});

/**
 * workspaces/<slug>/ips.json — the Investment Policy Statement. The user's own
 * goals, allocation, and rules; the friction gate argues from these.
 */
export const IpsSchema = z.object({
  version: z.literal(1).default(1),
  /** Free-form goals ("retire at 55", "college fund 2035"). */
  goals: z.string().max(4000).default(""),
  horizonYears: bounded(120).optional(),
  riskTolerance: z.enum(["low", "medium", "high"]).optional(),
  targetAllocation: z
    .array(z.object({ label: z.string().min(1).max(64), pct: pct() }))
    .max(32)
    .default([]),
  /** The rules the user committed to ("no selling on drawdowns < 25%"). */
  rules: z.array(z.string().min(1).max(500)).max(50).default([]),
  updatedAt: z.string().max(64).optional(),
});

/** One monitored company. `lastSeenAccession` is the monitor's cursor. */
export const WatchlistEntrySchema = z.object({
  ticker: TickerSchema,
  cik: CikSchema.optional(),
  name: z.string().max(256).optional(),
  addedAt: z.string().max(64).optional(),
  lastSeenAccession: AccessionSchema.optional(),
  lastCheckedAt: z.string().max(64).optional(),
});

/** workspaces/<slug>/watchlist.json — tickers the monitor tracks on EDGAR. */
export const WatchlistSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(WatchlistEntrySchema).max(200).default([]),
});

/**
 * One claim in a research brief. The citation is load-bearing: `quote` must be
 * an exact excerpt of the source document — brief-llm.mjs verifies it and sets
 * `verified`; unverified claims are dropped before the brief reaches disk.
 */
export const ClaimSchema = z.object({
  text: z.string().min(1).max(2000),
  /** Exact quote from the source document backing this claim. */
  quote: z.string().min(1).max(1500),
  /** Human-readable source label, e.g. "10-K FY2025, Item 1A". */
  source: z.string().min(1).max(256),
  sourceUrl: HttpsUrlSchema,
  accession: AccessionSchema.optional(),
  verified: z.boolean().default(false),
});

export const BriefSectionSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  claims: z.array(ClaimSchema).max(30).default([]),
});

/**
 * workspaces/<slug>/briefs/<ticker>-<date>.json — a due-diligence brief.
 * LLM-authored; every claim carries a verified citation.
 */
export const BriefSchema = z.object({
  version: z.literal(1).default(1),
  ticker: TickerSchema,
  company: z.string().max(256).optional(),
  generatedAt: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  summary: z.string().max(4000).default(""),
  sections: z.array(BriefSectionSchema).max(12).default([]),
  sources: z
    .array(z.object({ url: HttpsUrlSchema, title: z.string().max(256).optional() }))
    .max(50)
    .default([]),
  /** Claims the citation check dropped (kept as a count for honesty in the UI). */
  droppedClaims: z.number().int().nonnegative().max(1000).default(0),
});

/** One filing event surfaced by the monitor (10-K/10-Q/8-K/...). */
export const AlertSchema = z.object({
  id: z.string().min(1).max(128),
  ticker: TickerSchema,
  form: z.string().min(1).max(20),
  filedAt: z.string().max(64),
  accession: AccessionSchema,
  title: z.string().max(512).default(""),
  url: HttpsUrlSchema.optional(),
  /** LLM diff summary ("what changed vs the prior filing"), when available. */
  summary: z.string().max(8000).optional(),
  read: z.boolean().default(false),
});

/** workspaces/<slug>/alerts.json — the monitoring inbox. */
export const AlertsSchema = z.object({
  version: z.literal(1).default(1),
  alerts: z.array(AlertSchema).max(500).default([]),
});

export const DigestItemSchema = z.object({
  title: z.string().min(1).max(256),
  body: z.string().max(2000).default(""),
  tickers: z.array(TickerSchema).max(16).default([]),
});

/** workspaces/<slug>/digests/<date>.json — a periodic digest. */
export const DigestSchema = z.object({
  version: z.literal(1).default(1),
  generatedAt: z.string().max(64).optional(),
  periodLabel: z.string().max(64).optional(),
  bullets: z.array(DigestItemSchema).max(10).default([]),
  portfolioNote: z.string().max(2000).optional(),
  generatedBy: z.enum(["llm", "deterministic"]).default("llm"),
});

export const XrayGroupSchema = z.object({
  label: z.string().min(1).max(128),
  pct: pct(),
  tickers: z.array(TickerSchema).max(100).default([]),
});

/**
 * workspaces/<slug>/xray.json — the portfolio X-ray. Group math is
 * deterministic (scripts compute it from portfolio + EDGAR sector data); only
 * `narrative` is LLM prose, and it may not contradict the numbers.
 */
export const XraySchema = z.object({
  version: z.literal(1).default(1),
  generatedAt: z.string().max(64).optional(),
  /** How weights were derived: explicit weightPct, cost basis, or equal-weight fallback. */
  weighting: z.enum(["weights", "costBasis", "equal"]).default("equal"),
  bySector: z.array(XrayGroupSchema).max(64).default([]),
  topHoldings: z
    .array(z.object({ ticker: TickerSchema, pct: pct() }))
    .max(20)
    .default([]),
  concentration: z
    .object({
      top1Pct: pct().default(0),
      top5Pct: pct().default(0),
      sectorMaxPct: pct().default(0),
    })
    .default({}),
  warnings: z.array(z.string().max(500)).max(20).default([]),
  narrative: z.string().max(8000).optional(),
});
