import type { RollGrade } from '../../domain/rules/types';
import type { ActionContract, EffectOperation } from '../../domain/turns/types';
import type { PlannerProposal } from '../../domain/turns/proposal';
import type { GameStateSnapshot } from '../../domain/state/types';
import type {
  AbilityDefinition,
  ConstraintDefinition,
  ContentEntry,
  SceneDefinition,
  SkillDefinition,
} from '../../domain/content/types';
import type { ActorCard, SkillCatalog } from '../../domain/characters/card';
import { distanceBetweenZones, rangeCoversBand } from '../campaign/encounterFlow';
import {
  assertAbilityAffordable,
  resolveSkillKey,
  rollSpecForSkill,
  SkillNotDefinedError,
  SkillNotTrainedError,
} from '../../domain/characters/card';

/**
 * V2 local contract compiler (plan §13.2). The planner proposes; this module
 * decides. Every authoritative number — time cost, resource cost, damage,
 * healing caps, difficulty — comes from trusted definitions or the constants
 * below, never from model output. Compiled contracts carry origin 'engine'.
 */

/** V0.2 default time costs (minutes) for generic automatic actions. */
export const GENERIC_ACTION_MINUTES = {
  observe: 5,
  talk: 10,
  interact: 15,
  move: 10,
  skill_check: 10,
  ability: 1,
} as const;

export class ProposalRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalRejectedError';
  }
}

/** Ability effect ops the V0.2 compiler can execute; others are refused. */
const COMPILABLE_ABILITY_OPS = new Set([
  'damage',
  'heal',
  'restore_resource',
  'consume_resource',
  'apply_condition',
  'remove_condition',
]);

export interface CompileProposalInput {
  proposal: PlannerProposal;
  actingCard: ActorCard;
  cards: readonly ActorCard[];
  catalog: SkillCatalog;
  abilities: ReadonlyMap<string, AbilityDefinition>;
  scenes: readonly SceneDefinition[];
  constraints?: readonly ConstraintDefinition[];
  state: GameStateSnapshot;
}

export interface CompiledAction {
  contract: ActionContract;
  /** Card-stored skill key when the action rolls a world skill. */
  storedSkillKey: string | null;
}

function cardFor(cards: readonly ActorCard[], actorId: string): ActorCard | null {
  return cards.find(card => card.actorId === actorId) ?? null;
}

function isPartyMember(cards: readonly ActorCard[], actorId: string): boolean {
  const card = cardFor(cards, actorId);
  return card !== null && (card.controller === 'player' || card.controller === 'companion');
}

function summaryFor(
  proposal: PlannerProposal,
  grade: RollGrade,
  fallback: string,
): string {
  const hint = proposal.narrativeHint;
  if (!hint) return fallback;
  const achieved = grade === 'full_success' || grade === 'success';
  const text = (achieved ? hint.successSummary : hint.failureSummary).trim();
  return text.length > 0 ? text.slice(0, 500) : fallback;
}

function automaticOutcome(
  achieved: boolean,
  publicSummary: string,
  effects: EffectOperation[],
): ActionContract['outcomes']['success'] {
  return { achieved, publicSummary, effects };
}

/**
 * Compiles a validated proposal into a frozen engine contract. Throws
 * ProposalRejectedError (or SkillNotDefined/SkillNotTrained) when the proposal
 * names things the world or the card does not support.
 */
export function compileProposal(input: CompileProposalInput): CompiledAction {
  const { proposal, actingCard, cards, catalog, abilities, scenes, state } = input;
  const actorId = actingCard.actorId;
  const currentLocation = state.actors[actorId]?.locationId;

  const base = {
    protocolVersion: '1.0' as const,
    turnId: proposal.turnId,
    expectedStateVersion: proposal.expectedStateVersion,
    actorId,
    evidenceIds: [...proposal.evidenceIds],
    intent: proposal.intent,
  };

  switch (proposal.actionKind) {
    case 'observe':
    case 'talk':
    case 'interact': {
      const minutes = GENERIC_ACTION_MINUTES[proposal.actionKind];
      const label = { observe: '观察周围', talk: '交谈', interact: '与环境互动' }[proposal.actionKind];
      return {
        contract: {
          ...base,
          actionType: proposal.actionKind,
          requiresRoll: false,
          timeCostMinutes: minutes,
          resourcePreconditions: [],
          outcomes: {
            full_success: automaticOutcome(true, summaryFor(proposal, 'full_success', `${label}完成。`), []),
            success: automaticOutcome(true, summaryFor(proposal, 'success', `${label}完成。`), []),
            failure: automaticOutcome(false, summaryFor(proposal, 'failure', `${label}没有产生效果。`), []),
            severe_failure: automaticOutcome(false, summaryFor(proposal, 'severe_failure', `${label}没有产生效果。`), []),
          },
        },
        storedSkillKey: null,
      };
    }
    case 'move': {
      const destination = proposal.destinationId!;
      const knownLocations = new Set<string>(scenes.map(scene => scene.locationId));
      if (currentLocation) knownLocations.add(currentLocation);
      if (!knownLocations.has(destination)) {
        throw new ProposalRejectedError(
          `未知地点「${destination}」：只能移动到当前所在或世界场景中存在的地点。`,
        );
      }
      const effects: EffectOperation[] =
        destination === currentLocation
          ? []
          : [{ op: 'changeLocation', actorId, locationId: destination }];
      return {
        contract: {
          ...base,
          actionType: 'move',
          requiresRoll: false,
          timeCostMinutes: GENERIC_ACTION_MINUTES.move,
          resourcePreconditions: [],
          outcomes: {
            full_success: automaticOutcome(true, `前往 ${destination}。`, effects),
            success: automaticOutcome(true, `前往 ${destination}。`, effects),
            failure: automaticOutcome(true, `停留在原地。`, []),
            severe_failure: automaticOutcome(true, `停留在原地。`, []),
          },
        },
        storedSkillKey: null,
      };
    }
    case 'skill_check': {
      const skillId = proposal.skillId!;
      // Throws SkillNotDefinedError / SkillNotTrainedError for the session's
      // clean-refusal path.
      const spec = rollSpecForSkill(
        actingCard,
        catalog,
        skillId,
        proposal.difficultyBand ?? 'normal',
      );
      void spec;
      const storedSkillKey = resolveSkillKey(actingCard, skillId) ?? skillId;

      // A skill check may move the actor on success; the destination is
      // validated exactly like a move action.
      const destination = proposal.destinationId;
      let moveEffects: EffectOperation[] = [];
      if (destination !== undefined) {
        const knownLocations = new Set<string>(scenes.map(scene => scene.locationId));
        if (currentLocation) knownLocations.add(currentLocation);
        if (!knownLocations.has(destination)) {
          throw new ProposalRejectedError(
            `未知地点「${destination}」：检定只能进入世界场景中存在的地点。`,
          );
        }
        if (destination !== currentLocation) {
          moveEffects = [{ op: 'changeLocation', actorId, locationId: destination }];
        }
      }

      return {
        contract: {
          ...base,
          actionType: 'skill_check',
          skillId: storedSkillKey,
          difficultyBand: proposal.difficultyBand ?? 'normal',
          requiresRoll: true,
          timeCostMinutes: GENERIC_ACTION_MINUTES.skill_check,
          resourcePreconditions: [],
          outcomes: {
            full_success: automaticOutcome(true, summaryFor(proposal, 'full_success', '出色地完成了行动。'), moveEffects),
            success: automaticOutcome(true, summaryFor(proposal, 'success', '完成了行动。'), moveEffects),
            failure: automaticOutcome(false, summaryFor(proposal, 'failure', '行动未能奏效。'), []),
            severe_failure: automaticOutcome(false, summaryFor(proposal, 'severe_failure', '行动失败并带来了麻烦。'), []),
          },
        },
        storedSkillKey,
      };
    }
    case 'ability': {
      return compileAbilityAction(input);
    }
    default:
      throw new ProposalRejectedError(`Unsupported action kind: ${String(proposal.actionKind)}.`);
  }
}

function compileAbilityAction(input: CompileProposalInput): CompiledAction {
  const { proposal, actingCard, cards, catalog, abilities, scenes, state, constraints = [] } = input;
  const abilityId = proposal.abilityId!;
  const definition = abilities.get(abilityId);
  if (!definition) {
    throw new ProposalRejectedError(`能力「${abilityId}」在这个世界不存在或不可用。`);
  }
  if (definition.passive) {
    throw new ProposalRejectedError(`能力「${definition.name}」是被动能力，不能作为主动动作发动。`);
  }
  if (!actingCard.abilities.includes(abilityId)) {
    throw new ProposalRejectedError(
      `角色尚未习得能力「${abilityId}」，无法使用。`,
    );
  }
  if (!actingCard.preparedAbilities.includes(abilityId)) {
    throw new ProposalRejectedError(`能力「${definition.name}」尚未准备，无法使用。`);
  }
  if (
    definition.requiresSkillId &&
    resolveSkillKey(actingCard, definition.requiresSkillId) === null
  ) {
    throw new ProposalRejectedError(
      `能力「${definition.name}」需要先掌握技能 ${definition.requiresSkillId}。`,
    );
  }

  const actorState = state.actors[actingCard.actorId];
  if (!actorState) throw new ProposalRejectedError('Acting actor missing from state.');
  const cooldownReadyAt = actorState.abilityCooldowns?.[abilityId] ?? 0;
  if (cooldownReadyAt > state.stateVersion) {
    throw new ProposalRejectedError(`能力「${definition.name}」冷却中，需等到状态版本 ${cooldownReadyAt}。`);
  }
  assertAbilityAffordable(actingCard, definition, actorState.resources);

  // Target policy is enforced locally (self / ally / enemy).
  const targetId = resolveAbilityTarget(proposal, definition, cards, state);
  if (targetId) assertAbilityRange(actingCard.actorId, targetId, definition, state, scenes);
  enforceAbilityWorldConstraints(definition, proposal.intent, constraints);

  for (const effect of definition.effects) {
    if (!COMPILABLE_ABILITY_OPS.has(effect.op)) {
      throw new ProposalRejectedError(
        `能力「${definition.name}」包含当前规则引擎暂不支持的效果（${effect.op}），已被阻止执行。`,
      );
    }
  }

  const costs: EffectOperation[] = Object.entries(definition.costs).map(([resourceId, amount]) => ({
    op: 'consumeResource' as const,
    actorId: actingCard.actorId,
    resourceId,
    amount,
  }));
  const preconditions = Object.entries(definition.costs).map(([resourceId, amount]) => ({
    actorId: actingCard.actorId,
    resourceId,
    minimum: amount,
  }));

  const successEffects = compileAbilityEffects(definition, actingCard, targetId, cards, state, true);
  const failureEffects = compileAbilityEffects(definition, actingCard, targetId, cards, state, false);

  const build = (grade: RollGrade): ActionContract['outcomes']['success'] => {
    const achieved = grade === 'full_success' || grade === 'success';
    return {
      achieved,
      publicSummary: summaryFor(
        proposal,
        grade,
        achieved ? `发动了能力「${definition.name}」。` : `能力「${definition.name}」没有生效。`,
      ),
      effects: [...costs, ...(achieved ? successEffects : failureEffects)],
    };
  };

  return {
    contract: {
      protocolVersion: '1.0',
      turnId: proposal.turnId,
      expectedStateVersion: proposal.expectedStateVersion,
      actorId: actingCard.actorId,
      actionType: 'ability',
      abilityId,
      ...(targetId !== null ? { targetId } : {}),
      ...(definition.requiresSkillId !== undefined ? { skillId: definition.requiresSkillId } : {}),
      requiresRoll: definition.requiresRoll,
      ...(definition.requiresRoll ? { difficultyBand: 'normal' as const } : {}),
      evidenceIds: [...proposal.evidenceIds],
      intent: proposal.intent,
      timeCostMinutes: GENERIC_ACTION_MINUTES.ability,
      resourcePreconditions: preconditions,
      outcomes: {
        full_success: build('full_success'),
        success: build('success'),
        failure: build('failure'),
        severe_failure: build('severe_failure'),
      },
    },
    storedSkillKey: definition.requiresSkillId ?? null,
  };
}

function resolveAbilityTarget(
  proposal: PlannerProposal,
  definition: AbilityDefinition,
  cards: readonly ActorCard[],
  state: GameStateSnapshot,
): string | null {
  if (definition.targetPolicy === 'self') {
    if (proposal.targetId !== undefined && proposal.targetId !== proposal.actorId) {
      throw new ProposalRejectedError(`能力「${definition.name}」只能以施动者本人为目标。`);
    }
    return proposal.actorId;
  }
  if (definition.targetPolicy === 'area') return null;
  const targetId = proposal.targetId;
  if (!targetId) {
    throw new ProposalRejectedError(`能力「${definition.name}」需要指定目标。`);
  }
  if (!state.actors[targetId] || !cardFor(cards, targetId)) {
    throw new ProposalRejectedError(`目标角色「${targetId}」不存在。`);
  }
  if (definition.targetPolicy === 'single_ally' && !isPartyMember(cards, targetId)) {
    throw new ProposalRejectedError(`能力「${definition.name}」只能作用于队伍成员。`);
  }
  if (definition.targetPolicy === 'single_enemy' && isPartyMember(cards, targetId)) {
    throw new ProposalRejectedError(`能力「${definition.name}」不能作用于队伍成员。`);
  }
  return targetId;
}

function assertAbilityRange(
  actorId: string,
  targetId: string,
  definition: AbilityDefinition,
  state: GameStateSnapshot,
  scenes: readonly SceneDefinition[],
): void {
  if (definition.range === 'self') {
    if (targetId !== actorId) throw new ProposalRejectedError(`能力「${definition.name}」只允许以施动者本人为目标。`);
    return;
  }
  if (targetId === actorId) return;
  const actor = state.actors[actorId];
  const target = state.actors[targetId];
  if (!actor || !target) throw new ProposalRejectedError('Ability target state is missing.');
  if (target.locationId !== actor.locationId) {
    throw new ProposalRejectedError(`目标「${targetId}」不在施术者所在场景；当前没有可验证的跨场景路径。`);
  }
  const scene = scenes.find(candidate => candidate.locationId === actor.locationId);
  const band = scene && actor.zoneId && target.zoneId
    ? distanceBetweenZones(scene.zones, actor.zoneId, target.zoneId)
    : 'near';
  const range = definition.range === 'touch' ? 'touch' : definition.range;
  if (!rangeCoversBand(range, band)) {
    throw new ProposalRejectedError(`目标「${targetId}」位于 ${band} 距离，能力「${definition.name}」的 ${definition.range} 射程无法触及。`);
  }
}

function enforceAbilityWorldConstraints(
  definition: AbilityDefinition,
  intent: string,
  constraints: readonly ConstraintDefinition[],
): void {
  const actionText = `${intent} ${definition.name} ${definition.description}`.toLocaleLowerCase();
  for (const constraint of constraints) {
    if (!constraint.pattern || constraint.enforcement === 'audit') continue;
    const pattern = constraint.pattern.trim().toLocaleLowerCase();
    if (!pattern) continue;
    const matchesAction = actionText.includes(pattern);
    const effectText = JSON.stringify(definition.effects).toLocaleLowerCase();
    const matchesEffect = effectText.includes(pattern);
    if ((constraint.enforcement === 'block_action' && matchesAction) ||
        (constraint.enforcement === 'block_effect' && (matchesAction || matchesEffect))) {
      throw new ProposalRejectedError(
        `能力「${definition.name}」违反世界硬约束「${constraint.name}」，已阻止执行。`,
      );
    }
  }
}

function compileAbilityEffects(
  definition: AbilityDefinition,
  actingCard: ActorCard,
  targetId: string | null,
  cards: readonly ActorCard[],
  state: GameStateSnapshot,
  achieved: boolean,
): EffectOperation[] {
  if (!achieved) return [];
  const effects: EffectOperation[] = [];
  for (const effect of definition.effects) {
    switch (effect.op) {
      case 'damage': {
        if (!targetId) throw new ProposalRejectedError('伤害能力需要目标。');
        const targetState = state.actors[targetId];
        if (!targetState) throw new ProposalRejectedError(`目标 ${targetId} 不在场景中。`);
        const currentHp = targetState.resources.hp ?? 0;
        if (currentHp <= 0) throw new ProposalRejectedError(`目标 ${targetId} 已失能。`);
        const applied = Math.min(effect.amount ?? 1, currentHp);
        effects.push({ op: 'consumeResource', actorId: targetId, resourceId: 'hp', amount: applied });
        if (currentHp - applied <= 0) {
          effects.push({ op: 'applyCondition', actorId: targetId, conditionId: 'disabled' });
        }
        break;
      }
      case 'heal':
      case 'restore_resource': {
        if (!targetId) throw new ProposalRejectedError('治疗能力需要目标。');
        const targetCard = cardFor(cards, targetId);
        if (!targetCard) throw new ProposalRejectedError(`目标 ${targetId} 没有角色卡。`);
        const resourceId = effect.resource ?? 'hp';
        // Engine-injected cap: healing NEVER exceeds the card's authoritative
        // maximum (P2 acceptance A01).
        const cap = targetCard.resourceMax[resourceId];
        if (cap === undefined) {
          throw new ProposalRejectedError(`目标没有资源「${resourceId}」的上限定义，无法恢复。`);
        }
        effects.push({
          op: 'restoreResource',
          actorId: targetId,
          resourceId,
          amount: effect.amount ?? 1,
          cap,
        });
        break;
      }
      case 'consume_resource': {
        effects.push({
          op: 'consumeResource',
          actorId: targetId ?? actingCard.actorId,
          resourceId: effect.resource ?? 'stamina',
          amount: effect.amount ?? 1,
        });
        break;
      }
      case 'apply_condition': {
        if (!targetId) throw new ProposalRejectedError('状态能力需要目标。');
        if (!effect.conditionId) throw new ProposalRejectedError('apply_condition 需要 conditionId。');
        effects.push({ op: 'applyCondition', actorId: targetId, conditionId: effect.conditionId });
        break;
      }
      case 'remove_condition': {
        if (!targetId) throw new ProposalRejectedError('状态能力需要目标。');
        if (!effect.conditionId) throw new ProposalRejectedError('remove_condition 需要 conditionId。');
        effects.push({ op: 'removeCondition', actorId: targetId, conditionId: effect.conditionId });
        break;
      }
      default:
        throw new ProposalRejectedError(
          `能力「${definition.name}」的效果 ${String(effect.op)} 暂不支持。`,
        );
    }
  }
  return effects;
}

/** Builds the ability/scene indexes a session needs for compilation. */
export function packageIndexes(entries: readonly ContentEntry[]): {
  catalog: SkillCatalog;
  abilities: Map<string, AbilityDefinition>;
  scenes: SceneDefinition[];
  constraints: ConstraintDefinition[];
} {
  const catalog: SkillCatalog = {};
  const abilities = new Map<string, AbilityDefinition>();
  const scenes: SceneDefinition[] = [];
  const constraints: ConstraintDefinition[] = [];
  for (const entry of entries) {
    if (entry.kind === 'skill') {
      catalog[entry.entryId] = entry.definition as SkillDefinition;
      const bare = entry.entryId.replace(/^skill-/, '');
      if (bare !== entry.entryId && catalog[bare] === undefined) {
        catalog[bare] = entry.definition as SkillDefinition;
      }
    } else if (entry.kind === 'ability') {
      abilities.set(entry.entryId, entry.definition as AbilityDefinition);
      const bare = entry.entryId.replace(/^ability-/, '');
      if (bare !== entry.entryId && !abilities.has(bare)) {
        abilities.set(bare, entry.definition as AbilityDefinition);
      }
    } else if (entry.kind === 'scene') {
      scenes.push(entry.definition as SceneDefinition);
    } else if (entry.kind === 'constraint') {
      constraints.push(entry.definition as ConstraintDefinition);
    }
  }
  return { catalog, abilities, scenes, constraints };
}
