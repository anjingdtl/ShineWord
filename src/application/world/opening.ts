import { SHINEWORD_RULESET_ID, SHINEWORD_RULESET_VERSION } from '../../domain/rules/ruleset';
import { ATTRIBUTE_NAMES, type AttributeName, type SkillRank } from '../../domain/rules/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { StoredEntity, StoredFact, StoredRuleMapping } from '../ports/worldStore';

export const FREE_ATTRIBUTE_POINTS = 4;
export const BASE_ATTRIBUTE_POINTS = 1;

export interface ActorProfile {
  actorId: string;
  displayName: string;
  kind: 'canon' | 'original';
  attributes: Record<AttributeName, number>;
  skillRanks: Record<string, SkillRank>;
  evidenceFactIds: string[];
  rulesetId: string;
  rulesetVersion: string;
}

export interface OpeningRequest {
  branchId: string;
  actorId: string;
  displayName: string;
  kind: 'canon' | 'original';
  /** Original characters: free points distributed over base 1, single cap 3. */
  freeAttributePoints?: Partial<Record<AttributeName, number>>;
  /** Canon characters: the entity to derive the opening state from. */
  canonEntity?: StoredEntity;
}

export interface CanonContext {
  facts: readonly StoredFact[];
  mappings: readonly StoredRuleMapping[];
}

function factValueString(fact: StoredFact): string | undefined {
  const value = fact.value;
  if (typeof value.location === 'string') return value.location;
  if (typeof value.skill === 'string') return value.skill;
  return undefined;
}

/**
 * Builds the opening actor profile and branch snapshot. Canon characters only
 * receive abilities that the world mapping actually grants at this point —
 * the canon never leaks abilities the character has not yet mastered.
 */
export function buildOpening(
  request: OpeningRequest,
  context: CanonContext,
): { profile: ActorProfile; snapshot: GameStateSnapshot; startLocation: string } {
  if (request.kind === 'original') {
    const attributes = {} as Record<AttributeName, number>;
    let spent = 0;
    for (const name of ATTRIBUTE_NAMES) {
      const extra = request.freeAttributePoints?.[name] ?? 0;
      if (!Number.isInteger(extra) || extra < 0 || extra > 2) {
        throw new Error(`Free points for ${name} must be an integer between 0 and 2.`);
      }
      attributes[name] = BASE_ATTRIBUTE_POINTS + extra;
      spent += extra;
    }
    if (spent > FREE_ATTRIBUTE_POINTS) {
      throw new Error(
        `Free attribute points exceeded: ${spent} spent, maximum ${FREE_ATTRIBUTE_POINTS}.`,
      );
    }
    const profile: ActorProfile = {
      actorId: request.actorId,
      displayName: request.displayName,
      kind: 'original',
      attributes,
      skillRanks: {},
      evidenceFactIds: [],
      rulesetId: SHINEWORD_RULESET_ID,
      rulesetVersion: SHINEWORD_RULESET_VERSION,
    };
    const snapshot: GameStateSnapshot = {
      branchId: request.branchId,
      stateVersion: 0,
      clockMinutes: 0,
      actors: {
        [request.actorId]: {
          actorId: request.actorId,
          locationId: 'opening-anchor',
          resources: { hp: 10, stamina: 10 },
          conditions: [],
        },
      },
      itemOwners: {},
    };
    return { profile, snapshot, startLocation: 'opening-anchor' };
  }

  const entity = request.canonEntity;
  if (!entity) throw new Error('Canon opening requires a canon entity.');

  const subjectFacts = context.facts.filter(
    fact => fact.subjectEntityId === entity.entityId && fact.status !== 'speculation' && fact.status !== 'conflict',
  );

  const locationFact = subjectFacts.find(fact => fact.predicate === 'current_location')
    ?? subjectFacts.find(fact => fact.predicate === 'home_location');
  const startLocation = locationFact ? factValueString(locationFact) : undefined;
  if (!startLocation) {
    throw new Error(`Canon character ${entity.name} has no usable location fact for opening.`);
  }

  const skillRanks: Record<string, SkillRank> = {};
  const evidenceFactIds: string[] = [];
  for (const mapping of context.mappings) {
    if (mapping.targetEntityId !== entity.entityId || mapping.mappingKind !== 'skill') continue;
    const skillId = typeof mapping.mapping.skillId === 'string' ? mapping.mapping.skillId : undefined;
    const rank = mapping.mapping.rank;
    const evidence = mapping.evidenceRefs;
    if (!skillId) continue;
    if (rank === 'untrained' || rank === 'novice' || rank === 'trained' || rank === 'expert' || rank === 'master') {
      skillRanks[skillId] = rank;
    }
    evidenceFactIds.push(...evidence);
  }

  const attributes = {} as Record<AttributeName, number>;
  for (const name of ATTRIBUTE_NAMES) {
    const attributeMapping = context.mappings.find(
      mapping => mapping.targetEntityId === entity.entityId
        && mapping.mappingKind === 'attribute'
        && mapping.mapping.attribute === name,
    );
    const value = attributeMapping?.mapping.value;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3) {
      attributes[name] = value;
    } else {
      attributes[name] = BASE_ATTRIBUTE_POINTS;
    }
  }

  const profile: ActorProfile = {
    actorId: request.actorId,
    displayName: request.displayName,
    kind: 'canon',
    attributes,
    skillRanks,
    evidenceFactIds: [...new Set(evidenceFactIds)],
    rulesetId: SHINEWORD_RULESET_ID,
    rulesetVersion: SHINEWORD_RULESET_VERSION,
  };

  const snapshot: GameStateSnapshot = {
    branchId: request.branchId,
    stateVersion: 0,
    clockMinutes: 0,
    actors: {
      [request.actorId]: {
        actorId: request.actorId,
        locationId: startLocation,
        resources: { hp: 10, stamina: 10 },
        conditions: [],
      },
    },
    itemOwners: {},
  };
  return { profile, snapshot, startLocation };
}

/**
 * Divergence rule: once the game starts, canon events strictly after the
 * anchor become candidate outcomes ('pending'), not guaranteed history.
 * The caller persists divergence markers for the affected events.
 */
export function canonFactsVisibleAt(
  facts: readonly StoredFact[],
  worldTimeOrder: number,
): StoredFact[] {
  return facts.filter(fact => {
    if (fact.validFrom === null) return true;
    const from = Number.parseInt(fact.validFrom, 10);
    if (Number.isNaN(from)) return true;
    return from <= worldTimeOrder;
  });
}
