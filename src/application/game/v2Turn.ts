import type { RandomSource } from '../../domain/rules/random';
import type { RollGrade, RollRecord, RollSpec } from '../../domain/rules/types';
import type { PlannerProposal } from '../../domain/turns/proposal';
import { assertValidPlannerProposal } from '../../domain/turns/proposal';
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
import type { TurnSettlementPlan, TurnStore } from '../ports/turnStore';
import { commitResolvedTurn } from '../turns/commitTurn';
import { resolveOrReuseRoll } from '../turns/resolveOrReuseRoll';
import type { ActorCard, SkillCatalog } from '../../domain/characters/card';
import type { AbilityDefinition, ConstraintDefinition, SceneDefinition } from '../../domain/content/types';
import { compileProposal, type CompiledAction } from './v2Compile';

export interface NarrativeCandidate {
  turnId: string;
  outcomeGrade: string;
  text: string;
}

export interface RunV2TurnInput {
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
  /** The acting player card (multi-actor scheduling adds companions later). */
  actingCard: ActorCard;
  cards: readonly ActorCard[];
  catalog: SkillCatalog;
  abilities: ReadonlyMap<string, AbilityDefinition>;
  scenes: readonly SceneDefinition[];
  constraints?: readonly ConstraintDefinition[];
  updateCommittedState?: (
    nextState: import('../../domain/state/types').GameStateSnapshot,
    contract: ActionContract,
    grade: RollGrade,
  ) => Array<{ eventType: string; payload: unknown }> | void;
  resolveRollSpec(contract: ActionContract): RollSpec;
  settlementFor?(grade: RollGrade, contract: ActionContract): Promise<TurnSettlementPlan>;
  now?: () => string;
  budget?: TurnRequestBudget;
  usageRecorder?: (record: {
    role: 'Planner' | 'Narrator';
    inputTokens: number | null;
    outputTokens: number | null;
    estimated: boolean;
  }) => void;
}

export interface RunV2TurnResult {
  contract: ActionContract;
  rollRecord?: RollRecord;
  narrative: NarrativeRecord;
  stateVersion: number;
  resumed: boolean;
  requestCount: number;
}

/**
 * V2 turn loop (plan §13.1): the Planner returns a RESTRICTED PROPOSAL (no
 * effects, no numbers); the local compiler freezes the authoritative contract
 * (origin 'engine'); dice come from the card; the Narrator only words the
 * frozen outcome. Everything reuses the V1 persistence machinery (staged
 * turns, persisted rolls, atomic commit), so crash recovery semantics are
 * identical.
 */
export function plannerV2System(): string {
  return [
    'You are ShineWord Planner (V2).',
    'Output exactly one JSON proposal object and no prose.',
    'You must NOT output outcomes, effects, costs, dice, difficulty numbers, resource changes, damage or healing.',
    'All numbers are decided by the local rules engine; you only choose the action shape.',
    'Required keys: proposalVersion="2.0", turnId, expectedStateVersion, actorId, actionKind, evidenceIds, intent.',
    'actionKind must be one of skill_check | ability | observe | talk | interact | move.',
    'skill_check: also skillId (a world skill id) and optionally difficultyBand in simple|normal|challenging|hard|extreme|peak and destinationId (only when success would move the actor to a known location).',
    'When the player action carries a real chance of failure and the actor knows a matching skill, prefer skill_check over observe/talk - risky actions deserve dice.',
    'ability: also abilityId (a world ability id the actor knows) and targetId when the ability has a target.',
    'move: also destinationId (a location id that exists in this world).',
    'Optional: narrativeHint with successSummary and failureSummary strings (wording only).',
    'Use actor ids exactly as supplied in the world context.',
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

function recordUsage(
  input: RunV2TurnInput,
  role: 'Planner' | 'Narrator',
  response: { usage?: { inputTokens?: number | null; outputTokens?: number | null; estimated?: boolean } },
): void {
  if (!input.usageRecorder) return;
  input.usageRecorder({
    role,
    inputTokens: response.usage?.inputTokens ?? null,
    outputTokens: response.usage?.outputTokens ?? null,
    estimated: response.usage?.estimated ?? true,
  });
}

export async function runV2Turn(input: RunV2TurnInput): Promise<RunV2TurnResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const budget = input.budget ?? new TurnRequestBudget(4);

  const committed = await input.store.getCommittedTurn(input.branchId, input.turnId);
  if (committed) {
    let narrative = await input.narratives.get(input.branchId, input.turnId);
    if (!narrative) throw new Error('Committed turn is missing its narrative.');
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
  let compiled: CompiledAction;
  let contractHash: string;

  if (staged) {
    // Crash recovery: the compiled engine contract was already frozen and
    // hashed; reuse it verbatim (a persisted roll must never meet a new one).
    resumed = true;
    const contract = parseStrictJsonObject<ActionContract>(
      staged.actionContractJson,
      'persisted ActionContract',
    );
    contractHash = staged.actionContractHash;
    compiled = { contract, storedSkillKey: contract.skillId ?? null };
  } else {
    const state = await input.store.getState(input.branchId);
    if (!state) throw new Error(`Unknown branch: ${input.branchId}.`);

    // One repair round for malformed proposals (plan §13.1 step 8): a real
    // model occasionally drops required keys; feeding the validator's errors
    // back once recovers the turn instead of failing it outright. A second
    // failure is final - the proposal channel stays strict.
    const requestPlanner = async (repairErrors?: string[]): Promise<PlannerProposal> => {
      budget.consume('Planner');
      const planned = await input.provider.complete({
        role: 'Planner',
        system: plannerV2System(),
        user: JSON.stringify({
          turnId: input.turnId,
          expectedStateVersion: state.stateVersion,
          playerIntent: input.playerIntent,
          worldContext: input.worldContext ?? '',
          ...(repairErrors ? { repairInstructions: `Your previous proposal was rejected: ${repairErrors.join('; ')}. Output the corrected complete JSON proposal only.` } : {}),
        }),
        maxOutputTokens: 1200,
        jsonMode: true,
      });
      recordUsage(input, 'Planner', planned);
      return parseStrictJsonObject<PlannerProposal>(planned.text, 'Planner proposal');
    };
    let proposal = await requestPlanner();
    try {
      assertValidPlannerProposal(proposal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      proposal = await requestPlanner([message.replace(/\n/g, ' ').slice(0, 400)]);
      assertValidPlannerProposal(proposal);
    }
    if (proposal.turnId !== input.turnId) throw new Error('Planner turnId mismatch.');
    if (proposal.expectedStateVersion !== state.stateVersion) {
      throw new Error('Planner expectedStateVersion mismatch.');
    }

    const proposalWithActor = { ...proposal, actorId: reconcileActor(proposal.actorId, input) };
    compiled = compileProposal({
      proposal: proposalWithActor,
      actingCard: input.actingCard,
      cards: input.cards,
      catalog: input.catalog,
      abilities: input.abilities,
      scenes: input.scenes,
      constraints: input.constraints,
      state,
    });
    assertValidActionContract(compiled.contract, 'engine');
    contractHash = await hashActionContract(compiled.contract, input.hashProvider);
    await input.journal.stageRollTurn({
      branchId: input.branchId,
      turnId: input.turnId,
      expectedStateVersion: compiled.contract.expectedStateVersion,
      actionContractJson: serializeActionContract(compiled.contract),
      actionContractHash: contractHash,
      createdAt: now(),
      status: compiled.contract.requiresRoll ? 'AwaitRoll' : 'Resolved',
    });
  }

  const contract = compiled.contract;
  assertValidActionContract(contract, 'engine');
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
      { turnId: narrative.turnId, outcomeGrade: narrative.outcomeGrade, text: narrative.text },
      input.turnId,
      grade,
    );
    resumed = true;
  }

  const settlement = input.settlementFor ? await input.settlementFor(grade, contract) : undefined;
  const result = await commitResolvedTurn({
    store: input.store,
    branchId: input.branchId,
    contract,
    contractHash,
    outcomeGrade: grade,
    rollRecord,
    settlement,
    applyAuthoritativeState: nextState => input.updateCommittedState?.(nextState, contract, grade),
    contractOrigin: 'engine',
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

/**
 * The proposal's actor must be the acting player card. A single-player
 * campaign may see the story name instead of the id; remap ONLY when exactly
 * one player card exists. Otherwise the proposal is refused.
 */
function reconcileActor(proposed: string, input: RunV2TurnInput): string {
  if (proposed === input.actingCard.actorId) return proposed;
  const playerCards = input.cards.filter(card => card.controller === 'player');
  if (playerCards.length === 1 && playerCards[0]) return playerCards[0].actorId;
  throw new Error(`Planner proposed an unknown actorId: ${proposed}.`);
}
