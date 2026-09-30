/**
 * SQLite-backed durable physical-request ledger (infrastructure plan §52).
 * Migration 19 `llm_request_ledger` owns the table shape.
 */

import type {
  LlmAttemptPatch,
  LlmAttemptStatus,
  LlmRequestAttemptRecord,
  LlmRequestLedgerStore,
  NewLlmRequestAttempt,
} from '../../application/ports/llmLedger';
import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';

interface AttemptRow extends SqliteRow {
  attempt_id: string;
  logical_request_id: string;
  request_kind: string;
  campaign_id: string | null;
  branch_id: string | null;
  world_id: string | null;
  state_version: number | null;
  model_profile_fingerprint: string;
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
  };
}

const COLUMN_LIST = `attempt_id, logical_request_id, request_kind, campaign_id, branch_id, world_id,
  state_version, model_profile_fingerprint, attempt_no, status, failure_class, error_code, http_status,
  provider_request_id, input_tokens, output_tokens, reasoning_tokens, cached_input_tokens,
  estimated_usage, started_at, finished_at`;

export class SqliteLlmLedgerStore implements LlmRequestLedgerStore {
  constructor(private readonly db: SqliteDatabase) {}

  async beginAttempt(
    input: NewLlmRequestAttempt,
    startedAt: number,
  ): Promise<LlmRequestAttemptRecord> {
    const existing = await this.db.queryAll<{ count: number }>(
      'SELECT COUNT(*) AS count FROM llm_request_attempts WHERE logical_request_id = ?',
      [input.logicalRequestId],
    );
    const attemptNo = (existing[0]?.count ?? 0) + 1;
    const attemptId = `${input.logicalRequestId}#a${attemptNo}`;
    await this.db.execute(
      `INSERT INTO llm_request_attempts
        (attempt_id, logical_request_id, request_kind, campaign_id, branch_id, world_id,
         state_version, model_profile_fingerprint, attempt_no, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?)`,
      [
        attemptId,
        input.logicalRequestId,
        input.requestKind,
        input.campaignId ?? null,
        input.branchId ?? null,
        input.worldId ?? null,
        input.stateVersion ?? null,
        input.modelProfileFingerprint,
        attemptNo,
        startedAt,
      ],
    );
    const rows = await this.db.queryAll<AttemptRow>(
      `SELECT ${COLUMN_LIST} FROM llm_request_attempts WHERE attempt_id = ?`,
      [attemptId],
    );
    const row = rows[0];
    if (!row) throw new Error(`Ledger beginAttempt failed to persist ${attemptId}.`);
    return toRecord(row);
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
    await this.db.execute(
      `UPDATE llm_request_attempts SET ${sets.join(', ')} WHERE attempt_id = ?`,
      [...params, attemptId],
    );
  }

  async listAttempts(logicalRequestId: string): Promise<LlmRequestAttemptRecord[]> {
    const rows = await this.db.queryAll<AttemptRow>(
      `SELECT ${COLUMN_LIST} FROM llm_request_attempts
        WHERE logical_request_id = ? ORDER BY attempt_no`,
      [logicalRequestId],
    );
    return rows.map(toRecord);
  }

  async listInterruptedAttemptIds(): Promise<string[]> {
    const rows = await this.db.queryAll<{ attempt_id: string }>(
      `SELECT attempt_id FROM llm_request_attempts
        WHERE status IN ('prepared', 'sent') ORDER BY started_at`,
    );
    return rows.map(row => row.attempt_id);
  }
}
