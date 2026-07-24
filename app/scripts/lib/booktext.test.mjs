import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { chunkSource, epubToText } from "./booktext.mjs";

describe("chunkSource", () => {
  it("splits on paragraph boundaries with correct part labels", () => {
    const text = ["A".repeat(60), "B".repeat(60), "C".repeat(60)].join("\n\n");
    const chunks = chunkSource(text, 130);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("A");
    expect(chunks[0].text).toContain("B");
    expect(chunks[1].text).toContain("C");
    expect(chunks[0].location).toBe("part 1 of 2");
    expect(chunks[1].location).toBe("part 2 of 2");
  });

  it("hard-splits pathological single paragraphs", () => {
    const chunks = chunkSource("X".repeat(1000), 300);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.every((c) => c.text.length <= 300)).toBe(true);
  });

  it("empty input yields no chunks", () => {
    expect(chunkSource("  \n\n  ")).toEqual([]);
  });
});

describe("epubToText", () => {
  it("extracts chapter text from a synthetic epub, skipping nav/toc", () => {
    const zip = new AdmZip();
    zip.addFile("mimetype", Buffer.from("application/epub+zip"));
    zip.addFile(
      "OEBPS/ch1.xhtml",
      Buffer.from("<html><body><h1>Chapter 1</h1><p>Automate your money flows.</p></body></html>"),
    );
    zip.addFile(
      "OEBPS/ch2.xhtml",
      Buffer.from("<html><body><p>Attack the highest interest rate first.</p></body></html>"),
    );
    zip.addFile("OEBPS/toc.xhtml", Buffer.from("<html><body><p>Contents</p></body></html>"));
    zip.addFile("OEBPS/style.css", Buffer.from("p { color: red }"));
    const text = epubToText(zip.toBuffer());
    expect(text).toContain("Automate your money flows.");
    expect(text).toContain("Attack the highest interest rate first.");
    expect(text).not.toContain("Contents");
    expect(text).not.toContain("color: red");
  });
});
