import { describe, expect, it } from "vitest";
import { edgeId, mergeEdges, normalizeCompany, relatedTickers } from "./graph.mjs";

const edge = (from, to, rel, toTicker) => ({
  id: "",
  from,
  to,
  rel,
  toTicker,
  quote: "q",
  source: "10-K",
  sourceUrl: "https://www.sec.gov/x",
  verified: true,
});

describe("normalizeCompany", () => {
  it("strips punctuation and corporate suffixes", () => {
    expect(normalizeCompany("Apple Inc.")).toBe("apple");
    expect(normalizeCompany("APPLE, INC")).toBe("apple");
    expect(normalizeCompany("Butterfly Network Holdings Corp.")).toBe("butterfly network");
    expect(normalizeCompany("Taiwan Semiconductor Manufacturing Company Ltd.")).toBe(
      "taiwan semiconductor manufacturing",
    );
  });
});

describe("mergeEdges", () => {
  it("dedupes by filer+rel+normalized counterparty; existing edges win", () => {
    const existing = [
      {
        ...edge("AAPL", "Corning Inc.", "supplier"),
        id: edgeId(edge("AAPL", "Corning Inc.", "supplier")),
        quote: "original",
      },
    ];
    const { edges, added } = mergeEdges(existing, [
      edge("AAPL", "CORNING, INC", "supplier"), // same edge, different casing
      edge("AAPL", "Corning Inc.", "partner"), // different rel -> new edge
    ]);
    expect(added).toBe(1);
    expect(edges).toHaveLength(2);
    expect(edges[0].quote).toBe("original");
  });
});

describe("relatedTickers", () => {
  const edges = [
    { ...edge("MJRN", "Butterfly Network Inc.", "supplier", "BFLY"), id: "1" },
    { ...edge("AAPL", "Taiwan Semiconductor Manufacturing Company", "supplier"), id: "2" },
    { ...edge("NVDA", "Taiwan Semiconductor Manufacturing Co.", "supplier"), id: "3" },
    { ...edge("BFLY", "SomeCo", "customer"), id: "4" },
  ];

  it("finds 1-hop connections in either direction", () => {
    const related = relatedTickers(edges, "MJRN", new Set(["BFLY", "VTI"]));
    expect(related).toEqual([{ ticker: "BFLY", path: "MJRN lists Butterfly Network Inc. as a supplier" }]);
  });

  it("finds 2-hop connections through a shared (private) counterparty", () => {
    const related = relatedTickers(edges, "AAPL", new Set(["NVDA"]));
    expect(related).toHaveLength(1);
    expect(related[0].ticker).toBe("NVDA");
    expect(related[0].path).toContain("both AAPL and NVDA relate to");
  });

  it("excludes the filer itself and caps results", () => {
    expect(relatedTickers(edges, "AAPL", new Set(["AAPL"]))).toEqual([]);
  });
});
