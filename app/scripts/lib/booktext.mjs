// Text extraction + chunking for user-provided playbook sources (the book
// the user drops in). Formats: .txt/.md read directly, .pdf via pdf-parse,
// .epub via adm-zip + the existing HTML-to-text pass. We never bundle or
// redistribute book content — files are read locally from the user's data
// folder and distilled into their private playbook.
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import { htmlToText } from "./filings.mjs";

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf", ".epub"];

/** Extract readable text from a source file. Throws on unsupported/broken input. */
export async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".txt":
    case ".md":
      return fs.readFileSync(filePath, "utf8");
    case ".pdf": {
      const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
      try {
        const result = await parser.getText();
        return result.text ?? "";
      } finally {
        await parser.destroy?.();
      }
    }
    case ".epub":
      return epubToText(fs.readFileSync(filePath));
    default:
      throw new Error(`unsupported source format: ${ext} (use ${SUPPORTED_EXTENSIONS.join("/")})`);
  }
}

/**
 * EPUB = a zip of XHTML chapters. Concatenate the content documents in
 * archive order (close enough to spine order for extraction purposes) and
 * strip markup with the same HTML-to-text pass filings use.
 */
export function epubToText(buffer) {
  const zip = new AdmZip(buffer);
  const parts = [];
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toLowerCase();
    if (entry.isDirectory) continue;
    if (!/\.(xhtml|html|htm)$/.test(name)) continue;
    if (name.includes("toc") || name.includes("nav")) continue;
    parts.push(htmlToText(entry.getData().toString("utf8")));
  }
  return parts.join("\n\n");
}

/**
 * Split text into ~`size`-char chunks on paragraph boundaries (falling back
 * to hard splits for pathological single paragraphs). Chunks carry a
 * 1-based index and approximate location label for citations.
 */
export function chunkText(text, size = 15_000) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const para of paragraphs) {
    if (para.length > size) {
      push();
      for (let i = 0; i < para.length; i += size) chunks.push(para.slice(i, i + size));
      continue;
    }
    if (current.length + para.length + 2 > size) push();
    current += (current ? "\n\n" : "") + para;
  }
  push();
  return chunks.map((textChunk, i) => ({
    index: i + 1,
    location: `part ${i + 1} of ${0}`, // total patched below
    text: textChunk,
  }));
}

/** chunkText with correct "part i of N" labels. */
export function chunkSource(text, size = 15_000) {
  const chunks = chunkText(text, size);
  return chunks.map((c) => ({ ...c, location: `part ${c.index} of ${chunks.length}` }));
}
