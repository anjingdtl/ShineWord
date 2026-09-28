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
  /**
   * Opening world-time anchor. Canon openings MUST provide it: facts and rule
   * mappings are filtered through this anchor, so a character cannot begin
   * with abilities they will only gain later in the story.
   */
  worldTimeOrder?: number;
  /** Original characters: free points distributed over base 1, single cap 3. */
  freeAttributePoints?: Partial<Record<AttributeName, number>>;
  /** Canon characters: the entity to derive the opening state from. */
  canonEntity?: StoredEntity;
  /**
   * Player-chosen opening location (G02): used when the canon records no
   * usable location fact for a canon character at the anchor, and as the
   * original character's start location.
   */
  fallbackLocationId?: string;
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
          locationId: request.fallbackLocationId ?? 'unset',
          resources: { hp: 10, stamina: 10 },
          conditions: [],
        },
      },
      itemOwners: {},
      encounters: [],
    };
    return { profile, snapshot, startLocation: request.fallbackLocationId ?? 'unset' };
  }

  const entity = request.canonEntity;
  if (!entity) throw new Error('Canon opening requires a canon entity.');
  if (request.worldTimeOrder === undefined || !Number.isFinite(request.worldTimeOrder)) {
    throw new Error('Canon opening requires a finite worldTimeOrder anchor.');
  }
  const anchorOrder = request.worldTimeOrder;

  // Time-anchored, validity-windowed fact filtering: facts that have not
  // happened yet or have expired at the anchor never shape the opening.
  const visibleFacts = canonFactsVisibleAt(
    context.facts.filter(fact => fact.subjectEntityId === entity.entityId),
    anchorOrder,
  );
  const subjectFacts = visibleFacts.filter(
    fact => fact.status !== 'speculation' && fact.status !== 'conflict',
  );

  const locationFact = subjectFacts.find(fact => fact.predicate === 'current_location')
    ?? subjectFacts.find(fact => fact.predicate === 'home_location');
  // Conservative fallback (G02): when the novel records no location for this
  // character at the anchor, the PLAYER-CHOSEN opening location stands in
  // instead of blocking the opening. Evidence-backed locations always win.
  const startLocation = locationFact
    ? factValueString(locationFact)
    : (request.fallbackLocationId && request.fallbackLocationId.trim().length > 0
        ? request.fallbackLocationId.trim()
        : undefined);
  if (!startLocation) {
    throw new Error(
      `Canon character ${entity.name} has no usable location fact at anchor ${anchorOrder}.`,
    );
  }

  // Rule mappings carry no time bounds of their own; they are only usable at
  // the anchor when EVERY cited evidence fact is visible there. This blocks
  // late-story abilities leaking into an early opening.
  const evidenceVisibleAtAnchor = new Map(
    context.facts.map(fact => [fact.factId, fact]),
  );
  const factVisibleCache = new Map<string, boolean>();
  const isFactVisible = (factId: string): boolean => {
    const cached = factVisibleCache.get(factId);
    if (cached !== undefined) return cached;
    const fact = evidenceVisibleAtAnchor.get(factId);
    const visible = fact ? isFactVisibleAtAnchor(fact, anchorOrder) : false;
    factVisibleCache.set(factId, visible);
    return visible;
  };

  const skillRanks: Record<string, SkillRank> = {};
  const evidenceFactIds: string[] = [];
  for (const mapping of context.mappings) {
    if (mapping.targetEntityId !== entity.entityId || mapping.mappingKind !== 'skill') continue;
    const skillId = typeof mapping.mapping.skillId === 'string' ? mapping.mapping.skillId : undefined;
    const rank = mapping.mapping.rank;
    const evidence = mapping.evidenceRefs;
    if (!skillId) continue;
    if (!evidence.every(factId => isFactVisible(factId))) continue;
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
        && mapping.mapping.attribute === name
        && mapping.evidenceRefs.every(factId => isFactVisible(factId)),
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
    encounters: [],
  };
  return { profile, snapshot, startLocation };
}

function parseOrder(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Time-windowed visibility at one world-time anchor:
 * - `validFrom > anchor` → the fact does not hold yet;
 * - `validTo < anchor` → the fact has already stopped holding;
 * - `revealAt > anchor` → the story has not revealed it yet (foresight block).
 * Unparseable bounds are treated as unbounded (visible) — the extraction
 * pipeline stores numeric world-time orders as strings.
 */
export function isFactVisibleAtAnchor(fact: StoredFact, worldTimeOrder: number): boolean {
  const from = parseOrder(fact.validFrom);
  if (from !== null && from > worldTimeOrder) return false;
  const to = parseOrder(fact.validTo);
  if (to !== null && to < worldTimeOrder) return false;
  const reveal = parseOrder(fact.revealAt);
  if (reveal !== null && reveal > worldTimeOrder) return false;
  return true;
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
  return facts.filter(fact => isFactVisibleAtAnchor(fact, worldTimeOrder));
}
