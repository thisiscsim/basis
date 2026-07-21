// Shared CLI helpers for the engine scripts. Centralized so the arg parsing /
// tolerant file readers don't drift between scripts.
import fs from "node:fs";

/** Read a `--name value` flag from argv. */
export function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Round to 2 decimals (display/percent precision). */
export const round = (n) => Math.round(n * 100) / 100;

/** Read a file, returning "" if it doesn't exist. */
export function readMaybe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Read + JSON.parse a file, returning null on any failure. */
export function readJsonMaybe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Escape a value for a single TSV cell: tabs/newlines would otherwise shift
 * columns in a .tsv log parsed by splitting on \t.
 */
export function tsvCell(value) {
  return String(value).replace(/\s+/g, " ").trim();
}
