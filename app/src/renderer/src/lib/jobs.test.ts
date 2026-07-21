import { beforeEach, describe, expect, it, vi } from "vitest";
import { runJob } from "./jobs";
import { useApp } from "../store";

beforeEach(() => {
  useApp.setState({
    notices: [],
    reloadWorkspace: vi.fn(),
    jobs: {
      brief: { running: false, phase: "", progress: 0 },
      xray: { running: false, phase: "", progress: 0 },
      monitor: { running: false, phase: "", progress: 0 },
      digest: { running: false, phase: "", progress: 0 },
    },
  });
});

describe("runJob", () => {
  it("flips job state, reloads the workspace on success, and surfaces the output", async () => {
    const reload = vi.fn();
    useApp.setState({ reloadWorkspace: reload });
    let midRun = { running: false };
    const ok = await runJob("monitor", async () => {
      midRun = useApp.getState().jobs.monitor;
      return { ok: true, output: "3 new filings" };
    });
    expect(ok).toBe(true);
    expect(midRun.running).toBe(true);
    expect(reload).toHaveBeenCalled();
    expect(useApp.getState().jobs.monitor.running).toBe(false);
    expect(useApp.getState().notices.some((n) => n.text === "3 new filings")).toBe(true);
  });

  it("surfaces failures as error notices and still resets job state", async () => {
    const ok = await runJob("brief", async () => ({ ok: false, error: "EDGAR 503" }));
    expect(ok).toBe(false);
    const s = useApp.getState();
    expect(s.jobs.brief.running).toBe(false);
    expect(s.notices.some((n) => n.kind === "error" && n.text.includes("EDGAR 503"))).toBe(true);
  });

  it("ignores a duplicate run while the job is already in flight", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    useApp.getState().startJob("xray");
    const ok = await runJob("xray", invoke);
    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("mirrors PHASE/PROGRESS pushes into the store while running", async () => {
    let phaseCb: ((p: string) => void) | undefined;
    let progressCb: ((p: number) => void) | undefined;
    vi.mocked(window.api.onPhase).mockImplementation((_prefix: string, cb: (p: string) => void) => {
      phaseCb = cb;
      return () => {};
    });
    vi.mocked(window.api.onProgress).mockImplementation((_prefix: string, cb: (p: number) => void) => {
      progressCb = cb;
      return () => {};
    });
    const seen: { phase: string; progress: number }[] = [];
    await runJob("digest", async () => {
      phaseCb?.("composing digest");
      progressCb?.(60);
      const j = useApp.getState().jobs.digest;
      seen.push({ phase: j.phase, progress: j.progress });
      return { ok: true };
    });
    expect(seen[0]).toEqual({ phase: "composing digest", progress: 60 });
    vi.mocked(window.api.onPhase).mockReset();
    vi.mocked(window.api.onProgress).mockReset();
  });
});
