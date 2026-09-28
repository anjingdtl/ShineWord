import type { ChapterSplitStrategy, SourceChapter, SourceChunk } from '../../domain/world/types';
import type { SourceManifest, SourceStore } from '../../application/ports/sourceStore';
import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';

interface SegmentRow extends SqliteRow {
  shard_index: number;
  start_cp: number;
  end_cp: number;
  text: string;
}

interface ManifestRow extends SqliteRow {
  source_id: string;
  raw_sha256: string;
  normalized_tree_hash: string;
  normalize_tree_hash_version: string;
  byte_length: number;
  code_point_count: number;
  encoding: string;
  normalize_version: string;
  chapter_split_version: string;
  normalize_shard_scheme: string;
  split_strategy: string;
  file_name: string | null;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToManifest(row: ManifestRow): SourceManifest {
  const status = row.status;
  if (status !== 'staging' && status !== 'active' && status !== 'orphaned') {
    throw new Error(`Invalid source status: ${status}.`);
  }
  return {
    sourceId: row.source_id,
    rawSha256Hex: row.raw_sha256,
    normalizedTreeHash: row.normalized_tree_hash,
    normalizeTreeHashVersion: row.normalize_tree_hash_version,
    byteLength: row.byte_length,
    codePointCount: row.code_point_count,
    encoding: row.encoding,
    normalizeVersion: row.normalize_version,
    chapterSplitVersion: row.chapter_split_version,
    normalizeShardScheme: row.normalize_shard_scheme,
    splitStrategy: row.split_strategy as ChapterSplitStrategy,
    fileName: row.file_name,
    title: row.title,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** UTF-16-safe slice between two code point offsets local to `text`. */
function cpSlice(text: string, fromCp: number, toCp: number): string {
  let cp = 0;
  let startUtf16 = -1;
  let endUtf16 = -1;
  let utf16 = 0;
  while (utf16 <= text.length) {
    if (cp === fromCp) startUtf16 = utf16;
    if (cp === toCp) {
      endUtf16 = utf16;
      break;
    }
    if (utf16 >= text.length) break;
    const code = text.charCodeAt(utf16);
    utf16 += code >= 0xd800 && code < 0xdc00 ? 2 : 1;
    cp += 1;
  }
  if (startUtf16 === -1) startUtf16 = 0;
  if (endUtf16 === -1) endUtf16 = text.length;
  return text.slice(startUtf16, endUtf16);
}

export class SqliteSourceStore implements SourceStore {
  constructor(private readonly db: SqliteDatabase) {}

  async beginStaging(manifest: SourceManifest): Promise<void> {
    await this.db.execute(
      `INSERT INTO imported_sources
        (source_id, raw_sha256, normalized_tree_hash, normalize_tree_hash_version,
         byte_length, code_point_count, encoding, normalize_version, chapter_split_version,
         normalize_shard_scheme, split_strategy, file_name, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        manifest.sourceId,
        manifest.rawSha256Hex,
        manifest.normalizedTreeHash,
        manifest.normalizeTreeHashVersion,
        manifest.byteLength,
        manifest.codePointCount,
        manifest.encoding,
        manifest.normalizeVersion,
        manifest.chapterSplitVersion,
        manifest.normalizeShardScheme,
        manifest.splitStrategy,
        manifest.fileName,
        manifest.title,
        manifest.status,
        manifest.createdAt,
        manifest.updatedAt,
      ],
    );
  }

  async saveShard(input: {
    sourceId: string;
    shardIndex: number;
    startCp: number;
    endCp: number;
    text: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO imported_source_segments
        (source_id, shard_index, start_cp, end_cp, text)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id, shard_index) DO UPDATE SET
         start_cp = excluded.start_cp,
         end_cp = excluded.end_cp,
         text = excluded.text`,
      [input.sourceId, input.shardIndex, input.startCp, input.endCp, input.text],
    );
  }

  async activateSource(input: {
    manifest: SourceManifest;
    chapters: readonly SourceChapter[];
    chunks: readonly SourceChunk[];
  }): Promise<void> {
    await this.db.transaction(async tx => {
      await tx.execute(
        `UPDATE imported_sources SET
           normalized_tree_hash = ?, byte_length = ?, code_point_count = ?, encoding = ?,
           normalize_version = ?, chapter_split_version = ?, normalize_shard_scheme = ?,
           split_strategy = ?, file_name = ?, title = ?, status = 'active', updated_at = ?
         WHERE source_id = ?`,
        [
          input.manifest.normalizedTreeHash,
          input.manifest.byteLength,
          input.manifest.codePointCount,
          input.manifest.encoding,
          input.manifest.normalizeVersion,
          input.manifest.chapterSplitVersion,
          input.manifest.normalizeShardScheme,
          input.manifest.splitStrategy,
          input.manifest.fileName,
          input.manifest.title,
          input.manifest.updatedAt,
          input.manifest.sourceId,
        ],
      );
      for (const chapter of input.chapters) {
        await tx.execute(
          `INSERT INTO imported_source_chapters
            (source_id, chapter_id, chapter_index, title, start_cp, end_cp, char_count, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_id, chapter_id) DO UPDATE SET
             chapter_index = excluded.chapter_index,
             title = excluded.title,
             start_cp = excluded.start_cp,
             end_cp = excluded.end_cp,
             char_count = excluded.char_count,
             content_hash = excluded.content_hash`,
          [
            input.manifest.sourceId,
            chapter.chapterId,
            chapter.index,
            chapter.title,
            chapter.startOffset,
            chapter.endOffset,
            chapter.charCount,
            chapter.contentHash,
          ],
        );
      }
      for (const chunk of input.chunks) {
        await tx.execute(
          `INSERT INTO imported_source_chunks
            (source_id, chunk_id, chapter_id, chunk_index, start_cp, end_cp, char_count, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_id, chunk_id) DO UPDATE SET
             chapter_id = excluded.chapter_id,
             chunk_index = excluded.chunk_index,
             start_cp = excluded.start_cp,
             end_cp = excluded.end_cp,
             char_count = excluded.char_count,
             content_hash = excluded.content_hash`,
          [
            input.manifest.sourceId,
            chunk.chunkId,
            chunk.chapterId,
            chunk.chunkIndex,
            chunk.startOffset,
            chunk.endOffset,
            chunk.charCount,
            chunk.contentHash,
          ],
        );
      }
    });
  }

  async getManifest(sourceId: string): Promise<SourceManifest | null> {
    const row = await this.db.queryOne<ManifestRow>(
      'SELECT * FROM imported_sources WHERE source_id = ?',
      [sourceId],
    );
    return row ? rowToManifest(row) : null;
  }

  async findActiveByRawHash(rawSha256Hex: string): Promise<SourceManifest | null> {
    const row = await this.db.queryOne<ManifestRow>(
      `SELECT * FROM imported_sources WHERE raw_sha256 = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
      [rawSha256Hex],
    );
    return row ? rowToManifest(row) : null;
  }

  async readRange(sourceId: string, startCp: number, endCp: number): Promise<string> {
    if (endCp <= startCp) return '';
    const rows = await this.db.queryAll<SegmentRow>(
      `SELECT shard_index, start_cp, end_cp, text FROM imported_source_segments
        WHERE source_id = ? AND end_cp > ? AND start_cp < ?
        ORDER BY shard_index`,
      [sourceId, startCp, endCp],
    );
    let result = '';
    for (const row of rows) {
      const from = Math.max(startCp, row.start_cp) - row.start_cp;
      const to = Math.min(endCp, row.end_cp) - row.start_cp;
      if (to <= from) continue;
      // Code point offsets are contiguous per shard; convert to UTF-16 slice
      // indices safely because a code point can span two UTF-16 units.
      result += cpSlice(row.text, from, to);
    }
    return result;
  }

  async getChapters(sourceId: string): Promise<SourceChapter[]> {
    const rows = await this.db.queryAll<{
      chapter_id: string;
      chapter_index: number;
      title: string;
      start_cp: number;
      end_cp: number;
      char_count: number;
      content_hash: string;
    }>(
      `SELECT chapter_id, chapter_index, title, start_cp, end_cp, char_count, content_hash
         FROM imported_source_chapters WHERE source_id = ? ORDER BY chapter_index`,
      [sourceId],
    );
    return rows.map(row => ({
      chapterId: row.chapter_id,
      index: row.chapter_index,
      title: row.title,
      startOffset: row.start_cp,
      endOffset: row.end_cp,
      charCount: row.char_count,
      contentHash: row.content_hash,
    }));
  }

  async getChunks(sourceId: string): Promise<SourceChunk[]> {
    const rows = await this.db.queryAll<{
      chunk_id: string;
      chapter_id: string;
      chunk_index: number;
      start_cp: number;
      end_cp: number;
      char_count: number;
      content_hash: string;
    }>(
      `SELECT chunk_id, chapter_id, chunk_index, start_cp, end_cp, char_count, content_hash
         FROM imported_source_chunks WHERE source_id = ? ORDER BY chapter_id, chunk_index`,
      [sourceId],
    );
    return rows.map(row => ({
      chunkId: row.chunk_id,
      chapterId: row.chapter_id,
      chunkIndex: row.chunk_index,
      startOffset: row.start_cp,
      endOffset: row.end_cp,
      charCount: row.char_count,
      contentHash: row.content_hash,
    }));
  }

  async listStagingOlderThan(cutoffIso: string): Promise<SourceManifest[]> {
    const rows = await this.db.queryAll<ManifestRow>(
      `SELECT * FROM imported_sources WHERE status = 'staging' AND created_at < ?`,
      [cutoffIso],
    );
    return rows.map(rowToManifest);
  }

  async deleteSource(sourceId: string): Promise<boolean> {
    return this.db.transaction(async tx => {
      const row = await tx.queryOne<{ status: string }>(
        'SELECT status FROM imported_sources WHERE source_id = ?',
        [sourceId],
      );
      if (!row) return false;
      if (row.status === 'active') {
        throw new Error(`Refusing to delete active source ${sourceId}.`);
      }
      await tx.execute('DELETE FROM imported_source_segments WHERE source_id = ?', [sourceId]);
      await tx.execute('DELETE FROM imported_source_chapters WHERE source_id = ?', [sourceId]);
      await tx.execute('DELETE FROM imported_source_chunks WHERE source_id = ?', [sourceId]);
      await tx.execute('DELETE FROM imported_sources WHERE source_id = ?', [sourceId]);
      return true;
    });
  }
}
