import type { ContentEntry } from '../../domain/content/types';
import type { SituationCondition, SituationDefinitionV1 } from '../../domain/situations/types';
import type { StoredEntity } from '../ports/worldStore';

interface PublishedLocation {
  locationId: string;
  sceneEntryIds: readonly string[];
}

/** World entities, scene entries and branch coordinates are distinct IDs.
 * Only the actual catalog's scenes can certify an alias; no default location
 * or string-prefix guess can create a scene or a movement destination. */
export function createPublishedLocationIndex(entries: readonly ContentEntry[], entities: readonly StoredEntity[]): ReadonlyMap<string, PublishedLocation> {
  const candidates = new Map<string, PublishedLocation[]>();
  const add = (alias: string, location: PublishedLocation): void => {
    const values = candidates.get(alias) ?? [];
    values.push(location); candidates.set(alias, values);
  };
  const scenes = entries.filter(entry => entry.kind === 'scene').flatMap(entry => {
    const id = (entry.definition as { locationId?: unknown }).locationId;
    return typeof id === 'string' && id.trim() ? [{ entryId: entry.entryId, locationId: id }] : [];
  });
  for (const scene of scenes) {
    const location = { locationId: scene.locationId, sceneEntryIds: [scene.entryId] };
    add(scene.entryId, location); add(scene.locationId, location);
    for (const entity of entities.filter(e => e.type === 'location'
      && (e.name === scene.locationId || e.entityId === scene.locationId))) add(entity.entityId, location);
  }
  const result = new Map<string, PublishedLocation>();
  for (const [alias, values] of candidates) {
    if (new Set(values.map(value => value.locationId)).size !== 1) continue;
    result.set(alias, { locationId: values[0]!.locationId,
      sceneEntryIds: [...new Set(values.flatMap(value => value.sceneEntryIds))].sort() });
  }
  return result;
}

export function normalizeSituationLocations(
  input: SituationDefinitionV1, locations: ReadonlyMap<string, PublishedLocation>,
): { definition: SituationDefinitionV1; sceneEntryIds: string[]; unresolvedLocations: string[] } {
  const definition = JSON.parse(JSON.stringify(input)) as SituationDefinitionV1;
  const dependencies = new Set<string>(), unresolved = new Set<string>();
  const resolve = (id: string): string => {
    const location = locations.get(id);
    if (!location) { unresolved.add(id); return id; }
    for (const scene of location.sceneEntryIds) dependencies.add(scene);
    return location.locationId;
  };
  const condition = (node: SituationCondition): SituationCondition => {
    if (node.kind === 'all' || node.kind === 'any') return { ...node, of: node.of.map(condition) };
    if (node.kind === 'not') return { ...node, of: condition(node.of) };
    return node.kind === 'actor_at' ? { ...node, locationId: resolve(node.locationId) } : node;
  };
  if (definition.locationId) definition.locationId = resolve(definition.locationId);
  definition.activation = condition(definition.activation);
  if (definition.knowledgeCondition) definition.knowledgeCondition = condition(definition.knowledgeCondition);
  definition.methods = definition.methods.map(method => ({ ...method,
    firstStep: { ...method.firstStep, ...(method.firstStep.destinationId ? { destinationId: resolve(method.firstStep.destinationId) } : {}) },
    requires: { ...method.requires,
      ...(method.requires.actorAt ? { actorAt: { ...method.requires.actorAt, locationId: resolve(method.requires.actorAt.locationId) } } : {}),
      ...(method.requires.condition ? { condition: condition(method.requires.condition) } : {}),
    }, ...(method.visibility ? { visibility: condition(method.visibility) } : {}),
  }));
  if (definition.referenceEvents) definition.referenceEvents = definition.referenceEvents.map(event => ({ ...event,
    ...(event.condition ? { condition: condition(event.condition) } : {}) }));
  return { definition, sceneEntryIds: [...dependencies], unresolvedLocations: [...unresolved] };
}
