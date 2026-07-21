import { describe, expect, it } from "vitest";
import { extractItem, htmlToText, normalizeForMatch, verifyQuote } from "./filings.mjs";

describe("htmlToText", () => {
  it("strips tags/scripts and decodes entities", () => {
    const html = `<html><script>evil()</script><p>Total net sales &amp; revenue grew.</p><div>Item 1A.&nbsp;Risk Factors</div></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain("evil");
    expect(text).toContain("Total net sales & revenue grew.");
    expect(text).toContain("Item 1A. Risk Factors");
  });
});

describe("extractItem", () => {
  const doc = [
    "TABLE OF CONTENTS",
    "Item 1. Business 3",
    "Item 1A. Risk Factors 12",
    "Item 2. Properties 40",
    "",
    "Item 1. Business",
    "We design and sell widgets worldwide.",
    "",
    "Item 1A. Risk Factors",
    "Our business depends on a single supplier of flux capacitors.",
    "Competition may reduce margins.",
    "",
    "Item 2. Properties",
    "We lease offices.",
  ].join("\n");

  it("picks the real section, not the TOC entry", () => {
    const risks = extractItem(doc, "1A");
    expect(risks).toContain("single supplier of flux capacitors");
    expect(risks).not.toContain("We lease offices");
  });

  it("returns empty for a missing item", () => {
    expect(extractItem(doc, "7")).toBe("");
  });
});

describe("verifyQuote", () => {
  const source = "Total net sales increased 12% compared to 2024, driven by \u201cServices\u201d growth.";
  it("accepts exact and typographically-drifted quotes", () => {
    expect(verifyQuote("Total net sales increased 12% compared to 2024", source)).toBe(true);
    expect(verifyQuote('driven by "Services" growth', source)).toBe(true);
  });
  it("rejects fabricated or too-short quotes", () => {
    expect(verifyQuote("Total net sales decreased 12%", source)).toBe(false);
    expect(verifyQuote("sales", source)).toBe(false);
  });
});

describe("normalizeForMatch", () => {
  it("collapses whitespace and smart punctuation", () => {
    expect(normalizeForMatch("A\u2019s  \u201cB\u201d \u2014 C")).toBe(`a's "b" - c`);
  });
});
