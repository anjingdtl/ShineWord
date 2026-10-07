import type { ProposalActionKind } from '../../domain/turns/proposal';
import type { GameStateSnapshot } from '../../domain/state/types';

/**
 * Turn guidance contracts (frozen in docs/reviews/phase7/BASELINE_AND_CONTRACTS.md
 * §3.6–3.9). Guidance is a DERIVED projection: the LLM only words candidates
 * chosen from a locally-built allowlist; eligibility, counts and permission
 * filtering are local decisions.
 */

export const GUIDANCE_VERSION = 'turn-guidance-1';

/** Display-count policy lives in the core projection; the UI never re-truncates. */
export const GUIDANCE_DISPLAY_LIMITS = { normal: 3, major: 4 } as const;

/** The Narrator may return at most this many bounded candidates. */
export const GUIDANCE_MAX_LLM_CANDIDATES = 6;

/** Field length bounds for every player-visible guidance text. */
export const GUIDANCE_TEXT_LIMITS = {
  title: 24,
  rationale: 80,
  tradeoffs: 120,
  firstStepIntent: 160,
} as const;

export type GuidanceSeverity = 'normal' | 'major';

/** Locally built allowed candidate (source of truth for validation). */
export interface AllowedCandidateV1 {
  /** `method:{situationId}:{methodId}` or `action:{actionId}`. */
  ref: string;
  methodId?: string;
  situationId?: string;
  actionId?: string;
  title: string;
  goal: string;
  firstStepIntent: string;
  actionKind: ProposalActionKind;
  skillId?: string;
  itemId?: string;
  destinationId?: string;
  tradeoffs: string;
  preparation: string;
  availability: 'available' | 'needs_preparation';
  /** Why preparation is missing (player-safe). */
  blockers: string[];
}

/** Player-safe situation packet entering the Narrator request (§3.6). */
export interface PublicSituationPacketV1 {
  /** Locally bound current mainline; never supplied by the model. */
  preferredSituationId?: string;
  changes: string[];
  opportunities: ReadonlyArray<{ text: string; situationId?: string }>;
  pressures: ReadonlyArray<{ text: string; deadlineClockSeconds?: number }>;
  actorNotes: ReadonlyArray<{ actorId: string; note: string }>;
  allowedCandidates: readonly AllowedCandidateV1[];
}

/** Raw LLM output shape (non-authoritative, validated before any use). */
export interface NextStepCandidateV1 {
  candidateRef: string;
  title: string;
  rationale: string;
  tradeoffs: string;
  firstStepIntent: string;
}

export interface GuidanceDecisionPointBinding {
  campaignId: string;
  branchId: string;
  playerActorId: string;
  sourceTurnId: string;
  /** `{branchId}:{nextStateVersion}`. */
  decisionPointId: string;
  stateVersion: number;
  contentBindingHash: string;
  knowledgeHash: string;
  contextHash: string;
}

export interface GuidanceStepView {
  source: 'llm' | 'local';
  candidateRef: string;
  title: string;
  rationale: string;
  tradeoffs: string;
  firstStepIntent: string;
  actionKind: ProposalActionKind;
  availability: 'available' | 'needs_preparation';
  methodId?: string;
  situationId?: string;
  actionId?: string;
  skillId?: string;
  blockers?: string[];
}

/** Persisted guidance record (branch_decision_guidance). */
export interface TurnGuidanceV1 {
  guidanceVersion: typeof GUIDANCE_VERSION;
  decisionPoint: GuidanceDecisionPointBinding;
  severity: GuidanceSeverity;
  situationSummary: {
    changes: string[];
    opportunities: string[];
    pressures: string[];
  };
  steps: readonly GuidanceStepView[];
  degraded: boolean;
  degradationReason?: string;
  /** A known ancillary response was consumed, even when wording degraded. */
  upgradeStatus?: 'complete';
}

export function decisionPointIdFor(branchId: string, nextStateVersion: number): string {
  return `${branchId}:${nextStateVersion}`;
}

/** Segment adoption may change artifacts without changing the legacy manifest. */
export function guidanceContentBindingHash(state: GameStateSnapshot): string {
  return state.segmentContentBinding?.artifactManifestHash
    ?? state.segmentContentBinding?.manifestHash ?? state.contentManifest?.manifestHash ?? 'no-binding';
}

/** Runtime boundary for persisted/imported derived views (no executable effects). */
export function validateGuidanceRecord(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['guidance must be an object'];
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  const strings = (value: unknown): boolean => Array.isArray(value) && value.length <= 5
    && value.every(item => typeof item === 'string' && item.length <= 2000);
  if (record.guidanceVersion !== GUIDANCE_VERSION) errors.push('unknown guidance version');
  if (record.severity !== 'normal' && record.severity !== 'major') errors.push('invalid guidance severity');
  if (typeof record.degraded !== 'boolean') errors.push('invalid guidance degradation flag');
  const binding = record.decisionPoint as Record<string, unknown> | undefined;
  if (!binding || ['campaignId', 'branchId', 'playerActorId', 'sourceTurnId', 'decisionPointId', 'contentBindingHash', 'knowledgeHash', 'contextHash']
    .some(key => typeof binding[key] !== 'string') || !Number.isSafeInteger(binding.stateVersion) || Number(binding.stateVersion) < 0) errors.push('invalid guidance decision point');
  const summary = record.situationSummary as Record<string, unknown> | undefined;
  if (!summary || !strings(summary.changes) || !strings(summary.opportunities) || !strings(summary.pressures)) errors.push('invalid guidance summary');
  if (!Array.isArray(record.steps) || record.steps.length > 4) errors.push('invalid guidance steps');
  else for (const step of record.steps) {
    if (!step || typeof step !== 'object') { errors.push('invalid guidance step'); continue; }
    const s = step as Record<string, unknown>;
    if (['candidateRef', 'title', 'rationale', 'tradeoffs', 'firstStepIntent'].some(key => typeof s[key] !== 'string' || String(s[key]).length > 2000)
      || (s.source !== 'llm' && s.source !== 'local') || (s.availability !== 'available' && s.availability !== 'needs_preparation')
      || !['skill_check', 'ability', 'observe', 'talk', 'interact', 'move'].includes(String(s.actionKind))
      || (s.blockers !== undefined && (!Array.isArray(s.blockers) || s.blockers.length > 16
        || s.blockers.some(item => typeof item !== 'string' || item.length > 2000)))) errors.push('invalid guidance step');
  }
  return errors;
}
