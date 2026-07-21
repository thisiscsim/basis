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
  parseIps,
  parseMeta,
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
