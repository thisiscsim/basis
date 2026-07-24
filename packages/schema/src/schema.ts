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

/** One position the user holds (entered by hand or synced read-only from a broker). */
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
  /** Where this row came from; broker rows are replaced wholesale on sync. */
  source: z.enum(["manual", "broker"]).default("manual"),
  /** Last known per-share price (broker institution price or EOD close). */
  lastPrice: bounded(1e9).optional(),
});

/** portfolio.json — the user's holdings. */
export const PortfolioSchema = z.object({
  version: z.literal(1).default(1),
  currency: z.string().max(8).default("USD"),
  holdings: z.array(HoldingSchema).max(500).default([]),
  updatedAt: z.string().max(64).optional(),
  /** Last successful read-only broker sync. */
  lastSyncedAt: z.string().max(64).optional(),
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
    .array(
      z.object({
        label: z.string().min(1).max(64),
        pct: pct(),
        /** Holdings assigned to this bucket (drives drift detection). */
        tickers: z.array(TickerSchema).max(100).default([]),
      }),
    )
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

/**
 * One inbox event: a filing surfaced by the monitor (10-K/10-Q/8-K/...) or a
 * plan reminder (DCA day, drift band exceeded). Plan alerts have no
 * ticker/accession.
 */
export const AlertSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(["filing", "plan"]).default("filing"),
  ticker: TickerSchema.optional(),
  form: z.string().min(1).max(20),
  filedAt: z.string().max(64),
  accession: AccessionSchema.optional(),
  title: z.string().max(512).default(""),
  url: HttpsUrlSchema.optional(),
  /** LLM diff summary ("what changed vs the prior filing"), when available. */
  summary: z.string().max(8000).optional(),
  /**
   * Second-order inference from the knowledge graph: holdings/watchlist
   * tickers connected to the filer, with the quote-backed path.
   */
  related: z
    .array(z.object({ ticker: TickerSchema, path: z.string().min(1).max(256) }))
    .max(5)
    .default([]),
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
/** Actual vs IPS-target exposure for one allocation bucket. */
export const DriftEntrySchema = z.object({
  label: z.string().min(1).max(64),
  targetPct: pct(),
  actualPct: pct(),
  /** actual - target, in percentage points. */
  driftPct: z.number().finite().min(-100).max(100),
});

export const XraySchema = z.object({
  version: z.literal(1).default(1),
  generatedAt: z.string().max(64).optional(),
  /** How weights were derived: market value, explicit weightPct, cost basis, or equal-weight fallback. */
  weighting: z.enum(["market", "weights", "costBasis", "equal"]).default("equal"),
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
  /** Actual vs IPS-target allocation (only when the IPS assigns tickers to buckets). */
  drift: z.array(DriftEntrySchema).max(32).default([]),
  narrative: z.string().max(8000).optional(),
});

/**
 * ideas.json — the idea log: every surfaced brief, gate decision, or note,
 * graded later against what actually happened (vs SPY). The point is an
 * honest record of whether the system's (and the user's) ideas have any edge.
 */
export const IdeaSchema = z.object({
  id: z.string().min(1).max(128),
  at: z.string().max(64),
  kind: z.enum(["brief", "gate", "note"]),
  ticker: TickerSchema.optional(),
  text: z.string().max(1000).default(""),
  /** Gate ideas: what the user decided. */
  verdict: z.enum(["proceeded", "cancelled"]).optional(),
  /** Close on/just before `at`, filled lazily by grade-ideas.mjs. */
  priceAtLog: bounded(1e9).optional(),
  benchmarkPriceAtLog: bounded(1e9).optional(),
  gradedAt: z.string().max(64).optional(),
  /** Since-log total return, percent. */
  returnPct: z.number().finite().min(-100).max(100_000).optional(),
  benchmarkReturnPct: z.number().finite().min(-100).max(100_000).optional(),
});

export const IdeasSchema = z.object({
  version: z.literal(1).default(1),
  ideas: z.array(IdeaSchema).max(500).default([]),
});

// ---- The Lab (Phase 4): backtests, paper trading, plan reminders ----

export const BacktestPresetSchema = z.enum([
  "buy-and-hold",
  "dca-monthly",
  "ma200-trend",
  "momentum-rotation",
]);

export const BacktestConfigSchema = z.object({
  preset: BacktestPresetSchema,
  tickers: z.array(TickerSchema).min(1).max(10),
  /** ISO dates (YYYY-MM-DD). */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Round-trip friction applied to every traded notional, basis points. */
  costBps: z.number().finite().min(0).max(1000).default(5),
});

export const BacktestMetricsSchema = z.object({
  cagrPct: z.number().finite().min(-100).max(100_000),
  sharpe: z.number().finite().min(-100).max(100),
  maxDrawdownPct: pct(),
  trades: z.number().int().nonnegative().max(1_000_000),
  totalReturnPct: z.number().finite().min(-100).max(1_000_000),
});

/** lab/backtests/<id>.json — one deterministic backtest run + its audit. */
export const BacktestSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().min(1).max(64),
  generatedAt: z.string().max(64).optional(),
  config: BacktestConfigSchema,
  metrics: BacktestMetricsSchema,
  /** Buy-and-hold of the same tickers over the same window. */
  benchmarkMetrics: BacktestMetricsSchema,
  /** Downsampled equity curve (strategy vs benchmark), oldest first. */
  equityCurve: z
    .array(
      z.object({
        date: z.string().max(16),
        value: bounded(1e15),
        benchmarkValue: bounded(1e15),
      }),
    )
    .max(400)
    .default([]),
  /** Deterministic hard warnings (zero costs, short window, in-sample-only...). */
  warnings: z.array(z.string().max(500)).max(20).default([]),
  /** LLM bias-audit notes (lookahead/survivorship/overfitting review). */
  auditNotes: z.array(z.string().max(1000)).max(10).default([]),
});

export const PaperOrderSchema = z.object({
  id: z.string().min(1).max(128),
  at: z.string().max(64),
  ticker: TickerSchema,
  side: z.enum(["buy", "sell"]),
  shares: z.number().finite().positive().max(1e9),
  status: z.enum(["pending", "filled", "cancelled", "rejected"]).default("pending"),
  filledAt: z.string().max(64).optional(),
  fillPrice: bounded(1e9).optional(),
  note: z.string().max(256).optional(),
});

/**
 * paper.json — the paper-trading gauntlet. Orders fill at the NEXT day's
 * close (no same-day fills: that would be lookahead). Equity is marked
 * against buy-and-hold SPY from the account's start.
 */
export const PaperAccountSchema = z.object({
  version: z.literal(1).default(1),
  startedAt: z.string().max(64).optional(),
  startCash: bounded(1e12).default(100_000),
  cash: bounded(1e12).default(100_000),
  positions: z
    .array(z.object({ ticker: TickerSchema, shares: z.number().finite().positive().max(1e9) }))
    .max(100)
    .default([]),
  orders: z.array(PaperOrderSchema).max(500).default([]),
  equity: z
    .array(
      z.object({
        date: z.string().max(16),
        value: bounded(1e15),
        benchmarkValue: bounded(1e15).optional(),
      }),
    )
    .max(400)
    .default([]),
  /** SPY close on the first mark, for the benchmark line. */
  benchmarkStartPrice: bounded(1e9).optional(),
});

// ---- Life plan: finances snapshot, goals, plan + projections ----

/** Where a finances row came from; bank rows are replaced wholesale on sync. */
export const MoneySourceSchema = z.enum(["manual", "bank"]);

export const FixedCostSchema = z.object({
  label: z.string().min(1).max(64),
  amount: bounded(1e9),
  source: MoneySourceSchema.default("manual"),
});

export const FinDebtSchema = z.object({
  label: z.string().min(1).max(64),
  kind: z.enum(["credit-card", "student", "auto", "mortgage", "personal", "other"]).default("other"),
  balance: bounded(1e12),
  /** Annual percentage rate. Payday-loan territory tops the scale on purpose. */
  aprPct: z.number().finite().min(0).max(400).default(0),
  minimumMonthly: bounded(1e9).default(0),
  source: MoneySourceSchema.default("manual"),
  accountId: z.string().max(64).optional(),
});

export const FinAssetSchema = z.object({
  label: z.string().min(1).max(64),
  kind: z.enum(["cash", "property", "retirement", "other"]).default("other"),
  value: bounded(1e12),
  source: MoneySourceSchema.default("manual"),
  accountId: z.string().max(64).optional(),
});

/**
 * finances.json — the declared (and later bank-ingested) financial snapshot,
 * Conscious-Spending-Plan style. Brokerage holdings live in portfolio.json
 * and are valued at market — not duplicated here.
 */
export const FinancesSchema = z.object({
  version: z.literal(1).default(1),
  income: z
    .object({
      netMonthly: bounded(1e9).default(0),
      grossAnnual: bounded(1e10).optional(),
    })
    .default({}),
  fixedMonthly: z.array(FixedCostSchema).max(100).default([]),
  debts: z.array(FinDebtSchema).max(50).default([]),
  assets: z.array(FinAssetSchema).max(100).default([]),
  savingsMonthly: z
    .array(z.object({ label: z.string().min(1).max(64), amount: bounded(1e9) }))
    .max(50)
    .default([]),
  /** Measured average monthly spend from bank transactions (honesty check vs declared). */
  measuredMonthlySpend: bounded(1e9).optional(),
  lastSyncedAt: z.string().max(64).optional(),
  updatedAt: z.string().max(64).optional(),
});

export const GoalSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  /**
   * purchase: save toward targetAmount (optionally by targetDate);
   * recurring: annualCost forever (trips, tuition);
   * lifestyle: a permanent monthlyDelta (nicer apartment).
   */
  kind: z.enum(["purchase", "recurring", "lifestyle"]),
  targetAmount: bounded(1e12).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/)
    .optional(),
  annualCost: bounded(1e10).optional(),
  monthlyDelta: bounded(1e9).optional(),
  /** 1 = highest. Purchase goals are funded in priority order. */
  priority: z.number().int().min(1).max(5).default(3),
  notes: z.string().max(500).optional(),
});

/** goals.json — what the money is actually for. */
export const GoalsSchema = z.object({
  version: z.literal(1).default(1),
  goals: z.array(GoalSchema).max(50).default([]),
});

/**
 * One distilled principle from a user-provided source. Same citation
 * discipline as briefs: `quote` must be a verbatim excerpt of the source
 * text — playbook-llm.mjs verifies it and drops unverified principles.
 */
export const PrincipleSchema = z.object({
  id: z.string().min(1).max(64),
  topic: z
    .enum(["spending", "debt", "saving", "investing", "goals", "income", "psychology", "other"])
    .default("other"),
  /** The distilled, actionable principle in plain words. */
  text: z.string().min(1).max(500),
  /** Exact quote from the source backing this principle. */
  quote: z.string().min(1).max(1500),
  /** Where in the source ("part 3 of 24"). */
  location: z.string().max(128).optional(),
  verified: z.boolean().default(false),
});

/**
 * playbooks/<id>.json — a cited distillation of one user-provided source
 * (book/notes). Sources are read locally and never redistributed.
 */
export const PlaybookSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().min(1).max(64),
  title: z.string().max(256).default(""),
  author: z.string().max(128).optional(),
  sourceFile: z.string().max(256),
  extractedAt: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  /** Extraction resume cursor: big books process across multiple runs. */
  chunksTotal: z.number().int().nonnegative().max(10_000).default(0),
  chunksDone: z.number().int().nonnegative().max(10_000).default(0),
  droppedPrinciples: z.number().int().nonnegative().max(10_000).default(0),
  principles: z.array(PrincipleSchema).max(200).default([]),
});

/** A signed money amount (surplus lines can be negative). */
const signedMoney = () => z.number().finite().min(-1e12).max(1e12);

export const ScenarioSchema = z.object({
  name: z.string().min(1).max(32),
  /** Nominal annual return assumption, percent. */
  annualReturnPct: z.number().finite().min(-50).max(100),
});

export const PlanStepSchema = z.object({
  title: z.string().min(1).max(128),
  body: z.string().max(2000).default(""),
  /** Every step must ground itself in playbook principles (validated by id). */
  citations: z
    .array(z.object({ playbookId: z.string().min(1).max(64), principleId: z.string().min(1).max(64) }))
    .max(5)
    .default([]),
});

/**
 * lifeplan.json — the life plan. The deterministic core (surplus, debt
 * schedule, goal feasibility, net-worth projections) is ground truth computed
 * by lifeplan.mjs; `steps`/`narrative` are LLM-drafted and may not contradict
 * it. Projections are assumption math, not predictions.
 */
export const LifePlanSchema = z.object({
  version: z.literal(1).default(1),
  generatedAt: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  assumptions: z
    .object({
      scenarios: z.array(ScenarioSchema).max(5).default([]),
      inflationPct: z.number().finite().min(0).max(50).default(3),
    })
    .default({}),
  surplus: z
    .object({
      netMonthlyIncome: signedMoney().default(0),
      fixedMonthly: signedMoney().default(0),
      debtMinimums: signedMoney().default(0),
      savingsMonthly: signedMoney().default(0),
      goalReserveMonthly: signedMoney().default(0),
      /** What's actually left each month after all of the above. */
      monthly: signedMoney().default(0),
    })
    .default({}),
  debtSchedule: z
    .array(
      z.object({
        label: z.string().min(1).max(64),
        monthsToPayoff: z.number().int().min(0).max(1200).optional(),
        payoffDate: z.string().max(16).optional(),
        interestPaid: bounded(1e12).default(0),
        /** True when payments don't even cover interest. */
        neverPaysOff: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
  debtTotals: z
    .object({
      interestPaid: bounded(1e12).default(0),
      debtFreeDate: z.string().max(16).optional(),
    })
    .default({}),
  goalFunding: z
    .array(
      z.object({
        goalId: z.string().min(1).max(64),
        label: z.string().min(1).max(128),
        scenario: z.string().min(1).max(32),
        feasible: z.boolean(),
        fundedBy: z.string().max(16).optional(),
        shortfall: bounded(1e12).optional(),
      }),
    )
    .max(150)
    .default([]),
  netWorth: z
    .array(
      z.object({
        year: z.number().int().min(2000).max(2200),
        byScenario: z
          .array(
            z.object({ name: z.string().min(1).max(32), value: z.number().finite().min(-1e15).max(1e15) }),
          )
          .max(5),
      }),
    )
    .max(60)
    .default([]),
  steps: z.array(PlanStepSchema).max(12).default([]),
  narrative: z.string().max(8000).optional(),
  warnings: z.array(z.string().max(500)).max(20).default([]),
  playbooksUsed: z.array(z.string().max(64)).max(10).default([]),
});

// ---- Knowledge graph (Phase 5) ----

export const GraphRelSchema = z.enum([
  "supplier",
  "customer",
  "partner",
  "competitor",
  "investor",
  "subsidiary",
  "other",
]);

/**
 * One extracted relationship. Same citation discipline as briefs: `quote`
 * must be a verbatim excerpt of the cited filing — graph-llm.mjs verifies it
 * and drops unverified edges before anything reaches disk.
 */
export const GraphEdgeSchema = z.object({
  id: z.string().min(1).max(160),
  /** The filer whose filing asserted this relationship. */
  from: TickerSchema,
  /** Counterparty company name as written in the filing (may be private). */
  to: z.string().min(1).max(256),
  /** Counterparty's ticker when the filing/model could identify it. */
  toTicker: TickerSchema.optional(),
  rel: GraphRelSchema,
  quote: z.string().min(1).max(1500),
  source: z.string().min(1).max(256),
  sourceUrl: HttpsUrlSchema,
  accession: AccessionSchema.optional(),
  verified: z.boolean().default(false),
  extractedAt: z.string().max(64).optional(),
});

/** graph.json — the relationship knowledge graph across watched companies. */
export const GraphSchema = z.object({
  version: z.literal(1).default(1),
  edges: z.array(GraphEdgeSchema).max(1000).default([]),
});

/** plan.json — the no-execution "boring bots": reminders only. */
export const PlanSchema = z.object({
  version: z.literal(1).default(1),
  /** Monthly DCA reminder. */
  dca: z
    .object({
      amount: bounded(1e9),
      dayOfMonth: z.number().int().min(1).max(28),
    })
    .optional(),
  /** Alert when any IPS bucket drifts beyond this band (percentage points). */
  rebalanceBandPct: z.number().finite().min(0).max(50).default(5),
  /** Reminder cursors so the monitor alerts once, not every run. */
  lastDcaAlertMonth: z.string().max(7).optional(),
  lastDriftAlertAt: z.string().max(64).optional(),
});
