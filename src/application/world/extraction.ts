import type {
  EntityProposal,
  EventProposal,
  ExtractionResult,
  FactProposal,
  ParsedTxtSource,
} from '../../domain/world/types';
import { CodePointOffsetIndex } from '../../domain/world/textOffsets';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import type { StoredEntity, StoredFact } from '../ports/worldStore';

export type Sha256Hex = Sha256HexProvider['sha256Hex'];

export interface EvidenceCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Evidence policy: the quote must exist in the normalized source text and the
 * declared code point span must reproduce it exactly. This is what keeps
 * "source location = 100%" a hard guarantee, independent of the extractor.
 */
export function checkEvidence(
  proposal: FactProposal,
  parsed: ParsedTxtSource,
  chapterIndex: Map<string, { start: number; end: number }>,
  index: CodePointOffsetIndex,
): EvidenceCheckResult {
  if (!proposal.evidence) return { ok: false, reason: 'missing evidence span' };
  const { chapterId, startOffset, endOffset, quote } = proposal.evidence;
  const chapter = chapterIndex.get(chapterId);
  if (!chapter) return { ok: false, reason: `unknown chapter ${chapterId}` };
  if (startOffset < chapter.start || endOffset > chapter.end || startOffset >= endOffset) {
    return { ok: false, reason: `span outside chapter ${chapterId}` };
  }
  const sliced = index.slice(startOffset, endOffset);
  if (sliced !== quote) {
    return { ok: false, reason: 'quote does not match declared span' };
  }
  return { ok: true };
}

export interface ExtractionValidationIssue {
  kind: 'evidence' | 'entity' | 'dependency';
  detail: string;
}

export interface ResolvedExtraction {
  entities: StoredEntity[];
  facts: StoredFact[];
  events: Array<EventProposal & { resolvedDependsOnEventIds: string[] }>;
  rejected: ExtractionValidationIssue[];
}

function slug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function entityIdFor(worldId: string, key: string): string {
  return `ent-${worldId}-${slug(key)}`;
}

export function eventIdFor(worldId: string, key: string): string {
  return `evt-${worldId}-${slug(key)}`;
}

export interface ApplyExtractionInput {
  worldId: string;
  parsed: ParsedTxtSource;
  extraction: ExtractionResult;
  createdAt: string;
  sha256Hex: Sha256Hex;
}

/**
 * Validates an extractor proposal against the immutable source:
 * - every fact must carry verbatim evidence inside a known chapter;
 * - speculation never enters as canon authority (status preserved);
 * - entity keys resolve to stable entity ids with name aliases.
 */
export async function applyExtraction(input: ApplyExtractionInput): Promise<ResolvedExtraction> {
  const { worldId, parsed, extraction, createdAt, sha256Hex } = input;
  const index = new CodePointOffsetIndex(parsed.text);
  const chapterIndex = new Map<string, { start: number; end: number }>();
  for (const chapter of parsed.chapters) {
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
    const evidence = checkEvidence(proposal, parsed, chapterIndex, index);
    if (!evidence.ok) {
      rejected.push({ kind: 'evidence', detail: `${proposal.subjectKey}.${proposal.predicate}: ${evidence.reason}` });
      continue;
    }
    const subject = entityByKey.get(proposal.subjectKey);
    if (!subject) {
      rejected.push({ kind: 'entity', detail: `unknown subject ${proposal.subjectKey}` });
      continue;
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

  return { entities, facts, events, rejected };
}
