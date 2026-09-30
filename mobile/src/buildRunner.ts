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
 *
 * P0-2: the outer catch is NOT silent anymore. A bootstrap failure (DB,
 * frozen config, provider wiring) that happens before the coordinator could
 * classify anything leaves the run looking 'running' - the runner now
 * persists a sanitized failed_retryable so the task card can surface it and
 * a resume stays possible. Failures the coordinator already classified
 * (paused_user / needs_review / waiting_* / failed_retryable / terminal)
 * are never overwritten.
 */
import { loadApiProfile } from './profileStore';
import { runExtraction } from './sourceImport';
import { notifyBuildProgress } from './buildServiceBridge';
import { getDatabaseRuntime } from './database';
import { SqliteBuildRunStore } from '../../src/infra/sqlite/sqliteBuildRunStore';
import { reviveRunConfig } from '../../src/application/worldBuild/runConfig';

/** Statuses whose cause is already persisted by a more specific writer. */
const ALREADY_CLASSIFIED = new Set([
  'completed', 'canceled', 'failed_terminal', 'failed_retryable',
  'needs_review', 'paused_user', 'paused_system', 'stopped_user',
  'waiting_network', 'waiting_unlock',
]);

/** Redacts credential-shaped substrings from any text bound for persistence. */
export function sanitizeRunnerErrorText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .slice(0, 300);
}

export type RunnerErrorClass =
  | 'runner_start_failed'
  | 'runner_execution_failed'
  | 'keychain_unavailable'
  | 'provider_config_error'
  | 'network_error';

/**
 * Maps a bootstrap/runtime exception to the safest persisted error class.
 * Mirrors the coordinator taxonomy (snake_case, no secrets, no novel text).
 */
export function classifyRunnerError(error: unknown): { code: RunnerErrorClass; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const message = sanitizeRunnerErrorText(raw);
  const lower = raw.toLowerCase();
  if (lower.includes('keychain') || lower.includes('api key is missing')) {
    return { code: 'keychain_unavailable', message: message || '密钥暂不可用，构建未启动。' };
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')
    || lower.includes('api key') || lower.includes('invalid api')) {
    return { code: 'provider_config_error', message: message || '模型配置校验未通过。' };
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('timed out')
    || lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('enotfound')) {
    return { code: 'network_error', message: message || '网络错误，构建中断。' };
  }
  return { code: 'runner_execution_failed', message: message || '后台构建执行失败。' };
}

/**
 * Persists a runner-level failure ONLY when the run still pretends to be
 * queued/running (i.e. nothing more specific was written first). Returns the
 * applied class, or null when the run was absent or already classified.
 */
export async function persistRunnerFailure(
  runStore: { getRun(runId: string): Promise<{ status: string } | null>; setRunStatus(runId: string, status: 'failed_retryable', now: string, errorCode?: string | null, errorMessage?: string | null): Promise<void> },
  runId: string,
  error: unknown,
  now: () => string = () => new Date().toISOString(),
): Promise<RunnerErrorClass | null> {
  try {
    const run = await runStore.getRun(runId);
    if (!run || ALREADY_CLASSIFIED.has(run.status)) return null;
    const { code, message } = classifyRunnerError(error);
    await runStore.setRunStatus(runId, 'failed_retryable', now(), code, message);
    return code;
  } catch {
    // The DB itself may be the broken dependency; nothing more we can do
    // from inside a dying headless task.
    return null;
  }
}

export async function worldBuildRunner(data: { runId?: string }): Promise<void> {
  const runId = typeof data?.runId === 'string' ? data.runId : null;
  if (!runId) return;
  let runtime: Awaited<ReturnType<typeof getDatabaseRuntime>> | null = null;
  try {
    runtime = await getDatabaseRuntime();
    const runStore = new SqliteBuildRunStore(runtime.db);
    const run = await runStore.getRun(runId);
    if (!run) return;
    const frozen = reviveRunConfig(run?.configJson ?? null);
    const profile = frozen ? null : await loadApiProfile();
    if (!frozen && !profile) {
      // Legacy run without a frozen config and no live credentials
      // (lockscreen / cleared profile): stays resumable - and visible, never
      // a silent 'running' zombie.
      await runStore.setRunStatus(
        runId, 'waiting_unlock', new Date().toISOString(),
        'keychain_unavailable', '暂无可用模型配置或密钥；恢复配置后可继续构建。',
      );
      return;
    }
    await runExtraction(runId, profile, progress => {
      if (progress.chunksTotal && progress.chunksDone !== undefined) {
        notifyBuildProgress(runId, progress.chunksDone, progress.chunksTotal).catch(() => undefined);
      }
    });
  } catch (error) {
    if (!runtime) return;
    await persistRunnerFailure(new SqliteBuildRunStore(runtime.db), runId, error);
  }
}
