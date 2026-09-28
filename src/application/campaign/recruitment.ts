import type { ActorTemplateDefinition, ContentEntry, Provenance } from '../../domain/content/types';
import type { RelationshipSnapshotEntry } from '../../domain/state/types';
import { isFactVisibleAtAnchor } from '../world/opening';
import type { StoredFact } from '../ports/worldStore';

function provenanceIds(provenance: Provenance | undefined): string[] {
  return provenance?.sourceFactIds ? [...provenance.sourceFactIds] : [];
}

function evidenceVisible(
  factIds: readonly string[],
  factsById: ReadonlyMap<string, StoredFact>,
  worldTimeOrder: number | undefined,
): boolean {
  return factIds.every(factId => {
    const fact = factsById.get(factId);
    if (!fact || fact.status === 'speculation' || fact.status === 'conflict') return false;
    if (worldTimeOrder === undefined) {
      return fact.validFrom === null && fact.validTo === null && fact.revealAt === null;
    }
    return isFactVisibleAtAnchor(fact, worldTimeOrder);
  });
}

export function templateDefinition(entry: ContentEntry): ActorTemplateDefinition {
  return entry.definition as ActorTemplateDefinition;
}

export function isTemplateValidAtAnchor(entry: ContentEntry, worldTimeOrder?: number): boolean {
  if (entry.kind !== 'actor_template') return false;
  const policy = templateDefinition(entry).recruitment;
  if (!policy) return true;
  if (worldTimeOrder === undefined) {
    return policy.validFromOrder === undefined && policy.validToOrder === undefined;
  }
  return (policy.validFromOrder === undefined || worldTimeOrder >= policy.validFromOrder)
    && (policy.validToOrder === undefined || worldTimeOrder <= policy.validToOrder);
}

export function isEntryVisibleAtAnchor(
  entry: ContentEntry,
  facts: readonly StoredFact[],
  worldTimeOrder?: number,
): boolean {
  const factsById = new Map(facts.map(fact => [fact.factId, fact]));
  if (!evidenceVisible(provenanceIds(entry.provenance), factsById, worldTimeOrder)) return false;
  return Object.values(entry.fieldProvenance ?? {}).every(provenance =>
    evidenceVisible(provenanceIds(provenance), factsById, worldTimeOrder));
}

/**
 * Shared UI and authority check for companion-template projection. GM entries
 * and undiscovered entries never cross this boundary. Time-bounded content is
 * withheld until an actual opening anchor is supplied.
 */
export function isPlayerRecruitmentCandidate(
  entry: ContentEntry,
  facts: readonly StoredFact[],
  worldTimeOrder?: number,
  discovered = false,
): boolean {
  if (entry.kind !== 'actor_template' || entry.visibility === 'gm') return false;
  if (entry.visibility === 'discoverable' && !discovered) return false;
  const definition = templateDefinition(entry);
  const policy = definition.recruitment;
  if (!policy?.recruitable || !isTemplateValidAtAnchor(entry, worldTimeOrder)) return false;

  if (!isEntryVisibleAtAnchor(entry, facts, worldTimeOrder)) return false;
  const fields = entry.fieldProvenance ?? {};
  for (const field of ['name', 'description', 'recruitment']) {
    if (fields[field] && !evidenceVisible(provenanceIds(fields[field]), new Map(facts.map(fact => [fact.factId, fact])), worldTimeOrder)) return false;
  }
  return true;
}

export function openingRelationshipFor(
  entry: ContentEntry,
  worldTimeOrder: number,
): { stance: string; closeness: number } | null {
  const definition = templateDefinition(entry);
  const policy = definition.recruitment;
  if (!policy?.recruitable || policy.openingEligible !== true) return null;
  if (policy.requiredQuestIds?.length) return null;
  const relationship = policy.openingRelationship;
  if (!relationship) return null;
  const minimum = policy.minimumCloseness ?? 0;
  if (!Number.isInteger(relationship.closeness)
    || relationship.closeness < minimum
    || relationship.closeness > 100) return null;
  if (policy.validFromOrder !== undefined && worldTimeOrder < policy.validFromOrder) return null;
  if (policy.validToOrder !== undefined && worldTimeOrder > policy.validToOrder) return null;
  return { stance: relationship.stance, closeness: relationship.closeness };
}

export function meetsRecruitmentRelationship(
  entry: ContentEntry,
  relationships: readonly RelationshipSnapshotEntry[],
  actorId: string,
  leaderActorId: string,
): boolean {
  const policy = templateDefinition(entry).recruitment;
  if (!policy?.recruitable) return false;
  const relation = relationships.find(item => item.fromActorId === actorId && item.toActorId === leaderActorId);
  return Boolean(relation && relation.closeness >= (policy.minimumCloseness ?? 0));
}
