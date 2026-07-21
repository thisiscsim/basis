import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApp, type AppData } from "./store";

function seedData(): AppData {
  return {
    dir: "/tmp/basis",
    portfolio: { version: 1, currency: "USD", holdings: [] },
    ips: { version: 1, goals: "", targetAllocation: [], rules: [] },
    watchlist: { version: 1, entries: [] },
    alerts: { version: 1, alerts: [] },
    xray: null,
    digest: null,
    briefs: [],
    ideas: { version: 1, ideas: [] },
    graph: { version: 1, edges: [] },
    paper: { version: 1, startCash: 100_000, cash: 100_000, positions: [], orders: [], equity: [] },
    plan: { version: 1, rebalanceBandPct: 5 },
    backtests: [],
  };
}

beforeEach(() => {
  useApp.setState({
    data: null,
    loadError: null,
    tab: "digest",
    chat: [],
    chatStreaming: false,
    notices: [],
    jobs: {
      brief: { running: false, phase: "", progress: 0 },
      xray: { running: false, phase: "", progress: 0 },
      monitor: { running: false, phase: "", progress: 0 },
      digest: { running: false, phase: "", progress: 0 },
      backtest: { running: false, phase: "", progress: 0 },
      paper: { running: false, phase: "", progress: 0 },
    },
  });
});

describe("document saves", () => {
  it("savePortfolio updates state optimistically and persists via the bridge", async () => {
    useApp.getState().setData(seedData());
    const doc = {
      version: 1 as const,
      currency: "USD",
      holdings: [{ ticker: "AAPL", source: "manual" as const }],
    };
    await useApp.getState().savePortfolio(doc);
    expect(useApp.getState().data?.portfolio.holdings).toHaveLength(1);
    expect(window.api.savePortfolio).toHaveBeenCalledWith(doc);
  });

  it("a failed save surfaces an error notice", async () => {
    useApp.getState().setData(seedData());
    vi.mocked(window.api.saveIps).mockResolvedValueOnce({ ok: false, error: "disk full" });
    await useApp.getState().saveIps({ version: 1, goals: "", targetAllocation: [], rules: [] });
    const notices = useApp.getState().notices;
    expect(notices.some((n) => n.kind === "error" && n.text.includes("disk full"))).toBe(true);
  });

  it("saves are no-ops before the data folder is loaded", async () => {
    vi.mocked(window.api.saveWatchlist).mockClear();
    await useApp.getState().saveWatchlist({ version: 1, entries: [] });
    expect(window.api.saveWatchlist).not.toHaveBeenCalled();
  });
});

describe("chat streaming", () => {
  it("appendChatDelta starts and grows a pending assistant message", () => {
    const s = useApp.getState();
    s.appendChat({ role: "user", content: "hello" });
    s.appendChatDelta("Hi ");
    s.appendChatDelta("there");
    const chat = useApp.getState().chat;
    expect(chat).toHaveLength(2);
    expect(chat[1]).toMatchObject({ role: "assistant", content: "Hi there", pending: true });
  });

  it("finishChatMessage replaces the pending message with the final text", () => {
    const s = useApp.getState();
    s.appendChatDelta("partial");
    s.setChatStreaming(true);
    useApp.getState().finishChatMessage("final answer");
    const state = useApp.getState();
    expect(state.chat[state.chat.length - 1]).toEqual({ role: "assistant", content: "final answer" });
    expect(state.chatStreaming).toBe(false);
  });
});

describe("notices", () => {
  it("caps the queue at 5 so an error loop can't grow it unbounded", () => {
    for (let i = 0; i < 8; i++) useApp.getState().pushNotice("info", `n${i}`);
    const notices = useApp.getState().notices;
    expect(notices).toHaveLength(5);
    expect(notices[0].text).toBe("n3");
  });
});

describe("jobs", () => {
  it("tracks phase/progress and resets on finish", () => {
    const s = useApp.getState();
    s.startJob("monitor");
    s.setJobPhase("monitor", "checking AAPL");
    s.setJobProgress("monitor", 40);
    expect(useApp.getState().jobs.monitor).toEqual({ running: true, phase: "checking AAPL", progress: 40 });
    useApp.getState().finishJob("monitor");
    expect(useApp.getState().jobs.monitor.running).toBe(false);
  });
});
