/**
 * Headless world-build runner (closeout C5, plan §9).
 *
 * Registered as a Headless JS task so the foreground service can drive a
 * build with NO activity attached. The task only receives the runId - never
 * the novel, keys or results - and funnels everything through the same
 * run/lease coordinator the UI uses, so there is exactly one executor per
 * run no matter how many entry points wake up.
 */
import { loadApiProfile } from './profileStore';
import { runExtraction } from './sourceImport';
import { notifyBuildProgress } from './buildServiceBridge';

export async function worldBuildRunner(data: { runId?: string }): Promise<void> {
  const runId = typeof data?.runId === 'string' ? data.runId : null;
  if (!runId) return;
  const profile = await loadApiProfile();
  if (!profile) {
    // Credentials unavailable headless (lockscreen / cleared profile): the
    // run stays resumable; the UI surfaces the waiting state.
    return;
  }
  try {
    await runExtraction(runId, profile, progress => {
      if (progress.chunksTotal && progress.chunksDone !== undefined) {
        notifyBuildProgress(runId, progress.chunksDone, progress.chunksTotal).catch(() => undefined);
      }
    });
  } catch {
    // Unit-level failures are already classified and persisted by the
    // coordinator; the task must not crash the headless context.
  }
}
