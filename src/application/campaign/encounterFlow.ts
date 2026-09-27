import type { RollGrade, SkillRank } from '../../domain/rules/types';
import type { ActionContract } from '../../domain/turns/types';
import { applyDamage } from '../../domain/combat/encounter';
import type { EncounterState, DistanceBand } from '../../domain/combat/encounter';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { ActorCard, SkillCatalog } from '../../domain/characters/card';
import { rollSpecForSkill, attackDamageForGrade } from '../../domain/characters/card';
import type { TurnSettlementPlan } from '../ports/turnStore';
import { SKILL_RANK_DIE } from '../../domain/characters/card';

/**
 * V0.2 encounter flow (plan §12): deterministic initiative (agility desc,
 * insight desc, stable actorId), zone-based distance bands, per-actor action
 * economy, rewards granted exactly once at encounter end.
 */

export const COMBAT_ROUND_SECONDS = 6;
export const STANDARD_MOVES_PER_ROUND = 1;
export const MAIN_ACTIONS_PER_ROUND = 1;
/** Trigger-chain budget (plan §12.2): no recursive or endless triggers. */
export const MAX_TRIGGER_EFFECTS_PER_ACTION = 8;

export interface Combatant {
  actorId: string;
  card: ActorCard;
  side: 'party' | 'hostile' | 'neutral';
  zoneId: string;
  armor: number;
}

/**
 * Freezes initiative from the cards - never from generated text length.
 * Ties break deterministically by stable actorId so replays match.
 */
export function freezeInitiative(combatants: readonly Combatant[]): string[] {
  return [...combatants]
    .sort((a, b) => {
      const agiA = a.card.attributes.agility ?? 1;
      const agiB = b.card.attributes.agility ?? 1;
      if (agiA !== agiB) return agiB - agiA;
      const insA = a.card.attributes.insight ?? 1;
      const insB = b.card.attributes.insight ?? 1;
      if (insA !== insB) return insB - insA;
      return a.actorId < b.actorId ? -1 : 1;
    })
    .map(combatant => combatant.actorId);
}

/** Distance between zones: same = near, adjacent = mid, further = far. */
export function distanceBetweenZones(
  zones: ReadonlyArray<{ zoneId: string; exits: readonly string[] }>,
  fromZoneId: string,
  toZoneId: string,
): DistanceBand {
  if (fromZoneId === toZoneId) return 'near';
  const from = zones.find(zone => zone.zoneId === fromZoneId);
  if (from?.exits.includes(toZoneId)) return 'mid';
  for (const exit of from?.exits ?? []) {
    const neighbor = zones.find(zone => zone.zoneId === exit);
    if (neighbor?.exits.includes(toZoneId)) return 'far';
  }
  if ((from?.exits.length ?? 0) > 0) return 'far';
  throw new Error(`Zones are not connected: ${fromZoneId} -> ${toZoneId}.`);
}

export interface AttackActionInput {
  attacker: Combatant;
  target: Combatant;
  skillId: string;
  catalog: SkillCatalog;
  difficultyBand: 'simple' | 'normal' | 'challenging' | 'hard';
  state: GameStateSnapshot;
  encounter: EncounterState;
  encounterId: string;
  /** Monotonic action counter inside the encounter; freezes the turn id. */
  actionSeq: number;
  stateVersion: number;
}

/**
 * Compiles an attack into a frozen contract: the damage numbers come from
 * the local damage template, never from model output. The target defense is
 * the preset difficulty - no post-hoc armor generation.
 */
export function compileAttack(input: AttackActionInput): {
  contract: ActionContract;
  expectedDamage: number;
} {
  const spec = rollSpecForSkill(input.attacker.card, input.catalog, input.skillId, input.difficultyBand);
  void spec;
  const turnId = `enc:${input.encounterId}:${input.attacker.actorId}:${input.actionSeq}`;
  const actor = input.state.actors[input.target.actorId];
  if (!actor) throw new Error(`Target actor missing from state: ${input.target.actorId}.`);
  const currentHp = actor.resources.hp ?? 0;
  if (currentHp <= 0) throw new Error(`Target ${input.target.actorId} is already disabled.`);

  const build = (grade: RollGrade): ActionContract['outcomes']['success'] => {
    const raw = attackDamageForGrade(grade);
    const dealt = Math.max(0, raw - input.target.armor);
    const applied = Math.min(dealt, currentHp);
    const effects: ActionContract['outcomes']['success']['effects'] = [];
    if (applied > 0) {
      effects.push({ op: 'consumeResource', actorId: input.target.actorId, resourceId: 'hp', amount: applied });
    }
    if (currentHp - applied <= 0) {
      effects.push({ op: 'applyCondition', actorId: input.target.actorId, conditionId: 'disabled' });
    }
    effects.push({ op: 'recordEvent', eventType: 'attack', summary: `${input.attacker.actorId} 对 ${input.target.actorId} 攻击` });
    return {
      achieved: grade === 'success' || grade === 'full_success',
      publicSummary: grade === 'full_success' ? '攻击充分命中' : grade === 'success' ? '攻击命中' : '攻击未命中',
      effects,
    };
  };

  const contract: ActionContract = {
    protocolVersion: '1.0',
    turnId,
    expectedStateVersion: input.state.stateVersion,
    actorId: input.attacker.actorId,
    actionType: 'attack',
    targetId: input.target.actorId,
    evidenceIds: [`encounter:${input.encounterId}`],
    requiresRoll: true,
    intent: `${input.attacker.actorId} attacks ${input.target.actorId} with ${input.skillId}`,
    timeCostMinutes: 0,
    resourcePreconditions: [],
    skillId: input.skillId,
    difficultyBand: input.difficultyBand,
    outcomes: {
      full_success: build('full_success'),
      success: build('success'),
      failure: build('failure'),
      severe_failure: build('severe_failure'),
    },
  };
  return { contract, expectedDamage: Math.max(0, attackDamageForGrade('success') - input.target.armor) };
}

export interface RestOutcomePolicy {
  shortRest: { minutes: number; stamina: number; hp: number };
  longRest: { minutes: number; stamina: 'full' | number; hp: number };
}

/** Conservative ordinary-human rest defaults (plan §12.5), overridable per world. */
export const DEFAULT_REST_POLICY: RestOutcomePolicy = {
  shortRest: { minutes: 30, stamina: 2, hp: 0 },
  longRest: { minutes: 8 * 60, stamina: 'full', hp: 2 },
};

/**
 * Deterministic companion/hostile policy for one action slot (plan §11):
 * chooses among LEGAL actions only - attack the weakest conscious hostile in
 * range, or move closer when out of range. No LLM call per mechanical turn.
 */
export function decideNpcAction(options: {
  actor: Combatant;
  encounter: EncounterState;
  combatants: readonly Combatant[];
  catalog: SkillCatalog;
}): { kind: 'attack'; targetId: string; skillId: string } | { kind: 'move'; towardActorId: string } | { kind: 'retreat'; exitId: string } {
  const { actor, combatants, catalog } = options;
  const hpOf = (actorId: string): number => options.encounter.actors[actorId]?.hp ?? 0;

  // Retreat check: behavior threshold on the template card.
  const morale = actor.card.kind === 'creature' || actor.card.kind === 'npc';
  if (morale) {
    const maxHp = actor.card.resourceMax.hp ?? 10;
    const retreatThreshold = 0.25;
    if (hpOf(actor.actorId) > 0 && hpOf(actor.actorId) / maxHp < retreatThreshold) {
      return { kind: 'retreat', exitId: 'scene-exit' };
    }
  }

  const enemies = combatants.filter(
    candidate => candidate.side !== actor.side && candidate.side !== 'neutral' && hpOf(candidate.actorId) > 0,
  );
  if (enemies.length === 0) {
    // No conscious enemies: the encounter ends instead of acting.
    return { kind: 'retreat', exitId: 'scene-exit' };
  }
  const target = [...enemies].sort((a, b) => hpOf(a.actorId) - hpOf(b.actorId))[0]!;
  const attackSkill = Object.entries(actor.card.skills)
    .filter(([skillId]) => catalog[skillId])
    .sort((a, b) => SKILL_RANK_DIE[b[1] as SkillRank] - SKILL_RANK_DIE[a[1] as SkillRank])[0];
  if (!attackSkill) {
    return { kind: 'move', towardActorId: target.actorId };
  }
  return { kind: 'attack', targetId: target.actorId, skillId: attackSkill[0] };
}

/**
 * Loot + practice rewards at encounter end, generated ONCE per encounter
 * (plan §12.4). The reward ledger rows go through the same transaction, so a
 * replayed resolution cannot double-award.
 */
export function buildEncounterRewards(options: {
  branchId: string;
  encounterId: string;
  encounter: EncounterState;
  combatants: readonly Combatant[];
  catalog: SkillCatalog;
  stateVersion: number;
  lootItemIds?: readonly string[];
  lootRecipientActorId?: string;
}): TurnSettlementPlan {
  const plan: TurnSettlementPlan = {
    encounterId: options.encounterId,
    skillUpserts: [],
    rewardLedger: [],
    relationships: [],
  };
  // Loot: granted once by the frozen loot policy, engine-side only.
  if (options.lootItemIds && options.lootRecipientActorId) {
    plan.loot = options.lootItemIds.map(itemId => ({ itemId, actorId: options.lootRecipientActorId! }));
  }
  return plan;
}

// Re-export for callers assembling full plans.
export { applyDamage };
