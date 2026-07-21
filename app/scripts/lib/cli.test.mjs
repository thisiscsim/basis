import { describe, expect, it } from "vitest";
import { round, tsvCell } from "./cli.mjs";

describe("tsvCell", () => {
  it("collapses tabs/newlines so a value can't shift TSV columns", () => {
    expect(tsvCell("added\tmusic\nbed")).toBe("added music bed");
    expect(tsvCell("  spaced   out  ")).toBe("spaced out");
  });
});

describe("round", () => {
  it("rounds to 2 decimals", () => {
    expect(round(1.239)).toBe(1.24);
    expect(round(3)).toBe(3);
  });
});
