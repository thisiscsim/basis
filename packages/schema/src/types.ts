import type { z } from "zod";
import type {
  AlertSchema,
  AlertsSchema,
  BacktestConfigSchema,
  BacktestMetricsSchema,
  BacktestPresetSchema,
  BacktestSchema,
  BriefSchema,
  BriefSectionSchema,
  ClaimSchema,
  DigestItemSchema,
  DigestSchema,
  DriftEntrySchema,
  FinancesSchema,
  FinAssetSchema,
  FinDebtSchema,
  FixedCostSchema,
  GoalSchema,
  GoalsSchema,
  GraphEdgeSchema,
  GraphRelSchema,
  GraphSchema,
  HoldingSchema,
  IdeaSchema,
  IdeasSchema,
  IpsSchema,
  LifePlanSchema,
  MetaSchema,
  PaperAccountSchema,
  PaperOrderSchema,
  PlanSchema,
  PlanStepSchema,
  PlaybookSchema,
  PrincipleSchema,
  ScenarioSchema,
  PortfolioSchema,
  WatchlistEntrySchema,
  WatchlistSchema,
  XrayGroupSchema,
  XraySchema,
} from "./schema.js";

export type Meta = z.infer<typeof MetaSchema>;

export type Holding = z.infer<typeof HoldingSchema>;
export type Portfolio = z.infer<typeof PortfolioSchema>;

export type Ips = z.infer<typeof IpsSchema>;

export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>;
export type Watchlist = z.infer<typeof WatchlistSchema>;

export type Claim = z.infer<typeof ClaimSchema>;
export type BriefSection = z.infer<typeof BriefSectionSchema>;
export type Brief = z.infer<typeof BriefSchema>;

export type Alert = z.infer<typeof AlertSchema>;
export type Alerts = z.infer<typeof AlertsSchema>;

export type DigestItem = z.infer<typeof DigestItemSchema>;
export type Digest = z.infer<typeof DigestSchema>;

export type XrayGroup = z.infer<typeof XrayGroupSchema>;
export type DriftEntry = z.infer<typeof DriftEntrySchema>;
export type Xray = z.infer<typeof XraySchema>;

export type Idea = z.infer<typeof IdeaSchema>;
export type Ideas = z.infer<typeof IdeasSchema>;

export type BacktestPreset = z.infer<typeof BacktestPresetSchema>;
export type BacktestConfig = z.infer<typeof BacktestConfigSchema>;
export type BacktestMetrics = z.infer<typeof BacktestMetricsSchema>;
export type Backtest = z.infer<typeof BacktestSchema>;

export type PaperOrder = z.infer<typeof PaperOrderSchema>;
export type PaperAccount = z.infer<typeof PaperAccountSchema>;

export type Plan = z.infer<typeof PlanSchema>;

export type FixedCost = z.infer<typeof FixedCostSchema>;
export type FinDebt = z.infer<typeof FinDebtSchema>;
export type FinAsset = z.infer<typeof FinAssetSchema>;
export type Finances = z.infer<typeof FinancesSchema>;

export type Goal = z.infer<typeof GoalSchema>;
export type Goals = z.infer<typeof GoalsSchema>;

export type Principle = z.infer<typeof PrincipleSchema>;
export type Playbook = z.infer<typeof PlaybookSchema>;

export type Scenario = z.infer<typeof ScenarioSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type LifePlan = z.infer<typeof LifePlanSchema>;

export type GraphRel = z.infer<typeof GraphRelSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
