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

export interface LocalSourcePassage {
  paragraphId: string;
  chapterId: string;
  startCodePoint: number;
  endCodePoint: number;
  text: string;
}

export interface LocalSourceLookupResult {
  result: SourceSearchResult;
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
  ) {}

  async search(input: {
    sourceId: string;
    worldId: string;
    query: string;
    topK?: number;
  }): Promise<LocalSourceLookupResult> {
    const index = await this.getOrBuildIndex(input.sourceId, input.worldId);
    const result = searchLocalSource(index, { query: input.query, topK: input.topK, adjacentPrefetch: 2 });
    const passages = await Promise.all(result.hits.map(async hit => ({
      paragraphId: hit.paragraphId,
      chapterId: hit.chapterId,
      startCodePoint: hit.startCodePoint,
      endCodePoint: hit.endCodePoint,
      text: await this.sources.readRange(input.sourceId, hit.startCodePoint, hit.endCodePoint),
    })));
    const adjacentPrefetch = await Promise.all(result.adjacentPrefetch.map(async neighbor => ({
      ...neighbor,
      text: await this.sources.readRange(input.sourceId, neighbor.startCodePoint, neighbor.endCodePoint),
    })));
    return { result, passages, adjacentPrefetch };
  }

  private async getOrBuildIndex(sourceId: string, worldId: string): Promise<LocalSourceSearchIndex> {
    const manifest = await this.sources.getManifest(sourceId);
    if (!manifest || manifest.status !== 'active') {
      throw new Error('Cannot search a source that is not active.');
    }
    const entities = await this.worlds.listEntities(worldId);
    const aliasFingerprint = JSON.stringify(entities
      .map(entity => ({ entityId: entity.entityId, name: entity.name, aliases: [...entity.aliases].sort() }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId)));
    const key = JSON.stringify([
      sourceId,
      manifest.rawSha256Hex,
      manifest.normalizedTreeHash,
      CHINESE_SOURCE_INDEX_VERSION,
      aliasFingerprint,
    ]);
    const cached = this.indexes.get(key);
    if (cached) {
      this.touch(key, cached);
      return cached;
    }
    const existingBuild = this.builds.get(key);
    if (existingBuild) return existingBuild;

    const build = this.buildIndex(sourceId, entities).then(index => {
      this.indexes.set(key, index);
      this.trimCache();
      return index;
    }).finally(() => this.builds.delete(key));
    this.builds.set(key, build);
    return build;
  }

  private async buildIndex(sourceId: string, entities: Awaited<ReturnType<WorldStore['listEntities']>>): Promise<LocalSourceSearchIndex> {
    const chapters = await this.sources.getChapters(sourceId);
    const chapterOrder = new Map(chapters.map(chapter => [chapter.chapterId, chapter.index]));
    const chunks = await this.sources.getChunks(sourceId);
    chunks.sort((a, b) => (chapterOrder.get(a.chapterId) ?? Number.MAX_SAFE_INTEGER)
      - (chapterOrder.get(b.chapterId) ?? Number.MAX_SAFE_INTEGER)
      || a.chunkIndex - b.chunkIndex
      || a.startOffset - b.startOffset);

    const builder = new LocalSourceSearchIndexBuilder(entities.map(entity => ({
      entityId: entity.entityId,
      name: entity.name,
      aliases: entity.aliases,
    })));
    for (const chunk of chunks) {
      const chapterIndex = chapterOrder.get(chunk.chapterId);
      if (chapterIndex === undefined) throw new Error(`Source chunk ${chunk.chunkId} references an unknown chapter.`);
      const text = await this.sources.readRange(sourceId, chunk.startOffset, chunk.endOffset);
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
