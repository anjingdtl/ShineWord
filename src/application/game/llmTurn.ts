import type { RandomSource } from '../../domain/rules/random';
import type { RollGrade, RollRecord, RollSpec } from '../../domain/rules/types';
import {
  hashActionContract,
  serializeActionContract,
  type Sha256HexProvider,
} from '../../domain/turns/canonical';
import { assertValidActionContract } from '../../domain/turns/contracts';
import type { ActionContract } from '../../domain/turns/types';
import type { LlmProvider } from '../llm/types';
import { parseStrictJsonObject } from '../llm/json';
import { TurnRequestBudget } from '../llm/requestBudget';
import type { NarrativeRecord, NarrativeStore } from '../ports/narrativeStore';
import type { TurnRollJournal } from '../ports/turnRollJournal';
import type { TurnStore } from '../ports/turnStore';
import { commitResolvedTurn } from '../turns/commitTurn';
import { resolveOrReuseRoll } from '../turns/resolveOrReuseRoll';

export interface NarrativeCandidate {
  turnId: string;
  outcomeGrade: RollGrade;
  text: string;
}

export interface RunLlmTurnInput {
  provider: LlmProvider;
  store: TurnStore;
  journal: TurnRollJournal;
  narratives: NarrativeStore;
  branchId: string;
  turnId: string;
  playerIntent: string;
  worldContext?: string;
  hashProvider: Sha256HexProvider;
  random: RandomSource;
  resolveRollSpec(contract: ActionContract): RollSpec;
  now?: () => string;
  budget?: TurnRequestBudget;
  /** Optional usage persistence (llm_requests) wired by the platform layer. */
  usageRecorder?: (record: {
    role: 'Planner' | 'Narrator';
    inputTokens: number | null;
    outputTokens: number | null;
    estimated: boolean;
  }) => void;
}

export interface RunLlmTurnResult {
  contract: ActionContract;
  rollRecord?: RollRecord;
  narrative: NarrativeRecord;
  stateVersion: number;
  resumed: boolean;
  requestCount: number;
}

function plannerSystem(): string {
  return [
    'You are ShineWord Planner.',
    'Output exactly one JSON ActionContract object and no prose.',
    'Never include random values, dice rolls, diceCount, final result, balance changes, or invented authoritative state.',
    'The four outcome clauses must be frozen before any roll.',
    'Required keys: protocolVersion="1.0", turnId, expectedStateVersion, actorId, actionType, evidenceIds, requiresRoll, intent, timeCostMinutes, resourcePreconditions, outcomes.',
    'outcomes must contain full_success, success, failure, severe_failure; each has achieved (boolean), publicSummary (string), effects (array).',
    'Each effect uses EXACTLY these field names:',
    '{"op":"consumeResource","actorId":string,"resourceId":string,"amount":number>0}',
    '{"op":"changeLocation","actorId":string,"locationId":string}',
    '{"op":"applyCondition","actorId":string,"conditionId":string}',
    '{"op":"advanceClock","minutes":number>0}',
    '{"op":"transferItem","itemId":string,"fromActorId":string,"toActorId":string}',
    '{"op":"recordEvent","eventType":string,"summary":string}',
    'The key is "op" — never "type" or "effectType". Use only resource keys and locations that appear in the supplied state.',
    'For requiresRoll=true include skillId and difficultyBand in simple|normal|challenging|hard|extreme|peak.',
  ].join(' ');
}

function narratorSystem(): string {
  return [
    'You are ShineWord Narrator.',
    'Output exactly JSON: {"turnId":string,"outcomeGrade":string,"text":string}.',
    'Do not change the supplied outcome grade and do not add rewards or state changes outside the frozen contract.',
  ].join(' ');
}

// Single-actor campaign: models often answer with the story name (陈默/chenmo)
// instead of the internal actor id; remap deterministically when unambiguous,
// reject loudly otherwise.
function remapToSoleActor(
  actors: Record<string, { actorId: string }>,
  proposed: string,
): string {
  const actorIds = Object.keys(actors);
  if (actorIds.length !== 1 || actorIds[0] === undefined) {
    throw new Error(`Planner proposed an unknown actorId: ${proposed}.`);
  }
  return actorIds[0];
}

function validateNarrative(
  candidate: NarrativeCandidate,
  turnId: string,
  grade: RollGrade,
): void {
  if (typeof candidate.turnId !== 'string' || candidate.turnId !== turnId) {
    throw new Error('Narrator turnId mismatch.');
  }
  if (candidate.outcomeGrade !== grade) {
    throw new Error('Narrator attempted to change the frozen outcome grade.');
  }
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
    throw new Error('Narrator returned empty story text.');
  }
  if (candidate.text.length > 12_000) throw new Error('Narrator story text exceeds safety limit.');
}

// Deterministic mapping of common LLM effect dialects (type/effectType for op,
// `to`/`resource`/`condition`/`text` shorthands) onto canonical field names.
// The strict contract validator stays the gate; this only renames fields and
// fills the acting actorId, never adds authoritative state.
export function normalizePlannerEffects(contract: ActionContract): ActionContract {
  const normalized = JSON.parse(JSON.stringify(contract)) as ActionContract;
  for (const grade of Object.keys(normalized.outcomes ?? {}) as RollGrade[]) {
    const outcome = normalized.outcomes[grade];
    if (!outcome || !Array.isArray(outcome.effects)) continue;
    outcome.effects = outcome.effects.map(effect => {
      if (typeof effect !== 'object' || effect === null) return effect;
      const e = effect as Record<string, unknown>;
      if (e.op === undefined) {
        const alias = [e.effectType, e.type].find(v => typeof v === 'string');
        if (alias !== undefined) {
          e.op = alias;
          delete e.effectType;
          delete e.type;
        }
      }
      if (typeof e.op !== 'string') return e as unknown as typeof effect;
      if (e.op !== 'transferItem' && e.actorId === undefined && typeof contract.actorId === 'string') {
        e.actorId = contract.actorId;
      }
      if (e.op === 'changeLocation' && e.locationId === undefined) {
        const destination = [e.to, e.location].find(v => typeof v === 'string');
        if (destination !== undefined) {
          e.locationId = destination;
          delete e.to;
          delete e.from;
          delete e.location;
        }
      }
      if (e.op === 'consumeResource' && e.resourceId === undefined && typeof e.resource === 'string') {
        e.resourceId = e.resource;
        delete e.resource;
      }
      if (e.op === 'applyCondition' && e.conditionId === undefined && typeof e.condition === 'string') {
        e.conditionId = e.condition;
        delete e.condition;
      }
      if (e.op === 'recordEvent' && e.summary === undefined) {
        const summary = [e.text, e.note, e.description].find(v => typeof v === 'string');
        if (summary !== undefined) {
          e.summary = summary;
          delete e.text;
          delete e.note;
          delete e.description;
        }
        if (e.eventType === undefined) e.eventType = 'note';
      }
      return e as unknown as typeof effect;
    });
  }
  if (Array.isArray(normalized.resourcePreconditions)) {
    normalized.resourcePreconditions = normalized.resourcePreconditions.map(item => {
      if (typeof item !== 'object' || item === null) return item;
      const p = item as unknown as Record<string, unknown>;
      if (p.actorId === undefined && typeof contract.actorId === 'string') {
        p.actorId = contract.actorId;
      }
      if (p.resourceId === undefined && typeof p.resource === 'string') {
        p.resourceId = p.resource;
        delete p.resource;
      }
      return p as unknown as typeof item;
    });
  }
  return normalized;
}

function recordUsage(
  input: RunLlmTurnInput,
  role: 'Planner' | 'Narrator',
  response: { usage?: { inputTokens?: number; outputTokens?: number; estimated: boolean } },
): void {
  if (!input.usageRecorder) return;
  input.usageRecorder({
    role,
    inputTokens: response.usage?.inputTokens ?? null,
    outputTokens: response.usage?.outputTokens ?? null,
    estimated: response.usage?.estimated ?? true,
  });
}

export async function runLlmTurn(input: RunLlmTurnInput): Promise<RunLlmTurnResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const budget = input.budget ?? new TurnRequestBudget(4);

  const committed = await input.store.getCommittedTurn(input.branchId, input.turnId);
  if (committed) {
    let narrative = await input.narratives.get(input.branchId, input.turnId);
    if (!narrative) {
      throw new Error('Committed turn is missing its narrative.');
    }
    if (narrative.status === 'Candidate') {
      await input.narratives.markCommitted(input.branchId, input.turnId);
      narrative = await input.narratives.get(input.branchId, input.turnId);
      if (!narrative || narrative.status !== 'Committed') {
        throw new Error('Committed narrative recovery failed.');
      }
    }
    const staged = await input.journal.getStagedTurn(input.branchId, input.turnId);
    if (!staged) throw new Error('Committed turn is missing its frozen contract.');
    const contract = parseStrictJsonObject<ActionContract>(
      staged.actionContractJson,
      'persisted ActionContract',
    );
    return {
      contract,
      rollRecord: committed.rollRecord,
      narrative,
      stateVersion: committed.stateVersion,
      resumed: true,
      requestCount: budget.used(),
    };
  }

  let resumed = false;
  const staged = await input.journal.getStagedTurn(input.branchId, input.turnId);
  let contract: ActionContract;
  let contractHash: string;

  if (staged) {
    resumed = true;
    contract = parseStrictJsonObject<ActionContract>(
      staged.actionContractJson,
      'persisted ActionContract',
    );
    contractHash = staged.actionContractHash;
  } else {
    const state = await input.store.getState(input.branchId);
    if (!state) throw new Error(`Unknown branch: ${input.branchId}.`);

    budget.consume('Planner');
    const planned = await input.provider.complete({
      role: 'Planner',
      system: plannerSystem(),
      user: JSON.stringify({
        turnId: input.turnId,
        expectedStateVersion: state.stateVersion,
        playerIntent: input.playerIntent,
        worldContext: input.worldContext ?? '',
      }),
      maxOutputTokens: 2200,
      jsonMode: true,
    });
    recordUsage(input, 'Planner', planned);
    contract = parseStrictJsonObject<ActionContract>(planned.text, 'Planner ActionContract');
    contract = normalizePlannerEffects(contract);
    if (contract.turnId !== input.turnId) throw new Error('Planner turnId mismatch.');
    if (contract.expectedStateVersion !== state.stateVersion) {
      throw new Error('Planner expectedStateVersion mismatch.');
    }
    // Single-actor campaign: models also stamp the story name onto per-effect
    // actorIds; remap those too when unambiguous (transferItem endpoints are
    // left untouched — they must refer to other actors and are validated by
    // the engine during commit).
    const reconciledActor = state.actors[contract.actorId]
      ? contract.actorId
      : remapToSoleActor(state.actors, contract.actorId);
    contract.actorId = reconciledActor;
    for (const grade of Object.keys(contract.outcomes ?? {}) as RollGrade[]) {
      const effects = contract.outcomes[grade]?.effects;
      if (!Array.isArray(effects)) continue;
      for (const effect of effects) {
        if (
          effect && typeof effect === 'object' && 'actorId' in effect &&
          typeof effect.actorId === 'string' && !state.actors[effect.actorId]
        ) {
          (effect as { actorId: string }).actorId = reconciledActor;
        }
      }
    }
    if (Array.isArray(contract.resourcePreconditions)) {
      for (const precondition of contract.resourcePreconditions) {
        if (typeof precondition.actorId === 'string' && !state.actors[precondition.actorId]) {
          precondition.actorId = reconciledActor;
        }
      }
    }
    assertValidActionContract(contract);
    contractHash = await hashActionContract(contract, input.hashProvider);
    await input.journal.stageRollTurn({
      branchId: input.branchId,
      turnId: input.turnId,
      expectedStateVersion: contract.expectedStateVersion,
      actionContractJson: serializeActionContract(contract),
      actionContractHash: contractHash,
      createdAt: now(),
      status: contract.requiresRoll ? 'AwaitRoll' : 'Resolved',
    });
  }

  assertValidActionContract(contract);
  if (!contractHash) {
    contractHash = await hashActionContract(contract, input.hashProvider);
  }

  let rollRecord: RollRecord | undefined;
  let grade: RollGrade = 'success';
  if (contract.requiresRoll) {
    const resolved = await resolveOrReuseRoll({
      journal: input.journal,
      branchId: input.branchId,
      turnId: input.turnId,
      expectedStateVersion: contract.expectedStateVersion,
      actionContractJson: serializeActionContract(contract),
      actionContractHash: contractHash,
      spec: input.resolveRollSpec(contract),
      random: input.random,
      createdAt: now(),
    });
    rollRecord = resolved.rollRecord;
    grade = rollRecord.grade;
    resumed = resumed || resolved.reused;
  }

  let narrative = await input.narratives.get(input.branchId, input.turnId);
  if (!narrative) {
    budget.consume('Narrator');
    const narrated = await input.provider.complete({
      role: 'Narrator',
      system: narratorSystem(),
      user: JSON.stringify({
        turnId: input.turnId,
        playerIntent: input.playerIntent,
        outcomeGrade: grade,
        frozenOutcome: contract.outcomes[grade],
        roll: rollRecord
          ? {
              diceCount: rollRecord.diceCount,
              dieSides: rollRecord.dieSides,
              rolls: rollRecord.rolls,
              highest: rollRecord.highest,
              difficulty: rollRecord.difficulty,
            }
          : null,
      }),
      maxOutputTokens: 1500,
      jsonMode: true,
    });
    const candidate = parseStrictJsonObject<NarrativeCandidate>(
      narrated.text,
      'Narrator candidate',
    );
    recordUsage(input, 'Narrator', narrated);
    validateNarrative(candidate, input.turnId, grade);
    narrative = await input.narratives.saveCandidate({
      branchId: input.branchId,
      turnId: input.turnId,
      outcomeGrade: grade,
      text: candidate.text,
      createdAt: now(),
    });
  } else {
    validateNarrative(
      {
        turnId: narrative.turnId,
        outcomeGrade: narrative.outcomeGrade,
        text: narrative.text,
      },
      input.turnId,
      grade,
    );
    resumed = true;
  }

  const result = await commitResolvedTurn({
    store: input.store,
    branchId: input.branchId,
    contract,
    contractHash,
    outcomeGrade: grade,
    rollRecord,
    committedAt: now(),
  });
  await input.narratives.markCommitted(input.branchId, input.turnId);
  const committedNarrative = await input.narratives.get(input.branchId, input.turnId);
  if (!committedNarrative) throw new Error('Narrative disappeared after commit.');

  return {
    contract,
    rollRecord,
    narrative: committedNarrative,
    stateVersion: result.committedTurn.stateVersion,
    resumed: resumed || result.replayed,
    requestCount: budget.used(),
  };
}
