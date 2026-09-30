/**
 * Deterministic playability gate (TTFP, task §11).
 *
 * Answers "is the world extracted so far already enough to START playing?"
 * from persisted canon only - extracted entities/facts/events plus open
 * BLOCKING review issues. No LLM request is spent on the question; the only
 * paid step after the gate passes is publishing the Opening Package itself
 * (the regular mapping pass over the covered prefix).
 *
 * A progressive run re-evaluates this gate after every completed analysis
 * batch; the fixed "30% of the book first" condition is gone.
 */
import type { StoredEntity, StoredFact } from '../ports/worldStore';

/** Defaults tuned for "first big batch of a Chinese novel": chapter 1..N of a
 * normal book easily yields tens of explicit facts, several characters, at
 * least one place and at least one happening. */
export const PLAYABILITY_MIN_FACTS = 20;

export interface PlayabilityGateInput {
  entities: readonly StoredEntity[];
  facts: readonly StoredFact[];
  /** Canon events or still-open event proposals. */
  eventCount: number;
  /** Open review issues with severity 'blocking'. */
  openBlockingReviewIssues: number;
  minimumFacts?: number;
}

export interface PlayabilityGateResult {
  playable: boolean;
  /** Missing conditions, human readable (zh), empty when playable. */
  reasons: string[];
}

function isMappableFact(fact: StoredFact): boolean {
  return fact.status === 'explicit' || fact.status === 'inference';
}

export function evaluatePlayabilityGate(input: PlayabilityGateInput): PlayabilityGateResult {
  const reasons: string[] = [];
  const mappable = input.facts.filter(isMappableFact);
  const factsBySubject = new Map<string, number>();
  for (const fact of mappable) {
    factsBySubject.set(fact.subjectEntityId, (factsBySubject.get(fact.subjectEntityId) ?? 0) + 1);
  }

  const characters = input.entities.filter(entity => entity.type === 'character');
  const locations = input.entities.filter(entity => entity.type === 'location');

  const characterWithFacts = characters.some(entity => (factsBySubject.get(entity.entityId) ?? 0) > 0);
  if (!characterWithFacts) {
    reasons.push('还没有带事实依据的核心人物（自创角色开局也需要基础人物参照）');
  }
  const locationWithFacts = locations.some(entity => (factsBySubject.get(entity.entityId) ?? 0) > 0);
  if (!locationWithFacts) {
    reasons.push('还没有可用地点（至少一个带事实依据的 Location）');
  }
  const minimumFacts = input.minimumFacts ?? PLAYABILITY_MIN_FACTS;
  if (mappable.length < minimumFacts) {
    reasons.push(`Canon 事实不足（${mappable.length}/${minimumFacts}）`);
  }
  if (input.eventCount < 1) {
    reasons.push('还没有可作为剧情环境的事件');
  }
  if (input.openBlockingReviewIssues > 0) {
    reasons.push(`存在 ${input.openBlockingReviewIssues} 条阻断性审查问题`);
  }
  return { playable: reasons.length === 0, reasons };
}

/** Snapshot loader input for the gate over one world's persisted canon. */
export interface PlayabilitySnapshot {
  entities: readonly StoredEntity[];
  facts: readonly StoredFact[];
  eventCount: number;
  openBlockingReviewIssues: number;
}

/**
 * Gathers the gate snapshot from a world store. Pure read; safe to call after
 * every completed batch.
 */
export async function loadPlayabilitySnapshot(input: {
  listEntities: (worldId: string) => Promise<readonly StoredEntity[]>;
  listFacts: (worldId: string) => Promise<readonly StoredFact[]>;
  listEvents: (worldId: string) => Promise<ReadonlyArray<{ status: string }>>;
  listEventProposals?: (worldId: string) => Promise<readonly unknown[]>;
  countOpenBlockingReviewIssues: (worldId: string) => Promise<number>;
  worldId: string;
}): Promise<PlayabilitySnapshot> {
  const [entities, facts, events, proposals, blocking] = await Promise.all([
    input.listEntities(input.worldId),
    input.listFacts(input.worldId),
    input.listEvents(input.worldId),
    input.listEventProposals ? input.listEventProposals(input.worldId) : Promise.resolve([]),
    input.countOpenBlockingReviewIssues(input.worldId),
  ]);
  const eventCount = events.filter(event => event.status === 'canon').length + proposals.length;
  return { entities, facts, eventCount, openBlockingReviewIssues: blocking };
}
