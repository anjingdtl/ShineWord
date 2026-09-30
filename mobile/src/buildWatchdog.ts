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
import { runExtraction } from './sourceImport';
import type { ApiProfile } from '../../src/application/llm/types';

export interface ExecutionEvidenceQuery {
  status: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  active_units: number;
  attempted_units: number;
}

export interface ExecutionEvidence {
  query: ExecutionEvidenceQuery;
  /** True when at least one persisted signal proves a live executor. */
  confirmed: boolean;
}

/** Reads persisted proof that an executor is (or was) actually working. */
export async function readExecutionEvidence(runId: string): Promise<ExecutionEvidence | null> {
  const runtime = await getDatabaseRuntime();
  const run = await runtime.db.queryOne<{
    status: string;
    lease_owner: string | null;
    lease_expires_at: string | null;
    heartbeat_at: string | null;
  }>(
    `SELECT status, lease_owner, lease_expires_at, heartbeat_at
       FROM world_build_runs WHERE run_id = ?`,
    [runId],
  );
  if (!run) return null;
  const units = await runtime.db.queryOne<{ active: number; attempted: number }>(
    `SELECT
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN attempt > 0 THEN 1 ELSE 0 END) AS attempted
     FROM world_build_units WHERE run_id = ?`,
    [runId],
  );
  const query: ExecutionEvidenceQuery = {
    status: run.status,
    lease_owner: run.lease_owner,
    lease_expires_at: run.lease_expires_at,
    heartbeat_at: run.heartbeat_at,
    active_units: units?.active ?? 0,
    attempted_units: units?.attempted ?? 0,
  };
  const leaseAlive = Boolean(run.lease_owner) && Boolean(run.lease_expires_at)
    && Date.parse(run.lease_expires_at as string) > Date.now();
  return {
    query,
    confirmed: run.status === 'running'
      || leaseAlive
      || query.active_units > 0
      || query.attempted_units > 0,
  };
}

export interface WatchdogOptions {
  /** How long to wait for execution evidence after a successful service start. */
  evidenceTimeoutMs?: number;
  /** Local-SQLite poll interval while waiting for evidence. */
  evidencePollMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Starts a build through the foreground service and verifies it really
 * started. Resolution:
 * - 'service'  : the service started and execution evidence appeared;
 * - 'inline'   : no service / no evidence within the window, so the build ran
 *                (or was already running) inline in this process - the lease
 *                guarantees exactly one executor either way;
 * The caller stays free to refresh the task list; nothing here emits provider
 * requests besides the (possibly inline) extraction itself.
 */
export async function startBuildWithWatchdog(
  runId: string,
  profile: ApiProfile | null,
  options?: WatchdogOptions,
): Promise<'service' | 'inline'> {
  const timeoutMs = options?.evidenceTimeoutMs ?? 8_000;
  const pollMs = options?.evidencePollMs ?? 500;

  const serviceStarted = await startBuildService(runId);
  if (!serviceStarted) {
    await runExtraction(runId, profile, () => undefined);
    return 'inline';
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const evidence = await readExecutionEvidence(runId).catch(() => null);
    if (evidence?.confirmed) return 'service';
  }
  // Foreground service claimed success but nothing executed: fall back to
  // inline execution. If the background executor happens to start right now,
  // its lease acquisition loses (or ours does) - never both.
  await runExtraction(runId, profile, () => undefined);
  return 'inline';
}
