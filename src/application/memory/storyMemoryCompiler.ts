/**
 * Story-memory checkpoint request compiler (infrastructure plan §61).
 *
 *   previous memory subset + committed turn batch + patch protocol
 *
 * The model receives: the actor table (id + name + aliases, so narrative
 * names resolve to authoritative actorIds), a COMPACT view of the current
 * long-term state, the raw batch turns, and a strict patch schema. It never
 * sees or produces database keys, fingerprints or state versions beyond the
 * declared range.
 */

import type { StoryMemoryState } from './storyMemoryTypes';
import { buildTypedMaterial } from '../context/turnMaterialCollector';
import type { TurnMaterialCandidate } from '../context/turnMaterialTypes';
import { textRelevance } from '../context/relevance';

export interface MemoryActorHint {
  actorId: string;
  name: string;
}

export interface MemoryTurnMaterial {
  turnId: string;
  stateVersion: number;
  publicSummary: string;
  narrativeText: string | null;
  outcomeGrade: string | null;
  effects: ReadonlyArray<{ op: string }>;
}

export interface MemoryRequestPayload {
  range: { fromStateVersion: number; toStateVersion: number };
  actors: MemoryActorHint[];
  previousMemory: string;
  turns: Array<{
    turnId: string;
    stateVersion: number;
    summary: string;
    narrative: string;
    grade: string | null;
    effects: string[];
  }>;
  patchProtocol: string[];
}

/** Narrative-heavy state the checkpoint model needs; compact and bounded. */
export function compilePreviousMemoryView(state: StoryMemoryState): string {
  if (state.metadata.status === 'empty' && state.throughStateVersion === 0) {
    return '(empty - first checkpoint)';
  }
  const lines: string[] = [`through v${state.throughStateVersion}`];
  if (state.narrative.currentArc) {
    lines.push(`arc: ${state.narrative.currentArc.title} - ${state.narrative.currentArc.summary}`);
  }
  if (state.narrative.currentObjective) lines.push(`objective: ${state.narrative.currentObjective}`);
  for (const character of Object.values(state.characters)) {
    lines.push(
      `[${character.actorId}] ${character.stableIdentitySummary}` +
        ` | goal: ${character.currentNarrativeState.currentGoal}` +
        ` | mood: ${character.currentNarrativeState.emotionalState}` +
        (character.currentNarrativeState.promises.length > 0
          ? ` | promises: ${character.currentNarrativeState.promises.join('；')}`
          : '')
        + (character.currentNarrativeState.secretsKnownToPlayer.length > 0
          ? ` | player-known secrets: ${character.currentNarrativeState.secretsKnownToPlayer.join('；')}`
          : ''),
    );
  }
  for (const relationship of Object.values(state.relationships)) {
    lines.push(
      `[${relationship.fromActorId}->${relationship.toActorId}] ${relationship.relationType}` +
        ` | ${relationship.currentNarrativeState} | trust: ${relationship.trustNarrative}` +
        ` | status: ${relationship.publicStatus}`,
    );
  }
  for (const conflict of Object.values(state.narrative.activeConflicts)) {
    lines.push(`conflict(open): ${conflict.title} - ${conflict.description} | stakes: ${conflict.stakes}`);
  }
  for (const thread of Object.values(state.narrative.openThreads)) {
    lines.push(`thread(open): ${thread.title} - ${thread.description}`);
  }
  for (const seed of Object.values(state.narrative.foreshadowing)) {
    lines.push(`foreshadowing(${seed.status}): ${seed.title} - ${seed.description}`);
  }
  if (state.narrative.archiveDigest) lines.push(`archive: ${state.narrative.archiveDigest}`);
  return lines.join('\n');
}

export const MEMORY_PATCH_PROTOCOL: readonly string[] = [  'Return ONLY one JSON object: a StoryMemoryPatch for the declared range.',
  'shape: {"schemaVersion":2,"range":{"fromStateVersion":F,"toStateVersion":T},',
  '  "characterUpdates":[{"actorId":"...","stableIdentitySummary":"...","emotionalState":"...","currentGoal":"...","concerns":[],"promises":[],"secretsKnownToPlayer":[],"importantExperiences":[],"evidenceTurnIds":["..."]}],',
  '  "relationshipUpdates":[{"fromActorId":"...","toActorId":"...","action":"upsert|remove","relationType":"...","currentNarrativeState":"...","trustNarrative":"...","importantPromises":[],"unresolvedTensions":[],"publicStatus":"public|secret|misunderstood","evidenceTurnIds":["..."]}],',
  '  "conflictChanges":[{"title":"...","action":"open|resolve|update","description":"...","stakes":"...","resolution":"...","evidenceTurnIds":["..."]}],',
  '  "threadChanges":[{"title":"...","action":"open|resolve|update","description":"...","resolution":"...","evidenceTurnIds":["..."]}],',
  '  "foreshadowingChanges":[{"title":"...","action":"plant|payoff|update","description":"...","payoff":"...","evidenceTurnIds":["..."]}],',
  '  "completedBeats":[{"turnId":"...","summary":"..."}],',
  '  "narrative":{"currentArc":{"title":"...","summary":"..."},"currentObjective":"...","archiveDigestAppend":"..."}}',
  'Rules: actorId/fromActorId/toActorId MUST be exact ids from actors table. Every item MUST cite >=1 evidenceTurnIds from this batch. Lists you send REPLACE the previous list (send the merged full list). Never invent numbers, HP, inventory or locations - narrative state only. Omit optional sections you do not change.',
];

/**
 * P8-2 compact per-entity projection (plan §10.3, B05): the checkpoint is no
 * longer one preferred whole-item block. The current objective is mandatory
 * semantic material; each character and relationship competes for budget
 * independently, so a large roster cannot starve the mainline and one large
 * entity cannot starve the rest (T05/T06).
 */
export function compileMemoryMaterialCandidates(
  state: StoryMemoryState,
  queryText: string,
): TurnMaterialCandidate[] {
  const materials: TurnMaterialCandidate[] = [];
  const relevanceOf = (text: string): number => {
    const relevance = textRelevance(queryText, text);
    return relevance > 0 ? relevance : 0.3;
  };

  const objectiveLines: string[] = [];
  if (state.narrative.currentArc) {
    objectiveLines.push(`当前剧情弧：${state.narrative.currentArc.title} - ${state.narrative.currentArc.summary}`);
  }
  if (state.narrative.currentObjective) {
    objectiveLines.push(`当前目标：${state.narrative.currentObjective}`);
  }
  if (objectiveLines.length > 0) {
    materials.push(buildTypedMaterial({
      id: 'story-memory:objective',
      kind: 'current_objective',
      source: {
        origin: 'branch',
        sourceType: 'story_checkpoint',
        recordId: `story-memory:${state.branchId}:objective`,
        revision: String(state.throughStateVersion),
      },
      authorityDomain: 'story_memory',
      visibility: 'party',
      retention: 'mandatory',
      relevance: 1,
      entityIds: [],
      payload: { text: objectiveLines.join('\n') },
    }));
  }

  for (const character of Object.values(state.characters)) {
    const lines: string[] = [
      `【${character.actorId}】${character.stableIdentitySummary}`,
      `情绪：${character.currentNarrativeState.emotionalState}`,
      `目标：${character.currentNarrativeState.currentGoal}`,
    ];
    if (character.currentNarrativeState.concerns.length > 0) {
      lines.push(`顾虑：${character.currentNarrativeState.concerns.join('；')}`);
    }
    if (character.currentNarrativeState.promises.length > 0) {
      lines.push(`承诺：${character.currentNarrativeState.promises.join('；')}`);
    }
    if (character.currentNarrativeState.secretsKnownToPlayer.length > 0) {
      lines.push(`玩家已知的秘密：${character.currentNarrativeState.secretsKnownToPlayer.join('；')}`);
    }
    const text = lines.join('\n');
    materials.push(buildTypedMaterial({
      id: `story-memory:character:${character.actorId}`,
      kind: 'character_relationship',
      source: {
        origin: 'branch',
        sourceType: 'story_checkpoint',
        recordId: `story-memory:${state.branchId}:character:${character.actorId}`,
        revision: String(character.lastChangedStateVersion),
      },
      authorityDomain: 'story_memory',
      visibility: 'party',
      retention: 'preferred',
      relevance: relevanceOf(text),
      entityIds: [character.actorId],
      payload: { text },
      boardOverride: 'storyMemory',
    }));
  }

  for (const relationship of Object.values(state.relationships)) {
    const lines: string[] = [
      `关系【${relationship.fromActorId} → ${relationship.toActorId}】${relationship.relationType}`,
      `状态：${relationship.currentNarrativeState}`,
      `信任：${relationship.trustNarrative}`,
      `公开程度：${relationship.publicStatus}`,
    ];
    if (relationship.importantPromises.length > 0) {
      lines.push(`重要承诺：${relationship.importantPromises.join('；')}`);
    }
    if (relationship.unresolvedTensions.length > 0) {
      lines.push(`未化解张力：${relationship.unresolvedTensions.join('；')}`);
    }
    const text = lines.join('\n');
    materials.push(buildTypedMaterial({
      id: `story-memory:relationship:${relationship.relationshipId}`,
      kind: 'character_relationship',
      source: {
        origin: 'branch',
        sourceType: 'story_checkpoint',
        recordId: `story-memory:${state.branchId}:relationship:${relationship.relationshipId}`,
        revision: String(relationship.lastChangedStateVersion),
      },
      authorityDomain: 'story_memory',
      visibility: 'party',
      retention: 'preferred',
      relevance: relevanceOf(text),
      entityIds: [relationship.fromActorId, relationship.toActorId],
      payload: { text },
      boardOverride: 'storyMemory',
    }));
  }

  const mainlineLines: string[] = [];
  for (const conflict of Object.values(state.narrative.activeConflicts)) {
    mainlineLines.push(`冲突(进行中)：${conflict.title} - ${conflict.description}（筹码：${conflict.stakes}）`);
  }
  for (const thread of Object.values(state.narrative.openThreads)) {
    mainlineLines.push(`线索(未闭合)：${thread.title} - ${thread.description}`);
  }
  for (const seed of Object.values(state.narrative.foreshadowing)) {
    mainlineLines.push(`伏笔(${seed.status})：${seed.title} - ${seed.description}`);
  }
  for (const beat of state.narrative.recentCompletedBeats) {
    mainlineLines.push(`节点 v${beat.stateVersion}：${beat.summary}`);
  }
  if (mainlineLines.length > 0) {
    const text = mainlineLines.join('\n');
    materials.push(buildTypedMaterial({
      id: 'story-memory:mainline',
      kind: 'relevant_recall',
      source: {
        origin: 'branch',
        sourceType: 'story_checkpoint',
        recordId: `story-memory:${state.branchId}:mainline`,
        revision: String(state.throughStateVersion),
      },
      authorityDomain: 'story_memory',
      visibility: 'party',
      retention: 'preferred',
      relevance: relevanceOf(text),
      payload: { text },
    }));
  }

  return materials;
}

export function compileMemoryCheckpointRequest(input: {
  fromStateVersion: number;
  toStateVersion: number;
  actors: readonly MemoryActorHint[];
  previousMemory: string;
  turns: readonly MemoryTurnMaterial[];
}): { system: string; user: string } {
  const payload: MemoryRequestPayload = {
    range: { fromStateVersion: input.fromStateVersion, toStateVersion: input.toStateVersion },
    actors: input.actors.map(actor => ({ actorId: actor.actorId, name: actor.name })),
    previousMemory: input.previousMemory,
    turns: input.turns.map(turn => ({
      turnId: turn.turnId,
      stateVersion: turn.stateVersion,
      summary: turn.publicSummary,
      narrative: (turn.narrativeText ?? '').slice(0, 800),
      grade: turn.outcomeGrade,
      effects: turn.effects.map(effect => effect.op),
    })),
    patchProtocol: [...MEMORY_PATCH_PROTOCOL],
  };
  return {
    system: [
      'You are the ShineWord Story Memory checkpoint worker.',
      'You maintain LONG-TERM narrative state (goals, emotions, promises, secrets, relationships, conflicts, threads, foreshadowing).',
      'You never store numeric game state; authoritative numbers live elsewhere.',
      'Follow patchProtocol exactly; output a single JSON object and nothing else.',
    ].join(' '),
    user: JSON.stringify(payload),
  };
}
