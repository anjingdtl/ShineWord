/**
 * Headless world-build runner (closeout C5, plan §9; unified P1/P4).
 *
 * Registered as a Headless JS task so the foreground service can drive a
 * build with NO activity attached. The task only receives the runId - never
 * the novel, keys or results - and funnels everything through the same
 * run/lease coordinator the UI uses, so there is exactly one executor per
 * run no matter how many entry points wake up.
 *
 * Unified-build runs carry a FROZEN config on the run row: the live profile
 * is only a legacy fallback. A locked Keychain resolves to waiting_unlock,
 * never to a key copy into task state.
 */
import { loadApiProfile } from './profileStore';
import { runExtraction } from './sourceImport';
import { notifyBuildProgress } from './buildServiceBridge';
import { getDatabaseRuntime } from './database';
import { SqliteBuildRunStore } from '../../src/infra/sqlite/sqliteBuildRunStore';
import { reviveRunConfig } from '../../src/application/worldBuild/runConfig';

export async function worldBuildRunner(data: { runId?: string }): Promise<void> {
  const runId = typeof data?.runId === 'string' ? data.runId : null;
  if (!runId) return;
  try {
    const runtime = await getDatabaseRuntime();
    const run = await new SqliteBuildRunStore(runtime.db).getRun(runId);
    const frozen = reviveRunConfig(run?.configJson ?? null);
    const profile = frozen ? null : await loadApiProfile();
    if (!frozen && !profile) {
      // Legacy run without a frozen config and no live credentials
      // (lockscreen / cleared profile): stays resumable; the UI surfaces it.
      return;
    }
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
