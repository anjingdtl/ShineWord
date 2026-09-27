import { SHINEWORD_RULESET_ID, SHINEWORD_RULESET_VERSION, difficultyForBand } from '../rules/ruleset';
import type { AttributeName, DifficultyBand, RollGrade, SkillRank } from '../rules/types';
import type { SkillDefinition, ActorTemplateDefinition, AbilityDefinition } from '../content/types';
import type { RollSpec } from '../rules/types';
import { FREE_ATTRIBUTE_POINTS, BASE_ATTRIBUTE_POINTS } from '../../application/world/opening';

export const INITIAL_SKILL_BUDGET = 3;
export const PREPARED_ABILITY_SLOTS = 4;

export const SKILL_RANK_DIE: Readonly<Record<SkillRank, number>> = {
  untrained: 4,
  novice: 6,
  trained: 8,
  expert: 10,
  master: 12,
};

/**
 * Unified actor card (plan §8.1): players, companions, NPCs and creatures
 * share one model; UI projections (`public` / `party` / `gm`) are derived,
 * never separately maintained. Numeric authority for skills lives in
 * actor_skills (snapshotted); the card carries identity and rule parameters.
 */
export interface ActorCard {
  actorId: string;
  name: string;
  kind: 'canon' | 'original' | 'companion' | 'npc' | 'creature';
  controller: 'player' | 'companion' | 'gm';
  /** Canon character entity in the world (canon kind). */
  entityId?: string;
  /** Actor template entry this instance came from (npc/creature). */
  templateId?: string;
  originId?: string;
  pathId?: string;
  attributes: Record<AttributeName, number>;
  skills: Record<string, SkillRank>;
  abilities: string[];
  preparedAbilities: string[];
  resourceMax: Record<string, number>;
  defense: number;
  powerTier: 'ordinary' | 'enhanced' | 'supernatural';
  rulesetId: string;
  rulesetVersion: string;
  worldId: string;
  worldPackageRevision: number;
  cardRevision: number;
  description?: string;
}

export type SkillCatalog = Record<string, SkillDefinition>;

export interface OriginalCardInput {
  actorId: string;
  name: string;
  worldId: string;
  worldPackageRevision: number;
  /** Full attribute values (base 1 each + at most 4 free points, cap 3). */
  attributes: Record<AttributeName, number>;
  /** Up to 3 initial skills (novice) — origins count inside this budget. */
  initialSkills: string[];
  /** Up to 4 prepared active abilities. */
  preparedAbilities?: string[];
  learnedAbilities?: string[];
  originId?: string;
  pathId?: string;
  resourceMax?: Record<string, number>;
  defense?: number;
  powerTier?: ActorCard['powerTier'];
  description?: string;
}

const ATTRIBUTE_NAMES: readonly AttributeName[] = [
  'physique', 'agility', 'insight', 'knowledge', 'willpower', 'social',
];

/**
 * Original character card factory (plan §8.2/8.3): six attributes at base 1
 * plus at most 4 free points with a single cap of 3; unused points must be
 * distributed explicitly (they are never silently dropped); 3 initial
 * skills; 4 prepared ability slots.
 */
export function createOriginalCard(input: OriginalCardInput, catalog: SkillCatalog): ActorCard {
  let spent = 0;
  for (const name of ATTRIBUTE_NAMES) {
    const value = input.attributes[name];
    if (!Number.isInteger(value) || value < 1 || value > 3) {
      throw new Error(`Attribute ${name} must be an integer between 1 and 3.`);
    }
    spent += value - BASE_ATTRIBUTE_POINTS;
  }
  if (spent > FREE_ATTRIBUTE_POINTS) {
    throw new Error(
      `Free attribute points exceeded: ${spent} spent, maximum ${FREE_ATTRIBUTE_POINTS}. ` +
        'Distribute all points explicitly or lower an attribute.',
    );
  }

  if (input.initialSkills.length > INITIAL_SKILL_BUDGET) {
    throw new Error(
      `Initial skill budget is ${INITIAL_SKILL_BUDGET}; received ${input.initialSkills.length}.`,
    );
  }
  for (const skillId of input.initialSkills) {
    if (!catalog[skillId]) {
      throw new Error(`Unknown skill ${skillId}: the world must define every learnable skill.`);
    }
  }
  const prepared = input.preparedAbilities ?? [];
  if (prepared.length > PREPARED_ABILITY_SLOTS) {
    throw new Error(
      `Prepared ability slots are limited to ${PREPARED_ABILITY_SLOTS}; received ${prepared.length}.`,
    );
  }
  for (const abilityId of prepared) {
    if (!input.learnedAbilities?.includes(abilityId) && !input.originId) {
      // Abilities must be learned before preparation; origins may grant their
      // own list, which the caller resolves into learnedAbilities.
      throw new Error(`Ability ${abilityId} must be learned before it can be prepared.`);
    }
  }

  const skills: Record<string, SkillRank> = {};
  for (const skillId of input.initialSkills) skills[skillId] = 'novice';

  return {
    actorId: input.actorId,
    name: input.name,
    kind: 'original',
    controller: 'player',
    originId: input.originId,
    pathId: input.pathId,
    attributes: { ...input.attributes },
    skills,
    abilities: [...(input.learnedAbilities ?? [])],
    preparedAbilities: [...prepared],
    resourceMax: { hp: 10, stamina: 10, ...input.resourceMax },
    defense: input.defense ?? 2,
    powerTier: input.powerTier ?? 'ordinary',
    rulesetId: SHINEWORD_RULESET_ID,
    rulesetVersion: SHINEWORD_RULESET_VERSION,
    worldId: input.worldId,
    worldPackageRevision: input.worldPackageRevision,
    cardRevision: 1,
    description: input.description,
  };
}

export interface TemplateCardInput {
  actorId: string;
  worldId: string;
  worldPackageRevision: number;
  templateId: string;
  definition: ActorTemplateDefinition;
  controller: ActorCard['controller'];
  kind?: ActorCard['kind'];
}

/** Instantiates an actor template (NPC, companion, creature) with independent resources. */
export function createTemplateCard(input: TemplateCardInput): ActorCard {
  const attributes = {} as Record<AttributeName, number>;
  for (const name of ATTRIBUTE_NAMES) {
    attributes[name] = input.definition.attributes[name] ?? 1;
  }
  return {
    actorId: input.actorId,
    name: input.definition.name,
    kind: input.kind ?? (input.controller === 'gm' ? 'creature' : 'companion'),
    controller: input.controller,
    templateId: input.templateId,
    attributes,
    skills: { ...input.definition.skills },
    abilities: [...input.definition.abilities],
    preparedAbilities: [...input.definition.abilities],
    resourceMax: { hp: input.definition.hp, stamina: input.definition.stamina },
    defense: input.definition.defense,
    powerTier: input.definition.category === 'human' ? 'ordinary' : 'enhanced',
    rulesetId: SHINEWORD_RULESET_ID,
    rulesetVersion: SHINEWORD_RULESET_VERSION,
    worldId: input.worldId,
    worldPackageRevision: input.worldPackageRevision,
    cardRevision: 1,
    description: input.definition.description,
  };
}

/**
 * Card-driven roll spec (plan §13): attributes and ranks come from the
 * character card, difficulty from the frozen band — the fixed demo values
 * are gone. Untrained use is refused when the skill disallows it.
 */
/** Raised when the planner names a skill the world does not define. */
export class SkillNotDefinedError extends Error {
  constructor(public readonly skillId: string) {
    super(`Skill ${skillId} is not defined in this world package.`);
    this.name = 'SkillNotDefinedError';
  }
}

/** Raised when the skill exists but the card may not attempt it untrained. */
export class SkillNotTrainedError extends Error {
  constructor(public readonly skillId: string) {
    super(
      `Skill ${skillId} cannot be attempted untrained (requires: training).`,
    );
    this.name = 'SkillNotTrainedError';
  }
}

/**
 * Resolves a skill id across naming forms: planners say "stealth", package
 * entries and cards carry "skill-stealth". Returns the card's stored key.
 */
export function resolveSkillKey(card: Pick<ActorCard, 'skills'>, skillId: string): string | null {
  if (card.skills[skillId] !== undefined) return skillId;
  const prefixed = `skill-${skillId}`;
  if (card.skills[prefixed] !== undefined) return prefixed;
  const bare = skillId.replace(/^skill-/, '');
  if (card.skills[bare] !== undefined) return bare;
  return null;
}

export function rollSpecForSkill(
  card: ActorCard,
  catalog: SkillCatalog,
  skillId: string,
  difficultyBand: DifficultyBand,
): RollSpec {
  const definition = catalog[skillId];
  if (!definition) {
    throw new SkillNotDefinedError(skillId);
  }
  const storedKey = resolveSkillKey(card, skillId);
  const rank: SkillRank = (storedKey ? card.skills[storedKey] : undefined) ?? 'untrained';
  if (rank === 'untrained' && !definition.allowUntrained) {
    throw new SkillNotTrainedError(skillId);
  }
  const attribute = card.attributes[definition.attribute] ?? BASE_ATTRIBUTE_POINTS;
  return {
    attribute,
    skillRank: rank,
    difficulty: difficultyForBand(difficultyBand),
  };
}

/** Ability costs must be affordable from the actor's current resources. */
export function assertAbilityAffordable(
  card: ActorCard,
  ability: AbilityDefinition,
  currentResources: Record<string, number>,
): void {
  for (const [resourceId, amount] of Object.entries(ability.costs)) {
    const current = currentResources[resourceId] ?? 0;
    if (current < amount) {
      throw new Error(
        `Ability ${ability.name} requires ${amount} ${resourceId}; ${card.actorId} has ${current}.`,
      );
    }
  }
}

/** Grade → encounter damage template for an attack (plan §12.4). */
export function attackDamageForGrade(grade: RollGrade): number {
  switch (grade) {
    case 'full_success': return 3;
    case 'success': return 2;
    default: return 0;
  }
}
