import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';
import type { SchedulerResourceState, SchedulerResourceStore } from '../../application/worldBuild/rateScheduler';

/** Registered by M0 in schema 29. This is resource admission metadata, not a billing ledger. */
export const RESOURCE_GOVERNANCE_SQL = `
CREATE TABLE IF NOT EXISTS llm_resource_buckets (
  endpoint_bucket_id TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
interface BucketRow extends SqliteRow { state_json: string }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function nullableNumber(value: unknown): boolean { return value === null || number(value); }
function validPriority(value: unknown): boolean { return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3'; }
/** Corrupt quota state fails closed. Never clear the bucket and assume quota has recovered. */
function parseState(text: string): SchedulerResourceState {
  const state: unknown = JSON.parse(text);
  if (!object(state) || state.version !== 1 || !nullableNumber(state.rpm) || !nullableNumber(state.tpm)
    || !number(state.maxConcurrent) || !Number.isInteger(state.maxConcurrent) || state.maxConcurrent < 1 || state.maxConcurrent > 8
    || !nullableNumber(state.retryAfterUntil) || !number(state.rateLimitStreak)
    || !number(state.adaptiveSpacingMs) || !nullableNumber(state.nextGrantAt)
    || !number(state.playingUntil) || !number(state.interactiveTokenReserve)
    || !Array.isArray(state.activities) || !state.activities.every(value => object(value)
      && typeof value.owner === 'string' && number(value.playingUntil) && number(value.tokenReserve))
    || !Array.isArray(state.cancelledWorldIds) || !state.cancelledWorldIds.every(value => typeof value === 'string')
    || !Array.isArray(state.reservations) || !state.reservations.every(value => object(value)
      && typeof value.id === 'string' && typeof value.logicalTaskId === 'string'
      && number(value.t) && number(value.tokens) && typeof value.active === 'boolean'
      && typeof value.background === 'boolean' && number(value.activeUntil))
    || !Array.isArray(state.queue) || !state.queue.every(value => object(value)
      && typeof value.id === 'string' && typeof value.logicalTaskId === 'string'
      && typeof value.requestPlanHash === 'string' && (value.worldId === null || typeof value.worldId === 'string')
      && validPriority(value.priority) && number(value.queuedAt) && number(value.heartbeatAt)
      && nullableNumber(value.deadlineAt) && number(value.tokens) && nullableNumber(value.expectedDurationMs))) {
    throw new Error('Invalid persisted LLM resource bucket; admission blocked until resource state is repaired.');
  }
  return state as unknown as SchedulerResourceState;
}
export class SqliteSchedulerResourceStore implements SchedulerResourceStore {
  constructor(private readonly db: SqliteDatabase) {}
  async transact<T>(bucketId: string, initial: SchedulerResourceState,
    update: (state: SchedulerResourceState) => T): Promise<{ state: SchedulerResourceState; value: T }> {
    return this.db.transaction(async tx => {
      const row = await tx.queryOne<BucketRow>('SELECT state_json FROM llm_resource_buckets WHERE endpoint_bucket_id = ?', [bucketId]);
      const state = parseState(row ? row.state_json : JSON.stringify(initial));
      // Independently configured JS hosts cannot each claim their own full endpoint quota.
      if (initial.rpm !== null) state.rpm = state.rpm === null ? initial.rpm : Math.min(state.rpm, initial.rpm);
      if (initial.tpm !== null) state.tpm = state.tpm === null ? initial.tpm : Math.min(state.tpm, initial.tpm);
      state.maxConcurrent = Math.min(state.maxConcurrent, initial.maxConcurrent);
      const value = update(state);
      await tx.execute(`INSERT INTO llm_resource_buckets(endpoint_bucket_id, state_json, updated_at)
        VALUES (?, ?, ?) ON CONFLICT(endpoint_bucket_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
        [bucketId, JSON.stringify(state), Date.now()]);
      return { state, value };
    });
  }
}
