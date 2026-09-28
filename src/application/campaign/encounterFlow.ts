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
export type NpcActionDecision =
  | { kind: 'attack'; targetId: string; skillId: string }
  | { kind: 'move'; towardActorId: string }
  | { kind: 'retreat'; exitId: string }
  | { kind: 'rescue'; targetId: string }
  | { kind: 'guard' };

export function decideNpcAction(options: {
  actor: Combatant;
  encounter: EncounterState;
  combatants: readonly Combatant[];
  catalog: SkillCatalog;
  zones: ReadonlyArray<{ zoneId: string; exits: readonly string[] }>;
}): NpcActionDecision {
  const { actor, combatants, catalog, zones } = options;
  const hpOf = (actorId: string): number => options.encounter.actors[actorId]?.hp ?? 0;
  const actorState = options.encounter.actors[actor.actorId];
  const directive = actor.card.controller === 'companion' ? actor.card.companionDirective : undefined;
  const actorZone = zones.find(zone => zone.zoneId === actor.zoneId);
  const exitId = actorZone?.exits.find(exit => options.encounter.scene.exitIds.includes(exit));

  // Neutral is a real faction. It receives its initiative slot and recorded
  // guard action, but never auto-targets either of the fighting sides.
  if (actor.side === 'neutral') return { kind: 'guard' };

  if (directive === 'retreat') return exitId ? { kind: 'retreat', exitId } : { kind: 'guard' };

  if (directive === 'support') {
    const disabledAlly = combatants
      .filter(candidate => candidate.side === actor.side && candidate.actorId !== actor.actorId
        && hpOf(candidate.actorId) <= 0
        && options.encounter.actors[candidate.actorId]?.conditions.includes('disabled')
        && candidate.zoneId === actor.zoneId)
      .sort((a, b) => a.actorId.localeCompare(b.actorId))[0];
    if (disabledAlly) return { kind: 'rescue', targetId: disabledAlly.actorId };
  }

  if (directive === 'follow') {
    const leaderId = actor.card.companionLeaderActorId
      ?? combatants.find(candidate => candidate.side === 'party' && candidate.card.controller === 'player')?.actorId;
    const leader = leaderId ? combatants.find(candidate => candidate.actorId === leaderId) : undefined;
    if (leader && leader.zoneId !== actor.zoneId) return { kind: 'move', towardActorId: leader.actorId };
  }

  // Retreat check: behavior threshold on the template card, through an exit
  // that actually exists in the scene (a cornered actor keeps fighting).
  const hasMorale = actor.card.kind === 'creature' || actor.card.kind === 'npc' || actor.card.kind === 'companion';
  if (hasMorale) {
    const maxHp = actor.card.resourceMax.hp ?? 10;
    const retreatThreshold = actor.card.combatBehavior?.retreatThreshold ?? 0.25;
    if (hpOf(actor.actorId) > 0 && hpOf(actor.actorId) / maxHp < retreatThreshold && exitId) {
      return { kind: 'retreat', exitId };
    }
  }

  const enemies = combatants.filter(
    candidate => candidate.side !== actor.side && candidate.side !== 'neutral' && hpOf(candidate.actorId) > 0,
  );
  if (enemies.length === 0) return { kind: 'guard' };

  const leaderId = actor.card.companionLeaderActorId
    ?? combatants.find(candidate => candidate.side === 'party' && candidate.card.controller === 'player')?.actorId;
  const leader = leaderId ? combatants.find(candidate => candidate.actorId === leaderId) : undefined;
  const hops = (from: string, to: string): number => {
    const band = distanceBetweenZones(zones, from, to);
    return band === 'near' ? 0 : band === 'mid' ? 1 : band === 'far' ? 2 : 99;
  };
  const byAscendingHops = (a: Combatant, b: Combatant): number =>
    hops(actor.zoneId, a.zoneId) - hops(actor.zoneId, b.zoneId);

  // Protect policy chooses a nearby threat to the named leader before the
  // ordinary weakest-target preference. Without a leader it safely falls
  // back to the normal deterministic target order.
  const orderedEnemies = [...enemies].sort((a, b) => {
    if (directive === 'protect' && leader) {
      const protectDistance = hops(a.zoneId, leader.zoneId) - hops(b.zoneId, leader.zoneId);
      if (protectDistance !== 0) return protectDistance;
    }
    return hpOf(a.actorId) - hpOf(b.actorId) || byAscendingHops(a, b) || a.actorId.localeCompare(b.actorId);
  });

  // Prefer the weakest enemy the actor can legally hit with its best attack
  // skill (attack skills only, range respected).
  const attackSkill = Object.entries(actor.card.skills)
    .filter(([skillId]) => actor.attackSkillIds.includes(skillId) && catalog[skillId])
    .sort((a, b) => SKILL_RANK_DIE[b[1] as SkillRank] - SKILL_RANK_DIE[a[1] as SkillRank])[0];
  if (attackSkill) {
    const range = attackRangeFor(actor, attackSkill[0]);
    const inRange = orderedEnemies
      .filter(enemy => rangeCoversBand(range, distanceBetweenZones(zones, actor.zoneId, enemy.zoneId)))
      .sort((a, b) => orderedEnemies.indexOf(a) - orderedEnemies.indexOf(b));
    if (inRange.length > 0 && inRange[0]) {
      return { kind: 'attack', targetId: inRange[0].actorId, skillId: attackSkill[0] };
    }
    if (directive === 'conserve' || (directive === 'follow' && actorState?.movedThisRound)) return { kind: 'guard' };
    const nearest = directive === 'follow' && leader ? leader : orderedEnemies[0]!;
    return { kind: 'move', towardActorId: nearest.actorId };
  }
  if (directive === 'conserve') return { kind: 'guard' };
  const nearest = directive === 'follow' && leader ? leader : orderedEnemies[0]!;
  return { kind: 'move', towardActorId: nearest.actorId };
}

/** Stable explanation for an automatic action or a command that cannot be followed. */
export function explainNpcDecision(options: {
  actor: Combatant;
  encounter: EncounterState;
  combatants: readonly Combatant[];
  zones: ReadonlyArray<{ zoneId: string; exits: readonly string[] }>;
  decision: NpcActionDecision;
}): string {
  const { actor, encounter, combatants, zones, decision } = options;
  const actorState = encounter.actors[actor.actorId];
  const directive = actor.card.controller === 'companion' ? actor.card.companionDirective : undefined;
  const actorZone = zones.find(zone => zone.zoneId === actor.zoneId);
  const exitId = actorZone?.exits.find(exit => encounter.scene.exitIds.includes(exit));
  const consciousEnemies = combatants.filter(candidate => candidate.side !== actor.side && candidate.side !== 'neutral'
    && (encounter.actors[candidate.actorId]?.hp ?? 0) > 0);
  const leaderId = actor.card.companionLeaderActorId
    ?? combatants.find(candidate => candidate.side === 'party' && candidate.card.controller === 'player')?.actorId;
  const leader = leaderId ? combatants.find(candidate => candidate.actorId === leaderId) : undefined;
  if (actor.side === 'neutral') return '中立阵营不会自动选择敌对目标，本轮保持中立。';
  if (decision.kind === 'retreat') {
    return directive === 'retreat'
      ? `遵循撤退指令，通过当前场景的有效出口 ${decision.exitId} 撤离。`
      : `生命值低于模板士气阈值，并存在有效出口 ${decision.exitId}，因此撤离。`;
  }
  if (directive === 'retreat' && !exitId) return '撤退指令未能执行：当前位置没有通往场景出口的有效路径，因此暂时守卫。';
  if (directive === 'support') {
    const needsAid = combatants.some(candidate => candidate.side === actor.side && candidate.actorId !== actor.actorId
      && (encounter.actors[candidate.actorId]?.hp ?? 0) <= 0
      && encounter.actors[candidate.actorId]?.conditions.includes('disabled')
      && candidate.zoneId === actor.zoneId);
    if (decision.kind === 'rescue') return '遵循支援指令：同一区域有失能队友，执行援救。';
    if (!needsAid) return '支援指令未触发：同一区域没有满足规则的失能队友。';
  }
  if (directive === 'follow' && leader) {
    if (decision.kind === 'move' && decision.towardActorId === leader.actorId) return `遵循跟随指令：沿场景路径靠近队长 ${leader.card.name}。`;
    if (leader.zoneId === actor.zoneId) return '跟随指令已满足：与队长处于同一区域。';
    if (actorState?.movedThisRound) return '跟随指令暂缓：本轮标准移动已用完。';
  }
  if (directive === 'protect' && decision.kind === 'attack' && leader) return `遵循保护指令：优先处理靠近队长 ${leader.card.name} 的合法威胁。`;
  if (decision.kind === 'guard') {
    if (consciousEnemies.length === 0) return '没有清醒的敌对目标，本轮保持戒备。';
    if (directive === 'conserve') return '遵循节省资源指令：当前没有必须立即使用资源的行动，本轮保持戒备。';
    if (actorState?.movedThisRound && directive === 'follow') return '跟随移动已用完且没有可执行的近战攻击，本轮结束行动。';
    return '当前不存在满足武器、距离和状态规则的合法攻击或移动，保持戒备。';
  }
  if (decision.kind === 'rescue') return '援救目标符合失能状态和同区域条件。';
  if (decision.kind === 'move') return '没有处于已声明攻击范围内的合法目标，按确定性策略靠近目标。';
  if (decision.kind === 'attack') return '目标满足敌对关系、存活状态、已声明攻击技能和距离条件。';
  return '按已保存指令与当前可执行动作规则处理。';
}

/** Default attack range for a combatant's attack skill (templates declare their own). */
function attackRangeFor(actor: Combatant, skillId: string): 'touch' | 'near' | 'mid' | 'far' {
  return actor.card.combatAttacks?.find(attack => attack.skillId === skillId)?.range ?? 'touch';
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
    plan.loot = [...new Set(options.lootItemIds)].map(itemId => ({ itemId, actorId: options.lootRecipientActorId! }));
  }
  return plan;
}

// Re-export for callers assembling full plans.
export { applyDamage };
