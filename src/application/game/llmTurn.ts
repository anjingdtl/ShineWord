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
    'outcomes must contain full_success, success, failure, severe_failure; each has achieved, publicSummary, effects.',
    'Allowed effects: consumeResource, changeLocation, applyCondition, advanceClock, transferItem, recordEvent.',
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

function validateNarrative(
  candidate: NarrativeCandidate,
  turnId: string,
  grade: RollGrade,
): void {
  if (candidate.turnId !== turnId) throw new Error('Narrator turnId mismatch.');
  if (candidate.outcomeGrade !== grade) {
    throw new Error('Narrator attempted to change the frozen outcome grade.');
  }
  if (!candidate.text.trim()) throw new Error('Narrator returned empty story text.');
  if (candidate.text.length > 12_000) throw new Error('Narrator story text exceeds safety limit.');
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
    contract = parseStrictJsonObject<ActionContract>(
      planned.text,
      'Planner ActionContract',
    );
    if (contract.turnId !== input.turnId) throw new Error('Planner turnId mismatch.');
    if (contract.expectedStateVersion !== state.stateVersion) {
      throw new Error('Planner expectedStateVersion mismatch.');
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
