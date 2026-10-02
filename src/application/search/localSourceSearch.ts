import type { IndexCoverageV1 } from '../ports/phase6';
import type { SourceStore } from '../ports/sourceStore';
import type { WorldStore } from '../ports/worldStore';
import { codePointLength } from '../../domain/world/textOffsets';
import {
  CHINESE_SOURCE_INDEX_VERSION,
  LocalSourceSearchIndexBuilder,
  searchLocalSource,
  type LocalSourceSearchIndex,
  type SourceSearchResult,
} from './chineseSourceSearch';

const MAX_CACHED_INDEXES = 2;
const MAX_SCOPED_RANGES = 64;

export interface LocalSourceRange {
  chapterId: string;
  startCodePoint: number;
  endCodePoint: number;
}

export interface LocalSourcePassage {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  startCodePoint: number;
  endCodePoint: number;
  text: string;
}

export interface LocalSourcePersistentBackend {
  searchLocal(input: { sourceId:string; worldId:string; query:string; topK?:number;
    sourceRanges?:readonly LocalSourceRange[]; signal?:AbortSignal }):Promise<LocalSourceLookupResult>;
}

export interface LocalSourceLookupResult {
  result: SourceSearchResult;
  coverage?: readonly IndexCoverageV1[];
  completeness?: 'complete' | 'partial';
  passages: LocalSourcePassage[];
  /** Same-chapter neighbors are fetched locally for later prefetch selection. */
  adjacentPrefetch: LocalSourcePassage[];
}

/**
 * Searches the persisted novel locally. The full text is never assembled in
 * memory: chunks are read and indexed one at a time, and this service is only
 * called when a foreground lookup or post-opening build queue asks for it.
 */
export class LocalSourceSearchService {
  private readonly indexes = new Map<string, LocalSourceSearchIndex>();
  private readonly builds = new Map<string, Promise<LocalSourceSearchIndex>>();

  constructor(
    private readonly sources: Pick<SourceStore, 'getManifest' | 'getChapters' | 'getChunks' | 'readRange'>,
    private readonly worlds: Pick<WorldStore, 'listEntities'>,
    private readonly persistentBackend?: LocalSourcePersistentBackend,
  ) {}

  async search(input: {
    sourceId: string;
    worldId: string;
    query: string;
    topK?: number;
    /** Omit only for an explicit whole-source local lookup. */
    sourceRanges?: readonly LocalSourceRange[];
    signal?: AbortSignal;
  }): Promise<LocalSourceLookupResult> {
    if (this.persistentBackend) return this.persistentBackend.searchLocal(input);
    const index = await this.getOrBuildIndex(input.sourceId, input.worldId, input.sourceRanges, input.signal);
    const result = searchLocalSource(index, { query: input.query, topK: input.topK, adjacentPrefetch: 2 });
    const chapters = await this.sources.getChapters(input.sourceId);
    const chapterTitles = new Map(chapters.map(chapter => [chapter.chapterId, chapter.title]));
    const passages = await Promise.all(result.hits.map(async hit => ({
      paragraphId: hit.paragraphId,
      chapterId: hit.chapterId,
      chapterTitle: chapterTitles.get(hit.chapterId) ?? hit.chapterId,
      startCodePoint: hit.startCodePoint,
      endCodePoint: hit.endCodePoint,
      text: await readRange(this.sources, input.sourceId, hit.startCodePoint, hit.endCodePoint, input.signal),
    })));
    const adjacentPrefetch = await Promise.all(result.adjacentPrefetch.map(async neighbor => ({
      ...neighbor,
      chapterTitle: chapterTitles.get(neighbor.chapterId) ?? neighbor.chapterId,
      text: await readRange(this.sources, input.sourceId, neighbor.startCodePoint, neighbor.endCodePoint, input.signal),
    })));
    return { result, passages, adjacentPrefetch };
  }

  private async getOrBuildIndex(
    sourceId: string,
    worldId: string,
    sourceRanges: readonly LocalSourceRange[] | undefined,
    signal?: AbortSignal,
  ): Promise<LocalSourceSearchIndex> {
    throwIfAborted(signal);
    const manifest = await this.sources.getManifest(sourceId);
    if (!manifest || manifest.status !== 'active') {
      throw new Error('Cannot search a source that is not active.');
    }
    const entities = await this.worlds.listEntities(worldId);
    const aliasFingerprint = JSON.stringify(entities
      .map(entity => ({ entityId: entity.entityId, name: entity.name, aliases: [...entity.aliases].sort() }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId)));
    const normalizedRanges = sourceRanges === undefined ? undefined : normalizeRanges(sourceRanges);
    const key = JSON.stringify([
      sourceId,
      manifest.rawSha256Hex,
      manifest.normalizedTreeHash,
      CHINESE_SOURCE_INDEX_VERSION,
      aliasFingerprint,
      normalizedRanges === undefined ? null : normalizedRanges,
    ]);
    const cached = this.indexes.get(key);
    if (cached) {
      this.touch(key, cached);
      return cached;
    }
    const existingBuild = this.builds.get(key);
    if (existingBuild) return existingBuild;

    const build = this.buildIndex(sourceId, entities, normalizedRanges, signal).then(index => {
      this.indexes.set(key, index);
      this.trimCache();
      return index;
    }).finally(() => this.builds.delete(key));
    this.builds.set(key, build);
    return build;
  }

  private async buildIndex(
    sourceId: string,
    entities: Awaited<ReturnType<WorldStore['listEntities']>>,
    sourceRanges: readonly LocalSourceRange[] | undefined,
    signal?: AbortSignal,
  ): Promise<LocalSourceSearchIndex> {
    const chapters = await this.sources.getChapters(sourceId);
    const chapterOrder = new Map(chapters.map(chapter => [chapter.chapterId, chapter.index]));
    const builder = new LocalSourceSearchIndexBuilder(entities.map(entity => ({
      entityId: entity.entityId,
      name: entity.name,
      aliases: entity.aliases,
    })));
    if (sourceRanges !== undefined) {
      const sortedRanges = [...sourceRanges].sort((a, b) =>
        (chapterOrder.get(a.chapterId) ?? Number.MAX_SAFE_INTEGER)
          - (chapterOrder.get(b.chapterId) ?? Number.MAX_SAFE_INTEGER)
        || a.startCodePoint - b.startCodePoint);
      for (const [index, range] of sortedRanges.entries()) {
        throwIfAborted(signal);
        const chapter = chapters.find(item => item.chapterId === range.chapterId);
        if (!chapter || range.startCodePoint < chapter.startOffset || range.endCodePoint > chapter.endOffset) {
          throw new Error('Published source evidence range is outside its chapter.');
        }
        const text = await readRange(this.sources, sourceId, range.startCodePoint, range.endCodePoint, signal);
        builder.addChunk({
          chunkId: `evidence-${index}-${range.startCodePoint}-${range.endCodePoint}`,
          chapterId: range.chapterId,
          chapterIndex: chapter.index,
          chunkIndex: index,
          startCodePoint: range.startCodePoint,
          endCodePoint: range.endCodePoint,
          contentHash: `published-evidence:${range.startCodePoint}:${range.endCodePoint}`,
          text,
        });
      }
      return builder.finish();
    }

    const chunks = await this.sources.getChunks(sourceId);
    chunks.sort((a, b) => (chapterOrder.get(a.chapterId) ?? Number.MAX_SAFE_INTEGER)
      - (chapterOrder.get(b.chapterId) ?? Number.MAX_SAFE_INTEGER)
      || a.chunkIndex - b.chunkIndex
      || a.startOffset - b.startOffset);
    for (const chunk of chunks) {
      throwIfAborted(signal);
      const chapterIndex = chapterOrder.get(chunk.chapterId);
      if (chapterIndex === undefined) throw new Error(`Source chunk ${chunk.chunkId} references an unknown chapter.`);
      const text = await readRange(this.sources, sourceId, chunk.startOffset, chunk.endOffset, signal);
      if (codePointLength(text) !== chunk.endOffset - chunk.startOffset) {
        throw new Error(`Source range for chunk ${chunk.chunkId} is incomplete.`);
      }
      builder.addChunk({
        chunkId: chunk.chunkId,
        chapterId: chunk.chapterId,
        chapterIndex,
        chunkIndex: chunk.chunkIndex,
        startCodePoint: chunk.startOffset,
        endCodePoint: chunk.endOffset,
        contentHash: chunk.contentHash,
        text,
      });
    }
    return builder.finish();
  }

  private touch(key: string, index: LocalSourceSearchIndex): void {
    this.indexes.delete(key);
    this.indexes.set(key, index);
  }

  private trimCache(): void {
    while (this.indexes.size > MAX_CACHED_INDEXES) {
      const oldest = this.indexes.keys().next().value as string | undefined;
      if (!oldest) return;
      this.indexes.delete(oldest);
    }
  }
}

function normalizeRanges(ranges: readonly LocalSourceRange[]): LocalSourceRange[] {
  if (ranges.length > MAX_SCOPED_RANGES) throw new Error(`Source lookup exceeds ${MAX_SCOPED_RANGES} published evidence ranges.`);
  const ordered = [...ranges].sort((a, b) => a.chapterId.localeCompare(b.chapterId)
    || a.startCodePoint - b.startCodePoint || a.endCodePoint - b.endCodePoint);
  const merged: LocalSourceRange[] = [];
  for (const range of ordered) {
    if (!range.chapterId || !Number.isSafeInteger(range.startCodePoint) || !Number.isSafeInteger(range.endCodePoint)
      || range.startCodePoint < 0 || range.endCodePoint <= range.startCodePoint) {
      throw new Error('Published source evidence range is invalid.');
    }
    const previous = merged[merged.length - 1];
    if (previous && previous.chapterId === range.chapterId && range.startCodePoint <= previous.endCodePoint) {
      previous.endCodePoint = Math.max(previous.endCodePoint, range.endCodePoint);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

async function readRange(
  sources: Pick<SourceStore, 'readRange'>,
  sourceId: string,
  startCodePoint: number,
  endCodePoint: number,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const text = await sources.readRange(sourceId, startCodePoint, endCodePoint);
  throwIfAborted(signal);
  if (codePointLength(text) !== endCodePoint - startCodePoint) {
    throw new Error('Published source range is incomplete.');
  }
  return text;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Progressive source lookup was canceled.');
  error.name = 'AbortError';
  throw error;
}
