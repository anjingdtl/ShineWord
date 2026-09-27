import type { StoredEntity } from '../ports/worldStore';

export interface EntityMergeCandidate {
  primaryEntityId: string;
  secondaryEntityId: string;
  score: number;
  basis: 'exact_name' | 'alias_match';
  matchedAlias: string;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

/**
 * Deterministic alias-based merge proposals. Same-name entities are only
 * *candidates* — merging is an explicit operation backed by evidence, never
 * automatic, and entities of different types are never proposed.
 */
export function proposeEntityMerges(
  existing: readonly StoredEntity[],
  incoming: readonly StoredEntity[],
): EntityMergeCandidate[] {
  const candidates: EntityMergeCandidate[] = [];
  for (const next of incoming) {
    for (const prior of existing) {
      if (prior.entityId === next.entityId) continue;
      if (prior.type !== next.type) continue;
      const priorNames = [prior.name, ...prior.aliases].map(normalizeName);
      const nextNames = [next.name, ...next.aliases].map(normalizeName);
      const exact = nextNames.find(name => priorNames.includes(name));
      if (exact) {
        candidates.push({
          primaryEntityId: prior.entityId,
          secondaryEntityId: next.entityId,
          score: 1.0,
          basis: 'exact_name',
          matchedAlias: exact,
        });
        continue;
      }
      const alias = nextNames.find(name => priorNames.includes(name));
      if (alias) {
        candidates.push({
          primaryEntityId: prior.entityId,
          secondaryEntityId: next.entityId,
          score: 0.9,
          basis: 'alias_match',
          matchedAlias: alias,
        });
      }
    }
  }
  return candidates;
}

export interface EntityMergePlan {
  primary: StoredEntity;
  aliasAdditions: string[];
  absorbedEntityIds: string[];
}

/**
 * Applies explicit merges: the secondary entity's names become aliases of the
 * primary; the secondary disappears as an independent identity. Every alias
 * addition must carry evidence through the caller-provided evidence list.
 */
export function planEntityMerge(
  primary: StoredEntity,
  secondaries: readonly StoredEntity[],
): EntityMergePlan {
  const aliasAdditions = new Set<string>();
  const absorbed: string[] = [];
  for (const secondary of secondaries) {
    if (secondary.entityId === primary.entityId) continue;
    if (secondary.type !== primary.type) {
      throw new Error(
        `Cannot merge ${secondary.type} entity ${secondary.entityId} into ${primary.type} entity ${primary.entityId}.`,
      );
    }
    absorbed.push(secondary.entityId);
    for (const alias of [secondary.name, ...secondary.aliases]) {
      if (normalizeName(alias) === normalizeName(primary.name)) continue;
      if (!primary.aliases.includes(alias)) aliasAdditions.add(alias);
    }
  }
  return {
    primary,
    aliasAdditions: [...aliasAdditions],
    absorbedEntityIds: absorbed,
  };
}
