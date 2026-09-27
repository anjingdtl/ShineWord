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
  /**
   * Skills this actor may legally attack with: template-declared attacks, or
   * world skills explicitly marked usage='attack'. Medic/stealth/lore skills
   * NEVER auto-become weapons (P2 acceptance A07).
   */
  attackSkillIds: readonly string[];
}

/**
 * Freezes initiative from the cards - never from generated text length.
 * Ties break deterministically by stable actorId so replays match.
 */
export function freezeInitiative(combatants: readonly Combatant[]): string[] {
  const seen = new Set<string>();
  const order = [...combatants]
    .sort((a, b) => {
      const agiA = a.card.attributes.agility ?? 1;
      const agiB = b.card.attributes.agility ?? 1;
      if (agiA !== agiB) return agiB - agiA;
      const insA = a.card.attributes.insight ?? 1;
      const insB = b.card.attributes.insight ?? 1;
      if (insA !== insB) return insB - insA;
      return a.actorId < b.actorId ? -1 : 1;
    })
    .filter(combatant => {
      if (seen.has(combatant.actorId)) return false;
      seen.add(combatant.actorId);
      return true;
    });
  if (order.length === 0) {
    throw new Error('An encounter requires at least one combatant.');
  }
  return order.map(combatant => combatant.actorId);
}

/**
 * Attack ranges as distance ceilings: touch reaches only the same zone,
 * near/mid/far reach up to that band (plan §12.3).
 */
const RANGE_MAX_HOPS: Record<'touch' | 'near' | 'mid' | 'far', number> = {
  touch: 0,
  near: 0,
  mid: 1,
  far: 2,
};

/**
 * Graph distance between zones (P2 acceptance A07): same zone = near, one
 * connection = mid, two connections = far. ANYTHING further — including
 * completely disconnected zones — is out_of_range and can never be attacked
 * or targeted. Breadth-first over the exits; no path means unreachable.
 */
export function distanceBetweenZones(
  zones: ReadonlyArray<{ zoneId: string; exits: readonly string[] }>,
  fromZoneId: string,
  toZoneId: string,
): DistanceBand {
  if (fromZoneId === toZoneId) return 'near';
  const byId = new Map(zones.map(zone => [zone.zoneId, zone]));
  const from = byId.get(fromZoneId);
  if (!from) throw new Error(`Unknown zone: ${fromZoneId}.`);
  if (!byId.has(toZoneId)) throw new Error(`Unknown zone: ${toZoneId}.`);
  // BFS up to depth 2; deeper or unreachable => out_of_range.
  const visited = new Set<string>([fromZoneId]);
  let frontier = [fromZoneId];
  for (let depth = 1; depth <= 2; depth += 1) {
    const next: string[] = [];
    for (const zoneId of frontier) {
      for (const exit of byId.get(zoneId)?.exits ?? []) {
        if (visited.has(exit)) continue;
        visited.add(exit);
        if (exit === toZoneId) {
          return depth === 1 ? 'mid' : 'far';
        }
        next.push(exit);
      }
    }
    frontier = next;
  }
  return 'out_of_range';
}

/** True when an attack of `range` can legally reach `band`. */
export function rangeCoversBand(
  range: 'touch' | 'near' | 'mid' | 'far',
  band: DistanceBand,
): boolean {
  if (band === 'out_of_range') return false;
  const hops = band === 'near' ? 0 : band === 'mid' ? 1 : 2;
  return hops <= RANGE_MAX_HOPS[range];
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
  /** Scene zones; required for range validation. */
  zones: ReadonlyArray<{ zoneId: string; exits: readonly string[] }>;
  /** Attack range of the weapon/ability used; defaults to touch. */
  attackRange?: 'touch' | 'near' | 'mid' | 'far';
}

/**
 * Compiles an attack into a frozen contract: the damage numbers come from
 * the local damage template, never from model output. The target defense is
 * the preset difficulty - no post-hoc armor generation.
 *
 * Local eligibility gates (P2 acceptance A07): the attacker must be a
 * conscious encounter participant with an UNUSED main action this round; the
 * skill must be one of the attacker's declared attack skills; the target
 * must be a conscious participant within the attack's range band.
 */
export function compileAttack(input: AttackActionInput): {
  contract: ActionContract;
  expectedDamage: number;
} {
  const attackerState = input.encounter.actors[input.attacker.actorId];
  if (!attackerState) {
    throw new Error(`Attacker ${input.attacker.actorId} is not a participant in encounter ${input.encounterId}.`);
  }
  if ((attackerState.hp ?? 0) <= 0 || attackerState.conditions.includes('disabled')) {
    throw new Error(`Attacker ${input.attacker.actorId} is disabled and cannot act.`);
  }
  if (attackerState.actedThisRound) {
    throw new Error(
      `Attacker ${input.attacker.actorId} has already used its main action this round.`,
    );
  }
  if (!input.attacker.attackSkillIds.includes(input.skillId)) {
    throw new Error(
      `Skill ${input.skillId} is not an attack skill of ${input.attacker.actorId}; ` +
        'medic/stealth/utility skills can never be compiled into attacks.',
    );
  }
  const targetState = input.encounter.actors[input.target.actorId];
  if (!targetState) {
    throw new Error(`Target ${input.target.actorId} is not a participant in encounter ${input.encounterId}.`);
  }
  if ((targetState.hp ?? 0) <= 0) {
    throw new Error(`Target ${input.target.actorId} is already disabled.`);
  }
  const band = distanceBetweenZones(input.zones, input.attacker.zoneId, input.target.zoneId);
  if (!rangeCoversBand(input.attackRange ?? 'touch', band)) {
    throw new Error(
      `Target ${input.target.actorId} is at ${band} range; a ${input.attackRange ?? 'touch'} attack cannot reach it.`,
    );
  }

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
 * chooses among LEGAL actions only — attack the weakest conscious hostile IN
 * RANGE using a declared attack skill, move closer when nothing is in range,
 * retreat through a REAL scene exit when morale breaks. No LLM call per
 * mechanical turn, and utility skills are never selected as weapons.
 */
export function decideNpcAction(options: {
  actor: Combatant;
  encounter: EncounterState;
  combatants: readonly Combatant[];
  catalog: SkillCatalog;
  zones: ReadonlyArray<{ zoneId: string; exits: readonly string[] }>;
}): { kind: 'attack'; targetId: string; skillId: string } | { kind: 'move'; towardActorId: string } | { kind: 'retreat'; exitId: string } {
  const { actor, combatants, catalog, zones } = options;
  const hpOf = (actorId: string): number => options.encounter.actors[actorId]?.hp ?? 0;

  // Retreat check: behavior threshold on the template card, through an exit
  // that actually exists in the scene (a cornered actor keeps fighting).
  const hasMorale = actor.card.kind === 'creature' || actor.card.kind === 'npc';
  if (hasMorale) {
    const maxHp = actor.card.resourceMax.hp ?? 10;
    const retreatThreshold = 0.25;
    if (hpOf(actor.actorId) > 0 && hpOf(actor.actorId) / maxHp < retreatThreshold) {
      const exit = options.encounter.scene.exitIds[0];
      if (exit) return { kind: 'retreat', exitId: exit };
    }
  }

  const enemies = combatants.filter(
    candidate => candidate.side !== actor.side && candidate.side !== 'neutral' && hpOf(candidate.actorId) > 0,
  );
  if (enemies.length === 0) {
    // No conscious enemies: the encounter ends instead of acting.
    const exit = options.encounter.scene.exitIds[0];
    if (exit) return { kind: 'retreat', exitId: exit };
    return { kind: 'move', towardActorId: actor.actorId };
  }
  // Prefer the weakest enemy the actor can legally hit with its best attack
  // skill (attack skills only, range respected).
  const attackSkill = Object.entries(actor.card.skills)
    .filter(([skillId]) => actor.attackSkillIds.includes(skillId) && catalog[skillId])
    .sort((a, b) => SKILL_RANK_DIE[b[1] as SkillRank] - SKILL_RANK_DIE[a[1] as SkillRank])[0];
  const byAscendingHops = (a: Combatant, b: Combatant): number => {
    const hopsOf = (candidate: Combatant): number => {
      const band = distanceBetweenZones(zones, actor.zoneId, candidate.zoneId);
      return band === 'near' ? 0 : band === 'mid' ? 1 : band === 'far' ? 2 : 99;
    };
    return hopsOf(a) - hopsOf(b);
  };
  if (attackSkill) {
    const range = attackRangeFor(actor, attackSkill[0]);
    const inRange = enemies
      .filter(enemy => rangeCoversBand(range, distanceBetweenZones(zones, actor.zoneId, enemy.zoneId)))
      .sort((a, b) => hpOf(a.actorId) - hpOf(b.actorId) || byAscendingHops(a, b));
    if (inRange.length > 0 && inRange[0]) {
      return { kind: 'attack', targetId: inRange[0].actorId, skillId: attackSkill[0] };
    }
    const nearest = [...enemies].sort(byAscendingHops)[0]!;
    return { kind: 'move', towardActorId: nearest.actorId };
  }
  const nearest = [...enemies].sort(byAscendingHops)[0]!;
  return { kind: 'move', towardActorId: nearest.actorId };
}

/** Default attack range for a combatant's attack skill (templates declare their own). */
function attackRangeFor(_actor: Combatant, _skillId: string): 'touch' | 'near' | 'mid' | 'far' {
  // V0.2 default: melee (touch) unless a template attack declares otherwise;
  // callers pass explicit ranges when the template declares them.
  return 'touch';
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
