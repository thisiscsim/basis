import { describe, expect, it } from "vitest";
import {
  AccessionSchema,
  BriefSchema,
  extractJson,
  HttpsUrlSchema,
  isLlmConfigured,
  llmConfig,
  parseAlerts,
  parseBrief,
  parseDigest,
  parseBacktest,
  parseFinances,
  parseGoals,
  parseGraph,
  parseIdeas,
  parseLifePlan,
  parseIps,
  parseMeta,
  parsePaper,
  parsePlan,
  parsePortfolio,
  parseWatchlist,
  parseXray,
  reasoningEffort,
  TickerSchema,
} from "./index.js";

const validClaim = {
  text: "Revenue grew 12% year over year.",
  quote: "Total net sales increased 12% compared to 2024.",
  source: "10-K FY2025, Item 7",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
};

describe("primitives", () => {
  it("accepts real tickers and rejects junk", () => {
    expect(TickerSchema.safeParse("AAPL").success).toBe(true);
    expect(TickerSchema.safeParse("BRK.B").success).toBe(true);
    expect(TickerSchema.safeParse("aapl").success).toBe(false);
    expect(TickerSchema.safeParse("").success).toBe(false);
    expect(TickerSchema.safeParse("../ETC").success).toBe(false);
    expect(TickerSchema.safeParse("A".repeat(20)).success).toBe(false);
  });

  it("https-only URLs (links reach shell.openExternal)", () => {
    expect(HttpsUrlSchema.safeParse("https://www.sec.gov/x").success).toBe(true);
    expect(HttpsUrlSchema.safeParse("http://www.sec.gov/x").success).toBe(false);
    expect(HttpsUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
    expect(HttpsUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(HttpsUrlSchema.safeParse("not a url").success).toBe(false);
  });

  it("accession numbers", () => {
    expect(AccessionSchema.safeParse("0000320193-25-000079").success).toBe(true);
    expect(AccessionSchema.safeParse("00003201932500 evil").success).toBe(false);
  });
});

describe("defaults-filling parsers tolerate empty/partial input", () => {
  it("parseMeta / parsePortfolio / parseIps / parseWatchlist / parseAlerts / parseXray on {}", () => {
    expect(parseMeta({}).title).toBe("Untitled");
    expect(parsePortfolio({}).holdings).toEqual([]);
    expect(parseIps({}).rules).toEqual([]);
    expect(parseWatchlist({}).entries).toEqual([]);
    expect(parseAlerts({}).alerts).toEqual([]);
    expect(parseXray({}).concentration.top1Pct).toBe(0);
  });

  it("parsePortfolio drops nothing valid and rejects hostile numerics", () => {
    const p = parsePortfolio({ holdings: [{ ticker: "MSFT", shares: 10.5, weightPct: 40 }] });
    expect(p.holdings[0].ticker).toBe("MSFT");
    // JSON 1e400 parses to Infinity — must not pass .finite()
    expect(() => parsePortfolio({ holdings: [{ ticker: "MSFT", shares: Infinity }] })).toThrow();
    expect(() => parsePortfolio({ holdings: [{ ticker: "MSFT", weightPct: 101 }] })).toThrow();
    expect(() => parsePortfolio({ holdings: [{ ticker: "MSFT", shares: -1 }] })).toThrow();
  });

  it("parseIps caps rule count and length", () => {
    expect(() => parseIps({ rules: Array(51).fill("r") })).toThrow();
    expect(() => parseIps({ rules: ["x".repeat(501)] })).toThrow();
  });

  it("holdings default source=manual; broker fields are bounded", () => {
    const p = parsePortfolio({ holdings: [{ ticker: "AAPL" }] });
    expect(p.holdings[0].source).toBe("manual");
    expect(() => parsePortfolio({ holdings: [{ ticker: "AAPL", lastPrice: Infinity }] })).toThrow();
  });

  it("IPS allocation buckets carry validated tickers", () => {
    const ips = parseIps({ targetAllocation: [{ label: "Equities", pct: 70, tickers: ["VTI"] }] });
    expect(ips.targetAllocation[0].tickers).toEqual(["VTI"]);
    expect(() => parseIps({ targetAllocation: [{ label: "E", pct: 70, tickers: ["../etc"] }] })).toThrow();
  });

  it("xray drift entries are bounded to ±100 points", () => {
    const x = parseXray({ drift: [{ label: "Bonds", targetPct: 30, actualPct: 15, driftPct: -15 }] });
    expect(x.drift[0].driftPct).toBe(-15);
    expect(() =>
      parseXray({ drift: [{ label: "B", targetPct: 0, actualPct: 0, driftPct: Infinity }] }),
    ).toThrow();
  });

  it("lab schemas: bounded numerics and hostile input rejected", () => {
    expect(() =>
      parseBacktest({
        id: "x",
        config: { preset: "buy-and-hold", tickers: ["SPY"], from: "2015-01-01" },
        metrics: { cagrPct: Infinity, sharpe: 0, maxDrawdownPct: 0, trades: 0, totalReturnPct: 0 },
        benchmarkMetrics: { cagrPct: 0, sharpe: 0, maxDrawdownPct: 0, trades: 0, totalReturnPct: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseBacktest({
        id: "x",
        config: { preset: "not-a-preset", tickers: ["SPY"], from: "2015-01-01" },
        metrics: { cagrPct: 0, sharpe: 0, maxDrawdownPct: 0, trades: 0, totalReturnPct: 0 },
        benchmarkMetrics: { cagrPct: 0, sharpe: 0, maxDrawdownPct: 0, trades: 0, totalReturnPct: 0 },
      }),
    ).toThrow();
    expect(parsePaper({}).startCash).toBe(100_000);
    expect(() =>
      parsePaper({ orders: [{ id: "o", at: "x", ticker: "../E", side: "buy", shares: 1 }] }),
    ).toThrow();
    expect(parsePlan({}).rebalanceBandPct).toBe(5);
    expect(() => parsePlan({ dca: { amount: 100, dayOfMonth: 31 } })).toThrow();
  });

  it("finances snapshot: defaults, source tagging, hostile numerics rejected", () => {
    const f = parseFinances({
      income: { netMonthly: 8000 },
      debts: [{ label: "Visa", kind: "credit-card", balance: 4200, aprPct: 24.99, minimumMonthly: 120 }],
    });
    expect(f.debts[0].source).toBe("manual");
    expect(f.income.netMonthly).toBe(8000);
    expect(() => parseFinances({ income: { netMonthly: Infinity } })).toThrow();
    expect(() => parseFinances({ debts: [{ label: "x", balance: -5 }] })).toThrow();
    expect(() => parseFinances({ debts: [{ label: "x", balance: 1, aprPct: 500 }] })).toThrow();
  });

  it("goals: kinds, priority bounds, date format", () => {
    const g = parseGoals({
      goals: [
        {
          id: "house",
          label: "House down payment",
          kind: "purchase",
          targetAmount: 120_000,
          targetDate: "2030-06",
        },
        { id: "trips", label: "3 business-class trips/yr", kind: "recurring", annualCost: 24_000 },
      ],
    });
    expect(g.goals[0].priority).toBe(3);
    expect(() => parseGoals({ goals: [{ id: "x", label: "x", kind: "purchase", priority: 6 }] })).toThrow();
    expect(() =>
      parseGoals({ goals: [{ id: "x", label: "x", kind: "purchase", targetDate: "June 2030" }] }),
    ).toThrow();
  });

  it("life plan: surplus lines can be negative, projections bounded, steps cite by id", () => {
    const p = parseLifePlan({
      surplus: { monthly: -350 },
      netWorth: [{ year: 2030, byScenario: [{ name: "expected", value: 250_000 }] }],
      steps: [{ title: "Automate", citations: [{ playbookId: "iwt", principleId: "p1" }] }],
    });
    expect(p.surplus.monthly).toBe(-350);
    expect(p.assumptions.inflationPct).toBe(3);
    expect(() =>
      parseLifePlan({ netWorth: [{ year: 2030, byScenario: [{ name: "e", value: Infinity }] }] }),
    ).toThrow();
    expect(() => parseLifePlan({ netWorth: [{ year: 1800, byScenario: [] }] })).toThrow();
    expect(() => parseLifePlan({ steps: Array(13).fill({ title: "t" }) })).toThrow();
  });

  it("graph edges require verified-style citations and https URLs", () => {
    const edge = {
      id: "AAPL|supplier|corning",
      from: "AAPL",
      to: "Corning Inc.",
      rel: "supplier",
      quote: "Corning supplies glass for our devices.",
      source: "10-K filed 2025-10-31",
      sourceUrl: "https://www.sec.gov/Archives/x.htm",
    };
    const g = parseGraph({ edges: [edge] });
    expect(g.edges[0].verified).toBe(false); // defaults false until the script verifies
    expect(() => parseGraph({ edges: [{ ...edge, sourceUrl: "http://insecure" }] })).toThrow();
    expect(() => parseGraph({ edges: [{ ...edge, rel: "owns-the-moon" }] })).toThrow();
    expect(() => parseGraph({ edges: [{ ...edge, from: "../etc" }] })).toThrow();
  });

  it("alert related entries are validated and capped", () => {
    const a = parseAlerts({
      alerts: [
        {
          id: "x",
          ticker: "MJRN",
          form: "8-K",
          filedAt: "2026-07-20",
          accession: "0000000000-26-000001",
          related: [{ ticker: "BFLY", path: "MJRN lists Butterfly Network as a supplier" }],
        },
      ],
    });
    expect(a.alerts[0].related[0].ticker).toBe("BFLY");
    expect(() =>
      parseAlerts({
        alerts: [
          {
            id: "x",
            ticker: "MJRN",
            form: "8-K",
            filedAt: "2026-07-20",
            related: [{ ticker: "../E", path: "p" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("plan alerts parse without ticker/accession; filings still validate", () => {
    const a = parseAlerts({
      alerts: [{ id: "plan-dca-2026-07", kind: "plan", form: "PLAN", filedAt: "2026-07-20" }],
    });
    expect(a.alerts[0].kind).toBe("plan");
    expect(a.alerts[0].ticker).toBeUndefined();
  });

  it("ideas are capped and returns must be finite", () => {
    const ideas = parseIdeas({ ideas: [{ id: "a", at: "2026-07-20", kind: "gate", verdict: "cancelled" }] });
    expect(ideas.ideas[0].kind).toBe("gate");
    expect(() => parseIdeas({ ideas: [{ id: "a", at: "x", kind: "brief", returnPct: Infinity }] })).toThrow();
    expect(() => parseIdeas({ ideas: Array(501).fill({ id: "a", at: "x", kind: "note" }) })).toThrow();
  });
});

describe("LLM-authored documents (brief, digest)", () => {
  it("valid brief parses with verified defaulting to false", () => {
    const res = parseBrief({
      ticker: "AAPL",
      sections: [{ key: "risks", label: "Risks", claims: [validClaim] }],
    });
    expect(res.ok).toBe(true);
    expect(res.brief?.sections[0].claims[0].verified).toBe(false);
  });

  it("invalid brief returns path-prefixed errors for the repair retry", () => {
    const res = parseBrief({ ticker: "nope", sections: "x" });
    expect(res.ok).toBe(false);
    expect(res.errors?.some((e) => e.startsWith("ticker"))).toBe(true);
  });

  it("brief rejects non-https citation URLs", () => {
    const res = parseBrief({
      ticker: "AAPL",
      sections: [
        {
          key: "risks",
          label: "Risks",
          claims: [{ ...validClaim, sourceUrl: "file:///etc/passwd" }],
        },
      ],
    });
    expect(res.ok).toBe(false);
  });

  it("digest bullet caps hold", () => {
    const ok = parseDigest({ bullets: [{ title: "Week in review" }] });
    expect(ok.ok).toBe(true);
    const tooMany = parseDigest({ bullets: Array(11).fill({ title: "x" }) });
    expect(tooMany.ok).toBe(false);
  });

  it("oversize strings are rejected, not truncated", () => {
    expect(BriefSchema.safeParse({ ticker: "AAPL", summary: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("extractJson", () => {
  it("parses fenced and prose-wrapped JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("llm-config", () => {
  it("resolves provider-matched keys only (no cross-provider leak)", () => {
    const cfg = llmConfig({ BASIS_LLM_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-openai" });
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.apiKey).toBeUndefined();
    const cfg2 = llmConfig({ BASIS_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant" });
    expect(cfg2.apiKey).toBe("sk-ant");
  });

  it("openai-compatible counts a bare baseURL as configured", () => {
    expect(
      isLlmConfigured({
        BASIS_LLM_PROVIDER: "openai-compatible",
        BASIS_LLM_BASE_URL: "http://localhost:11434/v1",
      }),
    ).toBe(true);
    expect(isLlmConfigured({})).toBe(false);
  });

  it("reasoning effort falls back to low", () => {
    expect(reasoningEffort({ BASIS_REASONING_EFFORT: "extreme" })).toBe("low");
    expect(reasoningEffort({ BASIS_REASONING_EFFORT: "high" })).toBe("high");
  });
});
