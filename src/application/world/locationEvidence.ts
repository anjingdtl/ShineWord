import type { StoredEntity, StoredFact } from '../ports/worldStore';
/** Both draft compilation and publication use the existing entity resolver's
 * canonical names/aliases. A spelling variant does not lose a verified place. */
export function hasCharacterLocationEvidence(fact: StoredFact, character: StoredEntity, location: StoredEntity): boolean {
  if (fact.subjectEntityId !== character.entityId || !['explicit','inference'].includes(fact.status) || !fact.sources.length) return false;
  const placeNames = [location.name, ...location.aliases].filter(name => name.length >= 2);
  const personNames = [character.name, ...character.aliases].filter(name => name.length >= 2);
  const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings)
    : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
  return fact.predicate === 'current_location' && strings(fact.value).some(value => [location.entityId, ...placeNames].includes(value))
    || fact.sources.some(span => placeNames.some(name => span.quote.includes(name)) && personNames.some(name => span.quote.includes(name)));
}
