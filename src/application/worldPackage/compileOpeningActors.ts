import type { ActorTemplateDefinition, ContentEntry, Provenance } from '../../domain/content/types';
import type { StoredEntity, StoredFact } from '../ports/worldStore';
import { isFactVisibleAtAnchor } from '../world/opening';

/** Mechanical defaults follow the same base profile as an opening character.
 * Identity is canon; defaults do not claim novel abilities, intent or allegiance. */
export function compileOpeningActors(entities: readonly StoredEntity[], facts: readonly StoredFact[], anchor?: number): ContentEntry[] {
  return entities.filter(e => e.type === 'character').flatMap(entity => {
    const evidence = facts.filter(f => f.subjectEntityId === entity.entityId
      && (f.status === 'explicit' || f.status === 'inference') && f.sources.length > 0 && isFactVisibleAtAnchor(f, anchor ?? 0));
    if (!evidence.length) return [];
    const explicit = evidence.filter(f => f.status === 'explicit');
    const identity: Provenance = { kind: explicit.length ? 'explicit' : 'inferred', sourceFactIds: (explicit.length ? explicit : evidence).map(f => f.factId),
      rationale: '人物身份来自授权范围内经引用校验的原著事实。' };
    const mechanics: Provenance = { kind: 'rule_mapping', sourceFactIds: [],
      rationale: 'opening-local-rules-1：规则集基础行动参数，未声明原著战力、技能、目的或人物关系；后续有证据的映射可扩展。' };
    const definition: ActorTemplateDefinition = { name: entity.name, category: 'human',
      description: `已核验的原著人物：${entity.name}。`,
      attributes: { physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
      skills: {}, hp: 6, stamina: 4, defense: 2, attacks: [], abilities: [],
      behavior: { goal: '按当前明确行动和已知事实决定', retreatThreshold: 0.25, morale: 'steady' },
      lootPolicy: '未映射掉落', threat: { damage: 0, durability: 1, actions: 1, control: 0, environment: 0 } };
    return [{ entryId: `actor-canon-${entity.entityId}`, kind: 'actor_template' as const, revision: 0,
      provenance: identity, fieldProvenance: Object.fromEntries(['category','attributes','skills','hp','stamina','defense','attacks','abilities','behavior','lootPolicy','threat'].map(field => [field, mechanics])),
      visibility: 'public' as const, dependencyIds: [], definition }];
  });
}
