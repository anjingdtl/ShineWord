/**
 * Story-memory persistence (infrastructure plan §63-§65, §67).
 *
 * story_memory_states holds the folded state per branch; story_memory_patches
 * holds the immutable evidence-derived patch chain. Fork isolation replays
 * the chain up to the fork version - a branch can never inherit memory that
 * covers versions beyond its fork point.
 */

import type { SqliteDatabase, SqliteRow } from '../ports/sqlite';
import { emptyStoryMemoryState, storyMemoryContentHash, type StoryMemoryPatch, type StoryMemoryState, type StoryMemoryStatus } from './storyMemoryTypes';
import { mergeStoryMemoryPatch } from './storyMemoryMerger';
import { stableFingerprint } from '../llm/requestPlan';

export interface MemoryWorkerFence {
  owner: string; token: number; branchId: string;
  checkedAt?: string;
  handoffs: ReadonlyArray<{ handoffId: string; fencingToken: number }>;
}

/** Anything that can run SQL: a database connection or an open transaction. */
type SqliteDbOrTx = Pick<SqliteDatabase, 'execute' | 'queryAll'>;

interface StateRow extends SqliteRow {
  branch_id: string;
  through_state_version: number;
  state_json: string;
  state_fingerprint: string;
  status: string;
  dirty_from_state_version: number | null;
  last_applied_patch_id: string | null;
  updated_at: string;
}

export interface StoryMemoryPatchRow {
  patchId: string;
  branchId: string;
  fromStateVersion: number;
  toStateVersion: number;
  baseFingerprint: string;
  resultFingerprint: string | null;
  status: 'pending' | 'applied' | 'rejected';
  patch: StoryMemoryPatch;
  createdAt: string;
  appliedAt: string | null;
}

interface PatchRow extends SqliteRow {
  patch_id: string;
  branch_id: string;
  from_state_version: number;
  to_state_version: number;
  base_fingerprint: string;
  result_fingerprint: string | null;
  patch_json: string;
  status: string;
  created_at: string;
  applied_at: string | null;
}

/** P8-4 (I09): raised when a CAS-guarded checkpoint write loses the race. */
export class StoryMemoryCasConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryMemoryCasConflictError';
  }
}

export class SqliteStoryMemoryStore {
  constructor(private readonly db: SqliteDbOrTx) {}

  async getState(branchId: string): Promise<StoryMemoryState | null> {
    const rows = await this.db.queryAll<StateRow>(
      'SELECT * FROM story_memory_states WHERE branch_id = ?',
      [branchId],
    );
    const row = rows[0];
    if (!row) return null;
    const state = JSON.parse(row.state_json) as StoryMemoryState;
    if (state.schemaVersion !== 3) throw new Error('Unsupported story memory schema; current protocol is V3.');
    // Columns are authoritative over the JSON blob's metadata copy.
    state.metadata.status = row.status as StoryMemoryStatus;
    state.metadata.dirtyFromStateVersion = row.dirty_from_state_version;
    state.metadata.fingerprint = row.state_fingerprint;
    state.metadata.lastAppliedPatchId = row.last_applied_patch_id;
    state.metadata.updatedAt = row.updated_at;
    state.throughStateVersion = row.through_state_version;
    if ((state.metadata.status === 'clean' && !state.metadata.contentHash) || state.metadata.contentHash && state.metadata.contentHash !== storyMemoryContentHash(state)) {
      throw new Error('Story memory checkpoint content hash mismatch.');
    }
    return state;
  }

  async saveState(state: StoryMemoryState): Promise<void> {
    state.metadata.contentHash = storyMemoryContentHash(state);
    await this.db.execute(
      `INSERT INTO story_memory_states
        (branch_id, through_state_version, state_json, state_fingerprint, status,
         dirty_from_state_version, last_applied_patch_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id) DO UPDATE SET
         through_state_version = excluded.through_state_version,
         state_json = excluded.state_json,
         state_fingerprint = excluded.state_fingerprint,
         status = excluded.status,
         dirty_from_state_version = excluded.dirty_from_state_version,
         last_applied_patch_id = excluded.last_applied_patch_id,
         updated_at = excluded.updated_at`,
      [
        state.branchId,
        state.throughStateVersion,
        JSON.stringify(state),
        state.metadata.fingerprint,
        state.metadata.status,
        state.metadata.dirtyFromStateVersion,
        state.metadata.lastAppliedPatchId,
        state.metadata.updatedAt,
      ],
    );
  }

  async getCheckpointAt(branchId: string, maxVersion: number): Promise<StoryMemoryState | null> {
    const rows = await this.db.queryAll<{ state_json: string; content_hash: string }>(
      `SELECT state_json, content_hash FROM story_memory_checkpoints
       WHERE branch_id = ? AND through_state_version <= ? ORDER BY through_state_version DESC LIMIT 1`,
      [branchId, maxVersion]);
    if (!rows[0]) return null;
    const state = JSON.parse(rows[0].state_json) as StoryMemoryState;
    if (state.schemaVersion !== 3 || state.branchId !== branchId
      || storyMemoryContentHash(state) !== rows[0].content_hash) throw new Error('Story checkpoint integrity mismatch.');
    return state;
  }

  async freezeBatchRequest<T>(input: { batchId: string; branchId: string; from: number; to: number;
    baseFingerprint: string; payload: T }): Promise<T> {
    await this.db.execute(`INSERT OR IGNORE INTO story_memory_batch_requests
      (batch_id,branch_id,from_state_version,to_state_version,base_fingerprint,payload_json,content_hash,created_at)
      VALUES (?,?,?,?,?,?,?,?)`, [input.batchId, input.branchId, input.from, input.to,
      input.baseFingerprint, JSON.stringify(input.payload), stableFingerprint(input.payload), new Date().toISOString()]);
    const rows = await this.db.queryAll<{ payload_json: string; content_hash: string; base_fingerprint: string }>(
      'SELECT payload_json,content_hash,base_fingerprint FROM story_memory_batch_requests WHERE batch_id = ?', [input.batchId]);
    if (!rows[0]) throw new Error('Frozen memory batch is missing.');
    const payload = JSON.parse(rows[0].payload_json) as T;
    if (stableFingerprint(payload) !== rows[0].content_hash || rows[0].base_fingerprint !== input.baseFingerprint) {
      throw new Error('Frozen memory batch integrity/base mismatch; refusing live reassembly.');
    }
    return payload;
  }

  async saveBatchResponse(batchId: string, response: unknown): Promise<void> {
    const rows = await this.db.queryAll<{ n: number }>(
      'SELECT COALESCE(MAX(response_no),0)+1 AS n FROM story_memory_batch_responses WHERE batch_id=?', [batchId]);
    await this.db.execute('INSERT INTO story_memory_batch_responses VALUES (?,?,?,?,?)',
      [batchId, rows[0]!.n, JSON.stringify(response), stableFingerprint(response), new Date().toISOString()]);
  }

  async loadBatchResponse<T>(batchId: string): Promise<T | null> {
    const rows = await this.db.queryAll<{ response_json: string; content_hash: string }>(
      'SELECT response_json,content_hash FROM story_memory_batch_responses WHERE batch_id=? ORDER BY response_no DESC LIMIT 1', [batchId]);
    if (!rows[0]) return null;
    const response = JSON.parse(rows[0].response_json) as T;
    if (stableFingerprint(response) !== rows[0].content_hash) throw new Error('Memory response integrity mismatch.');
    return response;
  }

  /**
   * P8-4 CAS write (I09): the update only lands when the stored fingerprint
   * still equals `expectedFingerprint`. A stale worker's write is refused
   * with StoryMemoryCasConflictError instead of clobbering a newer checkpoint.
   */
  async saveStateCas(
    state: StoryMemoryState,
    options: { expectedFingerprint: string | null },
  ): Promise<void> {
    const expected = options.expectedFingerprint;
    state.metadata.contentHash = storyMemoryContentHash(state);
    const changes = await this.db.execute(
      `UPDATE story_memory_states SET
         through_state_version = ?,
         state_json = ?,
         state_fingerprint = ?,
         status = ?,
         dirty_from_state_version = ?,
         last_applied_patch_id = ?,
         updated_at = ?
       WHERE branch_id = ? AND state_fingerprint ${expected === null ? 'IS NULL' : '= ?'}`,
      expected === null
        ? [
            state.throughStateVersion,
            JSON.stringify(state),
            state.metadata.fingerprint,
            state.metadata.status,
            state.metadata.dirtyFromStateVersion,
            state.metadata.lastAppliedPatchId,
            state.metadata.updatedAt,
            state.branchId,
          ]
        : [
            state.throughStateVersion,
            JSON.stringify(state),
            state.metadata.fingerprint,
            state.metadata.status,
            state.metadata.dirtyFromStateVersion,
            state.metadata.lastAppliedPatchId,
            state.metadata.updatedAt,
            state.branchId,
            expected,
          ],
    );
    if (changes > 0) return;
    const existing = await this.getState(state.branchId);
    if (!existing) {
      // Absent row and no expected fingerprint: first write is legitimate.
      if (expected === null || expected === 'seed' || expected === '') {
        await this.saveState(state);
        return;
      }
      throw new StoryMemoryCasConflictError(
        `Story memory CAS refused: branch ${state.branchId} has no checkpoint but expected fingerprint '${expected}'.`,
      );
    }
    throw new StoryMemoryCasConflictError(
      `Story memory CAS refused: branch ${state.branchId} checkpoint fingerprint '${existing.metadata.fingerprint}'`
        + ` does not match expected '${expected ?? 'null'}'; the stale write must not overwrite the newer checkpoint.`,
    );
  }

  /**
   * P8-5 atomic checkpoint application (B09/I09, plan §15.5): patch insert,
   * CAS-guarded state write and patch-applied marking happen in ONE
   * transaction. A crash can never leave a pending patch row with an
   * already-advanced state row, and a concurrent writer's checkpoint (CAS
   * mismatch) aborts the whole batch.
   */
  async applyCheckpointAtomically(input: {
    patchRow: {
      patchId: string;
      fromStateVersion: number;
      toStateVersion: number;
      baseFingerprint: string;
      patch: StoryMemoryPatch;
    };
    nextState: StoryMemoryState;
    workerFence?: MemoryWorkerFence;
  }): Promise<void> {
    const now = new Date().toISOString();
    const db = this.db as SqliteDbOrTx & { transaction?: SqliteDatabase['transaction'] };
    if (typeof db.transaction !== 'function') {
      throw new Error('Atomic checkpoint application requires a transactional story-memory store.');
    }
    await db.transaction(async tx => {
      if (input.workerFence) {
        const fence = input.workerFence;
        const leases = await tx.queryAll<{ fencing_token: number; lease_owner: string; lease_expires_at: string }>(
          'SELECT fencing_token,lease_owner,lease_expires_at FROM story_memory_worker_leases WHERE branch_id = ?', [fence.branchId]);
        const lease = leases[0];
        if (!lease || lease.fencing_token !== fence.token || lease.lease_owner !== fence.owner
          || lease.lease_expires_at <= (fence.checkedAt ?? now) || fence.branchId !== input.nextState.branchId) {
          throw new StoryMemoryCasConflictError('Memory worker lease/fence expired.');
        }
      }
      const txStore = new SqliteStoryMemoryStore(tx);
      await txStore.insertPatch({
        patchId: input.patchRow.patchId,
        branchId: input.nextState.branchId,
        fromStateVersion: input.patchRow.fromStateVersion,
        toStateVersion: input.patchRow.toStateVersion,
        baseFingerprint: input.patchRow.baseFingerprint,
        patch: input.patchRow.patch,
        createdAt: now,
      });
      await txStore.saveStateCas(input.nextState, {
        expectedFingerprint: input.patchRow.baseFingerprint,
      });
      await txStore.markPatchApplied(input.patchRow.patchId, input.nextState.metadata.fingerprint, now);
      await tx.execute(`INSERT INTO story_memory_checkpoints
        (branch_id,through_state_version,state_json,content_hash,created_at) VALUES (?,?,?,?,?)`,
        [input.nextState.branchId, input.nextState.throughStateVersion, JSON.stringify(input.nextState),
          storyMemoryContentHash(input.nextState), now]);
      for (const handoff of input.workerFence?.handoffs ?? []) {
        await tx.execute(`UPDATE frozen_turn_postprocess_outbox SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,updated_at=?,
          physical_http_count=(SELECT COUNT(*) FROM llm_request_attempts a WHERE a.branch_id=frozen_turn_postprocess_outbox.branch_id
            AND a.state_version=frozen_turn_postprocess_outbox.committed_state_version AND a.request_kind IN ('memory_checkpoint','memory_repair') AND a.status<>'prepared')
          WHERE handoff_id=? AND status='running' AND lease_owner=? AND fencing_token=?
          AND committed_state_version <= ?`, [now, handoff.handoffId, input.workerFence!.owner,
          handoff.fencingToken, input.nextState.throughStateVersion]);
      }
    });
  }

  async markStatus(
    branchId: string,
    status: StoryMemoryStatus,
    options: { dirtyFromStateVersion?: number | null; updatedAt: string; expectedFingerprint?: string } ,
  ): Promise<void> {
    const current = await this.getState(branchId);
    if (!current) return;
    if (options.expectedFingerprint && current.metadata.fingerprint !== options.expectedFingerprint) return;
    current.metadata.status = status;
    current.metadata.dirtyFromStateVersion = options.dirtyFromStateVersion ?? null;
    current.metadata.updatedAt = options.updatedAt;
    await this.saveStateCas(current, { expectedFingerprint: options.expectedFingerprint ?? current.metadata.fingerprint });
  }

  async insertPatch(row: {
    patchId: string;
    branchId: string;
    fromStateVersion: number;
    toStateVersion: number;
    baseFingerprint: string;
    patch: StoryMemoryPatch;
    createdAt: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO story_memory_patches
        (patch_id, branch_id, from_state_version, to_state_version, base_fingerprint,
         patch_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        row.patchId,
        row.branchId,
        row.fromStateVersion,
        row.toStateVersion,
        row.baseFingerprint,
        JSON.stringify(row.patch),
        row.createdAt,
      ],
    );
  }

  async markPatchApplied(patchId: string, resultFingerprint: string, appliedAt: string): Promise<void> {
    await this.db.execute(
      `UPDATE story_memory_patches
         SET status = 'applied', result_fingerprint = ?, applied_at = ?
       WHERE patch_id = ?`,
      [resultFingerprint, appliedAt, patchId],
    );
  }

  async markPatchRejected(patchId: string): Promise<void> {
    await this.db.execute(
      `UPDATE story_memory_patches SET status = 'rejected' WHERE patch_id = ?`,
      [patchId],
    );
  }

  async listPatches(branchId: string, upToVersion?: number): Promise<StoryMemoryPatchRow[]> {
    const rows = upToVersion === undefined
      ? await this.db.queryAll<PatchRow>(
        'SELECT * FROM story_memory_patches WHERE branch_id = ? ORDER BY to_state_version',
        [branchId],
      )
      : await this.db.queryAll<PatchRow>(
        `SELECT * FROM story_memory_patches
          WHERE branch_id = ? AND to_state_version <= ? ORDER BY to_state_version`,
        [branchId, upToVersion],
      );
    return rows.map(row => ({
      patchId: row.patch_id,
      branchId: row.branch_id,
      fromStateVersion: row.from_state_version,
      toStateVersion: row.to_state_version,
      baseFingerprint: row.base_fingerprint,
      resultFingerprint: row.result_fingerprint,
      status: row.status as StoryMemoryPatchRow['status'],
      patch: JSON.parse(row.patch_json) as StoryMemoryPatch,
      createdAt: row.created_at,
      appliedAt: row.applied_at,
    }));
  }
}

export interface ForkedStoryMemory {
  throughStateVersion: number;
  appliedPatches: number;
}

/**
 * Branch fork isolation (plan §28, §67): copy the patch chain up to the fork
 * version onto the new branch and fold it from an empty seed. The new branch
 * can never see memory that covers versions beyond its fork point. Runs
 * INSIDE the fork transaction (pass the tx as `db`).
 */
export async function forkStoryMemory(
  db: SqliteDbOrTx,
  input: {
    sourceBranchId: string;
    targetBranchId: string;
    forkStateVersion: number;
    createdAt: string;
  },
): Promise<ForkedStoryMemory> {
  const sourcePatches = (await new SqliteStoryMemoryStore(db)
    .listPatches(input.sourceBranchId, input.forkStateVersion))
    // P8-5 (B15/I13): only APPLIED patches replay onto the fork. A pending or
    // rejected row was never a consumed checkpoint — replaying it would
    // fabricate memory the source branch never observed.
    .filter(row => row.status === 'applied');

  let state = emptyStoryMemoryState(input.targetBranchId, input.createdAt);
  let sourceState = emptyStoryMemoryState(input.sourceBranchId, input.createdAt);
  const store = new SqliteStoryMemoryStore(db);
  for (const row of sourcePatches) {
    if (!row.patch.evidenceVersions) throw new Error('Memory patch lacks its exact evidence version manifest.');
    const turnVersions = new Map(Object.entries(row.patch.evidenceVersions));
    if ([...turnVersions.values()].some(v => !Number.isSafeInteger(v) || v <= row.fromStateVersion || v > row.toStateVersion)) throw new Error('Memory evidence version manifest is invalid.');
    sourceState = mergeStoryMemoryPatch(sourceState, { patch: row.patch, patchId: row.patchId,
      baseFingerprint: row.baseFingerprint, turnVersions, now: input.createdAt });
    if (sourceState.metadata.fingerprint !== row.resultFingerprint) throw new Error('Memory source patch chain integrity mismatch.');
    const patchId = `smp:${input.targetBranchId}:${row.fromStateVersion}-${row.toStateVersion}`;
    const baseFingerprint = state.metadata.fingerprint;
    state = mergeStoryMemoryPatch(state, { patch: row.patch, patchId, baseFingerprint, turnVersions, now: input.createdAt });
    await store.insertPatch({ patchId, branchId: input.targetBranchId, fromStateVersion: row.fromStateVersion,
      toStateVersion: row.toStateVersion, baseFingerprint, patch: row.patch, createdAt: row.createdAt });
    await store.markPatchApplied(patchId, state.metadata.fingerprint, input.createdAt);
    await db.execute(`INSERT INTO story_memory_checkpoints(branch_id,through_state_version,state_json,content_hash,created_at)
      VALUES (?,?,?,?,?)`, [input.targetBranchId, state.throughStateVersion, JSON.stringify(state), storyMemoryContentHash(state), input.createdAt]);
  }
  state.metadata.status = sourcePatches.length > 0 ? 'clean' : 'empty';
  await store.saveState(state);
  return { throughStateVersion: state.throughStateVersion, appliedPatches: sourcePatches.length };
}
