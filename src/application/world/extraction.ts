import type {
  EntityProposal,
  EventProposal,
  ExtractionResult,
  FactProposal,
} from '../../domain/world/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import { SHINEWORD_RULESET_VERSION } from '../../domain/rules/ruleset';
import type { StoredEntity, StoredFact, StoredRuleMapping } from '../ports/worldStore';

export type Sha256Hex = Sha256HexProvider['sha256Hex'];

/**
 * Bounded evidence source (closeout C2): chapter bounds plus a range read.
 * The batch builder backs this with a CodePointOffsetIndex over the whole
 * text; the streaming coordinator backs it with persisted shards, so quote
 * verification no longer requires an O(N) full-text index per chunk.
 */
export interface EvidenceSource {
  chapters: readonly { chapterId: string; startOffset: number; endOffset: number }[];
  sliceRange(startCp: number, endCp: number): Promise<string>;
}

export interface EvidenceCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Evidence policy: the quote must exist in the normalized source text and the
 * declared code point span must reproduce it exactly. This is what keeps
 * "source location = 100%" a hard guarantee, independent of the extractor.
 */
export async function checkEvidence(
  proposal: FactProposal,
  chapterIndex: Map<string, { start: number; end: number }>,
  source: EvidenceSource,
): Promise<EvidenceCheckResult> {
  if (!proposal.evidence) return { ok: false, reason: 'missing evidence span' };
  const { chapterId, startOffset, endOffset, quote } = proposal.evidence;
  const chapter = chapterIndex.get(chapterId);
  if (!chapter) return { ok: false, reason: `unknown chapter ${chapterId}` };
  if (startOffset < chapter.start || endOffset > chapter.end || startOffset >= endOffset) {
    return { ok: false, reason: `span outside chapter ${chapterId}` };
  }
  const sliced = await source.sliceRange(startOffset, endOffset);
  if (sliced !== quote) {
    return { ok: false, reason: 'quote does not match declared span' };
  }
  return { ok: true };
}

export interface ExtractionValidationIssue {
  kind: 'evidence' | 'entity' | 'dependency' | 'rule_mapping';
  detail: string;
}

export interface ResolvedExtraction {
  entities: StoredEntity[];
  facts: StoredFact[];
  events: Array<EventProposal & { resolvedDependsOnEventIds: string[] }>;
  /**
   * Rule mappings whose target resolved to a known entity AND whose every
   * evidence quote is verified verbatim (1M plan P4). Rejected mappings
   * never block the chunk's facts/events - they surface as issues.
   */
  ruleMappings: StoredRuleMapping[];
  rejected: ExtractionValidationIssue[];
}

function slug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/**
 * Stable token for a rule mapping's skill/attribute/resource identity so the
 * derived mappingId is idempotent across replays (plan P4: "mappingId 稳定派生
 * 保证幂等"). Falls back to a canonical sorted-key rendering of the mapping.
 */
export function ruleMappingToken(mapping: Record<string, unknown>): string {
  for (const field of ['skillId', 'attribute', 'resource', 'tier', 'name', 'id']) {
    const value = mapping[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return slug(value);
    }
  }
  const stable = Object.keys(mapping).sort()
    .map(key => `${key}=${typeof mapping[key] === 'object' ? JSON.stringify(mapping[key]) : String(mapping[key])}`)
    .join('&');
  return slug(stable) || 'mapping';
}

/** Deterministic mapping identity: same target+kind+token -> same row. */
export function ruleMappingIdFor(
  worldId: string,
  targetEntityId: string,
  mappingKind: StoredRuleMapping['mappingKind'],
  mapping: Record<string, unknown>,
): string {
  return `map-${worldId}-${targetEntityId}-${mappingKind}-${ruleMappingToken(mapping)}`;
}

export function entityIdFor(worldId: string, key: string): string {
  return `ent-${worldId}-${slug(key)}`;
}

export function eventIdFor(worldId: string, key: string): string {
  return `evt-${worldId}-${slug(key)}`;
}

export interface ApplyExtractionInput {
  worldId: string;
  source: EvidenceSource;
  extraction: ExtractionResult;
  createdAt: string;
  sha256Hex: Sha256Hex;
  /**
   * Quotes already verified verbatim elsewhere in the SAME group commit
   * (other chunks' facts). Lets a group-level rule mapping cite evidence
   * from any member chunk without weakening the verbatim guarantee -
   * callers must only pass quotes the extractor located verbatim in the
   * source. (1M plan P4.)
   */
  additionalVerifiedQuotes?: readonly string[];
  /** Phase6 location values must denote an evidenced place, not a prose sentence. */
  strictLocationClaims?: boolean;
}

/**
 * Validates an extractor proposal against the immutable source:
 * - every fact must carry verbatim evidence inside a known chapter;
 * - speculation never enters as canon authority (status preserved);
 * - entity keys resolve to stable entity ids with name aliases.
 */
export async function applyExtraction(input: ApplyExtractionInput): Promise<ResolvedExtraction> {
  const { worldId, source, extraction, sha256Hex } = input;
  const chapterIndex = new Map<string, { start: number; end: number }>();
  for (const chapter of source.chapters) {
    chapterIndex.set(chapter.chapterId, { start: chapter.startOffset, end: chapter.endOffset });
  }

  const rejected: ExtractionValidationIssue[] = [];
  const entities: StoredEntity[] = extraction.entities.map((proposal: EntityProposal) => ({
    worldId,
    entityId: entityIdFor(worldId, proposal.entityKey),
    type: proposal.type,
    name: proposal.name,
    firstSeenChapterId: null,
    aliases: [proposal.name, ...(proposal.aliases ?? [])],
  }));

  const entityByKey = new Map<string, StoredEntity>();
  for (const proposal of extraction.entities) {
    const entity = entities.find(candidate => candidate.entityId === entityIdFor(worldId, proposal.entityKey));
    if (entity) entityByKey.set(proposal.entityKey, entity);
  }

  const facts: StoredFact[] = [];
  let factCounter = 0;
  for (const proposal of extraction.facts) {
    const evidence = await checkEvidence(proposal, chapterIndex, source);
    if (!evidence.ok) {
      rejected.push({ kind: 'evidence', detail: `${proposal.subjectKey}.${proposal.predicate}: ${evidence.reason}` });
      continue;
    }
    const subject = entityByKey.get(proposal.subjectKey);
    if (!subject) {
      rejected.push({ kind: 'entity', detail: `unknown subject ${proposal.subjectKey}` });
      continue;
    }
    if (input.strictLocationClaims && ['current_location','home_location'].includes(proposal.predicate)) {
      const location = entities.find(e => e.type === 'location'
        && [e.name, ...e.aliases].some(name => name.length >= 2 && proposal.evidence.quote.includes(name))
        && Object.values(proposal.value).some(value => typeof value === 'string'
          && [e.name, ...e.aliases, e.entityId, ...extraction.entities.filter(p => p.type === 'location' && p.name === e.name).map(p => p.entityKey)].includes(value)));
      if (!location) {
        rejected.push({ kind: 'evidence', detail: `${proposal.subjectKey}.${proposal.predicate}: location value lacks a named place supported by its quote` });
        continue;
      }
    }
    factCounter += 1;
    facts.push({
      worldId,
      factId: `fact-${worldId}-${slug(proposal.subjectKey)}-${proposal.predicate}-${factCounter}`,
      subjectEntityId: subject.entityId,
      predicate: proposal.predicate,
      value: proposal.value,
      status: proposal.status,
      confidence: proposal.confidence,
      validFrom: proposal.validFrom ?? null,
      validTo: proposal.validTo ?? null,
      revealAt: proposal.revealAt ?? null,
      scope: 'world',
      sources: [{
        chapterId: proposal.evidence.chapterId,
        startOffset: proposal.evidence.startOffset,
        endOffset: proposal.evidence.endOffset,
        quote: proposal.evidence.quote,
        quoteSha256: await sha256Hex(proposal.evidence.quote),
      }],
    });
  }

  const eventByKey = new Map(extraction.events.map(event => [event.eventKey, event]));
  const events = extraction.events.map(event => {
    const dependencies: string[] = [];
    for (const key of event.dependsOnEventKeys ?? []) {
      if (eventByKey.has(key)) {
        dependencies.push(eventIdFor(worldId, key));
      } else {
        rejected.push({ kind: 'dependency', detail: `unknown dependency event ${key}` });
      }
    }
    return { ...event, resolvedDependsOnEventIds: dependencies };
  });

  // P4 (1M plan): resolve rule mappings. The target must be a known entity
  // key and EVERY evidence quote must match - verbatim - a quote that
  // checkEvidence already verified for a fact of this extraction: the same
  // "verbatim + code-point span" guarantee, never a relaxation. A failing
  // mapping is rejected and recorded; it never blocks the chunk commit.
  const verifiedQuotes = new Set<string>([
    ...(facts.map(fact => fact.sources[0]?.quote).filter(Boolean) as string[]),
    ...(input.additionalVerifiedQuotes ?? []),
  ]);
  const ruleMappings: StoredRuleMapping[] = [];
  for (const proposal of extraction.ruleMappings ?? []) {
    const target = entityByKey.get(proposal.targetKey);
    if (!target) {
      rejected.push({ kind: 'rule_mapping', detail: `unknown mapping target ${proposal.targetKey}` });
      continue;
    }
    if (proposal.evidenceRefs.length === 0) {
      rejected.push({ kind: 'rule_mapping', detail: `mapping ${proposal.targetKey}.${proposal.mappingKind} has no evidence` });
      continue;
    }
    const unverified = proposal.evidenceRefs.filter(ref => !verifiedQuotes.has(ref));
    if (unverified.length > 0) {
      rejected.push({
        kind: 'rule_mapping',
        detail: `mapping ${proposal.targetKey}.${proposal.mappingKind} cites ${unverified.length} unverified quote(s)`,
      });
      continue;
    }
    ruleMappings.push({
      worldId,
      mappingId: ruleMappingIdFor(worldId, target.entityId, proposal.mappingKind, proposal.mapping),
      targetEntityId: target.entityId,
      mappingKind: proposal.mappingKind,
      mapping: proposal.mapping,
      evidenceRefs: [...proposal.evidenceRefs],
      rulesetVersion: SHINEWORD_RULESET_VERSION,
      status: 'active',
    });
  }

  return { entities, facts, events, ruleMappings, rejected };
}
