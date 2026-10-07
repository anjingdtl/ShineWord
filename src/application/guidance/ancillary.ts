import type { ContentEntry } from '../../domain/content/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { ActorCard } from '../../domain/characters/card';
import type { SituationDefinitionV1 } from '../../domain/situations/types';
import type { ActionContract } from '../../domain/turns/types';
import type { LlmProvider, LlmRequest } from '../llm/types';
import { parseStructuredOutput } from '../llm/structuredOutput';
import type { GuidanceStore } from '../ports/guidanceStore';
import { detectSeverity, buildSituationPacket } from './packet';
import { assembleTurnGuidance } from './validate';
import { stableFingerprint } from '../llm/requestPlan';
import { planLlmRequest, DEFAULT_OUTPUT_DEMANDS } from '../llm/requestBudgetKernel';
import { estimateTokens } from '../context/tokenEstimate';
import {
  GUIDANCE_VERSION,
  decisionPointIdFor,
  guidanceContentBindingHash,
  type NextStepCandidateV1,
  type TurnGuidanceV1,
} from './types';

/**
 * Ancillary decision-point guidance (plan §8.3, frozen §3.11). Local-action
 * turns (rest, training, transfers) and NPC auto-step boundaries have no
 * Narrator of their own. The player immediately gets LOCAL guidance; an
 * optional async LLM upgrade may replace it later for the SAME decision
 * point — deduped, staleness-checked, never blocking, never re-settling an
 * already-committed action.
 */

export interface AncillaryGuidanceInput {
  provider: LlmProvider;
  guidanceStore?: GuidanceStore;
  sha256Hex(input: string): Promise<string> | string;
  campaignId: string;
  branchId: string;
  playerCard: ActorCard;
  /** Cards already visible to this player, including instantiated NPC ids. */
  cards?: readonly ActorCard[];
  /** Committed state at the decision point (player-actable). */
  state: GameStateSnapshot;
  /** Source turn that created this decision point (the local/NPC action). */
  sourceTurnId: string;
  /** Events of that committed turn, for severity detection. */
  committedEvents: ReadonlyArray<{ eventType: string; payload: unknown }>;
  situationDefinitions: ReadonlyArray<{ situationId: string; definition: SituationDefinitionV1 }>;
  entries: readonly ContentEntry[];
  blockedEntries?: readonly ContentEntry[];
  /** Player-known entry ids (secret filtering). */
  knownEntryIds: ReadonlySet<string>;
  visibleActorNames: ReadonlyMap<string, string>;
  /** Skip the LLM upgrade entirely (offline/budget-constrained callers). */
  localOnly?: boolean;
  /** Wire ceiling for the ancillary request. */
  wireOutputTokens: number;
  reasoningTier: import('../llm/types').ReasoningTier;
  reasoningReserveTokens: number | null;
  reasoningPolicyVersion: string;
  /** True when the caller already dispatched the same upgrade (dedup). */
  modelProfileFingerprint?: string;
  now?: () => string;
  getCurrentState?: () => Promise<GameStateSnapshot | null>;
  capabilities?: import('../llm/requestPlan').FrozenModelCapabilities;
  reasoningPolicy?: import('../llm/reasoningPolicy').ReasoningPolicySelection;
  knowledgeHash?: string;
  allowedCandidates?: readonly import('./types').AllowedCandidateV1[];
  preferredCandidateRef?: string;
  preferredSituationId?: string;
}

export function buildLocalAncillaryGuidance(input: AncillaryGuidanceInput): TurnGuidanceV1 {
  return assembleTurnGuidance({
    prepared: {
      branchId: input.branchId,
      contract: syntheticContract(input.sourceTurnId, input.state),
      contractHash: 'ancillary-local',
      outcomeGrade: 'success',
      nextState: input.state,
      committedTurn: {
        branchId: input.branchId,
        turnId: input.sourceTurnId,
        previousStateVersion: input.state.stateVersion - 1,
        stateVersion: input.state.stateVersion,
        outcomeGrade: 'success',
        publicSummary: '',
        effects: [],
        committedAt: input.now?.() ?? new Date().toISOString(),
      },
      domainEvents: [...input.committedEvents],
      lifeEvents: [],
      extraEvents: [],
    },
    contract: syntheticContract(input.sourceTurnId, input.state),
    grade: 'success',
    llmSteps: null,
    llmSummary: null,
    packet: buildSituationPacket({
      prepared: {
        branchId: input.branchId,
        contract: syntheticContract(input.sourceTurnId, input.state),
        contractHash: 'ancillary-local',
        outcomeGrade: 'success',
        rollRecord: undefined,
        settlement: undefined,
        nextState: input.state,
        committedTurn: {
          branchId: input.branchId,
          turnId: input.sourceTurnId,
          previousStateVersion: input.state.stateVersion - 1,
          stateVersion: input.state.stateVersion,
          outcomeGrade: 'success',
          publicSummary: '',
          effects: [],
          committedAt: input.now?.() ?? new Date().toISOString(),
        },
        domainEvents: [...input.committedEvents],
        lifeEvents: [],
        extraEvents: [],
      },
      situationDefinitions: input.situationDefinitions,
      playerCard: input.playerCard,
      visibleActorNames: input.visibleActorNames,
      entries: input.entries,
      cards: input.cards,
      allowedCandidates: input.allowedCandidates,
      preferredCandidateRef: input.preferredCandidateRef,
      preferredSituationId: input.preferredSituationId,
    }),
    campaignId: input.campaignId,
    playerActorId: input.playerCard.actorId,
    blockedNames: collectBlockedNames(input.blockedEntries ?? input.entries, input.knownEntryIds),
    situationDefinitions: input.situationDefinitions,
    playerCard: input.playerCard,
    visibleActorNames: input.visibleActorNames,
    contentBindingHash: guidanceContentBindingHash(input.state),
    knowledgeHash: input.knowledgeHash ?? stableFingerprint([...input.knownEntryIds].sort()),
    contextHash: stableFingerprint({ definitions: input.situationDefinitions, candidates: input.allowedCandidates, preferredCandidateRef: input.preferredCandidateRef, preferredSituationId: input.preferredSituationId }),
  });
}

function syntheticContract(turnId: string, state: GameStateSnapshot): ActionContract {
  return {
    protocolVersion: '3.0',
    turnId,
    expectedStateVersion: state.stateVersion - 1,
    actorId: '',
    actionType: 'local_action',
    evidenceIds: [],
    requiresRoll: false,
    intent: '',
    timeCostMinutes: 0,
    resourcePreconditions: [],
    outcomes: {
      full_success: { achieved: true, publicSummary: '', effects: [] },
      success: { achieved: true, publicSummary: '', effects: [] },
      failure: { achieved: false, publicSummary: '', effects: [] },
      severe_failure: { achieved: false, publicSummary: '', effects: [] },
    },
  };
}

function collectBlockedNames(entries: readonly ContentEntry[], knownEntryIds: ReadonlySet<string>): string[] {
  const blocked: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'situation' && (entry.visibility === 'gm'
      || (entry.visibility === 'discoverable' && !knownEntryIds.has(entry.entryId)))) {
      const definition = entry.definition as { name?: string; title?: string };
      const name = definition.name ?? definition.title;
      if (name && name.trim()) blocked.push(name.trim());
    }
  }
  return blocked;
}

/**
 * Fire the async LLM upgrade for one decision point. Deduped by decision
 * point; a stale result (state moved on, branch switched) is discarded.
 * Unknown outcomes follow the ledger's precise-recovery rules — the local
 * guidance stays valid regardless.
 */
export async function upgradeAncillaryGuidance(
  input: AncillaryGuidanceInput,
): Promise<TurnGuidanceV1 | null> {
  if (input.localOnly || !input.guidanceStore) return null;
  const scope = input.guidanceStore.dedupScope ?? input.guidanceStore;
  let pending = pendingUpgrades.get(scope);
  if (!pending) { pending = new Map(); pendingUpgrades.set(scope, pending); }
  const key = stableFingerprint(buildLocalAncillaryGuidance(input).decisionPoint);
  const shared = pending.get(key);
  if (shared) return shared;
  const work = performUpgrade(input).finally(() => pending!.delete(key));
  pending.set(key, work);
  return work;
}

const pendingUpgrades = new WeakMap<object, Map<string, Promise<TurnGuidanceV1 | null>>>();

async function performUpgrade(input: AncillaryGuidanceInput): Promise<TurnGuidanceV1 | null> {
  if (!input.guidanceStore) return null;
  const decisionPointId = decisionPointIdFor(input.branchId, input.state.stateVersion);
  const existing = await input.guidanceStore.get(input.branchId, decisionPointId);
  const localAtDispatch = buildLocalAncillaryGuidance(input);
  if (!existing || JSON.stringify(existing.decisionPoint) !== JSON.stringify(localAtDispatch.decisionPoint)) return null;
  if (existing.upgradeStatus === 'complete' || existing.steps.some(step => step.source === 'llm')) return existing;

  const packet = buildSituationPacket({
    prepared: {
      branchId: input.branchId,
      contract: syntheticContract(input.sourceTurnId, input.state),
      contractHash: `ancillary:${decisionPointId}`,
      outcomeGrade: 'success',
      nextState: input.state,
      committedTurn: {
        branchId: input.branchId,
        turnId: input.sourceTurnId,
        previousStateVersion: input.state.stateVersion - 1,
        stateVersion: input.state.stateVersion,
        outcomeGrade: 'success',
        publicSummary: '',
        effects: [],
        committedAt: new Date().toISOString(),
      },
      domainEvents: [...input.committedEvents],
      lifeEvents: [],
      extraEvents: [],
    },
    situationDefinitions: input.situationDefinitions,
    playerCard: input.playerCard,
    visibleActorNames: input.visibleActorNames,
    entries: input.entries,
    cards: input.cards,
    allowedCandidates: input.allowedCandidates,
    preferredCandidateRef: input.preferredCandidateRef,
    preferredSituationId: input.preferredSituationId,
  });
  if (!packet) return null;

  let response;
  try {
    const request: LlmRequest = {
      role: 'Narrator',
      system: [
        'You are ShineWord Narrator producing ONLY next-step guidance for a committed decision point. No story text.',
        'Output exactly JSON: {"situationSummary":{"changes":string[],"opportunities":string[],"pressures":string[]},"nextSteps":[{"candidateRef":string,"title":string,"rationale":string,"tradeoffs":string,"firstStepIntent":string}]}.',
        'nextSteps: at most 4 entries. candidateRef MUST be copied verbatim from situationPacket.allowedCandidates[].ref.',
        'title ≤24 chars, rationale ≤80 chars, tradeoffs ≤120 chars, firstStepIntent ≤160 chars.',
        'Copy tradeoffs and firstStepIntent verbatim from the referenced allowed candidate. Only title and rationale may be reworded; do not add numbers or claim guaranteed results in them.',
        'Never invent success rates, damage, costs, deadlines or rewards. Never reveal names or facts absent from situationPacket.',
      ].join(' '),
      user: JSON.stringify({
        decisionPointId,
        sourceTurnId: input.sourceTurnId,
        situationPacket: packet,
      }),
      maxOutputTokens: input.wireOutputTokens,
      jsonMode: true,
      reasoningTier: input.reasoningTier,
      reasoningReserveTokens: input.reasoningReserveTokens,
      reasoningPolicyVersion: input.reasoningPolicyVersion,
      requestKind: 'narrator_guidance',
      ledger: {
        logicalRequestId: `guidance:${input.branchId}:${decisionPointId}:${stableFingerprint(existing.decisionPoint)}`,
        requestKind: 'narrator_guidance',
        branchId: input.branchId,
        stateVersion: input.state.stateVersion,
      },
      maxPhysicalRequests: 1,
    };
    if (input.capabilities) {
      const plan = planLlmRequest({
        capabilities: input.capabilities, requestKind: 'narrator_guidance',
        businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.narrator_guidance,
        estimatedMandatoryInputTokens: estimateTokens(request.system + request.user) + 100,
        reasoningPolicy: input.reasoningPolicy,
      });
      request.maxOutputTokens = plan.wireOutputTokens;
      request.reasoningReserveTokens = plan.reasoningPolicy?.reserveTokens ?? input.reasoningReserveTokens;
    }
    response = await input.provider.complete(request);
  } catch {
    return null; // ledger rules own retries; local guidance stays in effect
  }
  let parsed: { situationSummary?: { changes?: unknown }; nextSteps?: unknown };
  try {
    parsed = parseStructuredOutput<typeof parsed>(response.text, { label: 'Ancillary guidance' }).value;
  } catch {
    parsed = {}; // A known response is consumed once, with local degradation.
  }
  const rawSteps = Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [];
  const steps: NextStepCandidateV1[] = [];
  for (const raw of rawSteps) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.candidateRef !== 'string' || typeof record.title !== 'string'
      || typeof record.rationale !== 'string' || typeof record.tradeoffs !== 'string'
      || typeof record.firstStepIntent !== 'string' || !record.title || !record.firstStepIntent) {
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
  // Staleness gate: the state must not have moved while the request ran.
  const current = input.getCurrentState ? await input.getCurrentState() : input.state;
  if (!current || current.stateVersion !== input.state.stateVersion
    || guidanceContentBindingHash(current) !== existing.decisionPoint.contentBindingHash
    || stableFingerprint(current.discoveries ?? []) !== stableFingerprint(input.state.discoveries ?? [])) return null;
  const local = await input.guidanceStore.get(input.branchId, decisionPointId);
  if (!local || JSON.stringify(local) !== JSON.stringify(existing)) return null;
  const contract = syntheticContract(input.sourceTurnId, input.state);
  const assembled = assembleTurnGuidance({
    prepared: {
      branchId: input.branchId, contract, contractHash: 'ancillary', outcomeGrade: 'success',
      nextState: input.state,
      committedTurn: { branchId: input.branchId, turnId: input.sourceTurnId,
        previousStateVersion: input.state.stateVersion - 1, stateVersion: input.state.stateVersion,
        outcomeGrade: 'success', publicSummary: '', effects: [], committedAt: new Date().toISOString() },
      domainEvents: [...input.committedEvents], lifeEvents: [], extraEvents: [],
    },
    contract, grade: 'success', llmSteps: steps, llmSummary: null, packet,
    campaignId: input.campaignId, playerActorId: input.playerCard.actorId,
    blockedNames: collectBlockedNames(input.blockedEntries ?? input.entries, input.knownEntryIds),
    situationDefinitions: input.situationDefinitions, playerCard: input.playerCard,
    visibleActorNames: input.visibleActorNames,
    contentBindingHash: existing.decisionPoint.contentBindingHash,
    knowledgeHash: existing.decisionPoint.knowledgeHash, contextHash: existing.decisionPoint.contextHash,
  });
  const upgraded: TurnGuidanceV1 = {
    ...assembled,
    guidanceVersion: GUIDANCE_VERSION,
    upgradeStatus: 'complete',
  };
  if (input.guidanceStore.replaceIfCurrent) {
    if (!await input.guidanceStore.replaceIfCurrent(upgraded, existing)) return null;
  } else {
    await input.guidanceStore.save(upgraded);
  }
  return upgraded;
}

export { detectSeverity };
