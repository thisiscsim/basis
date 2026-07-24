import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  watch,
} from "node:fs";
import { basename, join, normalize, sep } from "node:path";
import { isSafeExternalUrl, safePath, writeFileAtomic } from "./paths";
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
  type Backtest,
  BacktestConfigSchema,
  type Digest,
  type Ips,
  type Finances,
  type Goals,
  type PaperAccount,
  parseAlerts,
  parseBacktest,
  parseBrief,
  parseDigest,
  parseFinances,
  parseGoals,
  parseGraph,
  parseIdeas,
  parseIps,
  parseLifePlan,
  parsePaper,
  parsePlan,
  parsePortfolio,
  parseWatchlist,
  parseXray,
  type Plan,
  type Portfolio,
  TickerSchema,
  type Watchlist,
  type Xray,
} from "@basis/schema";
import {
  fetchAccounts,
  fetchBalance,
  fetchTransactions,
  openConnectWindow,
  type TellerConfig,
} from "./teller";
import { detectRecurring, mapTellerAccounts } from "./teller-map";
import { type ChatMessage, type ChatMode, evaluateGate, llmInfo, streamChat, type CoachContext } from "./llm";

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
const GRADE_IDEAS_SCRIPT = join(SCRIPTS_DIR, "grade-ideas.mjs");
const GRAPH_SCRIPT = join(SCRIPTS_DIR, "graph-llm.mjs");
const LIFEPLAN_SCRIPT = join(SCRIPTS_DIR, "lifeplan.mjs");
const BACKTEST_SCRIPT = join(SCRIPTS_DIR, "backtest.mjs");
const PAPER_MARK_SCRIPT = join(SCRIPTS_DIR, "paper-mark.mjs");

/** Guarded path inside the single data dir (brief filenames etc. are untrusted). */
function safeDataPath(...rel: string[]): string {
  return safePath(DATA_DIR, rel);
}

// Captured so dialogs can parent to the window.
let mainWindow: BrowserWindow | null = null;

// The macOS menu bar / dock tooltip / About panel use app.name, which defaults
// to "Electron" in dev. Set it before the default menu is built.
app.setName("Basis");

// Record throws/rejections to the log file before anything else runs.
installCrashHandlers();
logger.info(`Basis ${app.getVersion()} starting (electron ${process.versions.electron})`);

// Two instances would both watch and write the same data files / settings.json;
// refuse to start a second one and focus the first instead.
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
export type PricesProvider = "yahoo" | "tiingo";
export type TellerEnvName = "sandbox" | "development" | "production";
interface AppSettings {
  /** User-chosen root folder for Basis data (default ~/Documents/Basis). */
  homeDir?: string;
  /** Agent preferences (env vars from .env.local always win). */
  agentModel: string;
  agentApiKey?: string;
  reasoningEffort: ReasoningEffort;
  /** Contact email for the SEC EDGAR User-Agent (their fair-access rules ask for one). */
  edgarContact?: string;
  /** Daily-close price data: free Yahoo Finance by default, keyed Tiingo optionally. */
  pricesProvider: PricesProvider;
  pricesApiKey?: string;
  /** Read-only Teller bank sync (the user's own Teller application id). */
  tellerAppId?: string;
  tellerEnv: TellerEnvName;
  /** Client-cert paths for Teller development/production (sandbox needs none). */
  tellerCertPath?: string;
  tellerKeyPath?: string;
  tellerAccessToken?: string;
}
/**
 * The renderer never needs raw key values — only whether a key is set — so we
 * strip them at the IPC boundary. Keeping the plaintext main-side means a
 * renderer compromise can't read them over `settings:get`.
 */
type PublicSettings = Omit<AppSettings, "agentApiKey" | "pricesApiKey" | "tellerAccessToken"> & {
  hasAgentKey: boolean;
  hasPricesKey: boolean;
  tellerLinked: boolean;
};
function publicSettings(s: AppSettings): PublicSettings {
  const { agentApiKey, pricesApiKey, tellerAccessToken, ...rest } = s;
  return {
    ...rest,
    hasAgentKey: Boolean(agentApiKey),
    hasPricesKey: Boolean(pricesApiKey),
    tellerLinked: Boolean(tellerAccessToken),
  };
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
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  return {
    homeDir: str(s.homeDir),
    agentModel: str(s.agentModel) ?? "gpt-5.5",
    agentApiKey: str(s.agentApiKey),
    reasoningEffort: oneOf(s.reasoningEffort, ["low", "medium", "high"] as const, "low"),
    edgarContact: str(s.edgarContact),
    pricesProvider: oneOf(s.pricesProvider, ["yahoo", "tiingo"] as const, "yahoo"),
    pricesApiKey: str(s.pricesApiKey),
    tellerAppId: str(s.tellerAppId),
    tellerEnv: oneOf(s.tellerEnv, ["sandbox", "development", "production"] as const, "sandbox"),
    tellerCertPath: str(s.tellerCertPath),
    tellerKeyPath: str(s.tellerKeyPath),
    tellerAccessToken: str(s.tellerAccessToken),
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
  pricesProvider: "BASIS_PRICES_PROVIDER" in process.env,
  pricesKey: "BASIS_PRICES_API_KEY" in process.env,
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
  if (!envLocked.pricesProvider) process.env["BASIS_PRICES_PROVIDER"] = s.pricesProvider;
  if (!envLocked.pricesKey) {
    if (s.pricesApiKey) process.env["BASIS_PRICES_API_KEY"] = s.pricesApiKey;
    else delete process.env["BASIS_PRICES_API_KEY"];
  }
}
applyAgentEnv(readSettings());

// User-owned storage: a single data folder (single-player — there is exactly
// one portfolio/IPS/watchlist). Resolution: env override (dev) -> user-picked
// folder (settings) -> ~/Documents/Basis. Resolved once at startup.
const APP_HOME =
  process.env["BASIS_HOME"] ?? readSettings().homeDir ?? join(app.getPath("documents"), "Basis");
const DATA_DIR = process.env["BASIS_DATA_DIR"] ?? APP_HOME;
const CACHE_DIR = process.env["BASIS_CACHE_DIR"] ?? join(APP_HOME, "cache");
// Spawned scripts (brief/xray/monitor/...) inherit these to find the same dirs.
process.env["BASIS_DATA_DIR"] = DATA_DIR;
process.env["BASIS_CACHE_DIR"] = CACHE_DIR;

/**
 * First-run scaffold: make sure every document/dir exists so the renderer,
 * the scripts, and an agent all see the same self-describing folder.
 */
function scaffoldDataDir(): void {
  try {
    for (const sub of ["briefs", "digests", "filings", join("lab", "backtests")]) {
      mkdirSync(join(DATA_DIR, sub), { recursive: true });
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    const seed: [string, unknown][] = [
      ["portfolio.json", parsePortfolio({})],
      ["ips.json", parseIps({})],
      ["watchlist.json", parseWatchlist({})],
      ["alerts.json", parseAlerts({})],
      ["paper.json", parsePaper({})],
      ["plan.json", parsePlan({})],
      ["graph.json", parseGraph({})],
      ["finances.json", parseFinances({})],
      ["goals.json", parseGoals({})],
    ];
    for (const [file, doc] of seed) {
      const path = join(DATA_DIR, file);
      if (!existsSync(path)) writeFileAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
    }
  } catch (err) {
    logger.error("could not scaffold the data dir", err as Error);
  }
}
scaffoldDataDir();

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
    // On macOS the process outlives the window; don't leave the watcher
    // running against a windowless app.
    activeWatcher?.close();
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

function readJsonMaybe(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ---- Data documents ----

export interface BriefSummary {
  file: string;
  ticker: string;
  company?: string;
  generatedAt?: string;
}

const BRIEF_FILE_RE = /^[A-Z0-9.-]{1,12}-\d{4}-\d{2}-\d{2}\.json$/;

function listBriefs(): BriefSummary[] {
  const out: BriefSummary[] = [];
  try {
    for (const file of readdirSync(join(DATA_DIR, "briefs"))) {
      if (!BRIEF_FILE_RE.test(file)) continue;
      const parsed = parseBrief(readJsonMaybe(safeDataPath("briefs", file)));
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

export interface BacktestSummary {
  file: string;
  id: string;
  preset: string;
  tickers: string[];
  generatedAt?: string;
  cagrPct: number;
  benchmarkCagrPct: number;
}

const BACKTEST_FILE_RE = /^[a-z0-9-]{1,64}\.json$/;

function listBacktests(): BacktestSummary[] {
  const out: BacktestSummary[] = [];
  try {
    for (const file of readdirSync(join(DATA_DIR, "lab", "backtests"))) {
      if (!BACKTEST_FILE_RE.test(file)) continue;
      try {
        const bt = parseBacktest(readJsonMaybe(safeDataPath("lab", "backtests", file)));
        out.push({
          file,
          id: bt.id,
          preset: bt.config.preset,
          tickers: bt.config.tickers,
          generatedAt: bt.generatedAt,
          cagrPct: bt.metrics.cagrPct,
          benchmarkCagrPct: bt.benchmarkMetrics.cagrPct,
        });
      } catch {
        // skip invalid results
      }
    }
  } catch {
    // no lab dir yet
  }
  return out.sort((a, b) => (b.generatedAt ?? b.file).localeCompare(a.generatedAt ?? a.file)).slice(0, 20);
}

function latestDigest(): Digest | null {
  try {
    const files = readdirSync(join(DATA_DIR, "digests"))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse();
    for (const file of files) {
      const parsed = parseDigest(readJsonMaybe(safeDataPath("digests", file)));
      if (parsed.ok && parsed.digest) return parsed.digest;
    }
  } catch {
    // no digests dir yet
  }
  return null;
}

function loadData() {
  try {
    let xray: Xray | null = null;
    try {
      const raw = readJsonMaybe(join(DATA_DIR, "xray.json"));
      if (raw) xray = parseXray(raw);
    } catch {
      xray = null;
    }
    return {
      ok: true as const,
      dir: DATA_DIR,
      portfolio: parsePortfolio(readJsonMaybe(join(DATA_DIR, "portfolio.json"))),
      ips: parseIps(readJsonMaybe(join(DATA_DIR, "ips.json"))),
      watchlist: parseWatchlist(readJsonMaybe(join(DATA_DIR, "watchlist.json"))),
      alerts: parseAlerts(readJsonMaybe(join(DATA_DIR, "alerts.json"))),
      xray,
      digest: latestDigest(),
      briefs: listBriefs(),
      ideas: parseIdeas(readJsonMaybe(join(DATA_DIR, "ideas.json"))),
      graph: parseGraph(readJsonMaybe(join(DATA_DIR, "graph.json"))),
      finances: parseFinances(readJsonMaybe(join(DATA_DIR, "finances.json"))),
      goals: parseGoals(readJsonMaybe(join(DATA_DIR, "goals.json"))),
      lifeplan: readJsonMaybe(join(DATA_DIR, "lifeplan.json"))
        ? parseLifePlan(readJsonMaybe(join(DATA_DIR, "lifeplan.json")))
        : null,
      paper: parsePaper(readJsonMaybe(join(DATA_DIR, "paper.json"))),
      plan: parsePlan(readJsonMaybe(join(DATA_DIR, "plan.json"))),
      backtests: listBacktests(),
    };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

// We write data files from two places: the app (edits) and the engine
// scripts/agent. Track our own writes so the file watcher doesn't echo a
// reload back to the UI that just saved (which would clobber in-flight edits).
let lastSelfWrite = 0;
let activeWatcher: FSWatcher | null = null;

function markSelfWrite(): void {
  lastSelfWrite = Date.now();
}

type DocKind = "portfolio" | "ips" | "watchlist" | "alerts" | "paper" | "plan" | "finances" | "goals";

function writeDoc(kind: DocKind, input: unknown): { ok: boolean; error?: string } {
  try {
    let validated: Portfolio | Ips | Watchlist | Alerts | PaperAccount | Plan | Finances | Goals;
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
      case "paper":
        validated = parsePaper(input);
        break;
      case "plan":
        validated = parsePlan(input);
        break;
      case "finances":
        validated = parseFinances(input);
        (validated as Finances).updatedAt = new Date().toISOString();
        break;
      case "goals":
        validated = parseGoals(input);
        break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
    markSelfWrite();
    writeFileAtomic(join(DATA_DIR, `${kind}.json`), `${JSON.stringify(validated, null, 2)}\n`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function watchData(event: IpcMainInvokeEvent): void {
  activeWatcher?.close();
  activeWatcher = null;
  if (!existsSync(DATA_DIR)) return;
  let timer: NodeJS.Timeout | null = null;
  // Watch the directory (recursively — briefs/ and digests/ matter too), not
  // individual files: atomic write-then-rename swaps the inode, which silently
  // kills a file-level watch on macOS (kqueue) and Linux (inotify).
  const watcher = watch(DATA_DIR, { recursive: true }, (_eventType, filename) => {
    // Only react to JSON documents; ignore filing/EDGAR caches and temp files.
    if (filename) {
      const rel = String(filename);
      const name = basename(rel);
      if (!name.endsWith(".json") || name.startsWith(".")) return;
      if (rel.startsWith("filings") || rel.startsWith("cache")) return;
    }
    // Ignore the echo from our own saves.
    if (Date.now() - lastSelfWrite < 1200) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!event.sender.isDestroyed()) event.sender.send("data:changed");
    }, 200);
  });
  activeWatcher = watcher;
}

// Spawn a Node script with arbitrary args, streaming its PHASE/PROGRESS/DONE
// protocol back to the renderer on `${channelPrefix}:*` channels.
function runScript(
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

// ---- Chat (tutor / coach) ----
// One in-flight stream per app; a new send aborts the previous one.
let activeChat: AbortController | null = null;

function coachContext(): CoachContext | null {
  const data = loadData();
  if (!data.ok) return null;
  return { ips: data.ips, portfolio: data.portfolio, xray: data.xray };
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
  input: { mode?: string; messages?: unknown },
): Promise<{ ok: boolean; text?: string; cancelled?: boolean; error?: string }> {
  if (!llmInfo().configured) {
    return { ok: false, error: "No model configured (add an API key in Settings)." };
  }
  const mode: ChatMode = input.mode === "coach" ? "coach" : "tutor";
  const messages = sanitizeMessages(input.messages);
  if (!messages) return { ok: false, error: "invalid chat payload" };

  activeChat?.abort();
  const controller = new AbortController();
  activeChat = controller;
  try {
    const text = await streamChat({
      mode,
      context: mode === "coach" ? coachContext() : null,
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
function recordDecision(input: { trade?: unknown; verdict?: unknown; argument?: unknown }): {
  ok: boolean;
  error?: string;
} {
  try {
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
    appendFileSync(join(DATA_DIR, "decisions.log.jsonl"), `${JSON.stringify(entry)}\n`);
    // Also land it in the idea log so grade-ideas.mjs / the Track record UI
    // can show what happened after. Intentionally NOT markSelfWrite'd — the
    // watcher reload is how the new idea reaches the renderer.
    try {
      const ideas = parseIdeas(readJsonMaybe(join(DATA_DIR, "ideas.json")));
      ideas.ideas.unshift({
        id: `gate-${Date.now().toString(36)}`,
        at: entry.at,
        kind: "gate",
        text: trade,
        verdict,
      });
      ideas.ideas = ideas.ideas.slice(0, 500);
      writeFileAtomic(join(DATA_DIR, "ideas.json"), `${JSON.stringify(parseIdeas(ideas), null, 2)}\n`);
    } catch (err) {
      logger.warn(`could not append gate decision to ideas.json: ${String(err)}`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---- Teller (read-only bank sync) ----
function tellerConfig(): TellerConfig | null {
  const s = readSettings();
  if (!s.tellerAppId) return null;
  return {
    applicationId: s.tellerAppId,
    env: s.tellerEnv,
    certPath: s.tellerCertPath,
    keyPath: s.tellerKeyPath,
  };
}

/**
 * Sync bank accounts into finances.json: balances become cash-asset /
 * credit-card-debt rows (source "bank", replaced wholesale), and ~90 days of
 * transactions feed recurring-fixed-cost suggestions plus the measured
 * monthly spend (the declared-vs-measured honesty number).
 */
async function tellerSync(): Promise<{
  ok: boolean;
  assets?: number;
  debts?: number;
  suggestions?: number;
  error?: string;
}> {
  const cfg = tellerConfig();
  const token = readSettings().tellerAccessToken;
  if (!cfg) return { ok: false, error: "Add your Teller application id in Settings first." };
  if (!token) return { ok: false, error: "No bank linked yet — use Connect bank first." };
  try {
    const accounts = await fetchAccounts(cfg, token);
    const balances = new Map(
      await Promise.all(accounts.map(async (a) => [a.id, await fetchBalance(cfg, token, a.id)] as const)),
    );
    const existing = parseFinances(readJsonMaybe(join(DATA_DIR, "finances.json")));
    const mapped = mapTellerAccounts(accounts, balances, existing);

    // Recurring detection over ~90 days of transactions on all accounts.
    const cutoff = new Date(Date.now() - 90 * 24 * 3600_000).toISOString().slice(0, 10);
    const allTx: Parameters<typeof detectRecurring>[0] = [];
    for (const account of accounts) {
      try {
        const txs = await fetchTransactions(cfg, token, account.id);
        for (const tx of txs) {
          if (tx.date >= cutoff && tx.status !== "pending") allTx.push({ tx, accountType: account.type });
        }
      } catch {
        // transactions are an enhancement; balances already landed
      }
    }
    const { suggestions, measuredMonthlySpend } = detectRecurring(allTx);
    const manualLabels = new Set(mapped.finances.fixedMonthly.map((r) => r.label.toLowerCase()));
    const suggestedRows = suggestions
      .filter((sug) => !manualLabels.has(sug.label.toLowerCase()))
      .slice(0, Math.max(0, 100 - mapped.finances.fixedMonthly.length))
      .map((sug) => ({ label: sug.label.slice(0, 64), amount: sug.amount, source: "bank" as const }));
    const finances = {
      ...mapped.finances,
      fixedMonthly: [
        ...mapped.finances.fixedMonthly.filter((r) => r.source !== "bank"),
        ...suggestedRows,
      ].slice(0, 100),
      measuredMonthlySpend: measuredMonthlySpend > 0 ? measuredMonthlySpend : undefined,
    };

    const write = writeDoc("finances", finances);
    if (!write.ok) return { ok: false, error: write.error };
    return { ok: true, assets: mapped.assets, debts: mapped.debts, suggestions: suggestedRows.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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

  // ---- Data documents ----
  ipcMain.handle("data:load", () => loadData());
  ipcMain.handle("data:watch", (event) => {
    watchData(event);
    return { ok: true };
  });
  ipcMain.handle("portfolio:save", (_event, doc: unknown) => writeDoc("portfolio", doc));
  ipcMain.handle("ips:save", (_event, doc: unknown) => writeDoc("ips", doc));
  ipcMain.handle("watchlist:save", (_event, doc: unknown) => writeDoc("watchlist", doc));
  ipcMain.handle("alerts:save", (_event, doc: unknown) => writeDoc("alerts", doc));
  ipcMain.handle("paper:save", (_event, doc: unknown) => writeDoc("paper", doc));
  ipcMain.handle("plan:save", (_event, doc: unknown) => writeDoc("plan", doc));
  ipcMain.handle("finances:save", (_event, doc: unknown) => writeDoc("finances", doc));
  ipcMain.handle("goals:save", (_event, doc: unknown) => writeDoc("goals", doc));
  ipcMain.handle("backtest:load", (_event, file: string): Backtest | null => {
    try {
      if (basename(file) !== file || !BACKTEST_FILE_RE.test(file)) return null;
      return parseBacktest(readJsonMaybe(safeDataPath("lab", "backtests", file)));
    } catch {
      return null;
    }
  });
  ipcMain.handle("briefs:list", () => listBriefs());
  ipcMain.handle("brief:load", (_event, file: string) => {
    try {
      if (basename(file) !== file || !BRIEF_FILE_RE.test(file)) return null;
      const parsed = parseBrief(readJsonMaybe(safeDataPath("briefs", file)));
      return parsed.ok ? (parsed.brief ?? null) : null;
    } catch {
      return null;
    }
  });

  // ---- Jobs (spawned engine scripts) ----
  ipcMain.handle("brief:start", (event, ticker: string) => {
    const parsed = TickerSchema.safeParse(
      String(ticker ?? "")
        .toUpperCase()
        .trim(),
    );
    if (!parsed.success) return Promise.resolve({ ok: false, error: "invalid ticker" });
    if (!llmInfo().configured) {
      return Promise.resolve({ ok: false, error: "No model configured (add an API key in Settings)." });
    }
    return runScript(BRIEF_SCRIPT, ["--ticker", parsed.data], event, "brief");
  });
  ipcMain.handle("xray:start", (event) => runScript(XRAY_SCRIPT, [], event, "xray"));
  ipcMain.handle("monitor:start", async (event) => {
    // Fetch new filings first; then, when a model is configured, summarize
    // what changed in the diffable ones; finally re-grade the idea log
    // against fresh closes. All report on the "monitor" prefix, and the
    // follow-up steps never fail the run — the filings already landed.
    const fetched = await runScript(MONITOR_SCRIPT, [], event, "monitor");
    if (!fetched.ok) return fetched;
    const notes: string[] = [];
    if (llmInfo().configured) {
      const diffed = await runScript(DIFF_SCRIPT, [], event, "monitor");
      if (!diffed.ok) notes.push(`diff summaries failed: ${diffed.error}`);
      const graphed = await runScript(GRAPH_SCRIPT, [], event, "monitor");
      if (!graphed.ok) notes.push(`graph extraction failed: ${graphed.error}`);
    }
    const graded = await runScript(GRADE_IDEAS_SCRIPT, [], event, "monitor");
    if (!graded.ok) notes.push(`idea grading failed: ${graded.error}`);
    const marked = await runScript(PAPER_MARK_SCRIPT, [], event, "monitor");
    if (!marked.ok) notes.push(`paper marking failed: ${marked.error}`);
    return {
      ok: true,
      output: notes.length > 0 ? `${fetched.output ?? ""} (${notes.join("; ")})` : fetched.output,
    };
  });
  ipcMain.handle("digest:start", (event) => runScript(DIGEST_SCRIPT, [], event, "digest"));
  ipcMain.handle(
    "backtest:start",
    (
      event,
      config: { preset?: string; tickers?: string[]; from?: string; to?: string; costBps?: number },
    ) => {
      const parsed = BacktestConfigSchema.safeParse({
        preset: config?.preset,
        tickers: (config?.tickers ?? []).map((t) => String(t).toUpperCase().trim()),
        from: config?.from,
        to: config?.to || undefined,
        costBps: config?.costBps,
      });
      if (!parsed.success) return Promise.resolve({ ok: false, error: "invalid backtest config" });
      const args = [
        "--preset",
        parsed.data.preset,
        "--tickers",
        parsed.data.tickers.join(","),
        "--from",
        parsed.data.from,
        "--costBps",
        String(parsed.data.costBps),
      ];
      if (parsed.data.to) args.push("--to", parsed.data.to);
      return runScript(BACKTEST_SCRIPT, args, event, "backtest");
    },
  );
  ipcMain.handle("paper:mark", (event) => runScript(PAPER_MARK_SCRIPT, [], event, "paper"));
  ipcMain.handle("lifeplan:start", (event) => runScript(LIFEPLAN_SCRIPT, [], event, "lifeplan"));

  // ---- Teller (read-only bank sync) ----
  ipcMain.handle("teller:link", async () => {
    const cfg = tellerConfig();
    if (!cfg) return { ok: false, error: "Add your Teller application id in Settings first." };
    try {
      const result = await openConnectWindow(cfg, mainWindow);
      if (!result.ok || !result.accessToken) {
        return result.cancelled ? { ok: false, cancelled: true } : { ok: false, error: result.error };
      }
      writeSettings({ tellerAccessToken: result.accessToken });
      // First sync immediately so the connect button visibly does something.
      return await tellerSync();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle("teller:sync", () => tellerSync());
  ipcMain.handle("teller:unlink", () => {
    // Teller enrollments are revoked from the bank's side / Teller dashboard;
    // locally we drop the token so Basis can no longer read anything.
    writeSettings({ tellerAccessToken: undefined });
    return { ok: true };
  });

  // ---- Chat + friction gate ----
  ipcMain.handle("chat:send", (event, input: { mode?: string; messages?: unknown }) =>
    handleChatSend(event, input),
  );
  ipcMain.handle("chat:cancel", () => {
    activeChat?.abort();
    activeChat = null;
    return { ok: true };
  });
  ipcMain.handle("gate:evaluate", async (_event, trade: string) => {
    if (!llmInfo().configured) {
      return { ok: false, error: "No model configured (add an API key in Settings)." };
    }
    const text = String(trade ?? "").slice(0, 1000);
    if (!text.trim()) return { ok: false, error: "describe the trade first" };
    const ctx = coachContext();
    if (!ctx) return { ok: false, error: "could not read your data folder" };
    return evaluateGate(text, ctx);
  });
  ipcMain.handle("gate:record", (_event, input: Record<string, unknown>) => recordDecision(input));

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
  ipcMain.handle("home:get", () => DATA_DIR);
  ipcMain.handle("home:reveal", () => shell.openPath(DATA_DIR));
  ipcMain.handle("home:pick", async () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: "Choose where Basis stores your data",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: APP_HOME,
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return { ok: true, canceled: true };
    // Store the chosen folder as the Basis home (takes effect on restart —
    // DATA_DIR is resolved once at startup).
    writeSettings({ homeDir: result.filePaths[0] });
    return { ok: true, homeDir: result.filePaths[0] };
  });
  ipcMain.handle("shell:reveal", (_event, filePath: string) => {
    // Only reveal paths inside the app's own storage roots — never an arbitrary
    // renderer-supplied path.
    const target = normalize(filePath);
    const roots = [DATA_DIR, APP_HOME].map(normalize);
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
  activeWatcher?.close();
  activeWatcher = null;
});
