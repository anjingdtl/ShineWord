import type { RollGrade } from '../../domain/rules/types';
import { awardPractice, checkAdvancement, type SkillProgress } from '../../domain/progression/growth';
import type { SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';

export interface SettlementInput {
  gameStore: SqliteGameStore;
  branchId: string;
  turnId: string;
  stateVersion: number;
  outcomeGrade: RollGrade;
  skillId?: string;
  actorId: string;
  now?: () => string;
}

export interface SettlementOutcome {
  practiceAwarded: boolean;
  advancedFrom: string | null;
  advancedTo: string | null;
  /** Serious failure with a genuine attempt still counts as practice (plan §6.5). */
  practiceReason: 'risk_success' | 'honest_failure' | null;
}

/**
 * Post-commit settlement: the local engine — never the LLM contract — decides
 * growth. Risky turns award exactly one practice point per skill; failure
 * after an honest attempt counts the same; advancement consumes thresholds.
 */
export async function settleTurnProgress(input: SettlementInput): Promise<SettlementOutcome> {
  const outcome: SettlementOutcome = {
    practiceAwarded: false,
    advancedFrom: null,
    advancedTo: null,
    practiceReason: null,
  };
  if (!input.skillId) return outcome;

  const existing = await input.gameStore.getSkillProgress(input.branchId, input.actorId, input.skillId);
  const progress: SkillProgress = existing ?? {
    skillId: input.skillId,
    rank: 'untrained',
    practicePoints: 0,
    awardedTurns: [],
  };

  const awarded = awardPractice(progress, input.turnId);
  if (awarded === progress) return outcome;

  const advanced = checkAdvancement(awarded);
  const next: SkillProgress = {
    ...awarded,
    practicePoints: advanced.pointsRemaining,
    rank: advanced.advanced && advanced.nextRank ? advanced.nextRank : awarded.rank,
  };
  await input.gameStore.upsertSkillProgress(input.branchId, input.actorId, next, input.stateVersion);

  outcome.practiceAwarded = true;
  outcome.practiceReason = input.outcomeGrade === 'success' || input.outcomeGrade === 'full_success'
    ? 'risk_success'
    : 'honest_failure';
  if (advanced.advanced && advanced.nextRank) {
    outcome.advancedFrom = progress.rank;
    outcome.advancedTo = advanced.nextRank;
  }
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
 * Relationship updates also run post-commit with bounded per-turn deltas; the
 * LLM proposes stance text but never writes authority directly.
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
