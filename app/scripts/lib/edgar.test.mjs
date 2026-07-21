import { afterEach, describe, expect, it } from "vitest";
import { edgarUserAgent, filingDocUrl, padCik, recentFilings } from "./edgar.mjs";

describe("padCik", () => {
  it("zero-pads to the 10 digits data.sec.gov expects", () => {
    expect(padCik("320193")).toBe("0000320193");
    expect(padCik(320193)).toBe("0000320193");
    expect(padCik("0000320193")).toBe("0000320193");
  });
  it("strips non-digits from hostile input", () => {
    expect(padCik("320193; rm -rf /")).toBe("0000320193");
  });
});

describe("filingDocUrl", () => {
  it("builds the Archives URL with a bare accession and unpadded CIK", () => {
    expect(filingDocUrl("320193", "0000320193-25-000079", "aapl-20250927.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    );
  });
});

describe("recentFilings", () => {
  const submissions = {
    filings: {
      recent: {
        accessionNumber: ["0000320193-26-000013", "0000320193-26-000011", "0000320193-25-000079"],
        form: ["10-Q", "8-K", "10-K"],
        filingDate: ["2026-05-01", "2026-04-30", "2025-10-31"],
        primaryDocument: ["aapl-q2.htm", "aapl-8k.htm", "aapl-10k.htm"],
        primaryDocDescription: ["10-Q", "8-K", "10-K"],
      },
    },
  };

  it("flattens the columnar structure preserving order (newest first)", () => {
    const rows = recentFilings(submissions);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      accession: "0000320193-26-000013",
      form: "10-Q",
      filedAt: "2026-05-01",
      primaryDoc: "aapl-q2.htm",
    });
  });

  it("filters by exact form type and honors the limit", () => {
    expect(recentFilings(submissions, { forms: ["10-K"] })).toHaveLength(1);
    expect(recentFilings(submissions, { limit: 2 })).toHaveLength(2);
    // "10-K" must not match "10-K/A"-style prefixes in reverse: exact matching only.
    expect(recentFilings(submissions, { forms: ["10"] })).toHaveLength(0);
  });

  it("tolerates a malformed submissions payload", () => {
    expect(recentFilings(null)).toEqual([]);
    expect(recentFilings({ filings: {} })).toEqual([]);
  });
});

describe("edgarUserAgent", () => {
  const saved = { ua: process.env.BASIS_EDGAR_UA, contact: process.env.BASIS_EDGAR_CONTACT };
  afterEach(() => {
    if (saved.ua === undefined) delete process.env.BASIS_EDGAR_UA;
    else process.env.BASIS_EDGAR_UA = saved.ua;
    if (saved.contact === undefined) delete process.env.BASIS_EDGAR_CONTACT;
    else process.env.BASIS_EDGAR_CONTACT = saved.contact;
  });

  it("interpolates the contact email per SEC fair-access rules", () => {
    delete process.env.BASIS_EDGAR_UA;
    process.env.BASIS_EDGAR_CONTACT = "me@example.com";
    expect(edgarUserAgent()).toContain("me@example.com");
  });

  it("a full UA override wins", () => {
    process.env.BASIS_EDGAR_UA = "MyResearch me@example.com";
    expect(edgarUserAgent()).toBe("MyResearch me@example.com");
  });
});
