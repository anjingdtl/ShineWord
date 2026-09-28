import {
  cloneGameState,
  type GameStateSnapshot,
  type RelationshipSnapshotEntry,
  type SkillSnapshotEntry,
} from '../../domain/state/types';
import type { SqliteDatabase } from '../ports/sqlite';
import type { TurnStore } from '../ports/turnStore';
import type { SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';
import { replaceEncounterSnapshots } from '../../infra/sqlite/encounterPersistence';

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
  /** True when the fork point snapshot carried a complete skill/relationship history. */
  historyComplete: boolean;
}

/**
 * Creates a new branch at a snapshot of the source branch. The source branch
 * is left untouched (rewind = fork at an earlier version + continue there).
 * Any UNRESOLVED turn on the source branch stays there: its persisted roll
 * belongs to the source branch and can never leak into or re-roll on the new
 * branch.
 *
 * Phase 2 correctness rules:
 * - Skills, relationships, cards, party and every other authoritative
 *   projection are restored FROM THE FORK-POINT SNAPSHOT inside the
 *   branch-creation transaction — never copied from the source branch's
 *   current rows (P2 acceptance A03).
 * - Phase-2 snapshots are complete. Legacy snapshots (no skills/relationships)
 *   can only be forked at their head (where current rows are correct); a
 *   historical legacy fork refuses instead of fabricating history.
 */
export async function forkBranch(input: ForkBranchInput): Promise<ForkBranchResult> {
  const { db, turnStore } = input;
  const sourceState = await turnStore.getState(input.sourceBranchId);
  if (!sourceState) throw new Error(`Unknown source branch: ${input.sourceBranchId}.`);

  const atHead = input.atStateVersion === undefined || input.atStateVersion === sourceState.stateVersion;
  let snapshot: GameStateSnapshot;
  if (atHead) {
    snapshot = cloneGameState(sourceState);
  } else {
    const row = await db.queryOne<{ snapshot_json: string }>(
      'SELECT snapshot_json FROM snapshots WHERE branch_id = ? AND state_version = ?',
      [input.sourceBranchId, input.atStateVersion!],
    );
    if (!row) {
      throw new Error(
        `No snapshot at version ${input.atStateVersion} for branch ${input.sourceBranchId}.`,
      );
    }
    snapshot = cloneGameState(JSON.parse(row.snapshot_json) as GameStateSnapshot);
  }

  const historyComplete = Array.isArray(snapshot.skills) && Array.isArray(snapshot.relationships);
  if (!historyComplete && !atHead) {
    throw new Error(
      `Legacy snapshot at version ${input.atStateVersion} lacks skill/relationship history; ` +
        'a historical fork would fabricate progress. Continue the branch read-only or create a new Phase-2 baseline.',
    );
  }

  if (!Array.isArray(snapshot.encounters)) {
    const existingEncounter = await db.queryOne(
      'SELECT encounter_id FROM encounters WHERE branch_id = ? LIMIT 1',
      [input.sourceBranchId],
    );
    if (existingEncounter && !atHead) {
      throw new Error(
        `Snapshot at version ${input.atStateVersion} lacks encounter history; ` +
          'a historical fork cannot reconstruct its battlefield from the branch head.',
      );
    }
    snapshot.encounters = [];
  }

  const existing = await db.queryOne('SELECT branch_id FROM branches WHERE branch_id = ?', [input.targetBranchId]);
  if (existing) throw new Error(`Target branch already exists: ${input.targetBranchId}.`);

  // Cards and party come from the fork-point snapshot. A snapshot without
  // card history may only take cards from CURRENT rows at the head (where
  // current == head); a historical fork with card rows present but no card
  // snapshot history refuses instead of fabricating (A03).
  let cards: NonNullable<GameStateSnapshot['cards']> = snapshot.cards ? [...snapshot.cards] : [];
  let party: NonNullable<GameStateSnapshot['party']> = snapshot.party ? [...snapshot.party] : [];
  if (!snapshot.cards) {
    const hasCardRows = await db.queryOne(
      'SELECT actor_id FROM actor_cards WHERE branch_id = ? LIMIT 1',
      [input.sourceBranchId],
    );
    if (hasCardRows && !atHead) {
      throw new Error(
        `Snapshot at version ${input.atStateVersion} lacks card history; ` +
          'a historical fork would copy the CURRENT card into the past. Play the branch forward once (any committed action re-stamps complete snapshots) or fork at the head.',
      );
    }
    if (hasCardRows && atHead) {
      const cardRows = await db.queryAll<{ actor_id: string; card_json: string }>(
        'SELECT actor_id, card_json FROM actor_cards WHERE branch_id = ? ORDER BY actor_id',
        [input.sourceBranchId],
      );
      cards = cardRows.map(row => ({
        actorId: row.actor_id,
        card: JSON.parse(row.card_json) as unknown,
      }));
      const partyRows = await db.queryAll<{ actor_id: string; controller: string; role: string; joined_at: string; party_group_id: string }>(
        'SELECT actor_id, controller, role, joined_at, party_group_id FROM party_members WHERE branch_id = ? ORDER BY actor_id',
        [input.sourceBranchId],
      );
      party = partyRows.map(row => ({
        actorId: row.actor_id,
        controller: row.controller,
        role: row.role,
        joinedAt: row.joined_at,
        groupId: row.party_group_id,
      }));
    }
  }

  snapshot.branchId = input.targetBranchId;
  const targetStateVersion = snapshot.stateVersion;
  const skills: SkillSnapshotEntry[] = snapshot.skills ?? [];
  const relationships: RelationshipSnapshotEntry[] = snapshot.relationships ?? [];
  if (cards.length > 0) snapshot.cards = cards;
  if (party.length > 0) snapshot.party = party;

  // Branch creation and ALL authoritative projections commit atomically.
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
    for (const skill of skills) {
      await tx.execute(
        `INSERT INTO actor_skills (branch_id, actor_id, skill_id, rank, practice_points, awarded_turns_json, state_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.targetBranchId, skill.actorId, skill.skillId, skill.rank, skill.practicePoints, JSON.stringify(skill.awardedKeys), targetStateVersion],
      );
    }
    for (const rel of relationships) {
      await tx.execute(
        `INSERT INTO relationships (branch_id, rel_id, from_actor_id, to_actor_id, stance, closeness, updated_turn_id, state_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.targetBranchId, rel.relId, rel.fromActorId, rel.toActorId, rel.stance, rel.closeness, rel.updatedTurnId, targetStateVersion],
      );
    }
    for (const card of cards) {
      await tx.execute(
        `INSERT INTO actor_cards (branch_id, actor_id, card_json, created_at, updated_at, updated_state_version)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.targetBranchId, card.actorId, JSON.stringify(card.card), input.createdAt, input.createdAt, targetStateVersion],
      );
    }
    for (const member of party) {
      await tx.execute(
        `INSERT INTO party_members (branch_id, actor_id, controller, role, joined_at, party_group_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.targetBranchId, member.actorId, member.controller, member.role, member.joinedAt, member.groupId ?? 'main'],
      );
    }
    await replaceEncounterSnapshots(tx, input.targetBranchId, snapshot.encounters ?? []);
    await tx.execute(
      `INSERT INTO snapshots (branch_id, state_version, snapshot_json, state_hash, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [input.targetBranchId, targetStateVersion, JSON.stringify(snapshot), input.createdAt],
    );
  });

  return {
    snapshot,
    copiedSkills: skills.length,
    copiedRelationships: relationships.length,
    historyComplete,
  };
}

/**
 * Marks canonical events after the fork anchor as pending FOR THIS BRANCH —
 * entering the game diverges the world; original-story events after the
 * anchor become candidate outcomes, not guaranteed history. The shared
 * canon_events table is never modified; the overlay is branch-scoped so two
 * campaigns of the same novel stay isolated.
 */
export async function markDivergence(
  worldStore: {
    markEventsPendingAfter(worldId: string, anchorEventId: string, branchId: string): Promise<number>;
  },
  worldId: string,
  anchorEventId: string,
  branchId: string,
): Promise<number> {
  return worldStore.markEventsPendingAfter(worldId, anchorEventId, branchId);
}
