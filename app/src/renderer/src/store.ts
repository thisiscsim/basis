import { create } from "zustand";
import type {
  Alerts,
  Brief,
  Digest,
  Finances,
  Goals,
  Graph,
  Ideas,
  Ips,
  LifePlan,
  PaperAccount,
  Plan,
  Playbook,
  Portfolio,
  Watchlist,
  Xray,
} from "@basis/schema";
import type { BacktestSummary, BriefSummary, ChatMessage } from "../../preload";

export type AppTab = "digest" | "research" | "coach" | "lab" | "plan";
export type Theme = "dark" | "light";

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

/** The user's documents, as read from the single data folder. */
export interface AppData {
  dir: string | null;
  portfolio: Portfolio;
  ips: Ips;
  watchlist: Watchlist;
  alerts: Alerts;
  xray: Xray | null;
  digest: Digest | null;
  briefs: BriefSummary[];
  ideas: Ideas;
  graph: Graph;
  finances: Finances;
  goals: Goals;
  playbooks: Playbook[];
  lifeplan: LifePlan | null;
  paper: PaperAccount;
  plan: Plan;
  backtests: BacktestSummary[];
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

export type JobId = "brief" | "xray" | "monitor" | "digest" | "backtest" | "paper" | "lifeplan" | "playbook";

export interface JobState {
  running: boolean;
  phase: string;
  progress: number;
}

const idleJob = (): JobState => ({ running: false, phase: "", progress: 0 });

interface AppState {
  data: AppData | null;
  loadError: string | null;
  tab: AppTab;

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
  reloadData: () => void | Promise<void>;

  setData: (data: AppData) => void;
  setLoadError: (msg: string | null) => void;
  setTab: (tab: AppTab) => void;

  /** Persist one document, refreshing local state optimistically. */
  savePortfolio: (doc: Portfolio) => Promise<void>;
  saveIps: (doc: Ips) => Promise<void>;
  saveWatchlist: (doc: Watchlist) => Promise<void>;
  saveAlerts: (doc: Alerts) => Promise<void>;
  savePaper: (doc: PaperAccount) => Promise<void>;
  savePlan: (doc: Plan) => Promise<void>;
  saveFinances: (doc: Finances) => Promise<void>;
  saveGoals: (doc: Goals) => Promise<void>;

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
  data: null,
  loadError: null,
  tab: "digest",

  theme: initialTheme(),
  panelSizes: initialPanelSizes(),

  jobs: {
    brief: idleJob(),
    xray: idleJob(),
    monitor: idleJob(),
    digest: idleJob(),
    backtest: idleJob(),
    paper: idleJob(),
    lifeplan: idleJob(),
    playbook: idleJob(),
  },

  chat: [],
  chatStreaming: false,

  openBriefFile: null,
  openBrief: null,

  notices: [],
  reloadData: () => {},

  setData: (data) => set({ data, loadError: null }),
  setLoadError: (msg) => set({ loadError: msg }),
  setTab: (tab) => set({ tab }),

  savePortfolio: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, portfolio: doc } });
    await persistDoc(() => window.api?.savePortfolio(doc), "portfolio");
  },
  saveIps: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, ips: doc } });
    await persistDoc(() => window.api?.saveIps(doc), "IPS");
  },
  saveWatchlist: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, watchlist: doc } });
    await persistDoc(() => window.api?.saveWatchlist(doc), "watchlist");
  },
  saveAlerts: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, alerts: doc } });
    await persistDoc(() => window.api?.saveAlerts(doc), "alerts");
  },
  savePaper: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, paper: doc } });
    await persistDoc(() => window.api?.savePaper(doc), "paper account");
  },
  savePlan: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, plan: doc } });
    await persistDoc(() => window.api?.savePlan(doc), "plan");
  },
  saveFinances: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, finances: doc } });
    await persistDoc(() => window.api?.saveFinances(doc), "finances");
  },
  saveGoals: async (doc) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, goals: doc } });
    await persistDoc(() => window.api?.saveGoals(doc), "goals");
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
  setReload: (fn) => set({ reloadData: fn }),
}));

// Apply the persisted/system theme to <html> before the first paint. Don't
// persist here, so a system-derived default keeps following the OS until the
// user makes an explicit choice via the toggle.
applyTheme(useApp.getState().theme, false);
