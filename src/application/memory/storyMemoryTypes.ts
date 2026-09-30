/**
 * Story Memory V2 types (infrastructure plan §19-§28).
 *
 * Long-term NARRATIVE state derived from committed turns: goals, emotions,
 * promises, secrets, relationships, conflicts, threads, foreshadowing. It is
 * NOT authority for numbers - HP/stamina/inventory/skills/location/quest
 * counters always come from GameStateSnapshot.
 *
 * Updates flow as PATCHES: the model proposes changes for a version range;
 * stable IDs, state versions and fingerprints are produced locally.
 */

export type StoryMemoryStatus = 'empty' | 'clean' | 'dirty' | 'rebuilding' | 'failed';

export interface StoryArc {
  title: string;
  summary: string;
}

export interface StoryMemoryCharacter {
  actorId: string;
  stableIdentitySummary: string;
  currentNarrativeState: {
    emotionalState: string;
    currentGoal: string;
    concerns: string[];
    promises: string[];
    secretsKnownToPlayer: string[];
  };
  importantExperiences: string[];
  lastChangedStateVersion: number;
}

export interface StoryMemoryRelationship {
  relationshipId: string;
  fromActorId: string;
  toActorId: string;
  relationType: string;
  currentNarrativeState: string;
  trustNarrative: string;
  importantPromises: string[];
  unresolvedTensions: string[];
  publicStatus: 'public' | 'secret' | 'misunderstood';
  lastChangedStateVersion: number;
}

export interface StoryConflict {
  conflictId: string;
  title: string;
  description: string;
  stakes: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  lastChangedStateVersion: number;
}

export interface StoryThread {
  threadId: string;
  title: string;
  description: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  lastChangedStateVersion: number;
}

export interface StoryForeshadowing {
  foreshadowingId: string;
  title: string;
  description: string;
  status: 'planted' | 'paid_off';
  payoff: string | null;
  lastChangedStateVersion: number;
}

export interface StoryBeat {
  turnId: string;
  stateVersion: number;
  summary: string;
}

export interface StoryResolvedThread {
  threadId: string;
  title: string;
  resolution: string;
  resolvedAtStateVersion: number;
}

export interface StoryMemoryState {
  schemaVersion: 2;
  branchId: string;
  /** Highest state version folded into this memory. */
  throughStateVersion: number;
  characters: Record<string, StoryMemoryCharacter>;
  relationships: Record<string, StoryMemoryRelationship>;
  narrative: {
    currentArc: StoryArc | null;
    currentObjective: string;
    activeConflicts: Record<string, StoryConflict>;
    openThreads: Record<string, StoryThread>;
    foreshadowing: Record<string, StoryForeshadowing>;
    recentCompletedBeats: StoryBeat[];
    recentResolvedThreads: StoryResolvedThread[];
    archiveDigest: string;
  };
  metadata: {
    status: StoryMemoryStatus;
    dirtyFromStateVersion: number | null;
    fingerprint: string;
    lastAppliedPatchId: string | null;
    updatedAt: string;
  };
}

// --------------------------------------------------------------------- patch

export interface StoryMemoryCharacterUpdate {
  actorId: string;
  action: 'upsert';
  stableIdentitySummary?: string;
  emotionalState?: string;
  currentGoal?: string;
  concerns?: string[];
  promises?: string[];
  secretsKnownToPlayer?: string[];
  importantExperiences?: string[];
  evidenceTurnIds: string[];
}

export interface StoryMemoryRelationshipUpdate {
  fromActorId: string;
  toActorId: string;
  action: 'upsert' | 'remove';
  relationType?: string;
  currentNarrativeState?: string;
  trustNarrative?: string;
  importantPromises?: string[];
  unresolvedTensions?: string[];
  publicStatus?: 'public' | 'secret' | 'misunderstood';
  evidenceTurnIds: string[];
}

export interface StoryMemoryConflictChange {
  title: string;
  action: 'open' | 'resolve' | 'update';
  description?: string;
  stakes?: string;
  resolution?: string;
  evidenceTurnIds: string[];
}

export interface StoryMemoryThreadChange {
  title: string;
  action: 'open' | 'resolve' | 'update';
  description?: string;
  resolution?: string;
  evidenceTurnIds: string[];
}

export interface StoryMemoryForeshadowingChange {
  title: string;
  action: 'plant' | 'payoff' | 'update';
  description?: string;
  payoff?: string;
  evidenceTurnIds: string[];
}

export interface StoryMemoryPatch {
  schemaVersion: 2;
  range: { fromStateVersion: number; toStateVersion: number };
  narrative?: {
    currentArc?: StoryArc | null;
    currentObjective?: string;
    archiveDigestAppend?: string;
  };
  characterUpdates: StoryMemoryCharacterUpdate[];
  relationshipUpdates: StoryMemoryRelationshipUpdate[];
  conflictChanges: StoryMemoryConflictChange[];
  threadChanges: StoryMemoryThreadChange[];
  foreshadowingChanges: StoryMemoryForeshadowingChange[];
  completedBeats: StoryBeat[];
}

export function emptyStoryMemoryState(branchId: string, updatedAt: string): StoryMemoryState {
  return {
    schemaVersion: 2,
    branchId,
    throughStateVersion: 0,
    characters: {},
    relationships: {},
    narrative: {
      currentArc: null,
      currentObjective: '',
      activeConflicts: {},
      openThreads: {},
      foreshadowing: {},
      recentCompletedBeats: [],
      recentResolvedThreads: [],
      archiveDigest: '',
    },
    metadata: {
      status: 'empty',
      dirtyFromStateVersion: null,
      fingerprint: 'seed',
      lastAppliedPatchId: null,
      updatedAt,
    },
  };
}

/** Caps applied by the deterministic merger (bounded memory footprint). */
export const MEMORY_MERGER_CAPS = {
  importantExperiences: 12,
  concerns: 6,
  promises: 6,
  secrets: 6,
  relationshipPromises: 6,
  unresolvedTensions: 6,
  recentCompletedBeats: 20,
  recentResolvedThreads: 10,
} as const;
