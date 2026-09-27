import type { SkillRank } from '../rules/types';
import type { AttributeName } from '../rules/types';

/**
 * Phase 2 content model (plan §6): one world package, three book views. Every
 * entry has a stable id, a provenance classification and field-level sources.
 * Narrative text may never act as the rule executor: mechanical fields live
 * only in these definitions and are validated before publication.
 */

export type ProvenanceKind =
  | 'explicit'        // stated by the source text
  | 'inferred'        // evidence-backed conclusion
  | 'rule_mapping'    // mapped onto a supported rule component
  | 'design_fill'     // conservative game default, clearly labeled
  | 'user_override';  // explicit user decision

export interface Provenance {
  kind: ProvenanceKind;
  sourceFactIds: readonly string[];
  policyId?: string;
  rationale: string;
}

export type EntryKind =
  | 'skill'
  | 'ability'
  | 'item'
  | 'condition'
  | 'actor_template'
  | 'origin'
  | 'path'
  | 'scene'
  | 'quest'
  | 'lore'
  | 'constraint';

export type EntryVisibility = 'public' | 'gm' | 'discoverable';

export type BookName = 'player_handbook' | 'gm_guide' | 'monster_manual';

export interface WorldPackageManifest {
  worldId: string;
  revision: number;
  schemaVersion: 'world-package-2';
  sourceSha256: string;
  ruleset: { id: string; version: string };
  mappingVersion: string;
  /** SHA-256 over the canonical JSON of all entries + sections. */
  contentHash: string;
  status: 'draft' | 'validating' | 'needs_review' | 'published' | 'retired';
}

export interface ContentEntry {
  entryId: string;
  kind: EntryKind;
  revision: number;
  provenance: Provenance;
  fieldProvenance: Record<string, Provenance>;
  visibility: EntryVisibility;
  revealPolicyId?: string;
  dependencyIds: readonly string[];
  definition: unknown; // validated per kind below
}

export interface BookSection {
  book: BookName;
  sectionKey: string;
  title: string;
  entryIds: readonly string[];
  position: number;
}

// ---------------------------------------------------------------------------
// Skill definitions (plan §8.3: skills are repeatable proficiencies, separate
// from one-shot abilities; every check binds an attribute via the definition).
// ---------------------------------------------------------------------------

export type SkillDie = 4 | 6 | 8 | 10 | 12;

export interface SkillDefinition {
  name: string;
  description: string;
  /** The attribute this skill rolls with; checks must bind one. */
  attribute: AttributeName;
  /** Whether an untrained (d4) attempt is allowed at all. */
  allowUntrained: boolean;
  /** Tools or prerequisites required before use. */
  requirements: string[];
  powerTier: 'ordinary' | 'enhanced' | 'supernatural';
}

// ---------------------------------------------------------------------------
// Ability definitions: independent effects with costs, targets and ranges.
// ---------------------------------------------------------------------------

export type EffectOp =
  | 'damage'
  | 'heal'
  | 'apply_condition'
  | 'remove_condition'
  | 'move_self'
  | 'move_target'
  | 'consume_resource'
  | 'restore_resource'
  | 'reveal_information'
  | 'grant_bonus_dice'
  | 'change_distance';

export interface AbilityEffect {
  op: EffectOp;
  amount?: number;
  conditionId?: string;
  resource?: string;
  distanceBand?: 'near' | 'mid' | 'far';
  bonusDice?: number;
}

export interface AbilityDefinition {
  name: string;
  description: string;
  /** Skill prerequisite (entryId) if any. */
  requiresSkillId?: string;
  /** Attribute the ability check rolls with, when a roll is needed. */
  attribute: AttributeName;
  /** Resource costs, e.g. { stamina: 2 }. */
  costs: Record<string, number>;
  range: 'self' | 'touch' | 'near' | 'mid' | 'far';
  targetPolicy: 'self' | 'single_ally' | 'single_enemy' | 'single_actor' | 'area';
  requiresRoll: boolean;
  difficulty?: number;
  effects: AbilityEffect[];
  /** Cooldown in rounds; 0 = unlimited. */
  cooldownRounds: number;
  /** Passive abilities do not occupy prepared slots. */
  passive: boolean;
  powerTier: 'ordinary' | 'enhanced' | 'supernatural';
}

// ---------------------------------------------------------------------------
// Actor templates (monster manual entries + human opponents) (plan §5.3).
// ---------------------------------------------------------------------------

export interface ActorTemplateDefinition {
  name: string;
  category: 'human' | 'beast' | 'spirit' | 'undead' | 'construct' | 'faction';
  description: string;
  attributes: Partial<Record<AttributeName, number>>;
  /** Default skills with ranks, e.g. { stealth: 'trained' }. */
  skills: Record<string, SkillRank>;
  hp: number;
  stamina: number;
  /** Defense tier for attacks targeting this actor (difficulty value). */
  defense: number;
  attacks: Array<{
    name: string;
    skillId: string;
    damage: number;
    range: 'touch' | 'near' | 'mid' | 'far';
  }>;
  abilities: string[];
  behavior: {
    goal: string;
    retreatThreshold: number; // HP fraction under which it tries to flee
    morale: 'low' | 'steady' | 'fierce';
  };
  lootPolicy: string;
  threat: {
    damage: number;
    durability: number;
    actions: number;
    control: number;
    environment: number;
  };
}

// ---------------------------------------------------------------------------
// Items, conditions, origins, paths, scenes, quests, lore, constraints.
// ---------------------------------------------------------------------------

export interface ItemDefinition {
  name: string;
  description: string;
  category: 'weapon' | 'armor' | 'tool' | 'consumable' | 'valuables' | 'key';
  /** Armor reduces damage after a hit (never silently both defense and soak). */
  armorReduction?: number;
  /** Weapon grants a bonus die to its bound skill when used. */
  weaponSkillId?: string;
  weaponBonusDice?: number;
  effects: AbilityEffect[];
  unique: boolean;
}

export interface ConditionDefinition {
  name: string;
  description: string;
  /** Effects while active, e.g. all checks -1 die or cannot act. */
  modifiers: {
    bonusDice?: number;         // negative = penalty
    cannotAct?: boolean;
    cannotMove?: boolean;
    damagePerRound?: number;
  };
  /** Expiry clock: rounds, encounter end, or explicit removal only. */
  expires: 'round_end' | 'encounter_end' | 'manual' | 'duration_seconds';
  durationSeconds?: number;
  maxStacks: number;
}

export interface OriginDefinition {
  name: string;
  description: string;
  /** Bonus skill ranks granted at creation (counted inside the 3-skill budget). */
  grantedSkills: Record<string, SkillRank>;
  /** Starting resource bonus, e.g. { hp: 2 }. */
  resourceBonus: Record<string, number>;
  startingItems: string[];
}

export interface PathDefinition {
  name: string;
  description: string;
  requiresOrigin?: string;
  /** Ordered gate requirements per rank of the path. */
  gates: Array<{
    rank: number;
    requirement: string;
    grantedAbilities: string[];
  }>;
}

export interface SceneDefinition {
  name: string;
  description: string;
  locationId: string;
  /** 3-7 zones with exits; distance derives from zone relations (plan §12.3). */
  zones: Array<{
    zoneId: string;
    name: string;
    cover: boolean;
    exits: string[];
  }>;
  actors: string[];
  visibleItems: string[];
  hazards: string[];
  clues: string[];
}

export interface QuestDefinition {
  name: string;
  description: string;
  /** Trigger condition expressed over rule events. */
  trigger: { eventType: string; summaryPattern?: string };
  objectives: Array<{ objectiveId: string; description: string; counter: string; target: number }>;
  rewards: { practicePoints?: Record<string, number>; items?: string[] };
  failurePath: string;
}

export interface LoreDefinition {
  name: string;
  title: string;
  text: string;
}

export interface ConstraintDefinition {
  name: string;
  description: string;
  /** Hard rule the game engine enforces; actions violating it are blocked. */
  enforcement: 'block_action' | 'block_effect' | 'audit';
  pattern?: string;
}

/** Narrow runtime validation per entry kind. Unknown ops and dangling
 * references are publication blockers, never warnings. */
export function validateDefinition(kind: EntryKind, definition: unknown): string[] {
  const errors: string[] = [];
  if (typeof definition !== 'object' || definition === null) {
    return [`${kind}: definition must be an object.`];
  }
  const def = definition as Record<string, unknown>;

  const requireString = (key: string): void => {
    if (typeof def[key] !== 'string' || (def[key] as string).trim() === '') {
      errors.push(`${kind}: ${key} must be a non-empty string.`);
    }
  };

  switch (kind) {
    case 'skill': {
      requireString('name');
      requireString('attribute');
      if (!['physique', 'agility', 'insight', 'knowledge', 'willpower', 'social'].includes(String(def.attribute))) {
        errors.push(`skill: unknown attribute ${String(def.attribute)}.`);
      }
      if (typeof def.allowUntrained !== 'boolean') {
        errors.push('skill: allowUntrained must be a boolean.');
      }
      if (!['ordinary', 'enhanced', 'supernatural'].includes(String(def.powerTier))) {
        errors.push(`skill: unknown powerTier ${String(def.powerTier)}.`);
      }
      break;
    }
    case 'ability': {
      requireString('name');
      requireString('attribute');
      const EFFECT_OPS = new Set([
        'damage', 'heal', 'apply_condition', 'remove_condition', 'move_self', 'move_target',
        'consume_resource', 'restore_resource', 'reveal_information', 'grant_bonus_dice', 'change_distance',
      ]);
      if (!Array.isArray(def.effects) || def.effects.length === 0) {
        errors.push('ability: effects must be a non-empty array.');
      } else {
        for (const effect of def.effects as Array<Record<string, unknown>>) {
          if (!EFFECT_OPS.has(String(effect.op))) {
            errors.push(`ability: unknown effect op ${String(effect.op)}.`);
          }
        }
      }
      if (!['self', 'touch', 'near', 'mid', 'far'].includes(String(def.range))) {
        errors.push(`ability: unknown range ${String(def.range)}.`);
      }
      if (!['self', 'single_ally', 'single_enemy', 'single_actor', 'area'].includes(String(def.targetPolicy))) {
        errors.push(`ability: unknown targetPolicy ${String(def.targetPolicy)}.`);
      }
      if (typeof def.costs !== 'object' || def.costs === null) {
        errors.push('ability: costs must be an object.');
      }
      if (typeof def.requiresRoll !== 'boolean') {
        errors.push('ability: requiresRoll must be a boolean.');
      }
      break;
    }
    case 'actor_template': {
      requireString('name');
      if (typeof def.hp !== 'number' || (def.hp as number) <= 0) {
        errors.push('actor_template: hp must be a positive number.');
      }
      if (typeof def.defense !== 'number' || (def.defense as number) <= 0) {
        errors.push('actor_template: defense must be a positive number.');
      }
      break;
    }
    case 'item': {
      requireString('name');
      requireString('category');
      break;
    }
    case 'condition': {
      requireString('name');
      if (typeof def.modifiers !== 'object' || def.modifiers === null) {
        errors.push('condition: modifiers must be an object.');
      }
      if (!['round_end', 'encounter_end', 'manual', 'duration_seconds'].includes(String(def.expires))) {
        errors.push(`condition: unknown expires ${String(def.expires)}.`);
      }
      break;
    }
    case 'origin':
    case 'path': {
      requireString('name');
      break;
    }
    case 'scene': {
      requireString('name');
      requireString('locationId');
      if (!Array.isArray(def.zones) || (def.zones as unknown[]).length < 1) {
        errors.push('scene: zones must be a non-empty array.');
      }
      break;
    }
    case 'quest': {
      requireString('name');
      if (!Array.isArray(def.objectives)) {
        errors.push('quest: objectives must be an array.');
      }
      break;
    }
    case 'lore':
    case 'constraint': {
      requireString('name');
      break;
    }
    default:
      errors.push(`unknown entry kind: ${String(kind)}.`);
  }
  return errors;
}
