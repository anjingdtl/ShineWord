import type { AttributeName } from '../../domain/rules/types';
import { INITIAL_SKILL_BUDGET } from '../../domain/characters/card';
import { BASE_ATTRIBUTE_POINTS, FREE_ATTRIBUTE_POINTS } from '../world/opening';

const ATTRIBUTE_ORDER: readonly AttributeName[] = [
  'physique', 'agility', 'insight', 'knowledge', 'willpower', 'social',
];

export interface OpeningSkillOption {
  entryId: string;
  attribute: string;
}

export interface RecommendedOpeningLoadout {
  attributes: Record<AttributeName, number>;
  initialSkills: string[];
}

/**
 * Produces a deterministic, legal starter card from the player's already
 * visible opening skill projection. It cannot discover templates or add an
 * id that is absent from that projection.
 */
export function recommendOpeningLoadout(skills: readonly OpeningSkillOption[]): RecommendedOpeningLoadout {
  const seen = new Set<string>();
  const eligible = skills.filter(skill => {
    const id = skill.entryId.trim();
    const knownAttribute = ATTRIBUTE_ORDER.includes(skill.attribute as AttributeName);
    if (!id || seen.has(id) || !knownAttribute) return false;
    seen.add(id);
    return true;
  }).slice(0, INITIAL_SKILL_BUDGET);

  const counts = new Map<AttributeName, number>();
  for (const skill of eligible) {
    const attribute = skill.attribute as AttributeName;
    counts.set(attribute, (counts.get(attribute) ?? 0) + 1);
  }
  const priorities = [
    ...ATTRIBUTE_ORDER.filter(attribute => counts.has(attribute))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)
        || ATTRIBUTE_ORDER.indexOf(a) - ATTRIBUTE_ORDER.indexOf(b)),
    ...ATTRIBUTE_ORDER.filter(attribute => !counts.has(attribute)),
  ];

  const attributes = Object.fromEntries(ATTRIBUTE_ORDER.map(attribute => [attribute, BASE_ATTRIBUTE_POINTS])) as Record<AttributeName, number>;
  for (let spent = 0; spent < FREE_ATTRIBUTE_POINTS; spent += 1) {
    const target = priorities.find(attribute => attributes[attribute] < 3);
    if (!target) break;
    attributes[target] += 1;
  }
  return { attributes, initialSkills: eligible.map(skill => skill.entryId) };
}
