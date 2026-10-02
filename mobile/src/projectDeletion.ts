/**
 * Mobile bridge for safe project deletion (task §23-§31).
 *
 * "Stop and delete" never rips SQLite out from under a live executor: the
 * persisted cancel flag (and the in-process signal, when the executor lives in
 * this process) asks the coordinator to stop claiming further units; the
 * in-flight paid request is allowed to finish and commit; only when every
 * active run has reached a safe status (or its lease expired without renewal)
 * does the transactional deletion service run.
 */
import { getDatabaseRuntime } from './database';
import { cancelQueuedWorldRequests } from './llmScheduler';
import { cancelRun } from './sourceImport';
import {
  deleteProject,
  findBlockingRuns,
  ProjectDeletionBlockedError,
  type ProjectDeletionResult,
} from '../../src/application/project/projectDeletion';

const ACTIVE_RUN_SQL = `
  SELECT run_id FROM world_build_runs
   WHERE world_id = ?
     AND (status IN ('queued', 'running', 'waiting_network', 'waiting_unlock', 'waiting_system')
          OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > ?))`;

/** How long "stop and delete" waits for executors to reach a safe state. */
export const STOP_AND_DELETE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

export { ProjectDeletionBlockedError };

export async function findActiveProjectRuns(worldId: string): Promise<string[]> {
  const runtime = await getDatabaseRuntime();
  return findBlockingRuns(runtime.db, worldId, new Date().toISOString());
}

/** Direct deletion; throws ProjectDeletionBlockedError while a build runs. */
export async function deleteProjectNow(worldId: string): Promise<ProjectDeletionResult> {
  const runtime = await getDatabaseRuntime();
  const result = await deleteProject({ db: runtime.db }, { worldId });
  if (result.foreignKeyViolations > 0) {
    throw new Error(`项目删除后外键检查仍有 ${result.foreignKeyViolations} 条违规，请反馈此问题。`);
  }
  return result;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => resolve(), ms);
  });
}

/**
 * Safe stop-then-delete: asks every active run to stop, waits (bounded) for
 * the executors to honor it, then deletes. Refuses to force-delete when the
 * wait times out - the LLM request in flight must never lose its database.
 */
export async function stopAndDeleteProject(worldId: string): Promise<ProjectDeletionResult> {
  const runtime = await getDatabaseRuntime();
  if (runtime.segments && await runtime.segmentPlans.getPlan(worldId)) await runtime.segments.setPause(worldId, 'user');
  cancelQueuedWorldRequests(worldId);
  const active = await findActiveProjectRuns(worldId);
  if (active.length === 0) {
    return deleteProjectNow(worldId);
  }
  for (const runId of active) {
    await cancelRun(runId);
  }
  const deadline = Date.now() + STOP_AND_DELETE_TIMEOUT_MS;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    const remaining = await findActiveProjectRuns(worldId);
    if (remaining.length === 0) break;
    if (Date.now() >= deadline) {
      throw new Error('构建尚未安全停止，请稍后重试删除。');
    }
  }
  return deleteProjectNow(worldId);
}
