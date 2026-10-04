import type { ActionContract } from '../../domain/turns/types';
import type { PreparedTurnResolution } from '../turns/commitTurn';
import type { ActorCard } from '../../domain/characters/card';
import type { SituationDefinitionV1 } from '../../domain/situations/types';
import { detectSeverity, buildSituationPacket } from './packet';
import { GUIDANCE_DISPLAY_LIMITS, GUIDANCE_TEXT_LIMITS, GUIDANCE_VERSION, decisionPointIdFor } from './types';
import type {
  GuidanceDecisionPointBinding,
  GuidanceSeverity,
  GuidanceStepView,
  NextStepCandidateV1,
  PublicSituationPacketV1,
  TurnGuidanceV1,
} from './types';

/**
 * Guidance validation and assembly (P7 §3.7–3.8). LLM steps are guests: each
 * one must reference a locally-allowed candidate, respect length caps and
 * never name blocked (GM-only / undiscovered / future) entities. A failing
 * step falls back to the published method wording — it is never shown with
 * unverified text, and its failure never re-sends the Narrator request.
 */

export interface GuidanceAssemblyInput {
  prepared: PreparedTurnResolution;
  contract: ActionContract;
  grade: string;
  llmSteps: NextStepCandidateV1[] | null;
  llmSummary: string[] | null;
  packet: PublicSituationPacketV1 | null;
  campaignId: string;
  playerActorId: string;
  /** Names that must NEVER appear in player-visible guidance text. */
  blockedNames: readonly string[];
  situationDefinitions: ReadonlyArray<{ situationId: string; definition: SituationDefinitionV1 }>;
  playerCard: ActorCard;
  visibleActorNames: ReadonlyMap<string, string>;
  keyItemIds?: ReadonlySet<string>;
  /** Hashes frozen for the decision-point binding. */
  contentBindingHash: string;
  knowledgeHash: string;
  contextHash: string;
}

const ODDS_WORDS = /成功率|几率|概率|百分之|\d+\s*%|必[成胜]|稳[赢操]/;

function containsBlockedName(text: string, blockedNames: readonly string[]): string | null {
  for (const name of blockedNames) {
    if (name.length >= 2 && text.includes(name)) return name;
  }
  return null;
}

function scrubNumbers(text: string): boolean {
  // Lone small numbers are common in Chinese prose; reject explicit odds and
  // long digit runs (fabricated costs/damage/deadlines).
  if (ODDS_WORDS.test(text)) return false;
  if (/\d{4,}/.test(text)) return false;
  return true;
}

export interface StepValidationOutcome {
  step: GuidanceStepView;
  usedLlmText: boolean;
  rejectedReason?: string;
}

export function validateLlmStep(
  raw: NextStepCandidateV1,
  packet: PublicSituationPacketV1,
  blockedNames: readonly string[],
): StepValidationOutcome | null {
  const allowed = packet.allowedCandidates.find(candidate => candidate.ref === raw.candidateRef);
  if (!allowed) return null; // unknown reference: drop the step entirely
  const fields = [
    ['title', raw.title, GUIDANCE_TEXT_LIMITS.title],
    ['rationale', raw.rationale, GUIDANCE_TEXT_LIMITS.rationale],
    ['tradeoffs', raw.tradeoffs, GUIDANCE_TEXT_LIMITS.tradeoffs],
    ['firstStepIntent', raw.firstStepIntent, GUIDANCE_TEXT_LIMITS.firstStepIntent],
  ] as const;
  let useLlm = true;
  let rejectedReason: string | undefined;
  for (const [field, value, limit] of fields) {
    if (value.length > limit) {
      useLlm = false;
      rejectedReason ??= `field ${field} exceeds ${limit} characters`;
    }
    const blocked = containsBlockedName(value, blockedNames);
    if (blocked) {
      useLlm = false;
      rejectedReason ??= `field ${field} leaks blocked entity`;
    }
    if (!scrubNumbers(value)) {
      useLlm = false;
      rejectedReason ??= `field ${field} fabricates odds or numbers`;
    }
  }
  // The intent must stay recognizable against the allowed candidate; a wildly
  // rewritten first step falls back to the published wording.
  if (!raw.firstStepIntent.trim() || raw.firstStepIntent.length < 4) {
    useLlm = false;
    rejectedReason ??= 'first step intent too short';
  }
  const step: GuidanceStepView = {
    source: useLlm ? 'llm' : 'local',
    candidateRef: allowed.ref,
    title: useLlm ? raw.title : allowed.title,
    rationale: useLlm ? raw.rationale : allowed.goal,
    tradeoffs: useLlm ? raw.tradeoffs : allowed.tradeoffs,
    firstStepIntent: useLlm ? raw.firstStepIntent : allowed.firstStepIntent,
    actionKind: allowed.actionKind,
    availability: allowed.availability,
    ...(allowed.methodId ? { methodId: allowed.methodId } : {}),
    ...(allowed.situationId ? { situationId: allowed.situationId } : {}),
    ...(allowed.actionId ? { actionId: allowed.actionId } : {}),
    ...(allowed.skillId ? { skillId: allowed.skillId } : {}),
    ...(allowed.blockers.length > 0 ? { blockers: allowed.blockers } : {}),
  };
  return { step, usedLlmText: useLlm, ...(rejectedReason ? { rejectedReason } : {}) };
}

export function assembleTurnGuidance(input: GuidanceAssemblyInput): TurnGuidanceV1 {
  const { prepared, contract, packet, llmSteps, llmSummary } = input;
  const severity: GuidanceSeverity = detectSeverity(
    [...prepared.domainEvents, ...prepared.lifeEvents, ...prepared.extraEvents],
    {
      keyItemIds: input.keyItemIds,
      relationshipCrossed60: detectRelationshipCrossing(prepared),
    },
  );
  const limit = GUIDANCE_DISPLAY_LIMITS[severity];

  const steps: GuidanceStepView[] = [];
  const usedRefs = new Set<string>();
  let degraded = false;
  let degradationReason: string | undefined;

  if (packet && llmSteps && llmSteps.length > 0) {
    for (const raw of llmSteps.slice(0, 6)) {
      const outcome = validateLlmStep(raw, packet, input.blockedNames);
      if (!outcome) {
        degraded = true;
        degradationReason ??= 'candidate_reference_rejected';
        continue;
      }
      if (!outcome.usedLlmText) {
        degraded = true;
        degradationReason ??= outcome.rejectedReason;
      }
      if (usedRefs.has(outcome.step.candidateRef)) continue;
      usedRefs.add(outcome.step.candidateRef);
      steps.push(outcome.step);
      if (steps.length >= limit) break;
    }
  } else if (packet) {
    degraded = true;
    degradationReason = llmSteps === null ? 'no_steps_in_response' : 'empty_steps';
  }

  // Fill from local candidates so the player always has real choices.
  if (packet) {
    for (const allowed of packet.allowedCandidates) {
      if (steps.length >= limit) break;
      if (usedRefs.has(allowed.ref)) continue;
      // Prefer situation methods; keep at most one base action when short.
      if (!allowed.methodId && steps.length > 0) continue;
      usedRefs.add(allowed.ref);
      steps.push({
        source: 'local',
        candidateRef: allowed.ref,
        title: allowed.title,
        rationale: allowed.goal,
        tradeoffs: allowed.tradeoffs,
        firstStepIntent: allowed.firstStepIntent,
        actionKind: allowed.actionKind,
        availability: allowed.availability,
        ...(allowed.methodId ? { methodId: allowed.methodId } : {}),
        ...(allowed.situationId ? { situationId: allowed.situationId } : {}),
        ...(allowed.actionId ? { actionId: allowed.actionId } : {}),
        ...(allowed.skillId ? { skillId: allowed.skillId } : {}),
        ...(allowed.blockers.length > 0 ? { blockers: allowed.blockers } : {}),
      });
    }
  }
  if (steps.length === 0) {
    degraded = true;
    degradationReason ??= 'no_valid_candidates';
  }

  const summary = packet
    ? {
      changes: (llmSummary && llmSummary.length > 0 ? llmSummary : packet.changes).slice(0, 5),
      opportunities: packet.opportunities.map(item => item.text).slice(0, 5),
      pressures: packet.pressures.map(item => item.text).slice(0, 5),
    }
    : { changes: [], opportunities: [], pressures: [] };

  const binding: GuidanceDecisionPointBinding = {
    campaignId: input.campaignId,
    branchId: prepared.branchId,
    playerActorId: input.playerActorId,
    sourceTurnId: contract.turnId,
    decisionPointId: decisionPointIdFor(prepared.branchId, prepared.nextState.stateVersion),
    stateVersion: prepared.nextState.stateVersion,
    contentBindingHash: input.contentBindingHash,
    knowledgeHash: input.knowledgeHash,
    contextHash: input.contextHash,
  };

  return {
    guidanceVersion: GUIDANCE_VERSION,
    decisionPoint: binding,
    severity,
    situationSummary: summary,
    steps,
    degraded,
    ...(degradationReason ? { degradationReason } : {}),
  };
}

function detectRelationshipCrossing(prepared: PreparedTurnResolution): boolean {
  return [...prepared.domainEvents, ...prepared.extraEvents].some(
    event => event.eventType === 'relationship_changed'
      && typeof (event.payload as { closeness?: unknown } | null)?.closeness === 'number'
      && Math.abs(Number((event.payload as { closeness?: unknown }).closeness)) >= 60,
  );
}

export { buildSituationPacket };
