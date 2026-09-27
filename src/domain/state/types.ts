import type { SkillRank } from '../rules/types';

/**
 * Snapshot-level skill projection. `awardedKeys` carries
 * `encounterId:rewardKind` entries so historical restores replay the exact
 * reward state of that version (a replayed encounter finds its own key).
 * Free-exploration challenges also append `<challengeId>:closed` markers when
 * a challenge is achieved (see progression/growth.ts).
 */
export interface SkillSnapshotEntry {
  actorId: string;
  skillId: string;
  rank: SkillRank;
  practicePoints: number;
  awardedKeys: string[];
}

/** Card snapshot: the full ActorCard JSON at this version (plan §15.2). */
export interface CardSnapshotEntry {
  actorId: string;
  card: unknown;
}

/** Party membership snapshot at this version. */
export interface PartySnapshotEntry {
  actorId: string;
  controller: string;
  role: string;
  joinedAt: string;
}

export interface RelationshipSnapshotEntry {
  relId: string;
  fromActorId: string;
  toActorId: string;
  stance: string;
  closeness: number;
  updatedTurnId: string | null;
}

export interface ActorState {
  actorId: string;
  locationId: string;
  resources: Record<string, number>;
  conditions: string[];
}

export interface GameStateSnapshot {
  branchId: string;
  stateVersion: number;
  /** World clock in seconds (plan §10.3). Authoritative when present. */
  clockSeconds?: number;
  /** Legacy V0.1 clock in minutes; superseded by clockSeconds. */
  clockMinutes: number;
  actors: Record<string, ActorState>;
  itemOwners: Record<string, string>;
  /**
   * Complete-snapshot fields. Written by every commit since Phase 2; absent in
   * legacy pre-Phase-2 snapshots, where historical restore must refuse instead
   * of copying the source branch's current rows.
   */
  skills?: SkillSnapshotEntry[];
  relationships?: RelationshipSnapshotEntry[];
  /**
   * Character cards and party membership at this version (P2 acceptance A03):
   * a historical fork restores cards/party from the fork-point snapshot —
   * never by copying the source branch's current rows.
   */
  cards?: CardSnapshotEntry[];
  party?: PartySnapshotEntry[];
}

export function cloneGameState(state: GameStateSnapshot): GameStateSnapshot {
  const cloned: GameStateSnapshot = {
    branchId: state.branchId,
    stateVersion: state.stateVersion,
    clockSeconds: state.clockSeconds ?? state.clockMinutes * 60,
    clockMinutes: state.clockSeconds !== undefined ? Math.floor(state.clockSeconds / 60) : state.clockMinutes,
    actors: Object.fromEntries(
      Object.entries(state.actors).map(([id, actor]) => [
        id,
        {
          actorId: actor.actorId,
          locationId: actor.locationId,
          resources: { ...actor.resources },
          conditions: [...actor.conditions],
        },
      ]),
    ),
    itemOwners: { ...state.itemOwners },
  };
  if (state.skills) {
    cloned.skills = state.skills.map(skill => ({
      ...skill,
      awardedKeys: [...skill.awardedKeys],
    }));
  }
  if (state.relationships) {
    cloned.relationships = state.relationships.map(rel => ({ ...rel }));
  }
  if (state.cards) {
    cloned.cards = state.cards.map(card => ({ actorId: card.actorId, card: card.card }));
  }
  if (state.party) {
    cloned.party = state.party.map(member => ({ ...member }));
  }
  return cloned;
}
