import type { JobResult } from "../../../preload";
import { useApp, type JobId } from "../store";

/**
 * Run one engine-script job: flips the store's job state, mirrors the
 * script's PHASE/PROGRESS stream while it runs, reloads the workspace on
 * success (scripts write workspace files), and surfaces the outcome as a
 * notice. Concurrent duplicate runs are ignored.
 */
export async function runJob(job: JobId, invoke: () => Promise<JobResult>): Promise<boolean> {
  const state = useApp.getState();
  if (state.jobs[job].running) return false;
  state.startJob(job);
  const offPhase = window.api?.onPhase(job, (phase) => useApp.getState().setJobPhase(job, phase));
  const offProgress = window.api?.onProgress(job, (pct) => useApp.getState().setJobProgress(job, pct));
  try {
    const res = await invoke();
    const s = useApp.getState();
    if (res.ok) {
      await s.reloadWorkspace();
      if (res.output) s.pushNotice("info", res.output);
      return true;
    }
    s.pushNotice("error", res.error ?? "The job failed.");
    return false;
  } catch (err) {
    useApp.getState().pushNotice("error", String(err));
    return false;
  } finally {
    offPhase?.();
    offProgress?.();
    useApp.getState().finishJob(job);
  }
}
