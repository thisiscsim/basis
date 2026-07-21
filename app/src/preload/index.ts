import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Alerts, Brief, Digest, Ips, Portfolio, Watchlist, Xray } from "@basis/schema";

/**
 * The full settings shape as written to disk. The API-key field is write-only
 * from the renderer's perspective: it can be SET via `setSettings`, but is
 * never returned by `getSettings` (see `PublicSettings`).
 */
export interface AppSettings {
  homeDir?: string;
  agentModel: string;
  agentApiKey?: string;
  reasoningEffort: "low" | "medium" | "high";
  edgarContact?: string;
}

/**
 * What the renderer actually receives: everything except the raw key value,
 * plus a boolean for whether a key is set. The UI only ever needs "is a key
 * configured", never the secret itself, so the plaintext key never crosses IPC.
 */
export type PublicSettings = Omit<AppSettings, "agentApiKey"> & {
  hasAgentKey: boolean;
};

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export interface JobResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface BriefSummary {
  file: string;
  ticker: string;
  company?: string;
  generatedAt?: string;
}

export interface LoadDataResult {
  ok: boolean;
  error?: string;
  dir?: string;
  portfolio?: Portfolio;
  ips?: Ips;
  watchlist?: Watchlist;
  alerts?: Alerts;
  xray?: Xray | null;
  digest?: Digest | null;
  briefs?: BriefSummary[];
}

export interface LlmInfo {
  provider: string;
  model: string;
  configured: boolean;
  modelLocked: boolean;
  keyLocked: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  ok: boolean;
  text?: string;
  cancelled?: boolean;
  error?: string;
}

export type GateVerdict = "consistent" | "inconsistent" | "unclear";

export interface GateResult {
  ok: boolean;
  verdict?: GateVerdict;
  argument?: string;
  error?: string;
}

/**
 * The safe bridge between the sandboxed renderer and the Node-capable main
 * process. Privileged operations (read the data folder, spawn engine scripts,
 * stream chat) are exposed here. Single-player: one data folder, no ids.
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke("ping"),

  // Data documents
  loadData: (): Promise<LoadDataResult> => ipcRenderer.invoke("data:load"),
  watchData: (): Promise<SaveResult> => ipcRenderer.invoke("data:watch"),
  savePortfolio: (doc: Portfolio): Promise<SaveResult> => ipcRenderer.invoke("portfolio:save", doc),
  saveIps: (doc: Ips): Promise<SaveResult> => ipcRenderer.invoke("ips:save", doc),
  saveWatchlist: (doc: Watchlist): Promise<SaveResult> => ipcRenderer.invoke("watchlist:save", doc),
  saveAlerts: (doc: Alerts): Promise<SaveResult> => ipcRenderer.invoke("alerts:save", doc),
  listBriefs: (): Promise<BriefSummary[]> => ipcRenderer.invoke("briefs:list"),
  loadBrief: (file: string): Promise<Brief | null> => ipcRenderer.invoke("brief:load", file),

  // Jobs (engine scripts on the PHASE/PROGRESS protocol)
  startBrief: (ticker: string): Promise<JobResult> => ipcRenderer.invoke("brief:start", ticker),
  startXray: (): Promise<JobResult> => ipcRenderer.invoke("xray:start"),
  startMonitor: (): Promise<JobResult> => ipcRenderer.invoke("monitor:start"),
  startDigest: (): Promise<JobResult> => ipcRenderer.invoke("digest:start"),

  // Chat + friction gate
  sendChat: (input: { mode: "tutor" | "coach"; messages: ChatMessage[] }): Promise<ChatResult> =>
    ipcRenderer.invoke("chat:send", input),
  cancelChat: (): Promise<SaveResult> => ipcRenderer.invoke("chat:cancel"),
  evaluateGate: (trade: string): Promise<GateResult> => ipcRenderer.invoke("gate:evaluate", trade),
  recordDecision: (input: {
    trade: string;
    verdict: "proceeded" | "cancelled";
    argument?: string;
  }): Promise<SaveResult> => ipcRenderer.invoke("gate:record", input),

  // Settings / app plumbing
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<AppSettings>): Promise<PublicSettings> =>
    ipcRenderer.invoke("settings:set", patch),
  llmInfo: (): Promise<LlmInfo> => ipcRenderer.invoke("llm:info"),
  getDataDir: (): Promise<string> => ipcRenderer.invoke("home:get"),
  revealDataDir: (): Promise<string> => ipcRenderer.invoke("home:reveal"),
  pickDataDir: (): Promise<{ ok: boolean; homeDir?: string; canceled?: boolean }> =>
    ipcRenderer.invoke("home:pick"),
  revealItem: (filePath: string): Promise<void> => ipcRenderer.invoke("shell:reveal", filePath),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  getAppInfo: (): Promise<{
    version: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
    logsDir: string;
  }> => ipcRenderer.invoke("app:info"),
  logRenderer: (level: "info" | "warn" | "error", message: string): Promise<void> =>
    ipcRenderer.invoke("log:renderer", level, message),

  // Push subscriptions (all return an unsubscribe function)
  onDataChanged: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("data:changed", listener);
    return () => ipcRenderer.removeListener("data:changed", listener);
  },
  onChatDelta: (cb: (delta: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, delta: string) => cb(delta);
    ipcRenderer.on("chat:delta", listener);
    return () => ipcRenderer.removeListener("chat:delta", listener);
  },
  onChatDone: (cb: (text: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on("chat:done", listener);
    return () => ipcRenderer.removeListener("chat:done", listener);
  },
  onChatError: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, message: string) => cb(message);
    ipcRenderer.on("chat:error", listener);
    return () => ipcRenderer.removeListener("chat:error", listener);
  },
  // Generic streamed-progress subscriptions for any script channel prefix
  // (e.g. "brief", "xray", "monitor", "digest"). Mirrors the script
  // PHASE/PROGRESS protocol the main process parses.
  onProgress: (prefix: string, cb: (pct: number) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, pct: number) => cb(pct);
    ipcRenderer.on(`${prefix}:progress`, listener);
    return () => ipcRenderer.removeListener(`${prefix}:progress`, listener);
  },
  onPhase: (prefix: string, cb: (phase: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, phase: string) => cb(phase);
    ipcRenderer.on(`${prefix}:phase`, listener);
    return () => ipcRenderer.removeListener(`${prefix}:phase`, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type BasisApi = typeof api;
