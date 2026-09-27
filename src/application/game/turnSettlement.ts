import type { RollGrade } from '../../domain/rules/types';
import {
  awardPractice,
  isTrainable,
  type RewardKind,
  type SkillProgress,
} from '../../domain/progression/growth';
import type { SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';

export interface SettlementInput {
  gameStore: SqliteGameStore;
  branchId: string;
  turnId: string;
  /** Stable encounter/challenge id; the reward dedup dimension. */
  encounterId: string;
  stateVersion: number;
  outcomeGrade: RollGrade;
  skillId?: string;
  actorId: string;
  now?: () => string;
}

export interface SettlementOutcome {
  practiceAwarded: boolean;
  /** Threshold reached — the skill is now trainable via explicit training. */
  trainable: boolean;
  /** Serious failure with a genuine attempt still counts as practice (plan §6.5). */
  practiceReason: 'risk_success' | 'honest_failure' | null;
}

/**
 * Settlement award: the local engine — never the LLM contract — decides
 * growth. Risky turns award exactly one practice point per skill per
 * encounter; failure after an honest attempt counts the same. Reaching a
 * threshold never auto-advances: advancement is an explicit, conditioned
 * training action that consumes the threshold.
 */
export async function settleTurnProgress(input: SettlementInput): Promise<SettlementOutcome> {
  const outcome: SettlementOutcome = {
    practiceAwarded: false,
    trainable: false,
    practiceReason: null,
  };
  if (!input.skillId) return outcome;

  const existing = await input.gameStore.getSkillProgress(input.branchId, input.actorId, input.skillId);
  const progress: SkillProgress = existing ?? {
    skillId: input.skillId,
    rank: 'untrained',
    practicePoints: 0,
    awardedKeys: [],
  };

  const awarded = awardPractice(progress, input.encounterId, 'practice');
  if (awarded === progress) return outcome;

  await input.gameStore.upsertSkillProgress(input.branchId, input.actorId, awarded, input.stateVersion);

  outcome.practiceAwarded = true;
  outcome.trainable = isTrainable(awarded);
  outcome.practiceReason = input.outcomeGrade === 'success' || input.outcomeGrade === 'full_success'
    ? 'risk_success'
    : 'honest_failure';
  return outcome;
}

export interface RelationshipUpdate {
  toActorId: string;
  stance: string;
  /** Closeness delta clamped to [-5, 5] per turn. */
  closenessDelta: number;
}

const CLOSNESS_MIN = -100;
const CLOSNESS_MAX = 100;

/**
 * Relationship updates with bounded per-turn deltas; the LLM proposes stance
 * text but never writes authority directly.
 */
export async function settleRelationships(
  gameStore: SqliteGameStore,
  branchId: string,
  fromActorId: string,
  updates: readonly RelationshipUpdate[],
  turnId: string,
  stateVersion: number,
): Promise<number> {
  let updated = 0;
  for (const change of updates) {
    if (!Number.isFinite(change.closenessDelta)) continue;
    const clamped = Math.max(-5, Math.min(5, change.closenessDelta));
    const existing = (await gameStore.listRelationships(branchId, fromActorId))
      .find(rel => rel.toActorId === change.toActorId);
    const closeness = Math.max(
      CLOSNESS_MIN,
      Math.min(CLOSNESS_MAX, (existing?.closeness ?? 0) + clamped),
    );
    await gameStore.upsertRelationship({
      branchId,
      relId: existing?.relId ?? `rel-${fromActorId}-${change.toActorId}`,
      fromActorId,
      toActorId: change.toActorId,
      stance: change.stance,
      closeness,
      updatedTurnId: turnId,
    }, stateVersion);
    updated += 1;
  }
  return updated;
}

/** Reward kind recorded in the ledger (kept in sync with the domain type). */
export type { RewardKind };
