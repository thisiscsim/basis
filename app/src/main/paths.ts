import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, sep } from "node:path";

/**
 * Pure path / id helpers for the main process. Extracted from index.ts so the
 * security-sensitive containment logic (`safePath`, `assertSlug`) is
 * unit-testable without booting Electron. No electron imports live here.
 */

/** Resolve + guard a path so it can never escape the given root. */
export function safePath(root: string, rel: string[]): string {
  const base = normalize(root);
  const file = normalize(join(base, ...rel));
  // Compare against root + separator so a sibling like "<root>-evil" can't pass.
  if (file !== base && !file.startsWith(base + sep)) throw new Error("path escapes storage dir");
  return file;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
/** Throw on a malformed renderer-supplied slug (handlers convert to {ok,error}). */
export function assertSlug(slug: string): void {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) throw new Error("invalid workspace id");
}

/** True only for real web links we're willing to hand to the OS handler. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace"
  );
}

/**
 * Write-then-rename so concurrent readers (the file watcher's reload path,
 * engine scripts, a second window) can never observe a truncated file. The
 * temp file lives in the same directory so the rename stays on one volume
 * (atomic on POSIX).
 */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  const tmp = join(
    dirname(file),
    `.${basename(file)}.${process.pid.toString(36)}${Date.now().toString(36)}.tmp`,
  );
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup; the original error is the one that matters
    }
    throw err;
  }
}
