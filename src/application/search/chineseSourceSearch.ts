import { codePointLength, CodePointOffsetIndex } from '../../domain/world/textOffsets';

export const CHINESE_SOURCE_INDEX_VERSION = 'local-cjk-bigram-1';
const MAX_QUERY_TERMS = 24;
const MAX_SEARCH_HITS = 8;
const MAX_ADJACENT_PREFETCH = 4;
const MAX_PARAGRAPH_CODE_POINTS = 1_200;

const STOP_SINGLE = new Set(Array.from('的了是我你他她它在有和与很就而又都为以从这那吗吧呢呀着被把将向对中上下里去来一个些'));
const STOP_BIGRAM = new Set(['的是', '了的', '不是', '因为', '所以', '但是', '然后', '如果', '这个', '那个', '他们', '我们', '你们']);

export interface SourceSearchChunkInput {
  chunkId: string;
  chapterId: string;
  chapterIndex: number;
  chunkIndex: number;
  startCodePoint: number;
  endCodePoint: number;
  contentHash: string;
  text: string;
}

export interface SourceSearchEntity {
  entityId: string;
  name: string;
  aliases?: readonly string[];
}

export interface IndexedSourceParagraph {
  paragraphId: string;
  chunkId: string;
  chapterId: string;
  chapterIndex: number;
  paragraphIndex: number;
  startCodePoint: number;
  endCodePoint: number;
  contentHash: string;
  termFrequency: Readonly<Record<string, number>>;
  entityIds: readonly string[];
}

export interface LocalSourceSearchIndex {
  version: string;
  paragraphs: readonly IndexedSourceParagraph[];
  documentFrequency: Readonly<Record<string, number>>;
  /** Ephemeral postings are built locally from the persisted paragraph rows. */
  postings: ReadonlyMap<string, ReadonlyMap<number, number>>;
  entityAliases: readonly { entityId: string; normalizedAlias: string; terms: readonly string[] }[];
}

export interface SourceSearchHit {
  paragraphId: string;
  chunkId: string;
  chapterId: string;
  chapterIndex: number;
  paragraphIndex: number;
  startCodePoint: number;
  endCodePoint: number;
  score: number;
  matchedTerms: string[];
  matchedEntityIds: string[];
}

export interface SourceSearchResult {
  queryTerms: string[];
  resolvedEntityIds: string[];
  hits: SourceSearchHit[];
  adjacentPrefetch: Array<{ paragraphId: string; chapterId: string; startCodePoint: number; endCodePoint: number }>;
  searchedParagraphCount: number;
  /** False means no match in this local index, never that a fact does not exist. */
  hasMatches: boolean;
}

export function normalizeSearchText(value: string): string {
  return Array.from(value.normalize('NFKC').toLowerCase())
    .filter(character => !isSearchSeparator(character.codePointAt(0)!))
    .join('');
}

/** Explicit punctuation handling keeps the tokenizer usable on Hermes builds
 * that do not implement Unicode property escapes in regular expressions. */
function isSearchSeparator(value: number): boolean {
  if (value <= 0x20 || value === 0x7f || (value >= 0x2000 && value <= 0x200a)) return true;
  if ((value >= 0x21 && value <= 0x2f)
    || (value >= 0x3a && value <= 0x40)
    || (value >= 0x5b && value <= 0x60)
    || (value >= 0x7b && value <= 0x7e)) return true;
  return value === 0x3000
    || (value >= 0x3001 && value <= 0x3003)
    || (value >= 0x3008 && value <= 0x3011)
    || (value >= 0x3014 && value <= 0x301f)
    || value === 0x3030
    || value === 0x303d
    || (value >= 0xfe10 && value <= 0xfe19)
    || (value >= 0xfe30 && value <= 0xfe52)
    || (value >= 0xff01 && value <= 0xff0f)
    || (value >= 0xff1a && value <= 0xff20)
    || (value >= 0xff3b && value <= 0xff40)
    || (value >= 0xff5b && value <= 0xff65);
}

function isHan(codePoint: number): boolean {
  return (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0x20000 && codePoint <= 0x323af);
}

function isAsciiWord(codePoint: number): boolean {
  return (codePoint >= 0x30 && codePoint <= 0x39)
    || (codePoint >= 0x41 && codePoint <= 0x5a)
    || (codePoint >= 0x61 && codePoint <= 0x7a);
}

/**
 * Dictionary-free Chinese tokenizer. Han runs yield overlapping bigrams;
 * Latin/digit runs remain whole. FTS5's unicode61 tokenizer is never used as
 * the Chinese segmentation policy.
 */
export function tokenizeChineseSearchText(input: string): string[] {
  const normalized = input.normalize('NFKC').toLowerCase();
  const codePoints = Array.from(normalized);
  const output: string[] = [];
  let cursor = 0;
  while (cursor < codePoints.length) {
    const point = codePoints[cursor]!;
    const value = point.codePointAt(0)!;
    if (isHan(value)) {
      const run: string[] = [];
      while (cursor < codePoints.length && isHan(codePoints[cursor]!.codePointAt(0)!)) {
        run.push(codePoints[cursor]!);
        cursor += 1;
      }
      if (run.length === 1 && !STOP_SINGLE.has(run[0]!)) output.push(`u:${run[0]}`);
      for (let index = 0; index + 1 < run.length; index += 1) {
        const pair = `${run[index]}${run[index + 1]}`;
        if (!STOP_BIGRAM.has(pair)) output.push(`b:${pair}`);
      }
      continue;
    }
    if (isAsciiWord(value)) {
      const start = cursor;
      while (cursor < codePoints.length && isAsciiWord(codePoints[cursor]!.codePointAt(0)!)) cursor += 1;
      const word = codePoints.slice(start, cursor).join('');
      if (word.length > 0) output.push(`w:${word}`);
      continue;
    }
    cursor += 1;
  }
  return output;
}

function splitChunkIntoParagraphs(chunk: SourceSearchChunkInput): Array<{
  paragraphId: string;
  chapterId: string;
  chapterIndex: number;
  paragraphIndex: number;
  chunkId: string;
  startCodePoint: number;
  endCodePoint: number;
  contentHash: string;
  text: string;
}> {
  const result: Array<{
    paragraphId: string;
    chapterId: string;
    chapterIndex: number;
    paragraphIndex: number;
    chunkId: string;
    startCodePoint: number;
    endCodePoint: number;
    contentHash: string;
    text: string;
  }> = [];
  const linePattern = /[^\n]+/g;
  let match: RegExpExecArray | null;
  let paragraphIndex = 0;
  while ((match = linePattern.exec(chunk.text)) !== null) {
    const prefix = chunk.text.slice(0, match.index);
    const lineStart = chunk.startCodePoint + codePointLength(prefix);
    const line = match[0];
    const lineOffsets = new CodePointOffsetIndex(line);
    const lineLength = lineOffsets.codePointCount;
    for (let offset = 0; offset < lineLength; offset += MAX_PARAGRAPH_CODE_POINTS) {
      const end = Math.min(lineLength, offset + MAX_PARAGRAPH_CODE_POINTS);
      const text = lineOffsets.slice(offset, end);
      result.push({
        paragraphId: `${chunk.chunkId}:p${paragraphIndex}`,
        chapterId: chunk.chapterId,
        chapterIndex: chunk.chapterIndex,
        paragraphIndex,
        chunkId: chunk.chunkId,
        startCodePoint: lineStart + offset,
        endCodePoint: lineStart + end,
        contentHash: chunk.contentHash,
        text,
      });
      paragraphIndex += 1;
    }
  }
  return result;
}

function aliasCatalog(entities: readonly SourceSearchEntity[]): Array<{
  entityId: string;
  normalizedAlias: string;
  terms: readonly string[];
}> {
  const aliases: Array<{ entityId: string; normalizedAlias: string; terms: readonly string[] }> = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    for (const alias of [entity.name, ...(entity.aliases ?? [])]) {
      const normalizedAlias = normalizeSearchText(alias);
      if (codePointLength(normalizedAlias) < 2) continue;
      const key = `${entity.entityId}\u0000${normalizedAlias}`;
      if (seen.has(key)) continue;
      seen.add(key);
      aliases.push({ entityId: entity.entityId, normalizedAlias, terms: tokenizeChineseSearchText(alias) });
    }
  }
  return aliases;
}

/** Incrementally builds local postings as persisted source chunks are read. */
export class LocalSourceSearchIndexBuilder {
  private readonly aliases: ReturnType<typeof aliasCatalog>;
  private readonly candidateAliasesByTerm = new Map<string, ReturnType<typeof aliasCatalog>>();
  private readonly paragraphIndexByChapter = new Map<string, number>();
  private readonly paragraphs: IndexedSourceParagraph[] = [];
  private readonly documentFrequency: Record<string, number> = {};
  private readonly postings = new Map<string, Map<number, number>>();
  private finished = false;

  constructor(entities: readonly SourceSearchEntity[] = []) {
    this.aliases = aliasCatalog(entities);
    for (const alias of this.aliases) {
      for (const term of alias.terms) {
        const list = this.candidateAliasesByTerm.get(term) ?? [];
        list.push(alias);
        this.candidateAliasesByTerm.set(term, list);
      }
    }
  }

  addChunk(chunk: SourceSearchChunkInput): void {
    if (this.finished) throw new Error('Cannot add source chunks after finishing the search index.');
    for (const paragraph of splitChunkIntoParagraphs(chunk)) {
      const paragraphIndex = this.paragraphIndexByChapter.get(chunk.chapterId) ?? 0;
      this.paragraphIndexByChapter.set(chunk.chapterId, paragraphIndex + 1);
      const terms = tokenizeChineseSearchText(paragraph.text);
      const termFrequency: Record<string, number> = {};
      for (const term of terms) termFrequency[term] = (termFrequency[term] ?? 0) + 1;
      const termSet = new Set(Object.keys(termFrequency));
      const normalizedParagraph = normalizeSearchText(paragraph.text);
      const entityIds = new Set<string>();
      const candidateAliases = new Set<ReturnType<typeof aliasCatalog>[number]>();
      for (const term of termSet) {
        for (const alias of this.candidateAliasesByTerm.get(term) ?? []) candidateAliases.add(alias);
      }
      for (const alias of candidateAliases) {
        if (normalizedParagraph.includes(alias.normalizedAlias)) entityIds.add(alias.entityId);
      }

      const paragraphId = `${chunk.chunkId}:p${paragraph.paragraphIndex}`;
      const documentId = this.paragraphs.length;
      this.paragraphs.push({
        paragraphId,
        chunkId: chunk.chunkId,
        chapterId: chunk.chapterId,
        chapterIndex: chunk.chapterIndex,
        paragraphIndex,
        startCodePoint: paragraph.startCodePoint,
        endCodePoint: paragraph.endCodePoint,
        contentHash: paragraph.contentHash,
        termFrequency,
        entityIds: [...entityIds].sort(),
      });
      for (const [term, frequency] of Object.entries(termFrequency)) {
        this.documentFrequency[term] = (this.documentFrequency[term] ?? 0) + 1;
        const termPostings = this.postings.get(term) ?? new Map<number, number>();
        termPostings.set(documentId, frequency);
        this.postings.set(term, termPostings);
      }
    }
  }

  finish(): LocalSourceSearchIndex {
    if (this.finished) throw new Error('Search index builder has already been finished.');
    this.finished = true;
    return {
      version: CHINESE_SOURCE_INDEX_VERSION,
      paragraphs: this.paragraphs,
      documentFrequency: this.documentFrequency,
      postings: this.postings,
      entityAliases: this.aliases,
    };
  }
}

/** Builds paragraph postings locally from bounded source chunks. */
export function buildLocalSourceSearchIndex(input: {
  chunks: readonly SourceSearchChunkInput[];
  entities?: readonly SourceSearchEntity[];
}): LocalSourceSearchIndex {
  const builder = new LocalSourceSearchIndexBuilder(input.entities ?? []);
  const orderedChunks = [...input.chunks].sort((a, b) =>
    a.chapterIndex - b.chapterIndex || a.chunkIndex - b.chunkIndex || a.startCodePoint - b.startCodePoint);
  for (const chunk of orderedChunks) builder.addChunk(chunk);
  return builder.finish();
}
export function searchLocalSource(index: LocalSourceSearchIndex, input: {
  query: string;
  topK?: number;
  adjacentPrefetch?: number;
}): SourceSearchResult {
  const queryTerms = [...new Set(tokenizeChineseSearchText(input.query))].slice(0, MAX_QUERY_TERMS);
  const normalizedQuery = normalizeSearchText(input.query);
  const resolvedEntityIds = new Set<string>();
  for (const alias of index.entityAliases) {
    if (normalizedQuery.includes(alias.normalizedAlias)) resolvedEntityIds.add(alias.entityId);
  }

  const scores = new Map<number, { score: number; terms: Set<string>; entities: Set<string> }>();
  const total = Math.max(index.paragraphs.length, 1);
  for (const term of queryTerms) {
    const termPostings = index.postings.get(term);
    if (!termPostings) continue;
    const documentFrequency = index.documentFrequency[term] ?? termPostings.size;
    const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
    for (const [documentId, frequency] of termPostings) {
      const paragraph = index.paragraphs[documentId];
      if (!paragraph) continue;
      const score = idf * ((frequency * 2.2) / (frequency + 1.2));
      const current = scores.get(documentId) ?? { score: 0, terms: new Set<string>(), entities: new Set<string>() };
      current.score += score;
      current.terms.add(term);
      scores.set(documentId, current);
    }
  }
  if (resolvedEntityIds.size > 0) {
    for (let documentId = 0; documentId < index.paragraphs.length; documentId += 1) {
      const paragraph = index.paragraphs[documentId]!;
      const matching = paragraph.entityIds.filter(entityId => resolvedEntityIds.has(entityId));
      if (matching.length === 0) continue;
      const current = scores.get(documentId) ?? { score: 0, terms: new Set<string>(), entities: new Set<string>() };
      current.score += 4 * matching.length;
      matching.forEach(entityId => current.entities.add(entityId));
      scores.set(documentId, current);
    }
  }

  const topK = clampInteger(input.topK, 3, 1, MAX_SEARCH_HITS);
  const hits = [...scores.entries()]
    .filter(([, value]) => value.score > 0)
    .sort((a, b) => b[1].score - a[1].score
      || index.paragraphs[a[0]]!.startCodePoint - index.paragraphs[b[0]]!.startCodePoint)
    .slice(0, topK)
    .map(([documentId, value]) => {
      const paragraph = index.paragraphs[documentId]!;
      return {
        paragraphId: paragraph.paragraphId,
        chunkId: paragraph.chunkId,
        chapterId: paragraph.chapterId,
        chapterIndex: paragraph.chapterIndex,
        paragraphIndex: paragraph.paragraphIndex,
        startCodePoint: paragraph.startCodePoint,
        endCodePoint: paragraph.endCodePoint,
        score: value.score,
        matchedTerms: [...value.terms].sort(),
        matchedEntityIds: [...value.entities].sort(),
      };
    });

  const adjacentLimit = clampInteger(input.adjacentPrefetch, 2, 0, MAX_ADJACENT_PREFETCH);
  const hitIds = new Set(hits.map(hit => hit.paragraphId));
  const adjacentPrefetch: SourceSearchResult['adjacentPrefetch'] = [];
  const paragraphPositions = new Map<string, number>();
  index.paragraphs.forEach((paragraph, position) => paragraphPositions.set(paragraph.paragraphId, position));
  for (const hit of hits) {
    const position = paragraphPositions.get(hit.paragraphId);
    if (position === undefined) continue;
    const candidates = [index.paragraphs[position - 1], index.paragraphs[position + 1]]
      .filter((candidate): candidate is IndexedSourceParagraph => Boolean(candidate && candidate.chapterId === hit.chapterId))
      .sort((a, b) => Math.abs(a.paragraphIndex - hit.paragraphIndex) - Math.abs(b.paragraphIndex - hit.paragraphIndex));
    for (const candidate of candidates) {
      if (hitIds.has(candidate.paragraphId) || adjacentPrefetch.some(item => item.paragraphId === candidate.paragraphId)) continue;
      adjacentPrefetch.push({
        paragraphId: candidate.paragraphId,
        chapterId: candidate.chapterId,
        startCodePoint: candidate.startCodePoint,
        endCodePoint: candidate.endCodePoint,
      });
      if (adjacentPrefetch.length >= adjacentLimit) break;
    }
    if (adjacentPrefetch.length >= adjacentLimit) break;
  }

  return {
    queryTerms,
    resolvedEntityIds: [...resolvedEntityIds].sort(),
    hits,
    adjacentPrefetch,
    searchedParagraphCount: index.paragraphs.length,
    hasMatches: hits.length > 0,
  };
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value!)) : fallback;
}
