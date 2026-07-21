import { create } from "zustand";
import type { Alerts, Brief, Digest, Ips, Meta, Portfolio, Watchlist, Xray } from "@basis/schema";
import type { BriefSummary, ChatMessage, WorkspaceSummary } from "../../preload";

export type WorkspaceTab = "digest" | "research" | "coach";
export type Theme = "dark" | "light";
export type View = "home" | "workspace";

const THEME_KEY = "basis:theme";
const LAYOUT_KEY = "basis:panel-layout";

export type PanelId = "left";
/** Resize clamps: [min, max] px. */
export const PANEL_LIMITS: Record<PanelId, [number, number]> = {
  left: [220, 440],
};
const PANEL_DEFAULTS: Record<PanelId, number> = { left: 300 };

function initialPanelSizes(): Record<PanelId, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Partial<Record<PanelId, number>>;
    const out = { ...PANEL_DEFAULTS };
    for (const id of ["left"] as PanelId[]) {
      const v = saved[id];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[id] = Math.min(Math.max(v, PANEL_LIMITS[id][0]), PANEL_LIMITS[id][1]);
      }
    }
    return out;
  } catch {
    return { ...PANEL_DEFAULTS };
  }
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage unavailable; fall through to system preference
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function applyTheme(theme: Theme, persist = true): void {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
  if (!persist) return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // persistence is best-effort
  }
}

// Animate theme switches with the View Transitions API (Chromium): the browser
// snapshots the old frame and cross-fades to the new one, so every surface
// changes in one coherent sweep. Falls back to an instant switch (e.g. jsdom).
function withViewTransition(mutate: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === "function") doc.startViewTransition(mutate);
  else mutate();
}

/** The documents of one loaded workspace, as read from disk. */
export interface WorkspaceData {
  slug: string;
  dir: string | null;
  meta: Meta | null;
  portfolio: Portfolio;
  ips: Ips;
  watchlist: Watchlist;
  alerts: Alerts;
  xray: Xray | null;
  digest: Digest | null;
  briefs: BriefSummary[];
}

export interface ChatEntry extends ChatMessage {
  /** True while this assistant message is still streaming in. */
  pending?: boolean;
}

export interface Notice {
  id: number;
  kind: "error" | "info";
  text: string;
}
let noticeSeq = 0;

export type JobId = "brief" | "xray" | "monitor" | "digest";

export interface JobState {
  running: boolean;
  phase: string;
  progress: number;
}

const idleJob = (): JobState => ({ running: false, phase: "", progress: 0 });

interface AppState {
  view: View;
  workspaces: WorkspaceSummary[];
  ws: WorkspaceData | null;
  slug: string | null;
  loadError: string | null;
  tab: WorkspaceTab;

  theme: Theme;
  panelSizes: Record<PanelId, number>;

  /** Long-running engine-script jobs, keyed by channel prefix. */
  jobs: Record<JobId, JobState>;

  /** Coach/tutor chat (session-scoped; the gate log is what persists). */
  chat: ChatEntry[];
  chatStreaming: boolean;

  /** Research surface selection (brief filename). */
  openBriefFile: string | null;
  openBrief: Brief | null;

  notices: Notice[];
  reloadWorkspace: () => void | Promise<void>;

  setView: (view: View) => void;
  setWorkspaces: (list: WorkspaceSummary[]) => void;
  openWorkspace: (slug: string) => void;
  goHome: () => void;
  setWorkspaceData: (data: WorkspaceData) => void;
  setLoadError: (msg: string | null) => void;
  setTab: (tab: WorkspaceTab) => void;

  /** Persist one document, refreshing local state optimistically. */
  savePortfolio: (doc: Portfolio) => Promise<void>;
  saveIps: (doc: Ips) => Promise<void>;
  saveWatchlist: (doc: Watchlist) => Promise<void>;
  saveAlerts: (doc: Alerts) => Promise<void>;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setPanelSize: (panel: PanelId, px: number, persist?: boolean) => void;

  startJob: (job: JobId) => void;
  setJobPhase: (job: JobId, phase: string) => void;
  setJobProgress: (job: JobId, pct: number) => void;
  finishJob: (job: JobId) => void;

  appendChat: (entry: ChatEntry) => void;
  appendChatDelta: (delta: string) => void;
  finishChatMessage: (text: string) => void;
  setChatStreaming: (v: boolean) => void;
  clearChat: () => void;

  setOpenBrief: (file: string | null, brief: Brief | null) => void;

  /** Enqueue a toast; returns its id. Errors persist until dismissed, info auto-dismisses. */
  pushNotice: (kind: "error" | "info", text: string) => number;
  dismissNotice: (id: number) => void;
  setReload: (fn: () => void | Promise<void>) => void;
}

async function persistDoc(
  slug: string,
  save: () => Promise<{ ok: boolean; error?: string } | undefined>,
  label: string,
): Promise<void> {
  let res: { ok: boolean; error?: string } | undefined;
  try {
    res = await save();
  } catch (err) {
    res = { ok: false, error: String(err) };
  }
  if (res && res.ok === false) {
    useApp.getState().pushNotice("error", `Couldn't save ${label}: ${res.error ?? "unknown error"}`);
  }
}

export const useApp = create<AppState>()((set, get) => ({
  view: "home",
  workspaces: [],
  ws: null,
  slug: null,
  loadError: null,
  tab: "digest",

  theme: initialTheme(),
  panelSizes: initialPanelSizes(),

  jobs: { brief: idleJob(), xray: idleJob(), monitor: idleJob(), digest: idleJob() },

  chat: [],
  chatStreaming: false,

  openBriefFile: null,
  openBrief: null,

  notices: [],
  reloadWorkspace: () => {},

  setView: (view) => set({ view }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  openWorkspace: (slug) =>
    set({
      slug,
      view: "workspace",
      ws: null,
      loadError: null,
      tab: "digest",
      chat: [],
      chatStreaming: false,
      openBriefFile: null,
      openBrief: null,
      notices: [],
    }),
  goHome: () => set({ view: "home", slug: null, ws: null, chat: [], chatStreaming: false }),
  setWorkspaceData: (data) => set({ ws: data, loadError: null }),
  setLoadError: (msg) => set({ loadError: msg }),
  setTab: (tab) => set({ tab }),

  savePortfolio: async (doc) => {
    const { slug, ws } = get();
    if (!slug || !ws) return;
    set({ ws: { ...ws, portfolio: doc } });
    await persistDoc(slug, () => window.api?.savePortfolio(slug, doc), "portfolio");
  },
  saveIps: async (doc) => {
    const { slug, ws } = get();
    if (!slug || !ws) return;
    set({ ws: { ...ws, ips: doc } });
    await persistDoc(slug, () => window.api?.saveIps(slug, doc), "IPS");
  },
  saveWatchlist: async (doc) => {
    const { slug, ws } = get();
    if (!slug || !ws) return;
    set({ ws: { ...ws, watchlist: doc } });
    await persistDoc(slug, () => window.api?.saveWatchlist(slug, doc), "watchlist");
  },
  saveAlerts: async (doc) => {
    const { slug, ws } = get();
    if (!slug || !ws) return;
    set({ ws: { ...ws, alerts: doc } });
    await persistDoc(slug, () => window.api?.saveAlerts(slug, doc), "alerts");
  },

  setTheme: (theme) => {
    withViewTransition(() => {
      applyTheme(theme);
      set({ theme });
    });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  setPanelSize: (panel, px, persist = true) => {
    const [min, max] = PANEL_LIMITS[panel];
    const next = { ...get().panelSizes, [panel]: Math.round(Math.min(Math.max(px, min), max)) };
    set({ panelSizes: next });
    // During a drag the resizer passes persist=false and writes once on
    // release, so we don't hit localStorage on every animation frame.
    if (!persist) return;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // persistence is best-effort
    }
  },

  startJob: (job) =>
    set((s) => ({ jobs: { ...s.jobs, [job]: { running: true, phase: "starting", progress: 0 } } })),
  setJobPhase: (job, phase) => set((s) => ({ jobs: { ...s.jobs, [job]: { ...s.jobs[job], phase } } })),
  setJobProgress: (job, progress) =>
    set((s) => ({ jobs: { ...s.jobs, [job]: { ...s.jobs[job], progress } } })),
  finishJob: (job) => set((s) => ({ jobs: { ...s.jobs, [job]: idleJob() } })),

  appendChat: (entry) => set((s) => ({ chat: [...s.chat, entry] })),
  appendChatDelta: (delta) =>
    set((s) => {
      const last = s.chat[s.chat.length - 1];
      if (!last || last.role !== "assistant" || !last.pending) {
        return { chat: [...s.chat, { role: "assistant", content: delta, pending: true }] };
      }
      const next = [...s.chat];
      next[next.length - 1] = { ...last, content: last.content + delta };
      return { chat: next };
    }),
  finishChatMessage: (text) =>
    set((s) => {
      const next = [...s.chat];
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.pending) {
        next[next.length - 1] = { role: "assistant", content: text };
      } else {
        next.push({ role: "assistant", content: text });
      }
      return { chat: next, chatStreaming: false };
    }),
  setChatStreaming: (v) => set({ chatStreaming: v }),
  clearChat: () => set({ chat: [], chatStreaming: false }),

  setOpenBrief: (file, brief) => set({ openBriefFile: file, openBrief: brief }),

  pushNotice: (kind, text) => {
    const id = ++noticeSeq;
    // Cap the queue so a runaway error loop can't grow it without bound.
    set((s) => ({ notices: [...s.notices, { id, kind, text }].slice(-5) }));
    return id;
  },
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  setReload: (fn) => set({ reloadWorkspace: fn }),
}));

// Apply the persisted/system theme to <html> before the first paint. Don't
// persist here, so a system-derived default keeps following the OS until the
// user makes an explicit choice via the toggle.
applyTheme(useApp.getState().theme, false);
