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
    effects: ReadonlyArray<{ op: string }>;
  }>;
  patchProtocol: string[];
}

/** Narrative-heavy state the checkpoint model needs; compact and bounded. */
export function compilePreviousMemoryView(state: StoryMemoryState, options: {
  queryText?: string; actorIds?: readonly string[]; maxCharacters?: number;
} = {}): string {
  const limit = Math.max(1000, Math.min(12000, options.maxCharacters ?? 12000));
  const participants = new Set(options.actorIds ?? []);
  const score = (ids: readonly string[], text: string) => (ids.some(id => participants.has(id)) ? 10 : 0)
    + textRelevance(options.queryText ?? '', text);
  const candidates = compileMemoryMaterialCandidates(state, options.queryText ?? '')
    .map(material => ({ material, text: typeof material.payload.text === 'string' ? material.payload.text : '' }))
    .sort((a, b) => Number(b.material.retention === 'mandatory') - Number(a.material.retention === 'mandatory')
      || score(b.material.entityIds ?? [], b.text) - score(a.material.entityIds ?? [], a.text)
      || a.material.id.localeCompare(b.material.id));
  const lines = [`through v${state.throughStateVersion}`];
  let used = lines[0]!.length;
  for (const candidate of candidates) {
    // Whole entity facts are selected independently; no clipping mid-promise.
    if (used + candidate.text.length + 1 > limit) continue;
    lines.push(candidate.text); used += candidate.text.length + 1;
  }
  return lines.join('\n');
}

export const MEMORY_PATCH_PROTOCOL: readonly string[] = [  'Return ONLY one JSON object: a StoryMemoryPatch for the declared range.',
  'shape: {"schemaVersion":3,"range":{"fromStateVersion":F,"toStateVersion":T},',
  '  "characterUpdates":[{"actorId":"...","stableIdentitySummary":"...","emotionalState":"...","currentGoal":"...","concerns":[],"promises":[],"secretsKnownToPlayer":[],"importantExperiences":[],"evidenceTurnIds":["..."]}],',
  '  "relationshipUpdates":[{"fromActorId":"...","toActorId":"...","action":"upsert|remove","relationType":"...","currentNarrativeState":"...","trustNarrative":"...","importantPromises":[],"unresolvedTensions":[],"publicStatus":"public|secret|misunderstood","evidenceTurnIds":["..."]}],',
  '  "conflictChanges":[{"title":"...","action":"open|resolve|update","description":"...","stakes":"...","resolution":"...","evidenceTurnIds":["..."]}],',
  '  "threadChanges":[{"title":"...","action":"open|resolve|update","description":"...","resolution":"...","evidenceTurnIds":["..."]}],',
  '  "foreshadowingChanges":[{"title":"...","action":"plant|payoff|update","description":"...","payoff":"...","evidenceTurnIds":["..."]}],',
  '  "completedBeats":[{"turnId":"...","summary":"..."}],',
  '  "narrative":{"currentArc":{"title":"...","summary":"..."},"currentObjective":"...","archiveDigestAppend":"...","evidenceTurnIds":["..."]}}',
  'Rules: actorId/fromActorId/toActorId MUST be exact ids from actors table. Every item MUST cite >=1 evidenceTurnIds from this batch. Lists you send REPLACE the previous list (send the merged full list). Never invent numbers, HP, inventory or locations - narrative state only. Omit optional sections you do not change.',
  'Promise semantics: promises and importantPromises contain only an explicit undertaking by the speaker to do something in the future. Advice, warnings, recommendations, information, hopes and inferred intentions are NOT promises. Preserve an unresolved actual promise until committed evidence proves fulfillment, abandonment or invalidation. Do not turn a suggestion into a commitment.',
  'Lifecycle semantics: use open for newly established conflicts or threads, update for evidenced progress, and resolve only when the adopted story establishes closure. A completed beat is not automatically a completed goal. Keep currentObjective tied to the player\'s established pursuit; a new clue alone does not replace it.',
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
    if (relationship.publicStatus === 'secret') continue;
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
      effects: turn.effects,
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
