import type {
  BuildRunPhase,
  BuildRunRecord,
  BuildRunStatus,
  BuildRunStore,
  BuildUnitRecord,
} from '../../application/ports/worldBuildStore';
import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';
import type { LlmPhysicalRequestMetric } from '../../application/llm/types';

interface RunRow extends SqliteRow {
  run_id: string;
  world_id: string;
  source_id: string;
  source_snapshot_hash: string;
  pipeline_version: string;
  plan_version: string;
  model_fingerprint: string;
  phase: string;
  status: string;
  units_total: number;
  units_done: number;
  units_failed: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  fencing_token: number;
  heartbeat_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  config_json: string | null;
  plan_state_json: string | null;
  scope_json: string | null;
  pause_requested: number | null;
  cancel_requested: number | null;
}

interface UnitRow extends SqliteRow {
  unit_id: string;
  run_id: string;
  kind: string;
  source_ranges_json: string;
  input_hash: string;
  config_fingerprint: string;
  parent_unit_id: string | null;
  ord: number;
  status: string;
  attempt: number;
  retry_at: string | null;
  result_ref: string | null;
  usage_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function requireString(row: SqliteRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Expected string column ${key}.`);
  return value;
}

function requireNumber(row: SqliteRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw new Error(`Expected number column ${key}.`);
  return value;
}

function optionalString(row: SqliteRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function parseUsageObject(serialized: string | null): Record<string, unknown> {
  if (!serialized) return {};
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch { /* preserve the legacy value below */ }
  return { legacyUsageJson: serialized };
}

function mergeUsageJson(previous: string | null, incoming: string | null): string | null {
  if (incoming === null) return previous;
  if (previous === null) return incoming;
  const before = parseUsageObject(previous);
  const after = parseUsageObject(incoming);
  const beforeMetrics = Array.isArray(before.requestMetrics) ? before.requestMetrics : [];
  const afterMetrics = Array.isArray(after.requestMetrics) ? after.requestMetrics : [];
  const merged = { ...before, ...after };
  if (beforeMetrics.length > 0 || afterMetrics.length > 0) {
    merged.requestMetrics = [...beforeMetrics, ...afterMetrics];
  }
  return JSON.stringify(merged);
}

function runFromRow(row: RunRow): BuildRunRecord {
  return {
    runId: requireString(row, 'run_id'),
    worldId: requireString(row, 'world_id'),
    sourceId: requireString(row, 'source_id'),
    sourceSnapshotHash: requireString(row, 'source_snapshot_hash'),
    pipelineVersion: requireString(row, 'pipeline_version'),
    planVersion: requireString(row, 'plan_version'),
    modelFingerprint: requireString(row, 'model_fingerprint'),
    phase: requireString(row, 'phase') as BuildRunRecord['phase'],
    status: requireString(row, 'status') as BuildRunRecord['status'],
    unitsTotal: requireNumber(row, 'units_total'),
    unitsDone: requireNumber(row, 'units_done'),
    unitsFailed: requireNumber(row, 'units_failed'),
    leaseOwner: optionalString(row, 'lease_owner'),
    leaseExpiresAt: optionalString(row, 'lease_expires_at'),
    fencingToken: requireNumber(row, 'fencing_token'),
    heartbeatAt: optionalString(row, 'heartbeat_at'),
    lastErrorCode: optionalString(row, 'last_error_code'),
    lastErrorMessage: optionalString(row, 'last_error_message'),
    createdAt: requireString(row, 'created_at'),
    updatedAt: requireString(row, 'updated_at'),
    configJson: optionalString(row, 'config_json'),
    planStateJson: optionalString(row, 'plan_state_json'),
    scopeJson: optionalString(row, 'scope_json'),
    pauseRequested: (row['pause_requested'] ?? 0) !== 0,
    cancelRequested: (row['cancel_requested'] ?? 0) !== 0,
  };
}

function unitFromRow(row: UnitRow): BuildUnitRecord {
  return {
    unitId: requireString(row, 'unit_id'),
    runId: requireString(row, 'run_id'),
    kind: requireString(row, 'kind') as BuildUnitRecord['kind'],
    sourceRangesJson: requireString(row, 'source_ranges_json'),
    inputHash: requireString(row, 'input_hash'),
    configFingerprint: requireString(row, 'config_fingerprint'),
    parentUnitId: optionalString(row, 'parent_unit_id'),
    ord: requireNumber(row, 'ord'),
    status: requireString(row, 'status') as BuildUnitRecord['status'],
    attempt: requireNumber(row, 'attempt'),
    retryAt: optionalString(row, 'retry_at'),
    resultRef: optionalString(row, 'result_ref'),
    usageJson: optionalString(row, 'usage_json'),
    errorCode: optionalString(row, 'error_code'),
    errorMessage: optionalString(row, 'error_message'),
    createdAt: requireString(row, 'created_at'),
    updatedAt: requireString(row, 'updated_at'),
  };
}

function insertUnitSql(): string {
  return `INSERT INTO world_build_units
    (unit_id, run_id, kind, source_ranges_json, input_hash, config_fingerprint,
     parent_unit_id, ord, status, attempt, retry_at, result_ref, usage_json,
     error_code, error_message, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

function unitParams(unit: BuildUnitRecord): unknown[] {
  return [
    unit.unitId,
    unit.runId,
    unit.kind,
    unit.sourceRangesJson,
    unit.inputHash,
    unit.configFingerprint,
    unit.parentUnitId,
    unit.ord,
    unit.status,
    unit.attempt,
    unit.retryAt,
    unit.resultRef,
    unit.usageJson,
    unit.errorCode,
    unit.errorMessage,
    unit.createdAt,
    unit.updatedAt,
  ];
}

export class SqliteBuildRunStore implements BuildRunStore {
  constructor(private readonly db: SqliteDatabase) {}

  async createRun(run: BuildRunRecord, units: readonly BuildUnitRecord[]): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.execute(
        `INSERT INTO world_build_runs
          (run_id, world_id, source_id, source_snapshot_hash, pipeline_version, plan_version,
           model_fingerprint, phase, status, units_total, units_done, units_failed,
           lease_owner, lease_expires_at, fencing_token, heartbeat_at,
           last_error_code, last_error_message, created_at, updated_at,
           config_json, plan_state_json, scope_json, pause_requested, cancel_requested)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, 0, NULL, NULL, NULL, ?, ?, ?, ?, ?, 0, 0)`,
        [
          run.runId, run.worldId, run.sourceId, run.sourceSnapshotHash,
          run.pipelineVersion, run.planVersion, run.modelFingerprint,
          run.phase, run.status, units.length, run.createdAt, run.updatedAt,
          run.configJson ?? null, run.planStateJson ?? null, run.scopeJson ?? null,
        ],
      );
      for (const unit of units) {
        await tx.execute(insertUnitSql(), unitParams(unit));
      }
    });
  }

  async getRun(runId: string): Promise<BuildRunRecord | null> {
    const row = await this.db.queryOne<RunRow>('SELECT * FROM world_build_runs WHERE run_id = ?', [runId]);
    return row ? runFromRow(row) : null;
  }

  async listResumableRuns(): Promise<BuildRunRecord[]> {
    const rows = await this.db.queryAll<RunRow>(
      `SELECT * FROM world_build_runs
        WHERE status IN ('queued', 'running', 'waiting_network', 'waiting_unlock',
                         'paused_system', 'paused_user', 'stopped_user',
                         'failed_retryable', 'needs_review')
        ORDER BY created_at`,
    );
    return rows.map(runFromRow);
  }

  async acquireLease(runId: string, owner: string, ttlMs: number, now: string): Promise<number | null> {
    const expires = new Date(Date.parse(now) + ttlMs).toISOString();
    await this.db.execute(
      `UPDATE world_build_runs SET
         lease_owner = ?, lease_expires_at = ?, fencing_token = fencing_token + 1,
         heartbeat_at = ?, updated_at = ?,
         status = 'running'
       WHERE run_id = ?
         AND status NOT IN ('failed_terminal', 'canceled', 'completed')
         AND (lease_owner IS NULL OR lease_owner = ? OR lease_expires_at IS NULL OR lease_expires_at < ?)`,
      [owner, expires, now, now, runId, owner, now],
    );
    // node:sqlite and the RN adapter report affected rows differently; re-read
    // to decide ownership instead of relying on the write result shape.
    const row = await this.db.queryOne<{ lease_owner: string | null; fencing_token: number }>(
      'SELECT lease_owner, fencing_token FROM world_build_runs WHERE run_id = ?',
      [runId],
    );
    return row && row.lease_owner === owner ? row.fencing_token : null;
  }

  async renewLease(runId: string, owner: string, fencingToken: number, ttlMs: number, now: string): Promise<boolean> {
    const expires = new Date(Date.parse(now) + ttlMs).toISOString();
    const row = await this.db.queryOne<{ lease_owner: string | null; fencing_token: number }>(
      'SELECT lease_owner, fencing_token FROM world_build_runs WHERE run_id = ?',
      [runId],
    );
    if (!row || row.lease_owner !== owner || row.fencing_token !== fencingToken) return false;
    await this.db.execute(
      'UPDATE world_build_runs SET lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE run_id = ?',
      [expires, now, now, runId],
    );
    return true;
  }

  async releaseLease(runId: string, owner: string, fencingToken: number, now: string): Promise<boolean> {
    const row = await this.db.queryOne<{ lease_owner: string | null; fencing_token: number }>(
      'SELECT lease_owner, fencing_token FROM world_build_runs WHERE run_id = ?',
      [runId],
    );
    if (!row || row.lease_owner !== owner || row.fencing_token !== fencingToken) return false;
    await this.db.execute(
      `UPDATE world_build_runs SET lease_owner = NULL, lease_expires_at = NULL,
         status = CASE WHEN status = 'running' THEN 'queued' ELSE status END,
         updated_at = ? WHERE run_id = ?`,
      [now, runId],
    );
    return true;
  }

  async heartbeat(runId: string, owner: string, now: string): Promise<boolean> {
    const row = await this.db.queryOne<{ lease_owner: string | null }>(
      'SELECT lease_owner FROM world_build_runs WHERE run_id = ?',
      [runId],
    );
    if (!row || row.lease_owner !== owner) return false;
    await this.db.execute(
      'UPDATE world_build_runs SET heartbeat_at = ?, updated_at = ? WHERE run_id = ?',
      [now, now, runId],
    );
    return true;
  }

  async setRunStatus(runId: string, status: BuildRunStatus, now: string, errorCode?: string | null, errorMessage?: string | null): Promise<void> {
    await this.db.execute(
      `UPDATE world_build_runs SET status = ?, last_error_code = ?, last_error_message = ?, updated_at = ?
         WHERE run_id = ?`,
      [status, errorCode ?? null, errorMessage ?? null, now, runId],
    );
  }

  async setRunPhase(runId: string, phase: BuildRunPhase, now: string): Promise<void> {
    await this.db.execute(
      'UPDATE world_build_runs SET phase = ?, updated_at = ? WHERE run_id = ?',
      [phase, now, runId],
    );
  }

  async listUnits(runId: string): Promise<BuildUnitRecord[]> {
    const rows = await this.db.queryAll<UnitRow>(
      'SELECT * FROM world_build_units WHERE run_id = ? ORDER BY ord',
      [runId],
    );
    return rows.map(unitFromRow);
  }

  async listExecutableUnits(runId: string, now: string): Promise<BuildUnitRecord[]> {
    const rows = await this.db.queryAll<UnitRow>(
      `SELECT * FROM world_build_units
        WHERE run_id = ? AND status IN ('queued', 'running', 'failed_retryable', 'waiting_network')
          AND (retry_at IS NULL OR retry_at <= ?)
        ORDER BY ord`,
      [runId, now],
    );
    return rows.map(unitFromRow);
  }

  async claimUnit(unitId: string, now: string): Promise<boolean> {
    // Atomic compare-and-set claim (resident plan §6): one conditional
    // UPDATE either matches or not, so concurrent workers can never both
    // win - no read/write race window, no explicit transaction needed.
    // 'running' stays claimable on purpose: a unit stuck 'running' after a
    // crashed coordinator is recovered by the next lease holder.
    const changed = await this.db.execute(
      `UPDATE world_build_units
         SET status = 'running', attempt = attempt + 1, updated_at = ?
       WHERE unit_id = ?
         AND status IN ('queued', 'failed_retryable', 'running', 'waiting_network')`,
      [now, unitId],
    );
    return changed > 0;
  }

  async completeUnit(input: {
    unitId: string;
    fencingToken: number;
    status: BuildUnitRecord['status'];
    resultRef?: string | null;
    usageJson?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    retryAt?: string | null;
    now: string;
  }): Promise<boolean> {
    return this.db.transaction(async tx => {
      const run = await tx.queryOne<{ fencing_token: number; usage_json: string | null; unit_status: string }>(
        `SELECT r.fencing_token, u.usage_json, u.status AS unit_status FROM world_build_runs r
           JOIN world_build_units u ON u.run_id = r.run_id WHERE u.unit_id = ?`,
        [input.unitId],
      );
      if (!run || run.fencing_token !== input.fencingToken) return false;
      // A late duplicate completion is idempotent; completed work is immutable.
      if (run.unit_status === 'completed') return input.status === 'completed';
      await tx.execute(
        `UPDATE world_build_units SET
           status = ?, result_ref = ?, usage_json = ?, error_code = ?, error_message = ?,
           retry_at = ?, updated_at = ?
         WHERE unit_id = ?`,
        [
          input.status, input.resultRef ?? null, mergeUsageJson(run.usage_json, input.usageJson ?? null),
          input.errorCode ?? null, input.errorMessage ?? null, input.retryAt ?? null,
          input.now, input.unitId,
        ],
      );
      if (input.status === 'completed') {
        await tx.execute(
          `UPDATE world_build_runs SET units_done = units_done + 1, updated_at = ?
             WHERE run_id = (SELECT run_id FROM world_build_units WHERE unit_id = ?)`,
          [input.now, input.unitId],
        );
      } else if (input.status === 'failed_retryable' || input.status === 'failed_terminal'
        || input.status === 'needs_review') {
        await tx.execute(
          `UPDATE world_build_runs SET units_failed = units_failed + 1, updated_at = ?
             WHERE run_id = (SELECT run_id FROM world_build_units WHERE unit_id = ?)`,
          [input.now, input.unitId],
        );
      }
      return true;
    });
  }

  async appendUnitRequestMetrics(
    unitId: string,
    fencingToken: number,
    metrics: readonly LlmPhysicalRequestMetric[],
    now: string,
  ): Promise<boolean> {
    if (metrics.length === 0) return false;
    return this.db.transaction(async tx => {
      const row = await tx.queryOne<{ usage_json: string | null; fencing_token: number }>(
        `SELECT u.usage_json, r.fencing_token FROM world_build_units u
           JOIN world_build_runs r ON r.run_id = u.run_id WHERE u.unit_id = ?`, [unitId],
      );
      if (!row || row.fencing_token !== fencingToken) return false;
      const next = mergeUsageJson(row.usage_json, JSON.stringify({ requestMetrics: metrics }));
      await tx.execute(
        'UPDATE world_build_units SET usage_json = ?, updated_at = ? WHERE unit_id = ?',
        [next, now, unitId],
      );
      return true;
    });
  }

  async replaceUnitWithChildren(input: {
    unitId: string;
    fencingToken: number;
    children: readonly Omit<BuildUnitRecord, 'runId'>[];
    now: string;
  }): Promise<boolean> {
    return this.db.transaction(async tx => {
      const unit = await tx.queryOne<{ run_id: string }>(
        'SELECT run_id FROM world_build_units WHERE unit_id = ?',
        [input.unitId],
      );
      if (!unit) return false;
      const run = await tx.queryOne<{ fencing_token: number }>(
        'SELECT fencing_token FROM world_build_runs WHERE run_id = ?',
        [unit.run_id],
      );
      if (!run || run.fencing_token !== input.fencingToken) return false;
      await tx.execute(
        `UPDATE world_build_units SET status = 'canceled', updated_at = ? WHERE unit_id = ?`,
        [input.now, input.unitId],
      );
      for (const child of input.children) {
        await tx.execute(insertUnitSql(), unitParams({ ...child, runId: unit.run_id }));
      }
      // The canceled parent leaves the effective count: only the children
      // remain as work, so a split must never inflate the total (plan 7.2 -
      // parent and children must not both count).
      await tx.execute(
        `UPDATE world_build_runs SET units_total = units_total + ?, updated_at = ? WHERE run_id = ?`,
        [input.children.length - 1, input.now, unit.run_id],
      );
      return true;
    });
  }

  async replaceUnclaimedUnits(input: {
    runId: string;
    fencingToken: number;
    units: readonly Omit<BuildUnitRecord, 'runId'>[];
    planStateJson?: string | null;
    now: string;
  }): Promise<boolean> {
    return this.db.transaction(async tx => {
      const run = await tx.queryOne<{ fencing_token: number }>(
        'SELECT fencing_token FROM world_build_runs WHERE run_id = ?',
        [input.runId],
      );
      if (!run || run.fencing_token !== input.fencingToken) return false;
      // Only untouched queued units are replaceable: completed/running/
      // retrying/blocked work keeps its identity and ordering (plan P1 §8).
      const rows = await tx.queryAll<{ unit_id: string }>(
        `SELECT unit_id FROM world_build_units
           WHERE run_id = ? AND status = 'queued'`,
        [input.runId],
      );
      for (const row of rows) {
        await tx.execute(
          `UPDATE world_build_units SET status = 'canceled', updated_at = ? WHERE unit_id = ?`,
          [input.now, row.unit_id],
        );
      }
      for (const unit of input.units) {
        await tx.execute(insertUnitSql(), unitParams({ ...unit, runId: input.runId }));
      }
      const delta = input.units.length - rows.length;
      await tx.execute(
        `UPDATE world_build_runs SET units_total = units_total + ?, updated_at = ? WHERE run_id = ?`,
        [delta, input.now, input.runId],
      );
      if (input.planStateJson !== undefined) {
        await tx.execute(
          'UPDATE world_build_runs SET plan_state_json = ?, updated_at = ? WHERE run_id = ?',
          [input.planStateJson, input.now, input.runId],
        );
      }
      return true;
    });
  }

  async setRunPlanState(runId: string, planStateJson: string, now: string): Promise<void> {
    await this.db.execute(
      'UPDATE world_build_runs SET plan_state_json = ?, updated_at = ? WHERE run_id = ?',
      [planStateJson, now, runId],
    );
  }

  async requestRunControl(runId: string, kind: 'pause' | 'cancel' | 'resume', now: string): Promise<void> {
    if (kind === 'resume') {
      // Resume clears BOTH control flags: honoring a pause/stop already
      // cleared its own flag, and a stale one must never re-interrupt the
      // run the user just asked to continue.
      await this.db.execute(
        `UPDATE world_build_runs SET pause_requested = 0, cancel_requested = 0, updated_at = ? WHERE run_id = ?`,
        [now, runId],
      );
      return;
    }
    const column = kind === 'pause' ? 'pause_requested' : 'cancel_requested';
    await this.db.execute(
      `UPDATE world_build_runs SET ${column} = 1, updated_at = ? WHERE run_id = ?`,
      [now, runId],
    );
  }
  async requestSystemPause(runId: string, reason: string, now: string): Promise<boolean> {
    return (await this.db.execute(`UPDATE world_build_runs SET pause_requested=1,status='paused_system',
      last_error_code='system_pause',last_error_message=?,updated_at=? WHERE run_id=?
      AND status IN ('queued','running','waiting_network','waiting_unlock','failed_retryable')
      AND pause_requested=0 AND cancel_requested=0`, [reason,now,runId])) === 1;
  }
}
