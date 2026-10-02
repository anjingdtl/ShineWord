import type { SkillRank } from '../rules/types';
import type { EncounterState } from '../combat/encounter';
import type { BranchContentManifest } from '../content/types';

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
  /** Branch-local squad membership; separated members do not share context. */
  groupId?: string;
}

export interface ItemSourceSnapshotEntry {
  kind: 'starting_loadout' | 'recruitment' | 'quest_reward' | 'encounter_loot' | 'transfer';
  sourceId: string;
  obtainedAtStateVersion: number;
}

/** Full immutable encounter projection at a branch state version. */
export interface EncounterSnapshotEntry {
  state: EncounterState;
  zones: Array<{ zoneId: string; exits: string[] }>;
  zoneMap: Record<string, string>;
  exits: string[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface KnowledgeSnapshotEntry {
  entryId: string;
  actorId: string;
  knownAtStateVersion: number;
  sourceTurnId: string;
  knownVia: 'witnessed' | 'told' | 'inferred';
}

export interface QuestProgressSnapshotEntry {
  questId: string;
  status: 'available' | 'active' | 'succeeded' | 'failed' | 'abandoned';
  counters: Record<string, number>;
  processedEventIds?: string[];
  updatedStateVersion: number;
  completedStateVersion: number | null;
}

export interface QuestRewardSnapshotEntry {
  questId: string;
  rewardId: string;
  actorId: string;
  grantedStateVersion: number;
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
  /** Current scene zone when the locked world defines one. */
  zoneId?: string;
  resources: Record<string, number>;
  conditions: string[];
  /** Zero HP is a recoverable critical state until an explicit rule resolves it. */
  lifeStatus?: 'active' | 'incapacitated' | 'critical' | 'dead';
  /** Ability cooldown expiry expressed as a state version, restored with snapshots. */
  abilityCooldowns?: Record<string, number>;
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
  /** Item lineage is branch state and travels with snapshots, forks and saves. */
  itemSources?: Record<string, ItemSourceSnapshotEntry>;
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
  /** Encounters and battlefield state are authoritative branch history. */
  encounters?: EncounterSnapshotEntry[];
  /** Discoveries, quest counters and granted quest rewards are branch history. */
  discoveries?: KnowledgeSnapshotEntry[];
  questProgress?: QuestProgressSnapshotEntry[];
  questRewards?: QuestRewardSnapshotEntry[];
  /** Exact base + published branch deltas visible at this state. */
  contentManifest?: BranchContentManifest;
  /** Immutable world artifact selection and last historical style binding. */
  segmentContentBinding?: import('../content/types').ContentDependencyBinding & { artifactIds: readonly string[] };
  styleSnapshot?: import('../style/types').EffectiveStyleSnapshotV1;
}

function cloneEncounter(entry: EncounterSnapshotEntry): EncounterSnapshotEntry {
  const state = entry.state;
  return {
    state: {
      encounterId: state.encounterId,
      status: state.status,
      scene: {
        sceneId: state.scene.sceneId,
        coverSpotIds: [...state.scene.coverSpotIds],
        exitIds: [...state.scene.exitIds],
      },
      actors: Object.fromEntries(Object.entries(state.actors).map(([actorId, actor]) => [actorId, {
        ...actor,
        conditions: [...actor.conditions],
      }])),
      initiative: [...state.initiative],
      pendingActorIds: [...(state.pendingActorIds ?? [])],
      turnCursor: state.turnCursor,
      round: state.round,
    },
    zones: entry.zones.map(zone => ({ zoneId: zone.zoneId, exits: [...zone.exits] })),
    zoneMap: { ...entry.zoneMap },
    exits: [...entry.exits],
    createdAt: entry.createdAt,
    resolvedAt: entry.resolvedAt,
  };
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
          ...(actor.zoneId ? { zoneId: actor.zoneId } : {}),
          resources: { ...actor.resources },
          conditions: [...actor.conditions],
          ...(actor.lifeStatus ? { lifeStatus: actor.lifeStatus } : {}),
          ...(actor.abilityCooldowns ? { abilityCooldowns: { ...actor.abilityCooldowns } } : {}),
        },
      ]),
    ),
    itemOwners: { ...state.itemOwners },
  };
  if (state.contentManifest) {
    cloned.contentManifest = {
      ...state.contentManifest,
      basePackage: { ...state.contentManifest.basePackage },
      deltas: state.contentManifest.deltas.map(delta => ({ ...delta })),
    };
  }
  if (state.segmentContentBinding) cloned.segmentContentBinding = {
    ...state.segmentContentBinding, deltaIds: [...state.segmentContentBinding.deltaIds],
    artifactIds: [...state.segmentContentBinding.artifactIds],
  };
  if (state.styleSnapshot) cloned.styleSnapshot = JSON.parse(JSON.stringify(state.styleSnapshot)) as import('../style/types').EffectiveStyleSnapshotV1;
  if (state.itemSources) {
    cloned.itemSources = Object.fromEntries(Object.entries(state.itemSources).map(([itemId, source]) => [itemId, { ...source }]));
  }
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
    cloned.cards = state.cards.map(card => ({
      actorId: card.actorId,
      card: JSON.parse(JSON.stringify(card.card)) as unknown,
    }));
  }
  if (state.party) {
    cloned.party = state.party.map(member => ({ ...member }));
  }
  if (state.encounters) cloned.encounters = state.encounters.map(cloneEncounter);
  if (state.discoveries) cloned.discoveries = state.discoveries.map(entry => ({ ...entry }));
  if (state.questProgress) cloned.questProgress = state.questProgress.map(entry => ({
    ...entry,
    counters: { ...entry.counters },
    ...(entry.processedEventIds ? { processedEventIds: [...entry.processedEventIds] } : {}),
  }));
  if (state.questRewards) cloned.questRewards = state.questRewards.map(entry => ({ ...entry }));
  return cloned;
}
