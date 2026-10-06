import type { RollGrade } from '../../domain/rules/types';
import { compileCampaignEffects } from '../../domain/campaignPlan/campaignEffects';
import { outcomeSetHashFor } from '../campaignPlan/localCompile';
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
import { resolveMethodActor } from '../guidance/candidates';
import type { AllowedCandidateV1 } from '../guidance/types';
import { assertRuleAction, bindRuleContract } from '../content/runtimeRules';
import { SHORT_REST_MINUTES, SHORT_REST_STAMINA_RESTORE } from '../../domain/rules/restPolicy';
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
  /**
   * P7: published situation methods offered to this turn. When the compiled
   * action structurally matches a method's first step (action kind + skill +
   * target/destination), the LOCAL compiler stamps contract.methodRef and
   * injects the method's engine successEffects — free text and suggested
   * paths go through the same matching, never the title.
   */
  methods?: readonly import('../../domain/situations/types').MethodTemplateV1[];
  /** Situation owner per method (parallel to methods). */
  methodSituations?: readonly string[];
  /** Original player input, never rewritten by the Planner. */
  requestedIntent?: string;
  selectedBaseAction?: AllowedCandidateV1;
  /**
   * P9 (A11/A13): stable method selected by candidate reference (player tap
   * or planner-echoed free-input mapping). The LOCAL compiler verifies the id
   * against the offered methods; stale ids are refused, never silently
   * re-resolved to a different path.
   */
  selectedMethodRef?: { situationId: string; methodId: string };
  /** P9: candidate reference frozen into the contract hash (player choice identity). */
  candidateRef?: string;
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
  const skillModule = input.state.ruleConfiguration?.modules.find(m => m.moduleId === 'skill_actions');
  if (input.proposal.actionKind === 'skill_check' && skillModule?.parameters.untrainedPolicy === 'forbid'
    && !resolveSkillKey(input.actingCard, input.proposal.skillId!)) throw new SkillNotTrainedError(input.proposal.skillId!);
  const compiled = compileSelectedProposal(input);
  assertRuleAction(input.state, compiled.contract.actionType, input.actingCard.actorId);
  compiled.contract = bindRuleContract(compiled.contract, input.state);
  if (input.state.ruleConfiguration?.modules.some(m => m.moduleId === 'pressure_track') && compiled.contract.requiresRoll) {
    for (const grade of ['failure', 'severe_failure'] as const) {
      compiled.contract.outcomes[grade] = { ...compiled.contract.outcomes[grade], effects: [
        ...compiled.contract.outcomes[grade].effects, { op: 'raisePressure', trackId: 'tension', amount: grade === 'severe_failure' ? 2 : 1,
          maxLevel: Number(input.state.ruleConfiguration.modules.find(m => m.moduleId === 'pressure_track')!.parameters.maxLevel) },
      ] };
    }
  }
  const pressure = input.state.ruleConfiguration?.modules.find(m => m.moduleId === 'pressure_track');
  if (pressure && ['short_rest','long_rest'].includes(compiled.contract.actionType)) {
    for (const outcome of Object.values(compiled.contract.outcomes)) outcome.effects = [...outcome.effects,
      { op: 'relievePressure', trackId: 'tension', amount: Number(pressure.parameters.reliefAmount) }];
  }
  return compiled;
}

function compileSelectedProposal(input: CompileProposalInput): CompiledAction {
  const methods = input.methods ?? [];
  const requestedIntent = input.requestedIntent ?? input.proposal.intent;
  const normalize = (text: string): string => text.replace(/[\s，。！？、,.!?；;：:]/g, '');
  // P9: a stable selected reference wins over text matching (A11); the id
  // must be one of the offered methods at this state, else the choice is
  // stale and refused instead of re-resolved (A13).
  const ref = input.selectedMethodRef ?? parseMethodRef(input.proposal.candidateRef);
  let selected: import("../../domain/situations/types").MethodTemplateV1 | undefined;
  if (ref) {
    const index = methods.findIndex((method, i) => method.methodId === ref.methodId
      && (input.methodSituations?.[i] ?? "") === ref.situationId);
    if (index === -1) throw new ProposalRejectedError('所选路径已不在当前可用办法中，请刷新后重新选择。');
    selected = methods[index]!;
  } else {
    const matching = methods.filter(method => normalize(method.firstStep.intent) === normalize(requestedIntent));
    if (matching.length > 1) throw new ProposalRejectedError('此行动对应多个办法，请明确选择其中一条路径。');
    selected = matching[0];
  }
  const baseAction = input.selectedBaseAction;
  if (baseAction && (baseAction.availability !== 'available' || baseAction.firstStepIntent !== requestedIntent)) {
    throw new ProposalRejectedError('当前基础行动与所选路径不一致。');
  }
  if (!selected && baseAction?.actionId === 'short_rest') {
    const cap = input.actingCard.resourceMax.stamina ?? 10;
    const outcome = automaticOutcome(true, '你进行了短休。', [{ op: 'restoreResource', actorId: input.actingCard.actorId, resourceId: 'stamina', amount: Math.min(SHORT_REST_STAMINA_RESTORE, cap), cap }]);
    return { storedSkillKey: null, contract: { protocolVersion: '3.0', turnId: input.proposal.turnId,
      expectedStateVersion: input.proposal.expectedStateVersion, actorId: input.actingCard.actorId, actionType: 'short_rest',
      intent: requestedIntent, evidenceIds: [], requiresRoll: false, timeCostMinutes: SHORT_REST_MINUTES,
      resourcePreconditions: [], outcomes: { full_success: outcome, success: outcome, failure: outcome, severe_failure: outcome } } };
  }
  let compileInput = input;
  if (selected) {
    const step = selected.firstStep;
    const targetId = step.targetEntryId ? resolveMethodActor(step.targetEntryId, input.state, input.cards) : null;
    if (step.targetEntryId && (!targetId || input.state.actors[targetId]?.lifeStatus === 'dead'
      || input.state.actors[targetId]?.locationId !== input.state.actors[input.actingCard.actorId]?.locationId)) {
      throw new ProposalRejectedError('行动对象需要在场且存活。');
    }
    // The published first step owns the shape of a selected method. A
    // Planner paraphrase cannot silently turn a checked skill into observe.
    compileInput = { ...input, proposal: {
      proposalVersion: input.proposal.proposalVersion, turnId: input.proposal.turnId,
      expectedStateVersion: input.proposal.expectedStateVersion, actorId: input.actingCard.actorId,
      actionKind: step.actionKind, intent: requestedIntent, evidenceIds: input.proposal.evidenceIds,
      ...(step.skillId ? { skillId: step.skillId } : {}),
      ...(step.abilityId ? { abilityId: step.abilityId } : {}),
      ...(step.destinationId ? { destinationId: step.destinationId } : {}),
      ...(targetId ? { targetId } : {}),
      ...(input.proposal.difficultyBand ? { difficultyBand: input.proposal.difficultyBand } : {}),
    } };
  } else if (baseAction) {
    compileInput = { ...input, proposal: { proposalVersion: '2.0', turnId: input.proposal.turnId,
      expectedStateVersion: input.proposal.expectedStateVersion, actorId: input.actingCard.actorId,
      actionKind: baseAction.actionKind, intent: requestedIntent, evidenceIds: input.proposal.evidenceIds,
      ...(baseAction.destinationId ? { destinationId: baseAction.destinationId } : {}) } };
  }
  const compiled = compileProposalBase(compileInput, selected !== undefined);
  // Preserve the player's submitted choice in the frozen, hashed contract;
  // a Planner paraphrase must not replace it in history or recovery.
  compiled.contract.intent = requestedIntent;
  if (methods.length === 0) return compiled;
  const selectedRef = input.selectedMethodRef ?? parseMethodRef(input.proposal.candidateRef);
  const selectedIndex = selected && methods.includes(selected) ? methods.indexOf(selected) : -1;
  const selectedCandidateRef = selectedRef
    ? `method:${selectedRef.situationId}:${selectedRef.methodId}`
    : (input.candidateRef?.startsWith('method:') ? input.candidateRef : undefined);
  return bindSituationMethod(compiled, methods, input.methodSituations ?? [], input.cards, requestedIntent,
    selectedIndex >= 0 ? selectedIndex : undefined, selectedCandidateRef);
}

function normalizeSkillId(skillId: string): string {
  return skillId.replace(/^skill-/, '');
}

/** P9: parses a method:{situationId}:{methodId} candidate reference. */
function parseMethodRef(ref: string | undefined): { situationId: string; methodId: string } | null {
  if (!ref || !ref.startsWith('method:')) return null;
  const rest = ref.slice('method:'.length);
  const separator = rest.lastIndexOf(':');
  if (separator <= 0 || separator >= rest.length - 1) return null;
  return { situationId: rest.slice(0, separator), methodId: rest.slice(separator + 1) };
}

function bindSituationMethod(
  compiled: CompiledAction,
  methods: readonly import('../../domain/situations/types').MethodTemplateV1[],
  methodSituations: readonly string[],
  cards: readonly ActorCard[],
  requestedIntent: string,
  selectedIndex?: number,
  candidateRef?: string,
): CompiledAction {
  const { contract } = compiled;
  const normalizeIntent = (text: string): string => text.replace(/[\s，。！？、,.!?；;：:]/g, '');
  for (const [index, method] of methods.entries()) {
    const step = method.firstStep;
    // P9: a stable selected id binds even when the player paraphrased the
    // step text; only structural checks still apply (A11).
    const byId = selectedIndex !== undefined && index === selectedIndex;
    if (!byId && normalizeIntent(requestedIntent) !== normalizeIntent(step.intent)) continue;
    if (step.actionKind !== contract.actionType) continue;
    if (step.skillId !== undefined) {
      if (contract.skillId === undefined) continue;
      if (normalizeSkillId(step.skillId) !== normalizeSkillId(contract.skillId)) continue;
    } else if (contract.skillId !== undefined) {
      continue; // a non-skill method cannot match a skill_check contract
    }
    if (step.targetEntryId !== undefined && contract.targetId !== undefined) {
      const targetCard = cards.find(card => card.actorId === contract.targetId);
      if (!(contract.targetId === step.targetEntryId || targetCard?.templateId === step.targetEntryId
        || contract.targetId === `actor-${step.targetEntryId.replace(/^npc-/, '')}`)) continue;
    }
    // A method whose first step names a target binds even when the compiled
    // contract carries no targetId (non-social skill checks have none) — the
    // action kind + skill still identify the attempt structurally.
    if (step.destinationId !== undefined) {
      const moves = (contract.outcomes.success.effects ?? [])
        .filter((effect): effect is Extract<EffectOperation, { op: 'changeLocation' }> => effect.op === 'changeLocation');
      if (!moves.some(effect => effect.locationId === step.destinationId)) continue;
    }
    const situationId = methodSituations[index] ?? '';
    if (!situationId) continue;
    const successEffects = (method.successEffects ?? []) as EffectOperation[];
    const templates = method.outcomeTemplates;
    let outcomes = contract.outcomes;
    let campaignEffects: ActionContract['campaignEffects'] = undefined;
    let outcomeSetHash: string | undefined;
    if (templates) {
      // P9 §8.2: four-grade templates override summaries/effects BEFORE the
      // roll; every grade comes from locally validated specs only.
      const actingActorId = contract.actorId;
      const actorResolver = (actorId: string): string => {
        // Model-drift alias: campaign templates may name the protagonist
        // generically; resolve to the acting card before template lookup.
        const actingCard = cards.find(item => item.actorId === actingActorId);
        if (actorId === 'player' || actorId === '玩家' || actorId === 'pc' || actorId === 'self'
          || (actingCard && actorId === actingCard.name)) return actingActorId;
        const card = cards.find(item => item.templateId === actorId);
        return card?.actorId ?? actorId;
      };
      const perGrade: Record<RollGrade, NonNullable<NonNullable<ActionContract['campaignEffects']>[RollGrade]>> = {} as never;
      outcomes = { ...contract.outcomes };
      for (const grade of ['full_success', 'success', 'failure', 'severe_failure'] as const) {
        const template = templates[grade];
        if (!template) continue;
        const compiledSpecs = compileCampaignEffects(template.effects, { actorResolver });
        outcomes[grade] = {
          ...outcomes[grade],
          achieved: template.achieved,
          publicSummary: template.resultFact,
          effects: [...outcomes[grade].effects, ...compiledSpecs.effects.map(effect => ({ ...effect }))],
        };
        perGrade[grade] = {
          transitions: compiledSpecs.transitions,
          knowledgeGrants: compiledSpecs.knowledgeGrants,
          relationshipShifts: compiledSpecs.relationshipShifts,
          scheduledConsequences: compiledSpecs.scheduledConsequences,
        };
      }
      campaignEffects = perGrade;
      outcomeSetHash = outcomeSetHashFor(method);
    } else if (successEffects.length > 0) {
      outcomes = {
        ...contract.outcomes,
        full_success: appendEffects(contract.outcomes.full_success, successEffects),
        success: appendEffects(contract.outcomes.success, successEffects),
      };
    }
    const withMethod: ActionContract = {
      ...contract,
      outcomes,
      methodRef: { situationId, methodId: method.methodId, ...(outcomeSetHash ? { outcomeSetHash } : {}) },
      ...(candidateRef ? { candidateRef } : {}),
      ...(campaignEffects ? { campaignEffects } : {}),
    };
    return { ...compiled, contract: withMethod };
  }
  return compiled;
}

function appendEffects(
  outcome: ActionContract['outcomes']['success'],
  extra: readonly EffectOperation[],
): ActionContract['outcomes']['success'] {
  return { ...outcome, effects: [...outcome.effects, ...extra.map(effect => ({ ...effect }))] };
}

function compileProposalBase(input: CompileProposalInput, publishedMethod = false): CompiledAction {
  const { proposal, actingCard, cards, catalog, abilities, scenes, state } = input;
  const actorId = actingCard.actorId;
  const currentLocation = state.actors[actorId]?.locationId;

  const base = {
    protocolVersion: '3.0' as const,
    turnId: proposal.turnId,
    expectedStateVersion: proposal.expectedStateVersion,
    actorId,
    evidenceIds: [...proposal.evidenceIds],
    intent: proposal.intent,
  };

  switch (proposal.actionKind) {
    case 'observe':
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
    case 'talk': {
      const targetId = resolveSocialTarget(proposal, actingCard, cards, state);
      return {
        contract: {
          ...base,
          actionType: 'talk',
          ...(targetId ? { targetId } : {}),
          requiresRoll: false,
          timeCostMinutes: GENERIC_ACTION_MINUTES.talk,
          resourcePreconditions: [],
          outcomes: {
            full_success: automaticOutcome(true, summaryFor(proposal, 'full_success', '交谈完成。'), []),
            success: automaticOutcome(true, summaryFor(proposal, 'success', '交谈完成。'), []),
            failure: automaticOutcome(false, summaryFor(proposal, 'failure', '交谈没有产生效果。'), []),
            severe_failure: automaticOutcome(false, summaryFor(proposal, 'severe_failure', '交谈没有产生效果。'), []),
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
      let socialTargetId: string | undefined;
      if (proposal.targetId) {
        const skillDefinition = catalog[skillId] ?? catalog[`skill-${skillId.replace(/^skill-/, '')}`];
        if (skillDefinition?.usage !== 'social' && !publishedMethod) {
          throw new ProposalRejectedError('只有世界目录标记为 social 的技能检定才能影响关系；请使用交谈行动。');
        }
        socialTargetId = skillDefinition?.usage === 'social'
          ? resolveSocialTarget(proposal, actingCard, cards, state) : proposal.targetId;
      }

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
          ...(socialTargetId ? { targetId: socialTargetId } : {}),
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

function resolveSocialTarget(
  proposal: PlannerProposal,
  actingCard: ActorCard,
  cards: readonly ActorCard[],
  state: GameStateSnapshot,
): string | undefined {
  const targetId = proposal.targetId;
  if (!targetId) return undefined;
  if (targetId === actingCard.actorId) throw new ProposalRejectedError('不能把自己作为交谈对象。');
  const targetCard = cardFor(cards, targetId);
  const source = state.actors[actingCard.actorId];
  const target = state.actors[targetId];
  if (!targetCard || !target || !source) throw new ProposalRejectedError(`交谈对象「${targetId}」不在当前战役。`);
  if (targetCard.controller === 'player') throw new ProposalRejectedError('交谈目标必须是可交互的 NPC 或同伴。');
  if (targetCard.kind !== 'npc' && targetCard.kind !== 'companion') {
    throw new ProposalRejectedError('该角色类型不支持社交交互。');
  }
  if (source.locationId !== target.locationId) {
    throw new ProposalRejectedError('交谈需要双方位于同一地点；当前没有可验证的跨地点通信路径。');
  }
  if (target.lifeStatus === 'critical' || target.lifeStatus === 'dead' || target.conditions.includes('disabled')) {
    throw new ProposalRejectedError('交谈对象目前失能，无法回应。');
  }
  return targetId;
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
      protocolVersion: '3.0',
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
