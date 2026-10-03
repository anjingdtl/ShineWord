/**
 * SQLite-backed durable physical-request ledger (infrastructure plan §52).
 * Migration 19 creates the ledger; 22/23 add frozen reasoning metadata.
 */

import type {
  LlmAttemptPatch,
  LlmAttemptStatus,
  LlmRequestAttemptRecord,
  LlmRequestLedgerStore,
  NewLlmRequestAttempt,
  BuildReplaySnapshotV1,
  LlmBuildRecoveryPort,
  LlmReplayApprovalPort,
} from '../../application/ports/llmLedger';
import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import type { BuildRunStatus } from '../../application/ports/worldBuildStore';
import { revivePlanState } from '../../application/worldBuild/runConfig';

interface AttemptRow extends SqliteRow {
  attempt_id: string;
  logical_request_id: string;
  request_kind: string;
  campaign_id: string | null;
  branch_id: string | null;
  world_id: string | null;
  state_version: number | null;
  model_profile_fingerprint: string;
  reasoning_tier: string | null;
  reasoning_reserve_tokens: number | null;
  reasoning_policy_version: string | null;
  wire_output_tokens: number | null;
  attempt_no: number;
  status: string;
  failure_class: string | null;
  error_code: string | null;
  http_status: number | null;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cached_input_tokens: number | null;
  estimated_usage: number;
  started_at: number;
  finished_at: number | null;
  replay_approved_at: number | null;
}

function toRecord(row: AttemptRow): LlmRequestAttemptRecord {
  return {
    attemptId: row.attempt_id,
    logicalRequestId: row.logical_request_id,
    requestKind: row.request_kind,
    campaignId: row.campaign_id,
    branchId: row.branch_id,
    worldId: row.world_id,
    stateVersion: row.state_version,
    modelProfileFingerprint: row.model_profile_fingerprint,
    reasoningTier: row.reasoning_tier === 'low' || row.reasoning_tier === 'high' || row.reasoning_tier === 'max'
      ? row.reasoning_tier
      : null,
    reasoningReserveTokens: row.reasoning_reserve_tokens,
    reasoningPolicyVersion: row.reasoning_policy_version,
    wireOutputTokens: row.wire_output_tokens,
    attemptNo: row.attempt_no,
    status: row.status as LlmAttemptStatus,
    failureClass: row.failure_class,
    errorCode: row.error_code,
    httpStatus: row.http_status,
    providerRequestId: row.provider_request_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    cachedInputTokens: row.cached_input_tokens,
    estimatedUsage: row.estimated_usage,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    replayApprovedAt: row.replay_approved_at,
  };
}

const COLUMN_LIST = `attempt_id, logical_request_id, request_kind, campaign_id, branch_id, world_id,
  state_version, model_profile_fingerprint, reasoning_tier, reasoning_reserve_tokens,
  reasoning_policy_version, wire_output_tokens, attempt_no, status, failure_class, error_code, http_status,
  provider_request_id, input_tokens, output_tokens, reasoning_tokens, cached_input_tokens,
  estimated_usage, started_at, finished_at, replay_approved_at`;

// Extraction is linked to an exact unit, not a potentially overlapping run-id
// prefix. Mapping jobs may be shared by compatible segments of this world.
const BUILD_ATTEMPT_MATCH = `(
  (a.request_kind = 'world_extract' AND EXISTS (
    SELECT 1 FROM world_build_units u WHERE u.run_id = r.run_id
    AND a.logical_request_id IN (
      'world-extract:' || r.run_id || ':' || u.unit_id || ':all',
      'world-extract:' || r.run_id || ':' || u.unit_id || ':characters',
      'world-extract:' || r.run_id || ':' || u.unit_id || ':world')))
  OR a.request_kind IN ('world_mapping', 'registry', 'timeline')
)`;

interface BuildAttemptRow extends AttemptRow {
  recovery_run_id: string; run_plan_state_json: string | null; legacy_mapping_match: number;
  recovery_run_status: string; recovery_run_phase: string; recovery_run_error: string | null;
}
const BUILD_ATTEMPT_COLUMNS = `${COLUMN_LIST.split(',').map(c => 'a.' + c.trim()).join(',')},
  r.run_id AS recovery_run_id, r.plan_state_json AS run_plan_state_json,
  r.status AS recovery_run_status, r.phase AS recovery_run_phase, r.last_error_code AS recovery_run_error,
  CASE WHEN a.logical_request_id = 'world-mapping:' || r.run_id || ':' || r.world_id
    OR EXISTS (SELECT 1 FROM world_jobs j WHERE j.world_id = r.world_id
      AND a.logical_request_id = 'world-mapping:' || r.run_id || ':' || j.job_id)
    THEN 1 ELSE 0 END AS legacy_mapping_match`;
function belongsToBuild(row: BuildAttemptRow): boolean {
  if (row.request_kind === 'world_extract') return true;
  if (row.request_kind === 'registry' || row.request_kind === 'timeline') {
    const prefix = `world-${row.request_kind}:${row.recovery_run_id}:${row.world_id}:`;
    return row.logical_request_id.startsWith(prefix) && /^[a-f0-9]{64}$/.test(row.logical_request_id.slice(prefix.length));
  }
  const tracked = revivePlanState(row.run_plan_state_json, { bodyTargetRatio: 0.30 }).mappingRequestIds;
  if (row.legacy_mapping_match === 1 || tracked?.includes(row.logical_request_id)) return true;
  // Before mappingRequestIds existed, incremental mapping was already shared
  // at world scope. Only an unfinished legacy finalization may recover its
  // exact world/job-hash request. Completed openings and new tracked runs
  // never inherit another segment's unknown request. No coordinates or new
  // ledger identities are synthesized by this conservative compatibility path.
  if (tracked !== undefined || ['completed', 'canceled', 'failed_terminal'].includes(row.recovery_run_status)) return false;
  if (!['mapping', 'validating', 'publishing'].includes(row.recovery_run_phase)
    && !/^(package_finalize_failed|mapping_.*|outcome_unknown)$/.test(row.recovery_run_error ?? '')) return false;
  const prefix = `world-mapping:${row.world_id}:job-map-${row.world_id}-`;
  return row.logical_request_id.startsWith(prefix) && /^[a-f0-9]{64}$/.test(row.logical_request_id.slice(prefix.length));
}

interface ReplayRunRow extends SqliteRow {
  run_id: string; world_id: string; fencing_token: number; status: BuildRunStatus;
  source_snapshot_hash: string; model_fingerprint: string;
  pause_requested: number; cancel_requested: number;
  lease_owner: string | null; lease_expires_at: string | null;
}

export class SqliteLlmLedgerStore implements LlmRequestLedgerStore, LlmBuildRecoveryPort, LlmReplayApprovalPort {
  constructor(private readonly db: SqliteDatabase) {}

  private async buildAttempts(tx: SqliteTransaction, runId: string, worldId: string): Promise<AttemptRow[]> {
    const rows = await tx.queryAll<BuildAttemptRow>(`SELECT ${BUILD_ATTEMPT_COLUMNS}
      FROM llm_request_attempts a JOIN world_build_runs r ON r.run_id = ? AND r.world_id = a.world_id
      JOIN worlds w ON w.world_id = r.world_id
      WHERE r.world_id = ? AND ${BUILD_ATTEMPT_MATCH} ORDER BY a.started_at, a.attempt_id`, [runId, worldId]);
    return rows.filter(belongsToBuild);
  }

  async readBuildUnknownRunIds(worldIds: readonly string[]): Promise<ReadonlySet<string>> {
    const result = new Set<string>();
    for (let offset = 0; offset < worldIds.length; offset += 200) {
      const ids = worldIds.slice(offset, offset + 200);
      const rows = await this.db.queryAll<BuildAttemptRow>(`SELECT ${BUILD_ATTEMPT_COLUMNS}
        FROM llm_request_attempts a JOIN world_build_runs r ON r.world_id = a.world_id
        JOIN worlds w ON w.world_id = r.world_id
        WHERE r.world_id IN (${ids.map(() => '?').join(',')}) AND a.status = 'outcome_unknown'
          AND a.replay_approved_at IS NULL AND ${BUILD_ATTEMPT_MATCH}`, ids);
      for (const row of rows) if (belongsToBuild(row)) result.add(row.recovery_run_id);
    }
    return result;
  }

  private replayRun(tx: SqliteTransaction, runId: string): Promise<ReplayRunRow | null> {
    return tx.queryOne<ReplayRunRow>(`SELECT r.run_id, r.world_id, r.fencing_token, r.status,
      r.source_snapshot_hash, r.model_fingerprint, r.pause_requested, r.cancel_requested,
      r.lease_owner, r.lease_expires_at FROM world_build_runs r JOIN worlds w ON w.world_id = r.world_id
      WHERE r.run_id = ?`, [runId]);
  }

  async readBuildRequestOutcome(runId: string, worldId: string): ReturnType<LlmBuildRecoveryPort['readBuildRequestOutcome']> {
    const rows = await this.buildAttempts(this.db, runId, worldId);
    if (rows.some(a => a.status === 'outcome_unknown' && a.replay_approved_at == null)) return 'outcome_unknown';
    if (rows.length) {
      // An unrelated known request cannot clear an older untracked unit's
      // unknown marker. Only its own retained, explicitly approved attempt can.
      const legacy = await this.db.queryAll<{ unit_id: string; last_error_code: string | null }>(
        `SELECT u.unit_id, r.last_error_code FROM world_build_runs r
          LEFT JOIN world_build_units u ON u.run_id = r.run_id AND u.status <> 'completed'
            AND instr(COALESCE(u.error_code, ''), 'outcome_unknown') > 0
          WHERE r.run_id = ? AND r.world_id = ?`, [runId, worldId]);
      const approved = rows.filter(a => a.status === 'outcome_unknown' && a.replay_approved_at != null);
      if (legacy.some(u => u.unit_id && !approved.some(a =>
        ['all', 'characters', 'world'].some(route => a.logical_request_id === `world-extract:${runId}:${u.unit_id}:${route}`)))
        || legacy.some(u => u.last_error_code?.includes('outcome_unknown')) && !approved.length) return 'outcome_unknown';
    }
    if (rows.some(a => a.status === 'sent')) return 'sent';
    if (rows.some(a => a.status === 'prepared')) return 'prepared';
    return rows.length ? 'known' : 'none';
  }

  async readBuildReplay(runId: string): Promise<BuildReplaySnapshotV1 | null> {
    const run = await this.replayRun(this.db, runId);
    if (!run) return null;
    const attempts = await this.buildAttempts(this.db, runId, run.world_id);
    const unknown = attempts.filter(a => a.status === 'outcome_unknown' && a.replay_approved_at == null).slice(0, 128);
    const ids = unknown.map(a => a.attempt_id);
    if (!ids.length) return null;
    return { runId, worldId: run.world_id, fencingToken: run.fencing_token, status: run.status,
      sourceSnapshotHash: run.source_snapshot_hash, modelFingerprint: run.model_fingerprint,
      pauseRequested: Boolean(run.pause_requested), cancelRequested: Boolean(run.cancel_requested), attemptIds: ids,
      attempts: unknown.map(a => ({ attemptId: a.attempt_id, requestKind: a.request_kind,
        startedAt: a.started_at, wireOutputTokens: a.wire_output_tokens })) };
  }

  async acknowledgeBuildReplay(snapshot: BuildReplaySnapshotV1): Promise<void> {
    if (!snapshot || !Array.isArray(snapshot.attemptIds) || !snapshot.attemptIds.length || snapshot.attemptIds.length > 128
      || snapshot.attemptIds.some(id => typeof id !== 'string' || !id) || new Set(snapshot.attemptIds).size !== snapshot.attemptIds.length
      || !Array.isArray(snapshot.attempts) || snapshot.attempts.length !== snapshot.attemptIds.length
      || snapshot.attempts.some((a, i) => a?.attemptId !== snapshot.attemptIds[i])) {
      throw new Error('请选择本次展示的未知请求。');
    }
    await this.db.transaction(async tx => {
      const run = await this.replayRun(tx, snapshot.runId);
      if (!run || run.world_id !== snapshot.worldId) throw new Error('项目或构建任务已不存在。');
      if (run.fencing_token !== snapshot.fencingToken || run.status !== snapshot.status
        || run.source_snapshot_hash !== snapshot.sourceSnapshotHash || run.model_fingerprint !== snapshot.modelFingerprint
        || Boolean(run.pause_requested) !== snapshot.pauseRequested || Boolean(run.cancel_requested) !== snapshot.cancelRequested) {
        throw new Error('构建状态已更新，请重新核对请求。');
      }
      if (run.lease_owner && (!run.lease_expires_at || !Number.isFinite(Date.parse(run.lease_expires_at))
        || Date.parse(run.lease_expires_at) > Date.now())) {
        throw new Error('构建执行者尚未结束，请稍后核对请求。');
      }
      if (['completed', 'canceled', 'failed_terminal'].includes(run.status)) throw new Error('此构建任务已结束。');
      const attempts = await this.buildAttempts(tx, run.run_id, run.world_id);
      if (attempts.some(a => a.status === 'prepared' || a.status === 'sent')) throw new Error('仍有模型请求正在发送，请稍后核对。');
      for (const [i, id] of snapshot.attemptIds.entries()) {
        const attempt = attempts.find(a => a.attempt_id === id && a.status === 'outcome_unknown');
        if (!attempt) throw new Error('这条请求不属于当前构建。');
        const displayed = snapshot.attempts[i];
        if (!displayed || displayed.requestKind !== attempt.request_kind || displayed.startedAt !== attempt.started_at
          || displayed.wireOutputTokens !== attempt.wire_output_tokens) throw new Error('请求信息已更新，请重新核对。');
      }
      const approvedAt = Date.now();
      for (const id of snapshot.attemptIds) await tx.execute(
        `UPDATE llm_request_attempts SET replay_approved_at = COALESCE(replay_approved_at, ?)
          WHERE attempt_id = ? AND status = 'outcome_unknown'`, [approvedAt, id]);
    });
  }

  async acknowledgePlayReplay(input: Parameters<LlmReplayApprovalPort['acknowledgePlayReplay']>[0]): Promise<void> {
    if (!Array.isArray(input.attemptIds) || !input.attemptIds.length || input.attemptIds.length > 128
      || input.attemptIds.some(id => typeof id !== 'string' || !id)
      || new Set(input.attemptIds).size !== input.attemptIds.length) throw new Error('请选择本次展示的未知请求。');
    await this.db.transaction(async tx => {
      const branch = await tx.queryOne<{ state_version: number }>(
        'SELECT state_version FROM branches WHERE branch_id = ? AND campaign_id = ?', [input.branchId, input.campaignId]);
      if (!branch) throw new Error('战役分支不存在。');
      if (branch.state_version !== input.expectedStateVersion) throw new Error('战役状态已经更新，请重新读取恢复信息。');
      const inFlight = await tx.queryOne(`SELECT attempt_id FROM llm_request_attempts WHERE branch_id = ?
        AND state_version = ? AND request_kind IN ('planner', 'narrator') AND status IN ('prepared', 'sent')`,
        [input.branchId, input.expectedStateVersion]);
      if (inFlight) throw new Error('仍有回合请求正在发送，请稍后核对。');
      for (const id of input.attemptIds) {
        const attempt = await tx.queryOne('SELECT attempt_id FROM llm_request_attempts WHERE attempt_id = ? AND branch_id = ? AND (campaign_id IS NULL OR campaign_id = ?) AND state_version = ? AND request_kind IN (\'planner\', \'narrator\') AND status = \'outcome_unknown\'',
          [id, input.branchId, input.campaignId, input.expectedStateVersion]);
        if (!attempt) throw new Error('这条请求不属于当前未完成的回合。');
      }
      const approvedAt = Date.now();
      for (const id of input.attemptIds) await tx.execute(
        'UPDATE llm_request_attempts SET replay_approved_at = COALESCE(replay_approved_at, ?) WHERE attempt_id = ?', [approvedAt, id]);
    });
  }

  async beginAttempt(
    input: NewLlmRequestAttempt,
    startedAt: number,
  ): Promise<LlmRequestAttemptRecord> {
    return this.db.transaction(async tx => {
      const pending = await tx.queryAll<{ status: string; replay_approved_at: number | null }>(
        `SELECT status, replay_approved_at FROM llm_request_attempts
         WHERE logical_request_id = ? AND status IN ('prepared', 'sent', 'outcome_unknown')`,
        [input.logicalRequestId],
      );
      if (pending.some(attempt => attempt.status === 'prepared' || attempt.status === 'sent')) {
        throw new Error('logical_request_in_flight');
      }
      if (!input.allowOutcomeUnknownReplay && pending.some(attempt =>
        attempt.status === 'outcome_unknown' && attempt.replay_approved_at == null)) {
        throw new Error('outcome_unknown_replay_blocked');
      }
      // Explicit operator replay is auditable and does not erase the unknown outcome.
      // A later unknown attempt requires a separate approval.
      if (input.allowOutcomeUnknownReplay) {
        await tx.execute(
          `UPDATE llm_request_attempts SET replay_approved_at = ?
           WHERE logical_request_id = ? AND status = 'outcome_unknown' AND replay_approved_at IS NULL`,
          [startedAt, input.logicalRequestId],
        );
      }
      const existing = await tx.queryAll<{ attempt_no: number | null }>(
        'SELECT MAX(attempt_no) AS attempt_no FROM llm_request_attempts WHERE logical_request_id = ?',
        [input.logicalRequestId],
      );
      const attemptNo = (existing[0]?.attempt_no ?? 0) + 1;
      const attemptId = `${input.logicalRequestId}#a${attemptNo}`;
      await tx.execute(
        `INSERT INTO llm_request_attempts
          (attempt_id, logical_request_id, request_kind, campaign_id, branch_id, world_id,
           state_version, model_profile_fingerprint, reasoning_tier, reasoning_reserve_tokens,
           reasoning_policy_version, wire_output_tokens, attempt_no, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?)`,
        [
          attemptId,
          input.logicalRequestId,
          input.requestKind,
          input.campaignId ?? null,
          input.branchId ?? null,
          input.worldId ?? null,
          input.stateVersion ?? null,
          input.modelProfileFingerprint,
          input.reasoningTier ?? null,
          input.reasoningReserveTokens ?? null,
          input.reasoningPolicyVersion ?? null,
          input.wireOutputTokens ?? null,
          attemptNo,
          startedAt,
        ],
      );
      const rows = await tx.queryAll<AttemptRow>(
        `SELECT ${COLUMN_LIST} FROM llm_request_attempts WHERE attempt_id = ?`,
        [attemptId],
      );
      const row = rows[0];
      if (!row) throw new Error(`Ledger beginAttempt failed to persist ${attemptId}.`);
      return toRecord(row);
    });
  }

  async updateAttempt(attemptId: string, patch: LlmAttemptPatch): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.failureClass !== undefined) push('failure_class', patch.failureClass);
    if (patch.errorCode !== undefined) push('error_code', patch.errorCode);
    if (patch.httpStatus !== undefined) push('http_status', patch.httpStatus);
    if (patch.providerRequestId !== undefined) push('provider_request_id', patch.providerRequestId);
    if (patch.inputTokens !== undefined) push('input_tokens', patch.inputTokens);
    if (patch.outputTokens !== undefined) push('output_tokens', patch.outputTokens);
    if (patch.reasoningTokens !== undefined) push('reasoning_tokens', patch.reasoningTokens);
    if (patch.cachedInputTokens !== undefined) push('cached_input_tokens', patch.cachedInputTokens);
    if (patch.estimatedUsage !== undefined) push('estimated_usage', patch.estimatedUsage);
    if (patch.finishedAt !== undefined) push('finished_at', patch.finishedAt);
    if (sets.length === 0) return;
    // The sent transition must still own a prepared attempt. A cold-start
    // sweep racing this boundary cannot permit an untracked HTTP dispatch.
    const guard = patch.status === 'sent' ? " AND status = 'prepared'"
      : patch.status === 'outcome_unknown' ? " AND status IN ('prepared', 'sent')" : '';
    // Use the same transaction queue as beginAttempt. An unqueued execute
    // can otherwise become part of another host's transaction and be rolled
    // back after the HTTP request was already sent.
    const affected = await this.db.transaction(tx => tx.execute(
      `UPDATE llm_request_attempts SET ${sets.join(', ')} WHERE attempt_id = ?${guard}`,
      [...params, attemptId],
    ));
    if (patch.status === 'sent' && affected !== 1) throw new Error('logical_request_dispatch_fenced');
  }

  async listAttempts(logicalRequestId: string): Promise<LlmRequestAttemptRecord[]> {
    const rows = await this.db.queryAll<AttemptRow>(
      `SELECT ${COLUMN_LIST} FROM llm_request_attempts
        WHERE logical_request_id = ? ORDER BY attempt_no`,
      [logicalRequestId],
    );
    return rows.map(toRecord);
  }

  async listRecentReasoningTokens(input: {
    modelProfileFingerprint: string;
    reasoningTier: 'low' | 'high' | 'max';
    requestKind: string;
    limit: number;
  }): Promise<number[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 256) {
      throw new Error('Reasoning usage sample limit must be an integer from 1 to 256.');
    }
    const rows = await this.db.queryAll<{ reasoning_tokens: number }>(
      `SELECT reasoning_tokens FROM llm_request_attempts
        WHERE model_profile_fingerprint = ? AND reasoning_tier = ? AND request_kind = ?
          AND status IN ('succeeded', 'failed') AND reasoning_tokens IS NOT NULL
        ORDER BY started_at DESC, attempt_no DESC LIMIT ?`,
      [input.modelProfileFingerprint, input.reasoningTier, input.requestKind, input.limit],
    );
    return rows
      .map(row => row.reasoning_tokens)
      .filter(value => Number.isInteger(value) && value >= 0);
  }

  async listInterruptedAttemptIds(): Promise<string[]> {
    const rows = await this.db.queryAll<{ attempt_id: string }>(
      `SELECT attempt_id FROM llm_request_attempts
        WHERE status IN ('prepared', 'sent') ORDER BY started_at`,
    );
    return rows.map(row => row.attempt_id);
  }
}
