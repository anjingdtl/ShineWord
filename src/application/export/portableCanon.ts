import type { ContentEntry, WorldPackageManifest } from '../../domain/content/types';
import { canonicalStringify, type CanonicalJson, type Sha256HexProvider } from '../../domain/turns/canonical';
import { codePointLength } from '../../domain/world/textOffsets';
import type { WorldCanonSnapshot } from '../ports/worldStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';

export interface PortableCanon extends WorldCanonSnapshot {
  worldId: string;
  sourceSha256: string;
  packageContentHash: string;
  contentHash: string;
}

function canonHash(canon: Omit<PortableCanon, 'contentHash'>, sha: Sha256HexProvider['sha256Hex']): Promise<string> | string {
  return sha(canonicalStringify(canon as unknown as CanonicalJson));
}

export async function exportPortableCanon(
  store: SqliteWorldStore,
  manifest: WorldPackageManifest,
  entries: readonly ContentEntry[],
  sha: Sha256HexProvider['sha256Hex'],
): Promise<PortableCanon> {
  const worldId = manifest.worldId;
  const [chapters, entities, facts, events, ruleMappings] = await Promise.all([
    store.getChapters(worldId), store.listEntities(worldId), store.listFacts(worldId),
    store.listEvents(worldId), store.listRuleMappings(worldId),
  ]);
  const body = { worldId, sourceSha256: manifest.sourceSha256, packageContentHash: manifest.contentHash,
    chapters, entities, facts, events, ruleMappings };
  const canon = { ...body, contentHash: await canonHash(body, sha) };
  await validatePortableCanon(canon, manifest, entries, sha);
  return canon;
}

/** Validate the entire reference graph BEFORE importing any world rows. */
export async function validatePortableCanon(
  canon: PortableCanon,
  manifest: WorldPackageManifest,
  entries: readonly ContentEntry[],
  sha: Sha256HexProvider['sha256Hex'],
): Promise<void> {
  const fail = (): never => { throw new Error('世界包原著资料不完整或校验失败，请从原小说重新导出完整世界包。'); };
  const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const nullableText = (value: unknown): boolean => value === null || text(value);
  const object = (value: unknown): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(canon) || canon.worldId !== manifest.worldId || canon.sourceSha256 !== manifest.sourceSha256
    || canon.packageContentHash !== manifest.contentHash || !text(canon.contentHash)
    || [canon.chapters, canon.entities, canon.facts, canon.events, canon.ruleMappings].some(list => !Array.isArray(list))) fail();
  const { contentHash, ...body } = canon;
  if ((await canonHash(body, sha)).toLowerCase() !== contentHash.toLowerCase()) fail();
  const unique = <T extends { worldId: string }>(list: readonly T[], key: (row: T) => string): Set<string> => {
    const ids = new Set<string>();
    for (const row of list) {
      if (!object(row) || row.worldId !== canon.worldId || !text(key(row)) || ids.has(key(row))) fail();
      ids.add(key(row));
    }
    return ids;
  };
  const chapters = unique(canon.chapters, row => row.chapterId);
  const entities = unique(canon.entities, row => row.entityId);
  const facts = unique(canon.facts, row => row.factId);
  const events = unique(canon.events, row => row.eventId);
  unique(canon.ruleMappings, row => row.mappingId);
  const chapterById = new Map(canon.chapters.map(row => [row.chapterId, row]));
  const indexes = new Set<number>();
  for (const chapter of canon.chapters) {
    if (!Number.isSafeInteger(chapter.index) || chapter.index < 0 || indexes.has(chapter.index)
      || !Number.isSafeInteger(chapter.startOffset) || !Number.isSafeInteger(chapter.endOffset)
      || chapter.startOffset < 0 || chapter.endOffset <= chapter.startOffset
      || chapter.charCount !== chapter.endOffset - chapter.startOffset || !text(chapter.title)
      || !/^[a-f0-9]{64}$/i.test(chapter.contentHash)) fail();
    indexes.add(chapter.index);
  }
  for (const entity of canon.entities) {
    if (!['character', 'faction', 'location', 'item', 'ability', 'rule', 'event'].includes(entity.type)
      || !text(entity.name) || !Array.isArray(entity.aliases) || entity.aliases.some(alias => !text(alias))
      || (entity.firstSeenChapterId !== null && !chapters.has(entity.firstSeenChapterId))) fail();
  }
  for (const fact of canon.facts) {
    if (!entities.has(fact.subjectEntityId) || !text(fact.predicate) || !object(fact.value) || !text(fact.scope)
      || !['explicit', 'inference', 'speculation', 'conflict', 'user_supplement'].includes(fact.status)
      || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1
      || ![fact.validFrom, fact.validTo, fact.revealAt].every(nullableText) || !Array.isArray(fact.sources)) fail();
    for (const span of fact.sources) {
      const chapter = object(span) ? chapterById.get(span.chapterId) : undefined;
      if (!chapter || !Number.isSafeInteger(span.startOffset) || !Number.isSafeInteger(span.endOffset)
        || span.startOffset < chapter.startOffset || span.endOffset > chapter.endOffset
        || span.endOffset <= span.startOffset || !text(span.quote)
        || codePointLength(span.quote) !== span.endOffset - span.startOffset
        || (await sha(span.quote)).toLowerCase() !== span.quoteSha256?.toLowerCase()) fail();
    }
  }
  for (const event of canon.events) {
    if (!text(event.title) || typeof event.summary !== 'string'
      || !['canon', 'pending', 'invalidated'].includes(event.status)
      || (event.worldTimeOrder !== null && !Number.isSafeInteger(event.worldTimeOrder))
      || (event.narrativeChapterId !== null && !chapters.has(event.narrativeChapterId))
      || ![event.validFrom, event.validTo].every(nullableText)
      || !Array.isArray(event.dependsOnEventIds) || event.dependsOnEventIds.some(id => !events.has(id))) fail();
  }
  for (const mapping of canon.ruleMappings) {
    if (!entities.has(mapping.targetEntityId) || !['attribute', 'skill', 'power_tier', 'resource'].includes(mapping.mappingKind)
      || !object(mapping.mapping) || !text(mapping.rulesetVersion) || !['active', 'retired'].includes(mapping.status)
      || !Array.isArray(mapping.evidenceRefs) || mapping.evidenceRefs.some(id => !facts.has(id))) fail();
  }
  for (const entry of entries) {
    const provenances = [entry.provenance, ...Object.values(entry.fieldProvenance ?? {})];
    if (provenances.some(p => p.sourceFactIds.some(id => !facts.has(id)))) fail();
  }
}
