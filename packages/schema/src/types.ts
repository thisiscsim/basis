import type { z } from "zod";
import type {
  AlertSchema,
  AlertsSchema,
  BriefSchema,
  BriefSectionSchema,
  ClaimSchema,
  DigestItemSchema,
  DigestSchema,
  HoldingSchema,
  IpsSchema,
  MetaSchema,
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
export type Xray = z.infer<typeof XraySchema>;
