/**
 * Execution-start watchdog (real-device P0-2).
 *
 * `WorldBuildServiceModule.startService()` resolving true only proves that
 * `startForegroundService()` was ACCEPTED by the OS - not that the foreground
 * service actually runs, that the Headless JS task woke up, or that the
 * coordinator claimed any unit. On real devices the headless task can fail
 * to start (OEM task killers, headless task timeouts) while the run keeps
 * showing a static 0/N.
 *
 * The watchdog closes that gap: after a successful service start it polls
 * the run row (local SQLite only - never the provider) for persisted
 * execution evidence within a short window, and falls back to an inline
 * `runExtraction` when none appears. Double execution is impossible: the
 * CAS lease + fencing token means a late background starter simply fails to
 * acquire the lease and exits.
 */
import { getDatabaseRuntime } from './database';
import { startBuildService } from './buildServiceBridge';
import { isRunActive, resumeRun, runExtraction } from './sourceImport';
import type { ApiProfile } from '../../src/application/llm/types';
import type { BuildTaskView } from './buildTasks';
import type { WorldBuildProgress } from './worldImport';
import type { SqliteRow } from '../../src/application/ports/sqlite';

export interface ExecutionBaseline extends SqliteRow {
  status: string;
  run_updated_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  running_units: number;
  attempt_total: number;
  unit_updated_at_max: string | null;
  pause_requested: number;
  cancel_requested: number;
}

export interface ExecutionEvidence {
  query: ExecutionBaseline;
  /** True only when an executor signal advanced since this start's baseline. */
  confirmed: boolean;
}

/** One SQLite snapshot: control writes and historical activity are baseline only. */
export async function readExecutionBaseline(runId: string): Promise<ExecutionBaseline | null> {
  const runtime = await getDatabaseRuntime();
  return runtime.db.queryOne<ExecutionBaseline>(
    `SELECT r.status, r.updated_at AS run_updated_at, r.pause_requested, r.cancel_requested,
            r.lease_owner, r.lease_expires_at, r.heartbeat_at,
            COALESCE(u.running_units, 0) AS running_units,
            COALESCE(u.attempt_total, 0) AS attempt_total, u.unit_updated_at_max
       FROM world_build_runs r
       LEFT JOIN (
         SELECT run_id,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_units,
           SUM(attempt) AS attempt_total,
           MAX(CASE WHEN status IN ('running', 'waiting_network', 'waiting_unlock',
             'failed_retryable', 'needs_review', 'failed_terminal', 'completed')
             THEN updated_at END) AS unit_updated_at_max
         FROM world_build_units WHERE run_id = ? GROUP BY run_id
       ) u ON u.run_id = r.run_id
      WHERE r.run_id = ?`,
    [runId, runId],
  );
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
}

export function hasFreshExecutionEvidence(
  baseline: ExecutionBaseline,
  current: ExecutionBaseline,
  watchdogStartAt: number,
  now = Date.now(),
): boolean {
  const advancedSinceStart = (value: string | null, previous: string | null): boolean =>
    timestamp(value) > timestamp(previous) && timestamp(value) >= watchdogStartAt;
  const freshHeartbeat = advancedSinceStart(current.heartbeat_at, baseline.heartbeat_at);
  const liveLease = Boolean(current.lease_owner) && timestamp(current.lease_expires_at) > now;
  const freshLease = liveLease && (
    current.lease_owner !== baseline.lease_owner
    || timestamp(current.lease_expires_at) > timestamp(baseline.lease_expires_at)
    || freshHeartbeat
  );
  // UI controls can change run.updated_at/status; neither alone proves execution.
  return freshLease || freshHeartbeat
    || current.attempt_total > baseline.attempt_total
    || advancedSinceStart(current.unit_updated_at_max, baseline.unit_updated_at_max);
}

export async function readExecutionEvidence(
  runId: string,
  baseline: ExecutionBaseline,
  watchdogStartAt: number,
): Promise<ExecutionEvidence | null> {
  const query = await readExecutionBaseline(runId);
  return query ? { query, confirmed: hasFreshExecutionEvidence(baseline, query, watchdogStartAt) } : null;
}

export interface WatchdogOptions {
  /** How long to wait for execution evidence after a successful service start. */
  evidenceTimeoutMs?: number;
  /** Local-SQLite poll interval while waiting for evidence. */
  evidencePollMs?: number;
  onProgress?: (progress: WorldBuildProgress) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isInactive(snapshot: ExecutionBaseline): boolean {
  return Boolean(snapshot.pause_requested || snapshot.cancel_requested)
    || ['paused_user', 'stopped_user', 'canceled', 'completed', 'failed_terminal', 'needs_review'].includes(snapshot.status);
}

/**
 * Starts a build through the foreground service and verifies it really
 * started. Resolution:
 * - 'service'  : the service started and execution evidence appeared;
 * - 'inline'   : no service / no evidence within the window, so the build ran
 *                (or was already running) inline in this process - the lease
 *                guarantees exactly one executor either way;
 * - 'inactive': a user control or terminal verdict ended this startup;
 * The caller stays free to refresh the task list; nothing here emits provider
 * requests besides the (possibly inline) extraction itself.
 */
export async function startBuildWithWatchdog(
  runId: string,
  profile: ApiProfile | null,
  options?: WatchdogOptions,
): Promise<'service' | 'inline' | 'inactive'> {
  const timeoutMs = options?.evidenceTimeoutMs ?? 8_000;
  const pollMs = options?.evidencePollMs ?? 500;

  const baseline = await readExecutionBaseline(runId);
  if (!baseline) throw new Error(`Unknown run ${runId}.`);
  if (isInactive(baseline)) return 'inactive';
  const watchdogStartAt = Date.now();
  const serviceStarted = await startBuildService(runId);
  if (!serviceStarted) {
    await runExtraction(runId, profile, options?.onProgress ?? (() => undefined));
    return 'inline';
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    const evidence = await readExecutionEvidence(runId, baseline, watchdogStartAt).catch(() => null);
    if (evidence && isInactive(evidence.query)) return 'inactive';
    if (evidence?.confirmed) return 'service';
  }
  // Foreground service claimed success but nothing executed: fall back to
  // inline execution. If the background executor happens to start right now,
  // its lease acquisition loses (or ours does) - never both.
  await runExtraction(runId, profile, options?.onProgress ?? (() => undefined));
  return 'inline';
}

type StartOutcome = 'service' | 'inline' | 'active' | 'inactive';
const startingBuilds = new Map<string, Promise<StartOutcome>>();

/** Shared entry for imports, explicit resume, recovery, and stage triggers. */
export async function startOrResumeBuild(
  runId: string,
  profile: ApiProfile | null,
  options?: WatchdogOptions & { resume?: boolean },
): Promise<StartOutcome> {
  if (options?.resume) {
    const { activeInProcess } = await resumeRun(runId);
    if (activeInProcess) return 'active';
  } else if (isRunActive(runId)) {
    return 'active';
  }
  const pending = startingBuilds.get(runId);
  if (pending) return pending;
  const started = startBuildWithWatchdog(runId, profile, options)
    .finally(() => { startingBuilds.delete(runId); });
  startingBuilds.set(runId, started);
  return started;
}

/** Recovery never revokes a persisted user pause/stop request. */
export async function recoverBuildTasks(
  tasks: ReadonlyArray<Pick<BuildTaskView, 'runId' | 'status' | 'leaseHeld' | 'pauseRequested' | 'cancelRequested'>>,
  profile: ApiProfile | null,
  options?: WatchdogOptions,
): Promise<void> {
  for (const task of tasks) {
    if (task.leaseHeld || task.pauseRequested || task.cancelRequested) continue;
    if (['queued', 'running', 'waiting_network', 'waiting_unlock', 'paused_system', 'failed_retryable'].includes(task.status)) {
      await startOrResumeBuild(task.runId, profile, options);
    }
  }
}
