/**
 * Story-memory persistence (infrastructure plan §63-§65, §67).
 *
 * story_memory_states holds the folded state per branch; story_memory_patches
 * holds the immutable evidence-derived patch chain. Fork isolation replays
 * the chain up to the fork version - a branch can never inherit memory that
 * covers versions beyond its fork point.
 */

import type { SqliteDatabase, SqliteRow } from '../ports/sqlite';
import { emptyStoryMemoryState, type StoryMemoryPatch, type StoryMemoryState, type StoryMemoryStatus } from './storyMemoryTypes';
import { mergeStoryMemoryPatch } from './storyMemoryMerger';

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
    // Columns are authoritative over the JSON blob's metadata copy.
    state.metadata.status = row.status as StoryMemoryStatus;
    state.metadata.dirtyFromStateVersion = row.dirty_from_state_version;
    state.metadata.fingerprint = row.state_fingerprint;
    state.metadata.lastAppliedPatchId = row.last_applied_patch_id;
    state.metadata.updatedAt = row.updated_at;
    state.throughStateVersion = row.through_state_version;
    return state;
  }

  async saveState(state: StoryMemoryState): Promise<void> {
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
  }): Promise<void> {
    const now = new Date().toISOString();
    const db = this.db as SqliteDbOrTx & { transaction?: SqliteDatabase['transaction'] };
    if (typeof db.transaction !== 'function') {
      throw new Error('Atomic checkpoint application requires a transactional story-memory store.');
    }
    await db.transaction(async tx => {
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
    });
  }

  async markStatus(
    branchId: string,
    status: StoryMemoryStatus,
    options: { dirtyFromStateVersion?: number | null; updatedAt: string } ,
  ): Promise<void> {
    const current = await this.getState(branchId);
    if (!current) return;
    current.metadata.status = status;
    current.metadata.dirtyFromStateVersion = options.dirtyFromStateVersion ?? null;
    current.metadata.updatedAt = options.updatedAt;
    await this.saveState(current);
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
  const store = new SqliteStoryMemoryStore(db);
  for (const row of sourcePatches) {
    const patchId = `smp:${input.targetBranchId}:${row.fromStateVersion}-${row.toStateVersion}`;
    await db.execute(
      `INSERT INTO story_memory_patches
        (patch_id, branch_id, from_state_version, to_state_version, base_fingerprint,
         patch_json, status, created_at, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, ?)`,
      [
        patchId,
        input.targetBranchId,
        row.fromStateVersion,
        row.toStateVersion,
        row.baseFingerprint,
        JSON.stringify(row.patch),
        row.createdAt,
        row.appliedAt ?? input.createdAt,
      ],
    );
    state = mergeStoryMemoryPatch(state, {
      patch: row.patch,
      patchId,
      baseFingerprint: state.metadata.fingerprint,
      turnVersions: new Map(row.patch.completedBeats.map(beat => [beat.turnId, beat.stateVersion])),
      now: input.createdAt,
    });
  }
  state.metadata.status = sourcePatches.length > 0 ? 'clean' : 'empty';
  await store.saveState(state);
  return { throughStateVersion: state.throughStateVersion, appliedPatches: sourcePatches.length };
}
