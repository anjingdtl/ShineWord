import type { DifficultyBand } from '../rules/types';

/**
 * V2 restricted planner proposal (plan §13.2). The model NEVER authors an
 * effect array or an outcome clause: it may only choose an action KIND, bind
 * it to a world-package definition (ability / skill), name targets and
 * evidence, and suggest narrative wording. Every authoritative number —
 * difficulty, costs, damage, healing caps, time — is compiled locally from
 * trusted definitions by the engine (application/game/v2Compile).
 */
export type ProposalActionKind =
  | 'skill_check'   // risky check against a world skill
  | 'ability'       // a prepared ability from the world package
  | 'observe'       // automatic: look around, no mechanical benefit
  | 'talk'          // automatic: social exchange without mechanical stakes
  | 'interact'      // automatic: low-risk manipulation of the environment
  | 'move';         // automatic: travel to a known location

export interface PlannerProposal {
  proposalVersion: '2.0';
  turnId: string;
  expectedStateVersion: number;
  actorId: string;
  actionKind: ProposalActionKind;
  /** skill_check: the world skill entry id (short or prefixed form). */
  skillId?: string;
  /** ability: the world ability entry id. */
  abilityId?: string;
  /** skill_check: planner may propose a difficulty band; the engine maps it. */
  difficultyBand?: DifficultyBand;
  /** ability/skill_check: target actor id, when the action has a target. */
  targetId?: string;
  /** move: destination location id (engine validates it is a known place). */
  destinationId?: string;
  evidenceIds: string[];
  intent: string;
  /** Non-authoritative narrative suggestions; wording only, never numbers. */
  narrativeHint?: {
    successSummary: string;
    failureSummary: string;
  };
  /**
   * P9 (A11): when the player's free input maps to one of the listed
   * intervention methods, the planner echoes that method's stable reference
   * (method:{situationId}:{methodId}). The LOCAL compiler verifies it
   * against the offered methods before binding; an unknown id is refused.
   */
  candidateRef?: string;
}

export const PROPOSAL_ACTION_KINDS: readonly ProposalActionKind[] = [
  'skill_check', 'ability', 'observe', 'talk', 'interact', 'move',
];

/** Fields a proposal must never carry: they are engine authority. */
const FORBIDDEN_PROPOSAL_KEYS = new Set([
  'outcomes',
  'effects',
  'requiresRoll',
  'resourcePreconditions',
  'timeCostMinutes',
  'actionContract',
  'diceCount',
  'dieSides',
  'rolls',
  'highest',
  'grade',
  'balance',
  'costs',
  'damage',
  'heal',
  'amount',
  'cap',
]);

const PROPOSAL_KEYS = new Set([
  'proposalVersion',
  'turnId',
  'expectedStateVersion',
  'actorId',
  'actionKind',
  'skillId',
  'abilityId',
  'difficultyBand',
  'targetId',
  'destinationId',
  'evidenceIds',
  'intent',
  'narrativeHint',
  // P9 (A11): planner may echo a stable method reference for free input.
  'candidateRef',
]);

const DIFFICULTY_BAND_SET = new Set(['simple', 'normal', 'challenging', 'hard', 'extreme', 'peak']);

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Strict proposal validation. Unknown or authoritative keys are refused with
 * an explicit message, so a model (or a tampered response) can never smuggle
 * numbers through the proposal channel.
 */
export function validatePlannerProposal(proposal: PlannerProposal): string[] {
  const errors: string[] = [];
  const record = proposal as unknown as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PROPOSAL_KEYS.has(key)) {
      errors.push(
        `${key}: proposals must not carry authoritative contract data; ` +
          'the local rules engine compiles all numbers.',
      );
    } else if (!PROPOSAL_KEYS.has(key)) {
      errors.push(`${key}: unknown proposal field.`);
    }
  }

  if (proposal.proposalVersion !== '2.0') {
    errors.push('proposalVersion must be "2.0".');
  }
  if (!nonEmpty(proposal.turnId)) errors.push('turnId is required.');
  if (!Number.isInteger(proposal.expectedStateVersion) || proposal.expectedStateVersion < 0) {
    errors.push('expectedStateVersion must be a non-negative integer.');
  }
  if (!nonEmpty(proposal.actorId)) errors.push('actorId is required.');
  if (!PROPOSAL_ACTION_KINDS.includes(proposal.actionKind)) {
    errors.push(`actionKind must be one of ${PROPOSAL_ACTION_KINDS.join(', ')}.`);
  }
  if (!nonEmpty(proposal.intent)) errors.push('intent is required.');
  if (!Array.isArray(proposal.evidenceIds)) errors.push('evidenceIds must be an array.');

  if (proposal.actionKind === 'skill_check') {
    if (!nonEmpty(proposal.skillId)) errors.push('skill_check requires skillId.');
    if (proposal.difficultyBand !== undefined && !DIFFICULTY_BAND_SET.has(proposal.difficultyBand)) {
      errors.push(`unknown difficultyBand ${String(proposal.difficultyBand)}.`);
    }
  }
  if (proposal.actionKind === 'ability' && !nonEmpty(proposal.abilityId)) {
    errors.push('ability requires abilityId.');
  }
  if (proposal.actionKind === 'move' && !nonEmpty(proposal.destinationId)) {
    errors.push('move requires destinationId.');
  }
  if (proposal.candidateRef !== undefined && !/^method:[A-Za-z0-9][A-Za-z0-9._:-]*:[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(proposal.candidateRef)) {
    errors.push('candidateRef must be a method:{situationId}:{methodId} reference.');
  }
  if (
    proposal.narrativeHint !== undefined &&
    (typeof proposal.narrativeHint !== 'object' || proposal.narrativeHint === null ||
      !nonEmpty(proposal.narrativeHint.successSummary) || !nonEmpty(proposal.narrativeHint.failureSummary))
  ) {
    errors.push('narrativeHint requires successSummary and failureSummary strings.');
  }
  return errors;
}

export function assertValidPlannerProposal(proposal: PlannerProposal): void {
  const errors = validatePlannerProposal(proposal);
  if (errors.length > 0) {
    throw new Error(`Invalid planner proposal:\n- ${errors.join('\n- ')}`);
  }
}
