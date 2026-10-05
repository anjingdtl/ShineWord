/**
 * Story-memory patch validation (infrastructure plan §25-§26).
 *
 * Structural + provenance gates BEFORE the deterministic merge:
 *   - every actorId must be a known game actor (aliases resolved by the
 *     model with the alias table it was given; unknown ids are rejected,
 *     never auto-corrected);
 *   - every item must cite at least one turnId from the batch it covers;
 *   - ranges must be positive and contiguous with the base state.
 *
 * Semantic quality (is this summary good?) belongs to the model + review;
 * this validator only refuses structurally impossible patches.
 */

import type { StoryMemoryPatch } from './storyMemoryTypes';

export interface PatchValidationContext {
  /** Actor ids the patch may reference. */
  allowedActorIds: ReadonlySet<string>;
  /** Turn ids the patch may cite as evidence. */
  batchTurnIds: ReadonlySet<string>;
  /** Expected contiguous range. */
  expectedFromVersion: number;
  expectedToVersion: number;
}

export function validateStoryMemoryPatch(
  value: unknown,
  context: PatchValidationContext,
): StoryMemoryPatch {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Memory patch must be a JSON object.');
  }
  const patch = value as Record<string, unknown>;
  if (patch.schemaVersion !== 3) errors.push('schemaVersion must be 3; historical memory protocols are unsupported');

  const range = patch.range as { fromStateVersion?: unknown; toStateVersion?: unknown } | undefined;
  const from = Number(range?.fromStateVersion);
  const to = Number(range?.toStateVersion);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) {
    errors.push('range.fromStateVersion/toStateVersion must be integers with to > from');
  } else if (from !== context.expectedFromVersion || to !== context.expectedToVersion) {
    errors.push(`range must be exactly ${context.expectedFromVersion}..${context.expectedToVersion}`);
  }

  const checkEvidence = (item: unknown, label: string, index: number): void => {
    const evidence = (item as { evidenceTurnIds?: unknown })?.evidenceTurnIds;
    if (!Array.isArray(evidence) || evidence.length === 0) {
      errors.push(`${label}[${index}] must cite at least one evidenceTurnId`);
      return;
    }
    for (const turnId of evidence) {
      if (typeof turnId !== 'string' || !context.batchTurnIds.has(turnId)) {
        errors.push(`${label}[${index}] cites unknown turnId ${String(turnId)}`);
      }
    }
  };
  const stringOr = (v: unknown): string | undefined =>
    (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const stringArrayOr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const list = v.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return list;
  };

  const characterUpdates: StoryMemoryPatch['characterUpdates'] = [];
  const rawCharacters = patch.characterUpdates ?? [];
  if (Array.isArray(rawCharacters)) {
    rawCharacters.forEach((raw, index) => {
      const actorId = (raw as { actorId?: unknown })?.actorId;
      if (typeof actorId !== 'string' || !context.allowedActorIds.has(actorId)) {
        errors.push(`characterUpdates[${index}] actorId ${String(actorId)} is not a known actor`);
      }
      checkEvidence(raw, 'characterUpdates', index);
      characterUpdates.push({
        actorId: actorId as string,
        action: 'upsert',
        stableIdentitySummary: stringOr((raw as { stableIdentitySummary?: unknown }).stableIdentitySummary),
        emotionalState: stringOr((raw as { emotionalState?: unknown }).emotionalState),
        currentGoal: stringOr((raw as { currentGoal?: unknown }).currentGoal),
        concerns: stringArrayOr((raw as { concerns?: unknown }).concerns),
        promises: stringArrayOr((raw as { promises?: unknown }).promises),
        secretsKnownToPlayer: stringArrayOr((raw as { secretsKnownToPlayer?: unknown }).secretsKnownToPlayer),
        importantExperiences: stringArrayOr((raw as { importantExperiences?: unknown }).importantExperiences),
        evidenceTurnIds: ((raw as { evidenceTurnIds?: unknown }).evidenceTurnIds as string[]) ?? [],
      });
    });
  } else {
    errors.push('characterUpdates must be an array');
  }

  const relationshipUpdates: StoryMemoryPatch['relationshipUpdates'] = [];
  const rawRelationships = patch.relationshipUpdates ?? [];
  if (Array.isArray(rawRelationships)) {
    rawRelationships.forEach((raw, index) => {
      const fromId = (raw as { fromActorId?: unknown })?.fromActorId;
      const toId = (raw as { toActorId?: unknown })?.toActorId;
      const action = (raw as { action?: unknown })?.action;
      if (typeof fromId !== 'string' || !context.allowedActorIds.has(fromId)) {
        errors.push(`relationshipUpdates[${index}] fromActorId ${String(fromId)} is unknown`);
      }
      if (typeof toId !== 'string' || !context.allowedActorIds.has(toId)) {
        errors.push(`relationshipUpdates[${index}] toActorId ${String(toId)} is unknown`);
      }
      if (fromId === toId) errors.push(`relationshipUpdates[${index}] cannot invent a self relationship`);
      if (action !== 'upsert' && action !== 'remove') {
        errors.push(`relationshipUpdates[${index}] action must be upsert|remove`);
      }
      checkEvidence(raw, 'relationshipUpdates', index);
      relationshipUpdates.push({
        fromActorId: fromId as string,
        toActorId: toId as string,
        action: action === 'remove' ? 'remove' : 'upsert',
        relationType: stringOr((raw as { relationType?: unknown }).relationType),
        currentNarrativeState: stringOr((raw as { currentNarrativeState?: unknown }).currentNarrativeState),
        trustNarrative: stringOr((raw as { trustNarrative?: unknown }).trustNarrative),
        importantPromises: stringArrayOr((raw as { importantPromises?: unknown }).importantPromises),
        unresolvedTensions: stringArrayOr((raw as { unresolvedTensions?: unknown }).unresolvedTensions),
        publicStatus: (raw as { publicStatus?: unknown }).publicStatus === 'secret'
          || (raw as { publicStatus?: unknown }).publicStatus === 'misunderstood'
          ? ((raw as { publicStatus?: unknown }).publicStatus as 'secret' | 'misunderstood')
          : 'public',
        evidenceTurnIds: ((raw as { evidenceTurnIds?: unknown }).evidenceTurnIds as string[]) ?? [],
      });
    });
  } else {
    errors.push('relationshipUpdates must be an array');
  }

  interface TitleChange {
    title?: unknown;
    action?: unknown;
    evidenceTurnIds?: unknown;
  }
  const titleChanges = (
    raw: unknown,
    label: string,
    validActions: readonly string[],
  ): Array<{ title: string; action: string; evidenceTurnIds: string[]; index: number }> => {
    const out: Array<{ title: string; action: string; evidenceTurnIds: string[]; index: number }> = [];
    // An omitted section is unambiguous ("no changes for this section",
    // plan §25 small-patch protocol) - only wrong TYPES are errors.
    if (raw === undefined || raw === null) return out;
    if (!Array.isArray(raw)) {
      errors.push(`${label} must be an array`);
      return out;
    }
    (raw as TitleChange[]).forEach((item, index) => {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      if (!title) errors.push(`${label}[${index}] needs a non-empty title`);
      if (typeof item?.action !== 'string' || !validActions.includes(item.action)) {
        errors.push(`${label}[${index}] action must be one of ${validActions.join('|')}`);
      }
      checkEvidence(item, label, index);
      out.push({
        title,
        action: (typeof item?.action === 'string' ? item.action : validActions[0] ?? ''),
        evidenceTurnIds: (item?.evidenceTurnIds as string[]) ?? [],
        index,
      });
    });
    return out;
  };

  const conflictChanges = titleChanges(patch.conflictChanges, 'conflictChanges', ['open', 'resolve', 'update']);
  const threadChanges = titleChanges(patch.threadChanges, 'threadChanges', ['open', 'resolve', 'update']);
  const foreshadowingChanges = titleChanges(patch.foreshadowingChanges, 'foreshadowingChanges', ['plant', 'payoff', 'update']);

  const completedBeats: StoryMemoryPatch['completedBeats'] = [];
  const rawBeats = patch.completedBeats ?? [];
  if (Array.isArray(rawBeats)) {
    rawBeats.forEach((beat, index) => {
      if (typeof beat?.turnId !== 'string' || !context.batchTurnIds.has(beat.turnId)) {
        errors.push(`completedBeats[${index}] turnId ${String(beat?.turnId)} is not in the batch`);
      }
      if (typeof beat?.summary !== 'string' || !beat.summary.trim()) {
        errors.push(`completedBeats[${index}] needs a non-empty summary`);
      }
      completedBeats.push({
        turnId: beat.turnId as string,
        stateVersion: 0, // resolved from the batch by the merger
        summary: String(beat.summary ?? ''),
      });
    });
  }

  let narrative: StoryMemoryPatch['narrative'];
  const rawNarrative = patch.narrative;
  if (rawNarrative !== undefined) {
    if (typeof rawNarrative !== 'object' || rawNarrative === null) {
      errors.push('narrative must be an object when present');
    } else {
      narrative = {};
      checkEvidence(rawNarrative, 'narrative', 0);
      narrative.evidenceTurnIds = (rawNarrative as { evidenceTurnIds?: string[] }).evidenceTurnIds;
      const arc = (rawNarrative as { currentArc?: unknown }).currentArc;
      if (arc !== undefined) {
        if (arc === null) narrative.currentArc = null;
        else if (typeof arc === 'object'
          && typeof (arc as { title?: unknown }).title === 'string'
          && typeof (arc as { summary?: unknown }).summary === 'string') {
          narrative.currentArc = {
            title: (arc as { title: string }).title,
            summary: (arc as { summary: string }).summary,
          };
        } else {
          errors.push('narrative.currentArc must be {title,summary} or null');
        }
      }
      const objective = (rawNarrative as { currentObjective?: unknown }).currentObjective;
      if (objective !== undefined) {
        if (typeof objective !== 'string') errors.push('narrative.currentObjective must be a string');
        else narrative.currentObjective = objective.trim();
      }
      narrative.archiveDigestAppend = stringOr((rawNarrative as { archiveDigestAppend?: unknown }).archiveDigestAppend);
    }
  }

  if (errors.length > 0) {
    const error = new Error(`Memory patch validation failed: ${errors.join('; ')}`);
    error.name = 'StoryMemoryPatchInvalid';
    throw error;
  }

  return {
    schemaVersion: 3,
    range: { fromStateVersion: from, toStateVersion: to },
    narrative,
    characterUpdates,
    relationshipUpdates,
    conflictChanges: conflictChanges.map(item => ({
      title: item.title,
      action: item.action as StoryMemoryPatch['conflictChanges'][number]['action'],
      description: stringOr(((patch.conflictChanges as Array<Record<string, unknown>>)?.[item.index] ?? {}).description),
      stakes: stringOr(((patch.conflictChanges as Array<Record<string, unknown>>)?.[item.index] ?? {}).stakes),
      resolution: stringOr(((patch.conflictChanges as Array<Record<string, unknown>>)?.[item.index] ?? {}).resolution),
      evidenceTurnIds: item.evidenceTurnIds,
    })),
    threadChanges: threadChanges.map(item => ({
      title: item.title,
      action: item.action as StoryMemoryPatch['threadChanges'][number]['action'],
      description: stringOr(((patch.threadChanges as Array<Record<string, unknown>>)?.[item.index] ?? {}).description),
      resolution: stringOr(((patch.threadChanges as Array<Record<string, unknown>>)?.[item.index] ?? {}).resolution),
      evidenceTurnIds: item.evidenceTurnIds,
    })),
    foreshadowingChanges: foreshadowingChanges.map(item => ({
      title: item.title,
      action: item.action as StoryMemoryPatch['foreshadowingChanges'][number]['action'],
      description: stringOr(((patch.foreshadowingChanges as Array<Record<string, unknown>>)?.[item.index] ?? {}).description),
      payoff: stringOr(((patch.foreshadowingChanges as Array<Record<string, unknown>>)?.[item.index] ?? {}).payoff),
      evidenceTurnIds: item.evidenceTurnIds,
    })),
    completedBeats,
  };
}
