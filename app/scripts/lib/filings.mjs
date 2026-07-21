// Pure helpers for working with EDGAR filing documents: HTML -> text,
// section (Item) extraction, and citation verification. No network, no fs —
// unit-tested in filings.test.mjs.

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&#160;": " ",
  "&#8217;": "'",
  "&#8216;": "'",
  "&#8220;": '"',
  "&#8221;": '"',
  "&#8211;": "-",
  "&#8212;": "-",
  "&#8230;": "...",
};

/** Convert filing HTML to readable plain text (block tags become newlines). */
export function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch);
  s = s.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n);
    return code > 31 && code < 65536 ? String.fromCharCode(code) : " ";
  });
  s = s.replace(/&[a-zA-Z]+;/g, " ");
  // Collapse intra-line whitespace, then runs of blank lines.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * Extract the text of one Item section (e.g. "1A" -> Risk Factors) from a
 * plain-text 10-K/10-Q. Headings also appear in the table of contents, so of
 * all "Item <n>" occurrences we keep the one with the largest span to the
 * next item marker — TOC entries sit tightly together, the real section
 * doesn't.
 */
export function extractItem(text, item, { maxChars = 60_000 } = {}) {
  const escaped = String(item).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`(^|\\n)\\s{0,8}item\\s+${escaped}\\b[.:\\s]`, "gi");
  const nextRe = /(^|\n)\s{0,8}item\s+\d{1,2}[A-Z]?\b[.:\s]/gi;

  const starts = [];
  for (let m = startRe.exec(text); m; m = startRe.exec(text)) starts.push(m.index);
  if (starts.length === 0) return "";

  const boundaries = [];
  for (let m = nextRe.exec(text); m; m = nextRe.exec(text)) boundaries.push(m.index);

  let best = { start: -1, end: -1, span: -1 };
  for (const s of starts) {
    // The first boundary strictly after this heading (skip the heading itself).
    const end = boundaries.find((b) => b > s + 4) ?? text.length;
    const span = end - s;
    if (span > best.span) best = { start: s, end, span };
  }
  if (best.start < 0) return "";
  return text.slice(best.start, best.end).trim().slice(0, maxChars);
}

/** Normalize text for tolerant substring matching (citation verification). */
export function normalizeForMatch(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9%$.,'"()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `quote` appears (whitespace/quote-mark tolerant) inside
 * `sourceText`. This is the citation check: a claim whose quote is not an
 * exact excerpt of the source is dropped.
 */
export function verifyQuote(quote, sourceText) {
  const q = normalizeForMatch(quote);
  if (q.length < 12) return false; // too short to be meaningful evidence
  return normalizeForMatch(sourceText).includes(q);
}

/** Truncate on a word boundary with an ellipsis marker. */
export function truncate(text, max) {
  const s = String(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.8 ? lastSpace : max)}\n[...truncated...]`;
}
