import type { ProposalActionKind } from '../../domain/turns/proposal';

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
  tradeoffs: string;
  preparation: string;
  availability: 'available' | 'needs_preparation';
  /** Why preparation is missing (player-safe). */
  blockers: string[];
}

/** Player-safe situation packet entering the Narrator request (§3.6). */
export interface PublicSituationPacketV1 {
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
}

export function decisionPointIdFor(branchId: string, nextStateVersion: number): string {
  return `${branchId}:${nextStateVersion}`;
}
