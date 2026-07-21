// The single Basis data folder (single-player: one portfolio/IPS/watchlist).
// The app exports BASIS_DATA_DIR before spawning scripts; standalone runs
// fall back to <repo>/data in dev.
import fs from "node:fs";
import path from "node:path";

/** Absolute data root, honoring BASIS_DATA_DIR (dev fallback: <repo>/data). */
export function dataDir(repoRoot) {
  return path.resolve(process.env.BASIS_DATA_DIR || path.join(repoRoot, "data"));
}

/** Data root that is guaranteed to exist (with the standard subfolders). */
export function ensureDataDir(repoRoot) {
  const dir = dataDir(repoRoot);
  for (const sub of ["briefs", "digests", "filings"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}
