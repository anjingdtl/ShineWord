/**
 * Source-of-truth storage for imported novel sources (closeout C2).
 *
 * A source is the immutable normalized text plus its manifest: shards are
 * persisted during streaming import under a staging manifest, and activation
 * commits chapters/chunks and flips the status in one transaction. Builds
 * read ranges from here, so resuming a build never requires the original
 * file again.
 */
import type { ChapterSplitStrategy, SourceChapter, SourceChunk } from '../../domain/world/types';

export interface SourceManifest {
  sourceId: string;
  /** True byte digest of the raw staged file. */
  rawSha256Hex: string;
  /** Versioned shard-tree digest of the normalized text. */
  normalizedTreeHash: string;
  normalizeTreeHashVersion: string;
  byteLength: number;
  codePointCount: number;
  encoding: string;
  normalizeVersion: string;
  chapterSplitVersion: string;
  normalizeShardScheme: string;
  splitStrategy: ChapterSplitStrategy;
  /** Original picked file name (display only; never used as identity). */
  fileName: string | null;
  title: string | null;
  status: 'staging' | 'active' | 'orphaned';
  createdAt: string;
  updatedAt: string;
}

export interface SourceStore {
  /** Creates a staging manifest; shards may then be written under it. */
  beginStaging(manifest: SourceManifest): Promise<void>;
  saveShard(input: {
    sourceId: string;
    shardIndex: number;
    startCp: number;
    endCp: number;
    text: string;
  }): Promise<void>;
  /** One-transaction activation: manifest + chapters + chunks + status. */
  activateSource(input: {
    manifest: SourceManifest;
    chapters: readonly SourceChapter[];
    chunks: readonly SourceChunk[];
  }): Promise<void>;
  getManifest(sourceId: string): Promise<SourceManifest | null>;
  /** Active source with the same raw bytes, if any (fast re-import path). */
  findActiveByRawHash(rawSha256Hex: string): Promise<SourceManifest | null>;
  readRange(sourceId: string, startCp: number, endCp: number): Promise<string>;
  getChapters(sourceId: string): Promise<SourceChapter[]>;
  getChunks(sourceId: string): Promise<SourceChunk[]>;
  listStagingOlderThan(cutoffIso: string): Promise<SourceManifest[]>;
  /** Deletes a staging/orphaned source and its shards. Never touches active. */
  deleteSource(sourceId: string): Promise<boolean>;
}
