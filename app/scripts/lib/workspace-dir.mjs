// Slug -> workspace directory, with the same containment guarantee the app's
// IPC boundary enforces. Scripts are documented as CLI/agent-runnable, so the
// slug is untrusted here too: `--slug ../../etc` must not resolve outside the
// workspaces root.
import path from "node:path";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Absolute workspaces root, honoring BASIS_WORKSPACES_DIR (dev fallback: <repo>/workspaces). */
export function workspacesRoot(repoRoot) {
  return path.resolve(process.env.BASIS_WORKSPACES_DIR || path.join(repoRoot, "workspaces"));
}

/**
 * Resolve workspaces/<slug>, throwing on a malformed slug or any path that
 * would escape the workspaces root. Returns an absolute path.
 */
export function resolveWorkspaceDir(repoRoot, slug) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    throw new Error(`invalid slug: ${JSON.stringify(slug)}`);
  }
  const root = workspacesRoot(repoRoot);
  const dir = path.resolve(root, slug);
  if (dir !== path.join(root, slug) || !dir.startsWith(root + path.sep)) {
    throw new Error("slug escapes the workspaces root");
  }
  return dir;
}
