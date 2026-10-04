import { canonicalStringify, type CanonicalJson } from '../../domain/turns/canonical';
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
import type { ContentDependencyBinding } from '../../domain/content/types';
import type { LlmProvider, LlmRequest, ReasoningTier } from '../llm/types';
import { classifyLlmFailure } from '../llm/requestLedger';
import { BudgetInfeasibleError } from '../llm/requestPlan';
import type { FrozenTurnContext } from '../context/contextSnapshot';
import { parseStrictJsonObject } from '../llm/json';
import { parseStructuredOutput } from '../llm/structuredOutput';
import { TurnRequestBudget } from '../llm/requestBudget';
import type { NarrativeRecord, NarrativeStore } from '../ports/narrativeStore';
import type { TurnRollJournal } from '../ports/turnRollJournal';
import type { TurnSettlementPlan, TurnStore } from '../ports/turnStore';
import { commitResolvedTurn, commitPreparedTurn, prepareTurnResolution, type PreparedTurnResolution } from '../turns/commitTurn';
import { resolveOrReuseRoll } from '../turns/resolveOrReuseRoll';
import type { ActorCard, SkillCatalog } from '../../domain/characters/card';
import type { AbilityDefinition, ConstraintDefinition, SceneDefinition } from '../../domain/content/types';
import { compileProposal, type CompiledAction } from './v2Compile';
import { contentDependencyBinding } from '../worldPackage/contentManifest';
import { describeWorldClock } from '../../domain/state/worldClock';
import { fitGuidanceNarratorRequest } from '../guidance/requestBudget';
import { verifyFinalWireRequest, type FinalWireBudget } from '../llm/finalWireVerifier';

/** Model-dialect field aliases accepted when parsing the restricted proposal. */
export const ACTION_FIELD_ALIASES: Record<string, string> = {
  skill: 'skillId',
  ability: 'abilityId',
  target: 'targetId',
  destination: 'destinationId',
  action: 'actionKind',
};

export interface NarrativeCandidate {
  turnId: string;
  outcomeGrade: string;
  text: string;
  /** P7 optional structured guidance (validated separately from the text). */
  situationSummary?: { changes?: unknown; opportunities?: unknown; pressures?: unknown };
  nextSteps?: unknown;
}

export interface TurnReasoningRecoveryPlan {
  worldContext: string;
  wireOutputTokens: number;
  reserveTokens: number;
  context: FrozenTurnContext;
  /** P8-2: envelope for the recovery dispatch's final wire check. */
  finalWire?: FinalWireBudget;
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
  /** Content snapshot used to prepare worldContext and local indexes. */
  expectedContentDependency?: ContentDependencyBinding;
  styleSnapshot?: import('../../domain/style/types').EffectiveStyleSnapshotV1;
  coordinationFence?: { campaignId: string; fenceToken: number };
  hashProvider: Sha256HexProvider;
  random: RandomSource;
  /** The acting player card (multi-actor scheduling adds companions later). */
  actingCard: ActorCard;
  cards: readonly ActorCard[];
  catalog: SkillCatalog;
  abilities: ReadonlyMap<string, AbilityDefinition>;
  scenes: readonly SceneDefinition[];
  constraints?: readonly ConstraintDefinition[];
  /** P7: situation methods offered this turn (structural binding in compile). */
  methods?: readonly import('../../domain/situations/types').MethodTemplateV1[];
  /** Parallel owner situation ids for `methods`. */
  methodSituations?: readonly string[];
  selectedBaseAction?: import('../guidance/types').AllowedCandidateV1;
  narratorBudget?: { capabilities: import('../llm/requestPlan').FrozenModelCapabilities; reasoningPolicy: import('../llm/reasoningPolicy').ReasoningPolicySelection };
  updateCommittedState?: (
    nextState: import('../../domain/state/types').GameStateSnapshot,
    contract: ActionContract,
    grade: RollGrade,
  ) => Array<{ eventType: string; payload: unknown }> | void;
  resolveRollSpec(contract: ActionContract): RollSpec;
  settlementFor?(grade: RollGrade, contract: ActionContract): Promise<TurnSettlementPlan>;
  now?: () => string;
  budget?: TurnRequestBudget;
  /** The tier/reserves and wire ceiling frozen alongside both contexts. */
  reasoningTier: ReasoningTier;
  plannerReasoningReserveTokens: number | null;
  narratorReasoningReserveTokens: number | null;
  reasoningPolicyVersion: string;
  /** Kernel-resolved provider wire output ceilings, including reasoning. */
  plannerWireOutputTokens: number;
  narratorWireOutputTokens: number;
  /** P8-2: frozen envelopes for the final wire gate (plan §10.4); when
   * absent (pure-domain tests) the gate is skipped. */
  plannerFinalWire?: FinalWireBudget;
  narratorFinalWire?: FinalWireBudget;
  plannerReasoningRecovery?: TurnReasoningRecoveryPlan;
  narratorReasoningRecovery?: TurnReasoningRecoveryPlan;
  onReasoningRecovery?: (role: 'planner' | 'narrator', context: FrozenTurnContext) => void;
  /** Independent narrator context (never the full planner context, §59). */
  narratorWorldContext?: string;
  usageRecorder?: (record: {
    role: 'Planner' | 'Narrator';
    inputTokens: number | null;
    outputTokens: number | null;
    estimated: boolean;
  }) => void;
  /**
   * P7 prepared-resolution pipeline (plan §8.2). When present, the full turn
   * resolution is reduced locally BEFORE the Narrator runs and committed
   * verbatim after; the callback must be deterministic for (contract, grade,
   * rollRecord) and include the settlement so rewards apply exactly once.
   */
  prepareResolution?: (args: {
    contract: ActionContract;
    contractHash: string;
    grade: RollGrade;
    rollRecord?: RollRecord;
  }) => Promise<PreparedTurnResolution>;
  /** P7: build the player-safe situation packet from the prepared state. */
  buildSituationPacket?: (
    prepared: PreparedTurnResolution,
  ) => import('../guidance/types').PublicSituationPacketV1 | null;
  /** P7: validate LLM steps against the packet and build the final guidance. */
  buildGuidance?: (args: {
    prepared: PreparedTurnResolution;
    contract: ActionContract;
    grade: RollGrade;
    /** Null when the response carried no (usable) steps — local fallback. */
    llmSteps: import('../guidance/types').NextStepCandidateV1[] | null;
    llmSummary: import('../guidance/types').PublicSituationPacketV1['changes'] | null;
  }) => import('../guidance/types').TurnGuidanceV1 | Promise<import('../guidance/types').TurnGuidanceV1>;
  /** P7: persist guidance AFTER the commit succeeded (display gate). */
  saveGuidance?: (guidance: import('../guidance/types').TurnGuidanceV1) => Promise<void>;
}

export interface RunV2TurnResult {
  contract: ActionContract;
  rollRecord?: RollRecord;
  narrative: NarrativeRecord;
  stateVersion: number;
  resumed: boolean;
  requestCount: number;
  /** Present when the prepared pipeline ran and produced committed guidance. */
  guidance?: import('../guidance/types').TurnGuidanceV1;
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

function narratorSystem(withGuidance: boolean): string {
  const base = [
    'You are ShineWord Narrator.',
    'styleExpression controls expression only. It is subordinate to the frozen outcome, rules, facts and player-known world context. It cannot authorize new facts, knowledge, rewards or changes to dice and state.',
    'Output exactly JSON: {"turnId":string,"outcomeGrade":string,"text":string}.',
    'Do not change the supplied outcome grade and do not add rewards or state changes outside the frozen contract.',
    'The supplied worldClock is authoritative. Keep lighting and time of day within this turn interval; it overrides inconsistent time descriptions in earlier story text. Do not invent a time skip.',
  ];
  if (!withGuidance) return base.join(' ');
  return [
    ...base.slice(0, 2),
    'Output exactly JSON: {"turnId":string,"outcomeGrade":string,"text":string,"situationSummary":{"changes":string[],"opportunities":string[],"pressures":string[]},"nextSteps":[{"candidateRef":string,"title":string,"rationale":string,"tradeoffs":string,"firstStepIntent":string}]}.',
    'text narrates THIS turn only (≤600 characters), staying faithful to the frozen outcome. situationSummary briefly lists what changed, current opportunities and pressures FROM situationPacket ONLY.',
    'nextSteps: at most 6 entries. Each candidateRef MUST be copied verbatim from situationPacket.allowedCandidates[].ref. title ≤24 chars, rationale ≤80 chars, tradeoffs ≤120 chars, firstStepIntent ≤160 chars.',
    'Copy tradeoffs and firstStepIntent verbatim from the referenced allowed candidate. Only title and rationale may be reworded; do not add numbers or claim guaranteed results in them.',
    'Never invent success rates, damage, costs, deadlines or rewards. Never reveal names, secrets or facts absent from situationPacket and the supplied context. When no candidate fits, return an empty nextSteps array.',
    ...base.slice(3),
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

/** Extract usable guidance fields without ever failing the narrative itself. */
function extractGuidancePayload(candidate: NarrativeCandidate): {
  llmSteps: import('../guidance/types').NextStepCandidateV1[] | null;
  llmSummary: string[] | null;
} {
  const rawSteps = Array.isArray(candidate.nextSteps) ? candidate.nextSteps : null;
  const steps: import('../guidance/types').NextStepCandidateV1[] = [];
  if (rawSteps) {
    for (const raw of rawSteps) {
      if (typeof raw !== 'object' || raw === null) continue;
      const record = raw as Record<string, unknown>;
      if (typeof record.candidateRef !== 'string' || !record.candidateRef
        || typeof record.title !== 'string' || !record.title
        || typeof record.rationale !== 'string' || typeof record.tradeoffs !== 'string'
        || typeof record.firstStepIntent !== 'string' || !record.firstStepIntent) {
        continue;
      }
      steps.push({
        candidateRef: record.candidateRef,
        title: record.title,
        rationale: record.rationale,
        tradeoffs: record.tradeoffs,
        firstStepIntent: record.firstStepIntent,
      });
    }
  }
  const rawSummary = candidate.situationSummary;
  const changes = rawSummary && Array.isArray(rawSummary.changes)
    ? rawSummary.changes.filter((item): item is string => typeof item === 'string')
    : null;
  return {
    llmSteps: rawSteps === null ? null : steps,
    llmSummary: changes,
  };
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
  const state = await input.store.getState(input.branchId);
  if (!state) throw new Error(`Unknown branch: ${input.branchId}.`);
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
    const currentBinding = state.segmentContentBinding ?? (state.contentManifest ? contentDependencyBinding(state.contentManifest) : undefined);
    if (contract.contentDependency && (!currentBinding || canonicalStringify(contract.contentDependency as unknown as CanonicalJson) !== canonicalStringify(currentBinding as unknown as CanonicalJson))) {
      throw new Error('Frozen turn content dependency no longer matches the branch; recovery must keep the original content.');
    }
    contractHash = staged.actionContractHash;
    compiled = { contract, storedSkillKey: contract.skillId ?? null };
  } else {
    if (input.styleSnapshot && (input.styleSnapshot.branchId !== input.branchId
      || input.styleSnapshot.turnId !== input.turnId
      || (state.contentManifest?.worldId && input.styleSnapshot.projectId !== state.contentManifest.worldId))) {
      throw new Error('Turn style snapshot does not belong to the current project, branch and turn.');
    }
    const stateContentDependency = state.segmentContentBinding ?? (state.contentManifest
      ? contentDependencyBinding(state.contentManifest)
      : undefined);
    if (input.expectedContentDependency && (!stateContentDependency ||
        JSON.stringify(input.expectedContentDependency) !== JSON.stringify(stateContentDependency))) {
      throw new Error('Campaign content changed while the turn context was being prepared; retry against the latest snapshot.');
    }

    // One repair round for malformed proposals (plan §13.1 step 8): a real
    // model occasionally drops required keys; feeding the validator's errors
    // back once recovers the turn instead of failing it outright. A second
    // failure is final - the proposal channel stays strict.
    const requestPlanner = async (repairErrors?: string[]): Promise<PlannerProposal> => {
      budget.consume('Planner');
      const makeRequest = (worldContext: string, maxOutputTokens: number, reserveTokens: number | null): LlmRequest => ({
        role: 'Planner',
        system: plannerV2System(),
        user: JSON.stringify({
          turnId: input.turnId,
          expectedStateVersion: state.stateVersion,
          playerIntent: input.playerIntent,
          worldContext,
          ...(repairErrors ? { repairInstructions: `Your previous proposal was rejected: ${repairErrors.join('; ')}. Output the corrected complete JSON proposal only.` } : {}),
        }),
        maxOutputTokens,
        ...(input.plannerReasoningRecovery ? { maxPhysicalRequests: 1 } : {}),
        jsonMode: true,
        reasoningTier: input.reasoningTier,
        reasoningReserveTokens: reserveTokens,
        reasoningPolicyVersion: input.reasoningPolicyVersion,
        requestKind: 'planner',
        ledger: {
          logicalRequestId: `planner:${input.branchId}:${input.turnId}`,
          requestKind: 'planner',
          branchId: input.branchId,
          stateVersion: state.stateVersion,
        },
      });
      const finalWireCheck = (worldContext: string, wireOutputTokens: number, budget?: FinalWireBudget): void => {
        if (!budget) return;
        const request = makeRequest(worldContext, wireOutputTokens, null);
        verifyFinalWireRequest({
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          budget,
        });
      };      let planned;
      try {
        finalWireCheck(
          input.worldContext ?? '',
          input.plannerWireOutputTokens,
          input.plannerFinalWire,
        );
        planned = await input.provider.complete(makeRequest(
          input.worldContext ?? '', input.plannerWireOutputTokens, input.plannerReasoningReserveTokens,
        ));
      } catch (error) {
        const recovery = input.plannerReasoningRecovery;
        if (!recovery || classifyLlmFailure(error) !== 'reasoning_only') throw error;
        budget.consume('Planner');
        input.onReasoningRecovery?.('planner', recovery.context);
        finalWireCheck(
          recovery.worldContext,
          recovery.wireOutputTokens,
          recovery.finalWire,
        );
        planned = await input.provider.complete({
          ...makeRequest(recovery.worldContext, recovery.wireOutputTokens, recovery.reserveTokens),
          maxPhysicalRequests: 1,
        });
      }
      recordUsage(input, 'Planner', planned);
      return parseStructuredOutput<PlannerProposal>(planned.text, {
        label: 'Planner proposal',
        fieldAliases: ACTION_FIELD_ALIASES,
      }).value;
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
      requestedIntent: input.playerIntent,
      selectedBaseAction: input.selectedBaseAction,
      proposal: proposalWithActor,
      actingCard: input.actingCard,
      cards: input.cards,
      catalog: input.catalog,
      abilities: input.abilities,
      scenes: input.scenes,
      constraints: input.constraints,
      state,
      ...(input.methods ? { methods: input.methods } : {}),
      ...(input.methodSituations ? { methodSituations: input.methodSituations } : {}),
    });
    if (stateContentDependency) compiled.contract.contentDependency = stateContentDependency;
    if (input.styleSnapshot) compiled.contract.styleSnapshot = input.styleSnapshot;
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

  // P7 prepared pipeline: the FULL resolution is reduced locally BEFORE the
  // Narrator runs, so guidance is computed against the post-settlement state
  // (never recommending spent items or resolved goals), and the commit later
  // applies this exact object — the reduction never runs twice.
  let prepared: PreparedTurnResolution | undefined;
  let packet: import('../guidance/types').PublicSituationPacketV1 | null = null;
  if (input.prepareResolution) {
    prepared = await input.prepareResolution({ contract, contractHash, grade, rollRecord });
    packet = input.buildSituationPacket ? (input.buildSituationPacket(prepared) ?? null) : null;
  }

  let narrative = await input.narratives.get(input.branchId, input.turnId);
  let extractedGuidance: { llmSteps: import('../guidance/types').NextStepCandidateV1[] | null; llmSummary: string[] | null } = {
    llmSteps: null,
    llmSummary: null,
  };
  if (!narrative) {
    budget.consume('Narrator');
    const makeNarratorRequest = (
      worldContext: string,
      maxOutputTokens: number,
      reserveTokens: number | null,
    ): LlmRequest => ({
      role: 'Narrator',
      system: narratorSystem(packet !== null),
      user: JSON.stringify({
        turnId: input.turnId,
        playerIntent: resumed ? compiled.contract.intent : input.playerIntent,
        outcomeGrade: grade,
        frozenOutcome: contract.outcomes[grade],
        worldClock: {
          start: describeWorldClock(state.clockSeconds ?? state.clockMinutes * 60),
          end: describeWorldClock((state.clockSeconds ?? state.clockMinutes * 60) + contract.timeCostMinutes * 60),
        },
        worldContext,
        ...(packet ? { situationPacket: packet } : {}),
        ...(contract.styleSnapshot ? { styleExpression: contract.styleSnapshot.compiledText } : {}),
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
      maxOutputTokens,
      ...(input.narratorReasoningRecovery ? { maxPhysicalRequests: 1 } : {}),
      jsonMode: true,
      reasoningTier: input.reasoningTier,
      reasoningReserveTokens: reserveTokens,
      reasoningPolicyVersion: input.reasoningPolicyVersion,
      requestKind: 'narrator',
      ledger: {
        logicalRequestId: `narrator:${input.branchId}:${input.turnId}`,
        requestKind: 'narrator',
        branchId: input.branchId,
        stateVersion: contract.expectedStateVersion,
      },
    });
    let narrated;
    const prepareNarratorRequest = (request: LlmRequest): LlmRequest => input.narratorBudget
      ? fitGuidanceNarratorRequest(request, { ...input.narratorBudget, plainNarratorSystem: narratorSystem(false) }) : request;
    // P8-2 final wire gate (plan §10.4): after all payload assembly and
    // optional-packet shedding, the real messages must fit the frozen
    // envelope. Over-budget optional payloads are shed from the SAME frozen
    // pool; a mandatory overflow fails with zero HTTP.
    const checkNarratorWire = (request: LlmRequest, budget?: FinalWireBudget): LlmRequest => {
      if (!budget) return request;
      const verify = (candidate: LlmRequest): void => {
        verifyFinalWireRequest({
          messages: [
            { role: 'system', content: candidate.system },
            { role: 'user', content: candidate.user },
          ],
          budget,
        });
      };
      let current = request;
      try {
        verify(current);
        return current;
      } catch (error) {
        if (!(error instanceof BudgetInfeasibleError)) throw error;
      }
      try {
        const payload = JSON.parse(current.user) as Record<string, unknown>;
        if (payload.situationPacket !== undefined) {
          delete payload.situationPacket;
          current = { ...current, system: narratorSystem(false), user: JSON.stringify(payload) };
          verify(current);
          return current;
        }
        if (payload.styleExpression !== undefined) {
          delete payload.styleExpression;
          current = { ...current, user: JSON.stringify(payload) };
          verify(current);
          return current;
        }
      } catch (error) {
        if (error instanceof BudgetInfeasibleError) throw error;
      }
      verify(current);
      return current;
    };
    try {
      narrated = await input.provider.complete(checkNarratorWire(
        prepareNarratorRequest(makeNarratorRequest(
          input.narratorWorldContext ?? '', input.narratorWireOutputTokens, input.narratorReasoningReserveTokens,
        )),
        input.narratorFinalWire,
      ));
    } catch (error) {
      const recovery = input.narratorReasoningRecovery;
      if (!recovery || classifyLlmFailure(error) !== 'reasoning_only') throw error;
      budget.consume('Narrator');
      input.onReasoningRecovery?.('narrator', recovery.context);
      narrated = await input.provider.complete(checkNarratorWire(prepareNarratorRequest({
        ...makeNarratorRequest(recovery.worldContext, recovery.wireOutputTokens, recovery.reserveTokens),
        maxPhysicalRequests: 1,
      }), recovery.finalWire ?? input.narratorFinalWire));
    }
    const candidate = parseStructuredOutput<NarrativeCandidate>(narrated.text, {
      label: 'Narrator candidate',
    }).value;
    recordUsage(input, 'Narrator', narrated);
    validateNarrative(candidate, input.turnId, grade);
    extractedGuidance = extractGuidancePayload(candidate);
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

  // P7 guidance: validate the LLM's steps against the packet SEPARATELY from
  // the narrative. A good narrative with bad/missing steps keeps the turn and
  // degrades to local guidance — the Narrator request is never re-sent just
  // to fix paths (plan §8.4). A crash-recovered narrative carries no stored
  // steps, so recovery degrades to local guidance by design.
  let guidance: import('../guidance/types').TurnGuidanceV1 | undefined;
  if (input.buildGuidance && prepared) {
    guidance = await input.buildGuidance({
      prepared,
      contract,
      grade,
      llmSteps: extractedGuidance.llmSteps,
      llmSummary: extractedGuidance.llmSummary,
    });
  }

  let result: { committedTurn: import('../ports/turnStore').CommittedTurn; replayed: boolean };
  if (prepared) {
    result = await commitPreparedTurn({
      store: input.store,
      prepared,
      coordinationFence: input.coordinationFence,
    });
  } else {
    const settlement = input.settlementFor ? await input.settlementFor(grade, contract) : undefined;
    result = await commitResolvedTurn({
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
      coordinationFence: input.coordinationFence,
    });
  }
  await input.narratives.markCommitted(input.branchId, input.turnId);
  const committedNarrative = await input.narratives.get(input.branchId, input.turnId);
  if (!committedNarrative) throw new Error('Narrative disappeared after commit.');
  // Guidance persists only after its turn committed (display gate, §8.2).
  if (guidance && input.saveGuidance) {
    await input.saveGuidance(guidance);
  }

  return {
    contract,
    rollRecord,
    narrative: committedNarrative,
    stateVersion: result.committedTurn.stateVersion,
    resumed: resumed || result.replayed,
    requestCount: budget.used(),
    ...(guidance ? { guidance } : {}),
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
