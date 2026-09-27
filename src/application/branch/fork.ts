import { cloneGameState, type GameStateSnapshot } from '../../domain/state/types';
import type { SqliteDatabase } from '../ports/sqlite';
import type { TurnStore } from '../ports/turnStore';
import type { SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';

export interface ForkBranchInput {
  db: SqliteDatabase;
  turnStore: TurnStore;
  gameStore: SqliteGameStore;
  sourceBranchId: string;
  targetBranchId: string;
  campaignId: string;
  forkTurnId: string | null;
  /** Fork point state version; defaults to the source branch head. */
  atStateVersion?: number;
  createdAt: string;
}

export interface ForkBranchResult {
  snapshot: GameStateSnapshot;
  copiedSkills: number;
  copiedRelationships: number;
}

/**
 * Creates a new branch at a snapshot of the source branch. The source branch
 * is left untouched (rewind = fork at an earlier version + continue there).
 * Any UNRESOLVED turn on the source branch stays there: its persisted roll
 * belongs to the source branch and can never leak into or re-roll on the new
 * branch.
 */
export async function forkBranch(input: ForkBranchInput): Promise<ForkBranchResult> {
  const { db, turnStore, gameStore } = input;
  const sourceState = await turnStore.getState(input.sourceBranchId);
  if (!sourceState) throw new Error(`Unknown source branch: ${input.sourceBranchId}.`);

  let snapshot: GameStateSnapshot;
  if (input.atStateVersion === undefined || input.atStateVersion === sourceState.stateVersion) {
    snapshot = cloneGameState(sourceState);
  } else {
    const row = await db.queryOne<{ snapshot_json: string }>(
      'SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = ?',
      [input.sourceBranchId, input.atStateVersion],
    );
    if (!row) {
      throw new Error(
        `No snapshot at version ${input.atStateVersion} for branch ${input.sourceBranchId}.`,
      );
    }
    snapshot = cloneGameState(JSON.parse(row.snapshot_json) as GameStateSnapshot);
  }

  const existing = await db.queryOne('SELECT branch_id FROM branches WHERE branch_id = ?', [input.targetBranchId]);
  if (existing) throw new Error(`Target branch already exists: ${input.targetBranchId}.`);

  snapshot.branchId = input.targetBranchId;
  const targetStateVersion = snapshot.stateVersion;

  await db.transaction(async tx => {
    await tx.execute(
      `INSERT INTO branches (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.targetBranchId, input.campaignId, input.sourceBranchId, input.forkTurnId, targetStateVersion, input.createdAt],
    );
    for (const actor of Object.values(snapshot.actors)) {
      await tx.execute(
        `INSERT INTO actor_states (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.targetBranchId, actor.actorId, targetStateVersion, actor.locationId, JSON.stringify(actor.resources), JSON.stringify(actor.conditions)],
      );
    }
    for (const [itemId, owner] of Object.entries(snapshot.itemOwners)) {
      await tx.execute(
        'INSERT INTO inventory (branch_id, item_id, owner_actor_id, state_version) VALUES (?, ?, ?, ?)',
        [input.targetBranchId, itemId, owner, targetStateVersion],
      );
    }
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [input.targetBranchId, targetStateVersion, JSON.stringify(snapshot), input.createdAt],
    );
  });

  const copiedSkills = await gameStore.copySkills(input.sourceBranchId, input.targetBranchId);
  await gameStore.copyRelationships(input.sourceBranchId, input.targetBranchId);

  return {
    snapshot,
    copiedSkills,
    copiedRelationships: (await gameStore.listRelationships(input.targetBranchId)).length,
  };
}

/**
 * Marks canonical events after the fork anchor as pending for this branch —
 * entering the game diverges the world; original-story events after the
 * anchor become candidate outcomes, not guaranteed history.
 */
export async function markDivergence(
  worldStore: {
    markEventsPendingAfter(worldId: string, anchorEventId: string): Promise<number>;
  },
  worldId: string,
  anchorEventId: string,
): Promise<number> {
  return worldStore.markEventsPendingAfter(worldId, anchorEventId);
}
