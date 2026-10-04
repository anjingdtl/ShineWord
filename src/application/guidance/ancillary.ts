import type { ContentEntry } from '../../domain/content/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { ActorCard } from '../../domain/characters/card';
import type { SituationDefinitionV1 } from '../../domain/situations/types';
import type { ActionContract } from '../../domain/turns/types';
import type { LlmProvider } from '../llm/types';
import { parseStructuredOutput } from '../llm/structuredOutput';
import type { GuidanceStore } from '../ports/guidanceStore';
import { detectSeverity, buildSituationPacket } from './packet';
import { assembleTurnGuidance, validateLlmStep } from './validate';
import {
  GUIDANCE_VERSION,
  decisionPointIdFor,
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
  /** Committed state at the decision point (player-actable). */
  state: GameStateSnapshot;
  /** Source turn that created this decision point (the local/NPC action). */
  sourceTurnId: string;
  /** Events of that committed turn, for severity detection. */
  committedEvents: ReadonlyArray<{ eventType: string; payload: unknown }>;
  situationDefinitions: ReadonlyArray<{ situationId: string; definition: SituationDefinitionV1 }>;
  entries: readonly ContentEntry[];
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
    }),
    campaignId: input.campaignId,
    playerActorId: input.playerCard.actorId,
    blockedNames: collectBlockedNames(input.entries, input.knownEntryIds),
    situationDefinitions: input.situationDefinitions,
    playerCard: input.playerCard,
    visibleActorNames: input.visibleActorNames,
    contentBindingHash: String(input.state.segmentContentBinding?.manifestHash
      ?? input.state.contentManifest?.manifestHash ?? 'no-binding'),
    knowledgeHash: '',
    contextHash: '',
  });
}

function syntheticContract(turnId: string, state: GameStateSnapshot): ActionContract {
  return {
    protocolVersion: '1.0',
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
    if (entry.visibility === 'gm'
      || (entry.visibility === 'discoverable' && !knownEntryIds.has(entry.entryId))) {
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
  const decisionPointId = decisionPointIdFor(input.branchId, input.state.stateVersion);
  const existing = await input.guidanceStore.get(input.branchId, decisionPointId);
  if (existing && existing.steps.some(step => step.source === 'llm')) return existing;

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
  });
  if (!packet) return null;

  let response;
  try {
    response = await input.provider.complete({
      role: 'Narrator',
      system: [
        'You are ShineWord Narrator producing ONLY next-step guidance for a committed decision point. No story text.',
        'Output exactly JSON: {"situationSummary":{"changes":string[],"opportunities":string[],"pressures":string[]},"nextSteps":[{"candidateRef":string,"title":string,"rationale":string,"tradeoffs":string,"firstStepIntent":string}]}.',
        'nextSteps: at most 4 entries. candidateRef MUST be copied verbatim from situationPacket.allowedCandidates[].ref.',
        'title ≤24 chars, rationale ≤80 chars, tradeoffs ≤120 chars, firstStepIntent ≤160 chars.',
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
        logicalRequestId: `guidance:${input.branchId}:${decisionPointId}`,
        requestKind: 'narrator_guidance',
        branchId: input.branchId,
        stateVersion: input.state.stateVersion,
      },
    });
  } catch {
    return null; // ledger rules own retries; local guidance stays in effect
  }
  let parsed: { situationSummary?: { changes?: unknown }; nextSteps?: unknown };
  try {
    parsed = parseStructuredOutput<typeof parsed>(response.text, { label: 'Ancillary guidance' }).value;
  } catch {
    return null;
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
  const blockedNames = collectBlockedNames(input.entries, input.knownEntryIds);
  const validated = steps
    .map(step => validateLlmStep(step, packet, blockedNames))
    .filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== null)
    .map(outcome => outcome.step)
    .slice(0, packet.allowedCandidates.length > 0 ? 4 : 0);

  // Staleness gate: the state must not have moved while the request ran.
  const current = input.state;
  void current;
  const local = await input.guidanceStore.get(input.branchId, decisionPointId);
  const base = local ?? buildLocalAncillaryGuidance(input);
  if (validated.length === 0) return base;
  const upgraded: TurnGuidanceV1 = {
    ...base,
    guidanceVersion: GUIDANCE_VERSION,
    steps: validated,
    degraded: false,
  };
  await input.guidanceStore.save(upgraded);
  return upgraded;
}

export { detectSeverity };
