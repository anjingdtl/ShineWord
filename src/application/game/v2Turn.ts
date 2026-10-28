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
import { LlmRequestFailure } from '../llm/types';
import { classifyLlmFailure } from '../llm/requestLedger';
import { SchedulerQueueError } from '../worldBuild/rateScheduler';
import { localNarrationCandidate, NARRATOR_LOCAL_DEGRADE_DEADLINE_MS } from './narrationTemplate';
import { requireCompiledRules, assertRuleAction } from '../content/runtimeRules';
import { BudgetInfeasibleError, stableFingerprint } from '../llm/requestPlan';
import type { FrozenTurnContext } from '../context/contextSnapshot';
import { parseStrictJsonObject } from '../llm/json';
import { parseStructuredOutput } from '../llm/structuredOutput';
import { TurnRequestBudget } from '../llm/requestBudget';
import { recordStartupEvent } from '../observability/startupTrace';
import type { NarrativeRecord, NarrativeStore } from '../ports/narrativeStore';
import type { TurnRollJournal } from '../ports/turnRollJournal';
import type { TurnSettlementPlan, TurnStore } from '../ports/turnStore';
import { commitResolvedTurn, commitPreparedTurn, prepareTurnResolution, type PreparedTurnResolution } from '../turns/commitTurn';
import { resolveOrReuseRoll } from '../turns/resolveOrReuseRoll';
import type { ActorCard, SkillCatalog } from '../../domain/characters/card';
import type { AbilityDefinition, ConstraintDefinition, SceneDefinition } from '../../domain/content/types';
import { compileProposal, type CompiledAction } from './v2Compile';
import { outcomeSetHashFor } from '../campaignPlan/localCompile';
import { localCompileCampaignBindingHash, type LocalCompileSelectionV1 } from './localCompileReadiness';
import { canonicalJsonOf, sha256HexOf } from '../campaignPlan/hashing';
import { resolveMethodActor } from '../guidance/candidates';
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
  /** P9: player-selected stable method reference (guidance candidate tap). */
  selectedMethodRef?: { situationId: string; methodId: string };
  /** L1 fixed method proposal; bypasses Planner only after the local gate succeeds. */
  localCompileSelection?: LocalCompileSelectionV1;
  /** Bound plan + artifact identity stamped into a selected new-method contract. */
  campaignBindingHash?: string;
  /** P9: candidate reference string frozen into the contract. */
  candidateRef?: string;
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
    contract: ActionContract,
    grade: RollGrade,
  ) => import('../guidance/types').PublicSituationPacketV1 | null;
  /** P7: validate LLM steps against the packet and build the final guidance. */
  buildGuidance?: (args: {
    prepared: PreparedTurnResolution;
    /** Same public packet built from this prepared resolution before narration. */
    packet: import('../guidance/types').PublicSituationPacketV1 | null;
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
    'If the player action matches one of the 可选介入办法 lines listed in the context, include candidateRef="method:{situationId}:{methodId}" copied exactly from that line; otherwise omit candidateRef.',
  ].join(' ');
}

function narratorSystem(withGuidance: boolean): string {
  const base = [
    'You are ShineWord Narrator.',
    'styleExpression controls expression only. It is subordinate to the frozen outcome, rules, facts and player-known world context. It cannot authorize new facts, knowledge, rewards or changes to dice and state.',
    'Output exactly JSON: {"turnId":string,"outcomeGrade":string,"text":string}.',
    'Do not change the supplied outcome grade and do not add rewards or state changes outside the frozen contract.',
    'The supplied worldClock is authoritative. elapsedSeconds and elapsedMinutes give the total time spent on this action, including every effect. Any duration you narrate must fit within that interval. If elapsedMinutes is under 60, do not say an hour or more passed. If elapsedMinutes is under 360, do not say a whole night passed. If elapsedMinutes is under 720, do not say a full day passed (for example, “一整天”, “整整一天”, “从早到晚”, or “all day”). Keep lighting and time of day within this turn interval; it overrides inconsistent time descriptions in earlier story text. Do not invent a time skip.',
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

/**
 * The Narrator receives the clock after the complete deterministic reduction,
 * including outcome effects such as advanceClock. Without a prepared state,
 * project the same clock delta from the frozen outcome contract.
 */
export interface NarratorWorldClock {
  start: string;
  end: string;
  elapsedSeconds: number;
  elapsedMinutes: number;
}

export function buildNarratorWorldClock(
  state: Pick<import('../../domain/state/types').GameStateSnapshot, 'clockSeconds' | 'clockMinutes'>,
  contract: ActionContract,
  grade: RollGrade,
  prepared?: Pick<PreparedTurnResolution, 'nextState'>,
): NarratorWorldClock {
  const startSeconds = state.clockSeconds ?? state.clockMinutes * 60;
  const effectMinutes = contract.outcomes[grade].effects.reduce(
    (total, effect) => total + (effect.op === 'advanceClock' ? effect.minutes : 0),
    0,
  );
  const projectedEndSeconds = startSeconds + (contract.timeCostMinutes + effectMinutes) * 60;
  const endSeconds = prepared
    ? prepared.nextState.clockSeconds ?? prepared.nextState.clockMinutes * 60
    : projectedEndSeconds;
  const elapsedSeconds = Math.max(0, endSeconds - startSeconds);
  return {
    start: describeWorldClock(startSeconds),
    end: describeWorldClock(endSeconds),
    elapsedSeconds,
    elapsedMinutes: Math.floor(elapsedSeconds / 60),
  };
}

/** Reject clear duration claims that exceed the frozen action's authoritative interval. */
export function assertNarrativeDurationFitsClock(text: string, worldClock: NarratorWorldClock): void {
  const claims: Array<{ label: string; minimumMinutes: number; pattern: RegExp }> = [
    {
      label: 'a full day',
      minimumMinutes: 720,
      pattern: /一整天|整整一天|整整一日|一整日|整个白天|一整个白天|整天|整日|从早到晚|整整.{0,12}(?:一天|一日)|(?:花|耗|忙|工作|调查|核对|查找|翻|走|等)了?(?:一整天|整整一天|一天|整天)|all day(?: long)?|the whole day|the entire day|from dawn to dusk/iu,
    },
    {
      label: 'a whole night',
      minimumMinutes: 360,
      pattern: /一整夜|整整一夜|整夜|通宵|一宿|整宿|整晚|all night(?: long)?|the whole night|the entire night|overnight/iu,
    },
    {
      label: 'an hour or more',
      minimumMinutes: 60,
      pattern: /(?:一个小时|一小时|数小时|几小时|好几小时|数个钟头|几个钟头|several hours|a few hours|an hour|hours passed)/iu,
    },
  ];
  const exceeded = claims.find(claim => worldClock.elapsedMinutes < claim.minimumMinutes && claim.pattern.test(text));
  if (exceeded) {
    throw new Error(`Narrator duration claim exceeds authoritative worldClock: ${exceeded.label} in ${worldClock.elapsedMinutes} minutes.`);
  }
}

function validateNarrative(
  candidate: NarrativeCandidate,
  turnId: string,
  grade: RollGrade,
  worldClock?: NarratorWorldClock,
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
  if (worldClock) assertNarrativeDurationFitsClock(candidate.text, worldClock);
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
  if (input.localCompileSelection) assertLocalCompileSelectionCurrent(input, state);
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
    if (contract.methodRef?.campaignBindingHash) {
      const method = input.methods?.find((item, index) => item.methodId === contract.methodRef!.methodId
        && input.methodSituations?.[index] === contract.methodRef!.situationId);
      if (!method || !state.campaignRuntime || !state.campaignContentBinding
        || contract.methodRef.outcomeSetHash !== outcomeSetHashFor(method)
        || contract.methodRef.campaignBindingHash !== localCompileCampaignBindingHash(state, method)) {
        throw new Error('Frozen campaign method binding changed; refusing recovery.');
      }
    }
    const currentBinding = state.segmentContentBinding ?? (state.contentManifest ? contentDependencyBinding(state.contentManifest) : undefined);
    if (await hashActionContract(contract, input.hashProvider) !== staged.actionContractHash) throw new Error('Frozen action contract hash mismatch; refusing dispatch.');
    if (state.ruleConfiguration && stableFingerprint(contract.ruleBinding) !== stableFingerprint(requireCompiledRules(state.ruleConfiguration).binding)) throw new Error('Frozen rule binding mismatch; refusing dispatch.');
    assertRuleAction(state, contract.actionType, contract.actorId);
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
      const plannerStartMs = Date.now();
      recordStartupEvent('turn_planner_start', { turnId: input.turnId, repair: repairErrors !== undefined });
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
          physicalAttemptLimit: 3,
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
      recordStartupEvent('turn_planner_end', { turnId: input.turnId, durationMs: Date.now() - plannerStartMs });
      return parseStructuredOutput<PlannerProposal>(planned.text, {
        label: 'Planner proposal',
        fieldAliases: ACTION_FIELD_ALIASES,
      }).value;
    };
    let proposal: PlannerProposal;
    if (input.localCompileSelection) {
      proposal = input.localCompileSelection.proposal;
    } else {
      const selectedMethod = input.selectedMethodRef && input.methods?.find((method, index) =>
        method.methodId === input.selectedMethodRef!.methodId
        && input.methodSituations?.[index] === input.selectedMethodRef!.situationId);
      if (selectedMethod?.difficultyPolicy?.kind === 'fixed' && selectedMethod.evidencePolicy?.kind === 'fixed') {
        throw new Error('L1 selection is missing its local compile binding; refusing Planner fallback.');
      }
      proposal = await requestPlanner();
      try {
        assertValidPlannerProposal(proposal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        proposal = await requestPlanner([message.replace(/\n/g, ' ').slice(0, 400)]);
        assertValidPlannerProposal(proposal);
      }
    }
    if (proposal.turnId !== input.turnId) throw new Error('Planner turnId mismatch.');
    if (proposal.expectedStateVersion !== state.stateVersion) {
      throw new Error('Planner expectedStateVersion mismatch.');
    }

    const proposalWithActor = { ...proposal, actorId: reconcileActor(proposal.actorId, input) };
    compiled = compileProposal({
      requestedIntent: input.playerIntent,
      selectedBaseAction: input.selectedBaseAction,
      // P9: a stable selected candidate reference (player tap or validated
      // free-input mapping) binds the exact method; stale ids are refused.
      ...(input.selectedMethodRef ? { selectedMethodRef: input.selectedMethodRef } : {}),
      ...(input.candidateRef ? { candidateRef: input.candidateRef } : {}),
      proposal: proposalWithActor,
      actingCard: input.actingCard,
      cards: input.cards,
      catalog: input.catalog,
      abilities: input.abilities,
      scenes: input.scenes,
      constraints: input.constraints,
      state,
      ...(input.campaignBindingHash ? { campaignBindingHash: input.campaignBindingHash } : {}),
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
    packet = input.buildSituationPacket ? (input.buildSituationPacket(prepared, contract, grade) ?? null) : null;
  }

  let narrative = await input.narratives.get(input.branchId, input.turnId);
  let extractedGuidance: { llmSteps: import('../guidance/types').NextStepCandidateV1[] | null; llmSummary: string[] | null } = {
    llmSteps: null,
    llmSummary: null,
  };
  if (!narrative) {
    budget.consume('Narrator');
    const narratorStartMs = Date.now();
    recordStartupEvent('turn_narrator_start', { turnId: input.turnId });
    const narratorWorldClock = buildNarratorWorldClock(state, contract, grade, prepared);
    const makeNarratorRequest = (
      worldContext: string,
      maxOutputTokens: number,
      reserveTokens: number | null,
    ): LlmRequest => ({
      role: 'Narrator',
      system: narratorSystem(packet !== null),
      user: canonicalStringify({
        turnId: input.turnId,
        playerIntent: input.playerIntent,
        outcomeGrade: grade,
        frozenOutcome: contract.outcomes[grade],
        worldClock: narratorWorldClock,
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
      } as unknown as CanonicalJson),
      maxOutputTokens,
      ...(input.narratorReasoningRecovery ? { maxPhysicalRequests: 1 } : {}),
      jsonMode: true,
      reasoningTier: input.reasoningTier,
      reasoningReserveTokens: reserveTokens,
      reasoningPolicyVersion: input.reasoningPolicyVersion,
      requestKind: 'narrator',
      ledger: {
        logicalRequestId: `narrator:${input.branchId}:${input.turnId}`,
          physicalAttemptLimit: 3,
        requestKind: 'narrator',
        branchId: input.branchId,
        stateVersion: contract.expectedStateVersion,
      },
      queueSignal: degradeController.signal,
    });
    let narrated;
    // W4c (D4 approved 2026-10-27): T-B tier hard deadline + local template
    // degrade. The queue signal only cancels a QUEUED request — dispatch is
    // never treated as reversible — so a request already in flight keeps its
    // transport deadline and the outcome_unknown rules; it is never
    // auto-degraded. No late response can race the degrade path: degrade only
    // fires on queue-cancel or on definite failures with a known outcome.
    const degradeController = new AbortController();
    const degradeTimer = setTimeout(() => degradeController.abort(), NARRATOR_LOCAL_DEGRADE_DEADLINE_MS);
    let degradedReason: string | null = null;
    const isDefiniteNarratorFailure = (error: unknown): boolean => {
      if (error instanceof SchedulerQueueError) return error.code === 'cancelled';
      if (error instanceof BudgetInfeasibleError) return true; // local wire gate: nothing was sent
      if (error instanceof LlmRequestFailure) {
        // Definite = every attempt either never dispatched, was definitely
        // rejected by the provider, or produced an unrepairable response.
        // Transport errors after dispatch stay uncertain (outcome_unknown).
        return error.requestMetrics.length > 0 && error.requestMetrics.every(metric =>
          metric.dispatchState === 'not_sent' || metric.outcome === 'invalid_response' || metric.outcome === 'http_error');
      }
      return false;
    };
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
    let candidate: NarrativeCandidate;
    try {
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
      recordUsage(input, 'Narrator', narrated);
      const parseCandidate = (text: string): NarrativeCandidate => {
        const value = parseStructuredOutput<NarrativeCandidate>(text, { label: 'Narrator candidate' }).value;
        validateNarrative(value, input.turnId, grade, narratorWorldClock);
        return value;
      };
      try { candidate = parseCandidate(narrated.text); }
      catch (error) {
        // Repair only a received, invalid candidate. An uncertain HTTP outcome
        // exits above and is never automatically sent again. Recovery reuses
        // the retained primary and repaired responses under the same identities.
        budget.consume('Narrator');
        const request = makeNarratorRequest(input.narratorWorldContext ?? '', input.narratorWireOutputTokens, input.narratorReasoningReserveTokens);
        const payload = JSON.parse(request.user) as Record<string, unknown>;
        payload.repairInstructions = `Your received candidate was invalid: ${error instanceof Error ? error.message : String(error)}. Return corrected complete JSON with turnId=${input.turnId}, outcomeGrade=${grade} and nonempty text. Preserve the frozen outcome; the previous candidate is unadopted and cannot establish facts.`;
        payload.previousCandidate = narrated.text;
        try {
          const repaired = await input.provider.complete(checkNarratorWire(
            prepareNarratorRequest({ ...request, user: canonicalStringify(payload as CanonicalJson), maxPhysicalRequests: 1 }), input.narratorFinalWire));
          recordUsage(input, 'Narrator', repaired);
          candidate = parseCandidate(repaired.text);
        } catch (repairError) {
          if (!isDefiniteNarratorFailure(repairError)) throw repairError;
          degradedReason = 'repair_definite_failure';
          candidate = localNarrationCandidate({ contract, turnId: input.turnId, grade, rollRecord });
        }
      }
    } catch (error) {
      // Degrade to the local template ONLY on definite failures (still queued
      // at the deadline, local wire gate, provider rejection, unrepairable
      // response). Uncertain dispatched outcomes rethrow into the existing
      // outcome_unknown flow; the degrade path never issues another request,
      // so no replay or double billing is possible either way.
      if (!isDefiniteNarratorFailure(error)) throw error;
      degradedReason = 'deadline_or_definite_failure';
      candidate = localNarrationCandidate({ contract, turnId: input.turnId, grade, rollRecord });
    } finally {
      clearTimeout(degradeTimer);
    }
    if (degradedReason !== null) {
      validateNarrative(candidate, input.turnId, grade, narratorWorldClock);
    }
    extractedGuidance = extractGuidancePayload(candidate);
    recordStartupEvent('turn_narrator_end', { turnId: input.turnId, durationMs: Date.now() - narratorStartMs, degraded: degradedReason !== null });
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
      buildNarratorWorldClock(state, contract, grade, prepared),
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
      packet,
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

function assertLocalCompileSelectionCurrent(
  input: RunV2TurnInput,
  state: import('../../domain/state/types').GameStateSnapshot,
): void {
  const selection = input.localCompileSelection!;
  const methodRef = input.selectedMethodRef;
  const candidateRef = input.candidateRef;
  if (!methodRef || !candidateRef
    || methodRef.situationId !== selection.selectedMethodRef.situationId
    || methodRef.methodId !== selection.selectedMethodRef.methodId
    || candidateRef !== selection.candidateRef
    || selection.candidateRef !== `method:${methodRef.situationId}:${methodRef.methodId}`
    || selection.expectedStateVersion !== state.stateVersion
    || selection.proposal.expectedStateVersion !== state.stateVersion
    || selection.proposal.turnId !== input.turnId
    || selection.proposal.intent !== input.playerIntent
    || selection.proposal.actorId !== input.actingCard.actorId) {
    throw new Error('Local compile selection is stale; refresh the selected path.');
  }
  const methods = input.methods ?? [];
  const methodSituations = input.methodSituations ?? [];
  const matches = methods.map((method, index) => ({ method, situationId: methodSituations[index] }))
    .filter(item => item.situationId === methodRef.situationId && item.method.methodId === methodRef.methodId);
  if (matches.length !== 1) throw new Error('Selected local compile method is no longer offered.');
  const method = matches[0]!.method;
  if (method.difficultyPolicy?.kind !== 'fixed' || method.evidencePolicy?.kind !== 'fixed'
    || !method.ruleBindingHash
    || outcomeSetHashFor(method) !== selection.methodOutcomeSetHash
    || selection.campaignBindingHash !== localCompileCampaignBindingHash(state, method)
    || input.campaignBindingHash !== selection.campaignBindingHash) {
    throw new Error('Selected local compile binding changed; refusing Planner fallback.');
  }
  if (!state.ruleConfiguration) throw new Error('Current rules are missing; refusing local compile.');
  const ruleBindingHash = sha256HexOf(canonicalJsonOf(requireCompiledRules(state.ruleConfiguration).binding));
  if (method.ruleBindingHash !== ruleBindingHash) throw new Error('Current rule binding changed; refusing local compile.');
  const step = method.firstStep;
  const targetId = step.targetEntryId ? resolveMethodActor(step.targetEntryId, state, input.cards) : undefined;
  const proposal = selection.proposal;
  const sameEvidence = JSON.stringify(proposal.evidenceIds) === JSON.stringify(method.evidencePolicy.evidenceIds);
  if (!sameEvidence || proposal.actionKind !== step.actionKind
    || (proposal.actionKind === 'skill_check' && (proposal.skillId?.replace(/^skill-/, '') !== step.skillId?.replace(/^skill-/, '')
      || proposal.difficultyBand !== method.difficultyPolicy.band))
    || (proposal.actionKind !== 'skill_check' && proposal.difficultyBand !== undefined)
    || proposal.abilityId !== step.abilityId
    || proposal.destinationId !== step.destinationId
    || proposal.targetId !== targetId
    || proposal.candidateRef !== selection.candidateRef) {
    throw new Error('Local proposal no longer exactly matches its selected method.');
  }
  assertValidPlannerProposal(proposal);
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
