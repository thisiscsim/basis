import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
} from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, normalize, sep } from "node:path";
import { assertSlug, isSafeExternalUrl, safePath, slugify, writeFileAtomic } from "./paths";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  nativeImage,
  session,
  shell,
} from "electron";
import { installCrashHandlers, logger, logsDir, openScriptLog } from "./logger";
import {
  type Alerts,
  type Digest,
  type Ips,
  parseAlerts,
  parseBrief,
  parseDigest,
  parseIps,
  parseMeta,
  parsePortfolio,
  parseWatchlist,
  parseXray,
  type Portfolio,
  TickerSchema,
  type Watchlist,
  type Xray,
} from "@basis/schema";
import {
  type ChatMessage,
  type ChatMode,
  evaluateGate,
  llmInfo,
  streamChat,
  type WorkspaceContext,
} from "./llm";

// In dev (electron-vite) __dirname is <repo>/app/out/main, so the repo root is
// three levels up. Allow an override for packaged/other layouts.
const REPO_ROOT = process.env["BASIS_ROOT"] ?? join(__dirname, "..", "..", "..");
const ICON_PATH = join(REPO_ROOT, "app", "resources", "icon.png");
const SCRIPTS_DIR = join(REPO_ROOT, "app", "scripts");
const BRIEF_SCRIPT = join(SCRIPTS_DIR, "brief-llm.mjs");
const XRAY_SCRIPT = join(SCRIPTS_DIR, "xray.mjs");
const MONITOR_SCRIPT = join(SCRIPTS_DIR, "monitor.mjs");
const DIFF_SCRIPT = join(SCRIPTS_DIR, "diff-llm.mjs");
const DIGEST_SCRIPT = join(SCRIPTS_DIR, "digest-llm.mjs");

function safeWorkspacePath(slug: string, ...rel: string[]): string {
  return safePath(WORKSPACES_DIR, [slug, ...rel]);
}

// Captured so dialogs can parent to the window.
let mainWindow: BrowserWindow | null = null;

// The macOS menu bar / dock tooltip / About panel use app.name, which defaults
// to "Electron" in dev. Set it before the default menu is built.
app.setName("Basis");

// Record throws/rejections to the log file before anything else runs.
installCrashHandlers();
logger.info(`Basis ${app.getVersion()} starting (electron ${process.versions.electron})`);

// Two instances would both watch and write the same workspace files /
// settings.json; refuse to start a second one and focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// Load a local, gitignored env file (KEY=VALUE) so secrets like OPENAI_API_KEY
// can live on disk instead of being exported into the launching shell. Existing
// process env always wins. Runs at startup so spawned scripts inherit it.
function loadLocalEnv(): void {
  for (const file of [join(REPO_ROOT, "app", ".env.local"), join(REPO_ROOT, ".env.local")]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trimStart().startsWith("#")) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  }
}
loadLocalEnv();

// ---- Persistent app settings ----
export type ReasoningEffort = "low" | "medium" | "high";
interface AppSettings {
  /** User-chosen root folder for workspaces (default ~/Documents/Basis). */
  homeDir?: string;
  /** Agent preferences (env vars from .env.local always win). */
  agentModel: string;
  agentApiKey?: string;
  reasoningEffort: ReasoningEffort;
  /** Contact email for the SEC EDGAR User-Agent (their fair-access rules ask for one). */
  edgarContact?: string;
}
/**
 * The renderer never needs raw key values — only whether a key is set — so we
 * strip them at the IPC boundary. Keeping the plaintext main-side means a
 * renderer compromise can't read them over `settings:get`.
 */
type PublicSettings = Omit<AppSettings, "agentApiKey"> & {
  hasAgentKey: boolean;
};
function publicSettings(s: AppSettings): PublicSettings {
  const { agentApiKey, ...rest } = s;
  return { ...rest, hasAgentKey: Boolean(agentApiKey) };
}
const SETTINGS_PATH = join(app.getPath("userData"), "settings.json");
function readSettings(): AppSettings {
  let s: Record<string, unknown> = {};
  try {
    s = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    // fresh install
  }
  const oneOf = <T extends string>(v: unknown, options: readonly T[], dflt: T): T =>
    typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : dflt;
  return {
    homeDir: typeof s.homeDir === "string" && s.homeDir ? s.homeDir : undefined,
    agentModel: typeof s.agentModel === "string" && s.agentModel ? s.agentModel : "gpt-5.5",
    agentApiKey: typeof s.agentApiKey === "string" && s.agentApiKey ? s.agentApiKey : undefined,
    reasoningEffort: oneOf(s.reasoningEffort, ["low", "medium", "high"] as const, "low"),
    edgarContact: typeof s.edgarContact === "string" && s.edgarContact ? s.edgarContact : undefined,
  };
}
function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  try {
    writeFileAtomic(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // best-effort
  }
  applyAgentEnv(next);
  return next;
}

// Agent preferences flow to the LLM layer via the same env vars .env.local uses.
// Anything explicitly set in the environment (shell or .env.local) stays
// authoritative; settings only fill the gaps. `envLocked` is captured once at
// startup, before the first injection.
const envLocked = {
  provider: "BASIS_LLM_PROVIDER" in process.env,
  model: "BASIS_LLM_MODEL" in process.env,
  apiKey: Boolean(
    process.env["BASIS_LLM_API_KEY"] || process.env["OPENAI_API_KEY"] || process.env["ANTHROPIC_API_KEY"],
  ),
  effort: "BASIS_REASONING_EFFORT" in process.env,
  edgarContact: "BASIS_EDGAR_CONTACT" in process.env,
};
function applyAgentEnv(s: AppSettings): void {
  if (!envLocked.model) {
    process.env["BASIS_LLM_MODEL"] = s.agentModel;
    if (!envLocked.provider) {
      process.env["BASIS_LLM_PROVIDER"] = s.agentModel.startsWith("claude") ? "anthropic" : "openai";
    }
  }
  if (!envLocked.apiKey) {
    if (s.agentApiKey) process.env["BASIS_LLM_API_KEY"] = s.agentApiKey;
    else delete process.env["BASIS_LLM_API_KEY"];
  }
  if (!envLocked.effort) process.env["BASIS_REASONING_EFFORT"] = s.reasoningEffort;
  if (!envLocked.edgarContact) {
    if (s.edgarContact) process.env["BASIS_EDGAR_CONTACT"] = s.edgarContact;
    else delete process.env["BASIS_EDGAR_CONTACT"];
  }
}
applyAgentEnv(readSettings());

// User-owned storage: workspaces live under the user's home folder, not the
// repo/app bundle. Resolution: env override (dev) -> user-picked folder
// (settings) -> ~/Documents/Basis. Resolved once at startup.
const APP_HOME =
  process.env["BASIS_HOME"] ?? readSettings().homeDir ?? join(app.getPath("documents"), "Basis");
const WORKSPACES_DIR = process.env["BASIS_WORKSPACES_DIR"] ?? join(APP_HOME, "workspaces");
const CACHE_DIR = process.env["BASIS_CACHE_DIR"] ?? join(APP_HOME, "cache");
try {
  mkdirSync(WORKSPACES_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
} catch {
  // directories are best-effort at startup
}
// Spawned scripts (brief/xray/monitor/...) inherit these to find the same dirs.
process.env["BASIS_WORKSPACES_DIR"] = WORKSPACES_DIR;
process.env["BASIS_CACHE_DIR"] = CACHE_DIR;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#16140f",
    title: "Basis",
    icon: ICON_PATH,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
    },
  });

  mainWindow = win;
  win.on("ready-to-show", () => win.show());
  win.webContents.on("render-process-gone", (_e, details) => {
    logger.error(`render-process-gone: ${details.reason} (exitCode ${details.exitCode})`);
  });
  win.webContents.on("unresponsive", () => logger.warn("renderer unresponsive"));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    // On macOS the process outlives the window; don't leave the last
    // workspace's watcher running against a windowless app.
    activeWatcher?.watcher.close();
    activeWatcher = null;
  });
  // Only ever hand real web links to the OS. Denying the window is not enough:
  // a compromised/injected renderer could otherwise ask shell.openExternal to
  // launch file://, smb://, or a custom-scheme handler (a known RCE-adjacent
  // vector).
  win.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url);
    return { action: "deny" };
  });
  // The app is a fixed local bundle; never let content navigate the top frame
  // away from its own origin (dev server or the packaged file://).
  win.webContents.on("will-navigate", (event, url) => {
    const appOrigin = process.env["ELECTRON_RENDERER_URL"];
    const sameApp = appOrigin ? url.startsWith(appOrigin) : url.startsWith("file://");
    if (!sameApp) event.preventDefault();
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readJsonMaybe(file: string): unknown {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function readMeta(slug: string) {
  try {
    return parseMeta(readJson(safeWorkspacePath(slug, "meta.json")));
  } catch {
    return parseMeta({});
  }
}

function touchMeta(slug: string, patch: Partial<ReturnType<typeof readMeta>>): void {
  try {
    // Re-validate the merged result so an arbitrary renderer patch can't write
    // unknown keys / out-of-range values into meta.json (parseMeta drops them).
    const meta = parseMeta({ ...readMeta(slug), ...patch, updatedAt: new Date().toISOString() });
    markSelfWrite(slug);
    writeFileAtomic(safeWorkspacePath(slug, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  } catch {
    // meta is best-effort
  }
}

// ---- Workspace documents ----

export interface BriefSummary {
  file: string;
  ticker: string;
  company?: string;
  generatedAt?: string;
}

const BRIEF_FILE_RE = /^[A-Z0-9.-]{1,12}-\d{4}-\d{2}-\d{2}\.json$/;

function listBriefs(slug: string): BriefSummary[] {
  const out: BriefSummary[] = [];
  try {
    for (const file of readdirSync(safeWorkspacePath(slug, "briefs"))) {
      if (!BRIEF_FILE_RE.test(file)) continue;
      const parsed = parseBrief(readJsonMaybe(safeWorkspacePath(slug, "briefs", file)));
      if (parsed.ok && parsed.brief) {
        out.push({
          file,
          ticker: parsed.brief.ticker,
          company: parsed.brief.company,
          generatedAt: parsed.brief.generatedAt,
        });
      }
    }
  } catch {
    // no briefs dir yet
  }
  return out.sort((a, b) => (b.generatedAt ?? b.file).localeCompare(a.generatedAt ?? a.file));
}

function latestDigest(slug: string): Digest | null {
  try {
    const files = readdirSync(safeWorkspacePath(slug, "digests"))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse();
    for (const file of files) {
      const parsed = parseDigest(readJsonMaybe(safeWorkspacePath(slug, "digests", file)));
      if (parsed.ok && parsed.digest) return parsed.digest;
    }
  } catch {
    // no digests dir yet
  }
  return null;
}

function loadWorkspace(slug: string) {
  try {
    assertSlug(slug);
    const dir = safeWorkspacePath(slug);
    if (!existsSync(join(dir, "meta.json"))) {
      return { ok: false as const, error: "workspace not found", slug };
    }
    let xray: Xray | null = null;
    try {
      const raw = readJsonMaybe(join(dir, "xray.json"));
      if (raw) xray = parseXray(raw);
    } catch {
      xray = null;
    }
    return {
      ok: true as const,
      slug,
      dir,
      meta: readMeta(slug),
      portfolio: parsePortfolio(readJsonMaybe(join(dir, "portfolio.json"))),
      ips: parseIps(readJsonMaybe(join(dir, "ips.json"))),
      watchlist: parseWatchlist(readJsonMaybe(join(dir, "watchlist.json"))),
      alerts: parseAlerts(readJsonMaybe(join(dir, "alerts.json"))),
      xray,
      digest: latestDigest(slug),
      briefs: listBriefs(slug),
    };
  } catch (err) {
    return { ok: false as const, error: String(err), slug };
  }
}

// We write workspace files from two places: the app (edits) and the engine
// scripts/agent. Track our own writes so the file watcher doesn't echo a
// reload back to the UI that just saved (which would clobber in-flight edits).
const lastSelfWrite = new Map<string, number>();
let activeWatcher: { slug: string; watcher: FSWatcher } | null = null;

function markSelfWrite(slug: string): void {
  lastSelfWrite.set(slug, Date.now());
}

type DocKind = "portfolio" | "ips" | "watchlist" | "alerts";

function writeDoc(slug: string, kind: DocKind, input: unknown): { ok: boolean; error?: string } {
  try {
    assertSlug(slug);
    let validated: Portfolio | Ips | Watchlist | Alerts;
    switch (kind) {
      case "portfolio":
        validated = parsePortfolio(input);
        (validated as Portfolio).updatedAt = new Date().toISOString();
        break;
      case "ips":
        validated = parseIps(input);
        (validated as Ips).updatedAt = new Date().toISOString();
        break;
      case "watchlist":
        validated = parseWatchlist(input);
        break;
      case "alerts":
        validated = parseAlerts(input);
        break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
    markSelfWrite(slug);
    writeFileAtomic(safeWorkspacePath(slug, `${kind}.json`), `${JSON.stringify(validated, null, 2)}\n`);
    touchMeta(slug, {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function watchWorkspace(slug: string, event: IpcMainInvokeEvent): void {
  activeWatcher?.watcher.close();
  activeWatcher = null;
  const dir = safeWorkspacePath(slug);
  if (!existsSync(dir)) return;
  let timer: NodeJS.Timeout | null = null;
  // Watch the directory (recursively — briefs/ and digests/ matter too), not
  // individual files: atomic write-then-rename swaps the inode, which silently
  // kills a file-level watch on macOS (kqueue) and Linux (inotify).
  const watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
    // Only react to JSON documents; ignore filing caches and temp files.
    if (filename) {
      const name = basename(String(filename));
      if (!name.endsWith(".json") || name.startsWith(".")) return;
      if (String(filename).startsWith("filings")) return;
    }
    // Ignore the echo from our own saves.
    if (Date.now() - (lastSelfWrite.get(slug) ?? 0) < 1200) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!event.sender.isDestroyed()) event.sender.send("workspace:changed", slug);
    }, 200);
  });
  activeWatcher = { slug, watcher };
}

export interface WorkspaceSummary {
  slug: string;
  title: string;
  status: string;
  holdings: number;
  watching: number;
  unreadAlerts: number;
  updatedAt?: string;
  albumId?: string;
}

// ---- Home-page albums (registry at <WORKSPACES_DIR>/albums.json; membership
// lives in each workspace's meta.json so workspaces stay self-describing) ----
export interface AlbumRecord {
  id: string;
  name: string;
  createdAt: string;
}

const ALBUMS_FILE = () => join(WORKSPACES_DIR, "albums.json");

function readAlbums(): AlbumRecord[] {
  try {
    const raw = JSON.parse(readFileSync(ALBUMS_FILE(), "utf8")) as { albums?: unknown[] };
    return (raw.albums ?? []).filter(
      (a): a is AlbumRecord =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as AlbumRecord).id === "string" &&
        typeof (a as AlbumRecord).name === "string",
    );
  } catch {
    return [];
  }
}

function writeAlbumsFile(albums: AlbumRecord[]): void {
  writeFileAtomic(ALBUMS_FILE(), `${JSON.stringify({ albums }, null, 2)}\n`);
}

const validAlbumId = (id: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);

function createAlbum(name: string): { ok: boolean; id?: string; name?: string; error?: string } {
  try {
    const albums = readAlbums();
    // Dedupe the display name ("New folder", "New folder 2", ...) then derive the id.
    const base = name.trim() || "New folder";
    let finalName = base;
    let n = 2;
    while (albums.some((a) => a.name.toLowerCase() === finalName.toLowerCase())) finalName = `${base} ${n++}`;
    const idBase = slugify(finalName);
    let id = idBase;
    n = 2;
    while (albums.some((a) => a.id === id)) id = `${idBase}-${n++}`;
    albums.push({ id, name: finalName, createdAt: new Date().toISOString() });
    writeAlbumsFile(albums);
    return { ok: true, id, name: finalName };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function renameAlbum(id: string, name: string): { ok: boolean; error?: string } {
  try {
    if (!validAlbumId(id)) return { ok: false, error: "invalid folder id" };
    const albums = readAlbums();
    const album = albums.find((a) => a.id === id);
    if (!album) return { ok: false, error: "folder not found" };
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "name required" };
    album.name = trimmed;
    writeAlbumsFile(albums);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function deleteAlbum(id: string): { ok: boolean; error?: string } {
  try {
    if (!validAlbumId(id)) return { ok: false, error: "invalid folder id" };
    writeAlbumsFile(readAlbums().filter((a) => a.id !== id));
    // The group dissolves; member workspaces are kept and just ungrouped.
    for (const slug of readdirSync(WORKSPACES_DIR)) {
      try {
        if (!existsSync(join(WORKSPACES_DIR, slug, "meta.json"))) continue;
        if (readMeta(slug).albumId === id) touchMeta(slug, { albumId: undefined });
      } catch {
        // skip unreadable entries
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function setWorkspaceAlbum(slug: string, albumId: string | null): { ok: boolean; error?: string } {
  try {
    if (albumId !== null) {
      if (!validAlbumId(albumId)) return { ok: false, error: "invalid folder id" };
      if (!readAlbums().some((a) => a.id === albumId)) return { ok: false, error: "folder not found" };
    }
    touchMeta(slug, { albumId: albumId ?? undefined });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Async + parallel: every ipcMain handler runs on the main (UI) thread, and
// this reads/parses every workspace's sidecar files. fs/promises + Promise.all
// yields between reads so a large home grid can't jank the window.
async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(WORKSPACES_DIR);
  } catch {
    return [];
  }
  const summaries = await Promise.all(
    entries.map(async (slug): Promise<WorkspaceSummary | null> => {
      const metaFile = join(WORKSPACES_DIR, slug, "meta.json");
      if (!existsSync(metaFile)) return null; // not a workspace dir
      let meta: ReturnType<typeof readMeta>;
      try {
        meta = parseMeta(JSON.parse(await readFile(metaFile, "utf8")));
      } catch {
        meta = parseMeta({});
      }
      const readCount = async (file: string, pick: (data: unknown) => number): Promise<number> => {
        try {
          return pick(JSON.parse(await readFile(join(WORKSPACES_DIR, slug, file), "utf8")));
        } catch {
          return 0;
        }
      };
      const holdings = await readCount("portfolio.json", (d) => parsePortfolio(d).holdings.length);
      const watching = await readCount("watchlist.json", (d) => parseWatchlist(d).entries.length);
      const unreadAlerts = await readCount(
        "alerts.json",
        (d) => parseAlerts(d).alerts.filter((a) => !a.read).length,
      );
      let updatedAt = meta.updatedAt;
      if (!updatedAt) {
        try {
          updatedAt = (await stat(metaFile)).mtime.toISOString();
        } catch {
          // leave undefined
        }
      }
      return {
        slug,
        title: meta.title || slug,
        status: meta.status,
        holdings,
        watching,
        unreadAlerts,
        updatedAt,
        albumId: meta.albumId,
      };
    }),
  );
  return summaries
    .filter((s): s is WorkspaceSummary => s !== null)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

function createWorkspace(input: { title: string; tickers?: string[] }): {
  ok: boolean;
  slug?: string;
  error?: string;
} {
  try {
    const base = slugify(input.title);
    let slug = base;
    let n = 2;
    while (existsSync(join(WORKSPACES_DIR, slug))) slug = `${base}-${n++}`;
    const dir = join(WORKSPACES_DIR, slug);
    for (const sub of ["briefs", "digests", "filings"]) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
    const now = new Date().toISOString();
    const meta = parseMeta({
      title: input.title.trim() || slug,
      createdAt: now,
      updatedAt: now,
      status: "new",
    });
    const entries = (input.tickers ?? [])
      .map((t) => TickerSchema.safeParse(String(t).toUpperCase().trim()))
      .filter((r) => r.success)
      .map((r) => ({ ticker: (r as { data: string }).data, addedAt: now }));
    writeFileAtomic(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    writeFileAtomic(join(dir, "portfolio.json"), `${JSON.stringify(parsePortfolio({}), null, 2)}\n`);
    writeFileAtomic(join(dir, "ips.json"), `${JSON.stringify(parseIps({}), null, 2)}\n`);
    writeFileAtomic(join(dir, "watchlist.json"), `${JSON.stringify(parseWatchlist({ entries }), null, 2)}\n`);
    writeFileAtomic(join(dir, "alerts.json"), `${JSON.stringify(parseAlerts({}), null, 2)}\n`);
    return { ok: true, slug };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function deleteWorkspace(slug: string): { ok: boolean; error?: string } {
  try {
    if (!slug || slug.includes("/") || slug.includes("\\")) return { ok: false, error: "invalid slug" };
    const dir = safeWorkspacePath(slug);
    if (normalize(dir) === normalize(WORKSPACES_DIR)) return { ok: false, error: "invalid slug" };
    if (activeWatcher?.slug === slug) {
      activeWatcher.watcher.close();
      activeWatcher = null;
    }
    rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Spawn a Node script with arbitrary args, streaming its PHASE/PROGRESS/DONE
// protocol back to the renderer on `${channelPrefix}:*` channels.
function runScriptArgs(
  scriptPath: string,
  args: string[],
  event: IpcMainInvokeEvent,
  channelPrefix: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const runLog = openScriptLog(channelPrefix);
    logger.info(`script ${channelPrefix} start: ${basename(scriptPath)} ${args.join(" ")} -> ${runLog.path}`);
    // Run engine scripts with Electron's bundled Node (ELECTRON_RUN_AS_NODE)
    // rather than a `node` on PATH — a packaged app has no system node, and
    // this also lets nested spawns reuse process.execPath.
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let output = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      runLog.append(text);
      for (const line of text.split("\n")) {
        const progress = line.match(/PROGRESS (\d+)/);
        if (progress && !event.sender.isDestroyed())
          event.sender.send(`${channelPrefix}:progress`, Number(progress[1]));
        const phase = line.match(/PHASE (.+)/);
        if (phase && !event.sender.isDestroyed())
          event.sender.send(`${channelPrefix}:phase`, phase[1].trim());
        const done = line.match(/DONE (.+)/);
        if (done) output = done[1].trim();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      runLog.append(text);
    });
    child.on("close", (code) => {
      runLog.close(code);
      if (code === 0) {
        logger.info(`script ${channelPrefix} ok`);
        resolve({ ok: true, output });
      } else {
        logger.warn(
          `script ${channelPrefix} failed (exit ${code}): ${stderr.trim().split("\n").pop() ?? ""}`,
        );
        resolve({ ok: false, error: stderr.trim() || `Process exited with code ${code}` });
      }
    });
    child.on("error", (err) => {
      runLog.close(null);
      logger.error(`script ${channelPrefix} spawn error`, err);
      resolve({ ok: false, error: String(err) });
    });
  });
}

function runScript(
  scriptPath: string,
  slug: string,
  event: IpcMainInvokeEvent,
  channelPrefix: string,
  extraArgs: string[] = [],
): Promise<{ ok: boolean; output?: string; error?: string }> {
  // Engine scripts join the slug onto the workspaces dir themselves, so enforce
  // slug shape at this IPC boundary (same rule slugify produces).
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
    return Promise.resolve({ ok: false, error: "invalid workspace id" });
  }
  return runScriptArgs(scriptPath, ["--slug", slug, ...extraArgs], event, channelPrefix);
}

// ---- Chat (tutor / coach) ----
// One in-flight stream per app; a new send aborts the previous one.
let activeChat: AbortController | null = null;

function workspaceContext(slug: string | null): WorkspaceContext | null {
  if (!slug) return null;
  const ws = loadWorkspace(slug);
  if (!ws.ok) return null;
  return { ips: ws.ips, portfolio: ws.portfolio, xray: ws.xray };
}

function sanitizeMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 60) return null;
  const out: ChatMessage[] = [];
  for (const m of input) {
    const role = (m as ChatMessage)?.role;
    const content = (m as ChatMessage)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    out.push({ role, content: content.slice(0, 8000) });
  }
  return out;
}

async function handleChatSend(
  event: IpcMainInvokeEvent,
  input: { slug?: string | null; mode?: string; messages?: unknown },
): Promise<{ ok: boolean; text?: string; cancelled?: boolean; error?: string }> {
  if (!llmInfo().configured) {
    return { ok: false, error: "No model configured (add an API key in Settings)." };
  }
  const mode: ChatMode = input.mode === "coach" ? "coach" : "tutor";
  const messages = sanitizeMessages(input.messages);
  if (!messages) return { ok: false, error: "invalid chat payload" };
  let slug: string | null = null;
  if (typeof input.slug === "string") {
    try {
      assertSlug(input.slug);
      slug = input.slug;
    } catch {
      return { ok: false, error: "invalid workspace id" };
    }
  }

  activeChat?.abort();
  const controller = new AbortController();
  activeChat = controller;
  try {
    const text = await streamChat({
      mode,
      context: mode === "coach" ? workspaceContext(slug) : null,
      messages,
      signal: controller.signal,
      onDelta: (delta) => {
        if (!event.sender.isDestroyed()) event.sender.send("chat:delta", delta);
      },
    });
    if (!event.sender.isDestroyed()) event.sender.send("chat:done", text);
    return { ok: true, text };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, cancelled: true };
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`chat failed: ${message}`);
    if (!event.sender.isDestroyed()) event.sender.send("chat:error", message);
    return { ok: false, error: message };
  } finally {
    if (activeChat === controller) activeChat = null;
  }
}

// ---- Friction-gate decision log ----
function recordDecision(
  slug: string,
  input: { trade?: unknown; verdict?: unknown; argument?: unknown },
): { ok: boolean; error?: string } {
  try {
    assertSlug(slug);
    const trade = String(input.trade ?? "").slice(0, 1000);
    const verdict = input.verdict === "proceeded" ? "proceeded" : "cancelled";
    if (!trade.trim()) return { ok: false, error: "trade description required" };
    const entry = {
      at: new Date().toISOString(),
      trade,
      verdict,
      argument: typeof input.argument === "string" ? input.argument.slice(0, 8000) : undefined,
    };
    // Append-only JSONL: the point is an honest history the user can review.
    appendFileSync(safeWorkspacePath(slug, "decisions.log.jsonl"), `${JSON.stringify(entry)}\n`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

app.whenReady().then(() => {
  // macOS ignores the BrowserWindow `icon`; set the dock icon so the app shows
  // its own icon instead of the default Electron one (matters most in dev).
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(ICON_PATH);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  // Content-Security-Policy backstop. The renderer loads only local content;
  // there is no reason for it to reach the network or eval remote code. In
  // dev, Vite/React-Refresh inject inline scripts and use a websocket for
  // HMR, so the dev policy is looser.
  const isDev = Boolean(process.env["ELECTRON_RENDERER_URL"]);
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: http://localhost:*;"
    : [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "frame-src 'none'",
      ].join("; ");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] },
    });
  });

  ipcMain.handle("ping", () => "pong");

  // ---- Workspaces ----
  ipcMain.handle("workspaces:list", () => listWorkspaces());
  ipcMain.handle("workspace:create", (_event, input: { title: string; tickers?: string[] }) =>
    createWorkspace(input),
  );
  ipcMain.handle("workspace:load", (_event, slug: string) => loadWorkspace(slug));
  ipcMain.handle("workspace:delete", (_event, slug: string) => deleteWorkspace(slug));
  ipcMain.handle("workspace:watch", (event, slug: string) => {
    try {
      assertSlug(slug);
      watchWorkspace(slug, event);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  ipcMain.handle("meta:save", (_event, slug: string, patch: Record<string, unknown>) => {
    touchMeta(slug, patch);
    return { ok: true };
  });

  // ---- Folders (albums) on the home grid ----
  ipcMain.handle("albums:list", () => readAlbums());
  ipcMain.handle("albums:create", (_event, name: string) => createAlbum(name));
  ipcMain.handle("albums:rename", (_event, id: string, name: string) => renameAlbum(id, name));
  ipcMain.handle("albums:delete", (_event, id: string) => deleteAlbum(id));
  ipcMain.handle("workspace:setAlbum", (_event, slug: string, albumId: string | null) =>
    setWorkspaceAlbum(slug, albumId),
  );

  // ---- Workspace documents ----
  ipcMain.handle("portfolio:save", (_event, slug: string, doc: unknown) => writeDoc(slug, "portfolio", doc));
  ipcMain.handle("ips:save", (_event, slug: string, doc: unknown) => writeDoc(slug, "ips", doc));
  ipcMain.handle("watchlist:save", (_event, slug: string, doc: unknown) => writeDoc(slug, "watchlist", doc));
  ipcMain.handle("alerts:save", (_event, slug: string, doc: unknown) => writeDoc(slug, "alerts", doc));
  ipcMain.handle("briefs:list", (_event, slug: string) => {
    try {
      assertSlug(slug);
      return listBriefs(slug);
    } catch {
      return [];
    }
  });
  ipcMain.handle("brief:load", (_event, slug: string, file: string) => {
    try {
      assertSlug(slug);
      if (basename(file) !== file || !BRIEF_FILE_RE.test(file)) return null;
      const parsed = parseBrief(readJsonMaybe(safeWorkspacePath(slug, "briefs", file)));
      return parsed.ok ? (parsed.brief ?? null) : null;
    } catch {
      return null;
    }
  });

  // ---- Jobs (spawned engine scripts) ----
  ipcMain.handle("brief:start", (event, slug: string, ticker: string) => {
    const parsed = TickerSchema.safeParse(
      String(ticker ?? "")
        .toUpperCase()
        .trim(),
    );
    if (!parsed.success) return Promise.resolve({ ok: false, error: "invalid ticker" });
    if (!llmInfo().configured) {
      return Promise.resolve({ ok: false, error: "No model configured (add an API key in Settings)." });
    }
    return runScript(BRIEF_SCRIPT, slug, event, "brief", ["--ticker", parsed.data]);
  });
  ipcMain.handle("xray:start", (event, slug: string) => runScript(XRAY_SCRIPT, slug, event, "xray"));
  ipcMain.handle("monitor:start", async (event, slug: string) => {
    // Fetch new filings first; then, when a model is configured, summarize
    // what changed in the diffable ones. Both report on the "monitor" prefix.
    const fetched = await runScript(MONITOR_SCRIPT, slug, event, "monitor");
    if (!fetched.ok) return fetched;
    if (llmInfo().configured) {
      const diffed = await runScript(DIFF_SCRIPT, slug, event, "monitor");
      if (!diffed.ok) {
        // New filings still landed; surface the diff failure without failing the run.
        return { ok: true, output: `${fetched.output ?? ""} (diff summaries failed: ${diffed.error})` };
      }
    }
    return fetched;
  });
  ipcMain.handle("digest:start", (event, slug: string) => runScript(DIGEST_SCRIPT, slug, event, "digest"));

  // ---- Chat + friction gate ----
  ipcMain.handle("chat:send", (event, input: { slug?: string | null; mode?: string; messages?: unknown }) =>
    handleChatSend(event, input),
  );
  ipcMain.handle("chat:cancel", () => {
    activeChat?.abort();
    activeChat = null;
    return { ok: true };
  });
  ipcMain.handle("gate:evaluate", async (_event, slug: string, trade: string) => {
    try {
      assertSlug(slug);
    } catch {
      return { ok: false, error: "invalid workspace id" };
    }
    if (!llmInfo().configured) {
      return { ok: false, error: "No model configured (add an API key in Settings)." };
    }
    const text = String(trade ?? "").slice(0, 1000);
    if (!text.trim()) return { ok: false, error: "describe the trade first" };
    const ctx = workspaceContext(slug);
    if (!ctx) return { ok: false, error: "workspace not found" };
    return evaluateGate(text, ctx);
  });
  ipcMain.handle("gate:record", (_event, slug: string, input: Record<string, unknown>) =>
    recordDecision(slug, input),
  );

  // ---- Settings / app plumbing ----
  ipcMain.handle("settings:get", () => publicSettings(readSettings()));
  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>) =>
    publicSettings(writeSettings(patch)),
  );
  ipcMain.handle("llm:info", () => {
    const info = llmInfo();
    return {
      ...info,
      // True when .env.local / shell env pins these (Settings then can't change them).
      modelLocked: envLocked.model,
      keyLocked: envLocked.apiKey,
    };
  });
  ipcMain.handle("home:get", () => WORKSPACES_DIR);
  ipcMain.handle("home:reveal", () => shell.openPath(WORKSPACES_DIR));
  ipcMain.handle("home:pick", async () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: "Choose where Basis stores your workspaces",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: APP_HOME,
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    // Store the chosen folder as the Basis home; workspaces live under it.
    writeSettings({ homeDir: result.filePaths[0] });
    return { ok: true, homeDir: result.filePaths[0] };
  });
  ipcMain.handle("shell:reveal", (_event, filePath: string) => {
    // Only reveal paths inside the app's own storage roots — never an arbitrary
    // renderer-supplied path.
    const target = normalize(filePath);
    const roots = [WORKSPACES_DIR, APP_HOME].map(normalize);
    if (!roots.some((r) => target === r || target.startsWith(r + sep))) return;
    shell.showItemInFolder(target);
  });
  // Citations link to sec.gov; open them in the user's browser, https only.
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  // Runtime build metadata so a bug report can be correlated to a version.
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    logsDir: logsDir(),
  }));
  // Let the renderer persist its own errors (window.onerror, boundary) to the
  // shared log file — otherwise they only reach a usually-closed DevTools.
  ipcMain.handle("log:renderer", (_event, level: string, message: string) => {
    const fn = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.info;
    fn(`[renderer] ${message}`);
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  activeWatcher?.watcher.close();
  activeWatcher = null;
});
