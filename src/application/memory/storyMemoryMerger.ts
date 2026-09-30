/**
 * Deterministic story-memory merger (infrastructure plan §27-§28).
 *
 *   previous memory + validated patch = next memory
 *
 * The merger owns every stable ID and fingerprint: title-addressed sections
 * (conflicts/threads/foreshadowing) map to canonical ids via a content
 * fingerprint, so the same narrative thread keeps its identity across
 * checkpoints while the model never invents database keys. Applying a patch
 * to a base whose fingerprint it was not built from is refused.
 */

import { stableFingerprint } from '../llm/requestPlan';
import type {
  StoryBeat,
  StoryMemoryPatch,
  StoryMemoryState,
  StoryMemoryCharacter,
  StoryMemoryRelationship,
} from './storyMemoryTypes';
import { MEMORY_MERGER_CAPS } from './storyMemoryTypes';

export class PatchFingerprintMismatchError extends Error {
  constructor(
    readonly patchBaseFingerprint: string,
    readonly currentFingerprint: string,
  ) {
    super(
      `Memory patch base fingerprint ${patchBaseFingerprint} does not match current state ${currentFingerprint}; refusing to apply a stale patch.`,
    );
    this.name = 'PatchFingerprintMismatchError';
  }
}

function slug(kind: string, title: string): string {
  return `${kind}:${stableFingerprint(title).slice(0, 8)}`;
}

function relationshipIdFor(fromActorId: string, toActorId: string): string {
  return `rel:${fromActorId}->${toActorId}`;
}

const cap = (list: string[] | undefined, max: number): string[] =>
  (list ?? []).slice(0, max);

export interface MergePatchInput {
  patch: StoryMemoryPatch;
  patchId: string;
  /** Fingerprint of the base state the patch was compiled against. */
  baseFingerprint: string;
  /** stateVersion of each batch turnId (beats resolve their version here). */
  turnVersions: ReadonlyMap<string, number>;
  now: string;
}

export function mergeStoryMemoryPatch(
  base: StoryMemoryState,
  input: MergePatchInput,
): StoryMemoryState {
  if (input.baseFingerprint !== base.metadata.fingerprint) {
    throw new PatchFingerprintMismatchError(input.baseFingerprint, base.metadata.fingerprint);
  }
  if (input.patch.range.fromStateVersion !== base.throughStateVersion) {
    throw new PatchFingerprintMismatchError(
      `through=${input.patch.range.fromStateVersion}`,
      `through=${base.throughStateVersion}`,
    );
  }
  const to = input.patch.range.toStateVersion;
  const next: StoryMemoryState = {
    ...base,
    characters: { ...base.characters },
    relationships: { ...base.relationships },
    narrative: {
      ...base.narrative,
      activeConflicts: { ...base.narrative.activeConflicts },
      openThreads: { ...base.narrative.openThreads },
      foreshadowing: { ...base.narrative.foreshadowing },
      recentCompletedBeats: [...base.narrative.recentCompletedBeats],
      recentResolvedThreads: [...base.narrative.recentResolvedThreads],
    },
    metadata: { ...base.metadata },
  };

  // Characters: pure upsert; fields the patch omits keep their previous
  // value, provided fields replace wholesale (bounded by caps).
  for (const update of input.patch.characterUpdates) {
    const existing: StoryMemoryCharacter | undefined = next.characters[update.actorId];
    next.characters[update.actorId] = {
      actorId: update.actorId,
      stableIdentitySummary: update.stableIdentitySummary ?? existing?.stableIdentitySummary ?? '',
      currentNarrativeState: {
        emotionalState: update.emotionalState ?? existing?.currentNarrativeState.emotionalState ?? '',
        currentGoal: update.currentGoal ?? existing?.currentNarrativeState.currentGoal ?? '',
        concerns: cap(update.concerns ?? existing?.currentNarrativeState.concerns, MEMORY_MERGER_CAPS.concerns),
        promises: cap(update.promises ?? existing?.currentNarrativeState.promises, MEMORY_MERGER_CAPS.promises),
        secretsKnownToPlayer: cap(update.secretsKnownToPlayer ?? existing?.currentNarrativeState.secretsKnownToPlayer, MEMORY_MERGER_CAPS.secrets),
      },
      importantExperiences: cap(update.importantExperiences ?? existing?.importantExperiences, MEMORY_MERGER_CAPS.importantExperiences),
      lastChangedStateVersion: to,
    };
  }

  for (const update of input.patch.relationshipUpdates) {
    const relationshipId = relationshipIdFor(update.fromActorId, update.toActorId);
    if (update.action === 'remove') {
      delete next.relationships[relationshipId];
      continue;
    }
    const existing = next.relationships[relationshipId];
    const merged: StoryMemoryRelationship = {
      relationshipId,
      fromActorId: update.fromActorId,
      toActorId: update.toActorId,
      relationType: update.relationType ?? existing?.relationType ?? '',
      currentNarrativeState: update.currentNarrativeState ?? existing?.currentNarrativeState ?? '',
      trustNarrative: update.trustNarrative ?? existing?.trustNarrative ?? '',
      importantPromises: cap(update.importantPromises ?? existing?.importantPromises, MEMORY_MERGER_CAPS.relationshipPromises),
      unresolvedTensions: cap(update.unresolvedTensions ?? existing?.unresolvedTensions, MEMORY_MERGER_CAPS.unresolvedTensions),
      publicStatus: update.publicStatus ?? existing?.publicStatus ?? 'public',
      lastChangedStateVersion: to,
    };
    next.relationships[relationshipId] = merged;
  }

  for (const change of input.patch.conflictChanges) {
    const conflictId = slug('conflict', change.title);
    const existing = next.narrative.activeConflicts[conflictId];
    if (change.action === 'open' || change.action === 'update') {
      next.narrative.activeConflicts[conflictId] = {
        conflictId,
        title: change.title,
        description: change.description ?? existing?.description ?? '',
        stakes: change.stakes ?? existing?.stakes ?? '',
        status: 'open',
        resolution: change.action === 'update' ? existing?.resolution ?? null : null,
        lastChangedStateVersion: to,
      };
    } else if (change.action === 'resolve') {
      delete next.narrative.activeConflicts[conflictId];
      // Resolved conflicts leave a compact trail in the resolved list.
      next.narrative.recentResolvedThreads.push({
        threadId: conflictId,
        title: change.title,
        resolution: change.resolution ?? '',
        resolvedAtStateVersion: to,
      });
    }
  }

  for (const change of input.patch.threadChanges) {
    const threadId = slug('thread', change.title);
    if (change.action === 'open' || change.action === 'update') {
      const existing = next.narrative.openThreads[threadId];
      next.narrative.openThreads[threadId] = {
        threadId,
        title: change.title,
        description: change.description ?? existing?.description ?? '',
        status: 'open',
        resolution: null,
        lastChangedStateVersion: to,
      };
    } else {
      delete next.narrative.openThreads[threadId];
      next.narrative.recentResolvedThreads.push({
        threadId,
        title: change.title,
        resolution: change.resolution ?? '',
        resolvedAtStateVersion: to,
      });
    }
  }

  for (const change of input.patch.foreshadowingChanges) {
    const foreshadowingId = slug('fshd', change.title);
    if (change.action === 'plant' || change.action === 'update') {
      const existing = next.narrative.foreshadowing[foreshadowingId];
      next.narrative.foreshadowing[foreshadowingId] = {
        foreshadowingId,
        title: change.title,
        description: change.description ?? existing?.description ?? '',
        status: 'planted',
        payoff: null,
        lastChangedStateVersion: to,
      };
    } else {
      const existing = next.narrative.foreshadowing[foreshadowingId];
      if (existing) {
        // Paid-off foreshadowing keeps a compact tombstone (queryable, but
        // out of the active set rendered into prompts).
        next.narrative.foreshadowing[foreshadowingId] = {
          ...existing,
          status: 'paid_off',
          payoff: change.payoff ?? '',
          lastChangedStateVersion: to,
        };
      }
    }
  }

  const beats: StoryBeat[] = input.patch.completedBeats.map(beat => ({
    turnId: beat.turnId,
    stateVersion: input.turnVersions.get(beat.turnId) ?? beat.stateVersion,
    summary: beat.summary,
  }));
  next.narrative.recentCompletedBeats = [
    ...next.narrative.recentCompletedBeats.filter(beat => beat.stateVersion <= to),
    ...beats,
  ].slice(-MEMORY_MERGER_CAPS.recentCompletedBeats);
  next.narrative.recentResolvedThreads = next.narrative.recentResolvedThreads
    .slice(-MEMORY_MERGER_CAPS.recentResolvedThreads);

  if (input.patch.narrative) {
    if (input.patch.narrative.currentArc !== undefined) {
      next.narrative.currentArc = input.patch.narrative.currentArc;
    }
    if (input.patch.narrative.currentObjective !== undefined) {
      next.narrative.currentObjective = input.patch.narrative.currentObjective;
    }
    if (input.patch.narrative.archiveDigestAppend) {
      next.narrative.archiveDigest = [
        next.narrative.archiveDigest,
        input.patch.narrative.archiveDigestAppend,
      ].filter(Boolean).join(' ');
    }
  }

  next.throughStateVersion = to;
  next.metadata.status = 'clean';
  next.metadata.dirtyFromStateVersion = null;
  next.metadata.lastAppliedPatchId = input.patchId;
  next.metadata.updatedAt = input.now;
  next.metadata.fingerprint = storyMemoryFingerprint(base.metadata.fingerprint, input.patchId, input.patch);
  return next;
}

/** Chained fingerprint: base -> patch -> result (plan §28). */
export function storyMemoryFingerprint(
  baseFingerprint: string,
  patchId: string,
  patch: StoryMemoryPatch,
): string {
  return stableFingerprint({
    base: baseFingerprint,
    patchId,
    range: patch.range,
    counts: [
      patch.characterUpdates.length,
      patch.relationshipUpdates.length,
      patch.conflictChanges.length,
      patch.threadChanges.length,
      patch.foreshadowingChanges.length,
      patch.completedBeats.length,
    ],
    narrative: patch.narrative ?? null,
    characters: patch.characterUpdates.map(update => [update.actorId, update.currentGoal ?? '', update.promises ?? []]),
    relationships: patch.relationshipUpdates.map(update => [update.fromActorId, update.toActorId, update.action, update.publicStatus ?? '']),
    titles: [
      ...patch.conflictChanges.map(change => [change.action, change.title]),
      ...patch.threadChanges.map(change => [change.action, change.title]),
      ...patch.foreshadowingChanges.map(change => [change.action, change.title]),
    ],
  });
}

export { slug as memoryEntitySlug, relationshipIdFor };
