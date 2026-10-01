import type {
  EntityType,
  FactStatus,
  ParsedTxtSource,
} from '../../domain/world/types';
import type { BookSection, ContentEntry, ProgressiveDeltaPackage, WorldPackageManifest } from '../../domain/content/types';
import type { SqliteDatabase, SqliteRow, SqliteTransaction } from '../../application/ports/sqlite';
import type {
  CommitChunkResultInput,
  CommitChunkResultOutcome,
  FactSourceSpan,
  StoredChapter,
  StoredChunk,
  StoredEntity,
  StoredEvent,
  StoredEventProposal,
  StoredFact,
  StoredRuleMapping,
  WorldJobRecord,
  WorldRecord,
  WorldStore,
  WorldCanonSnapshot,
} from '../../application/ports/worldStore';

interface WorldRow extends SqliteRow {
  world_id: string;
  title: string;
  source_sha256: string;
  source_bytes: number;
  normalize_version: string;
  chapter_split_version: string;
  build_status: string;
  created_at: string;
  updated_at: string;
}

/** Match the same reviewed payload even when JSON object keys change order. */
function reviewDetailKey(detailJson: string): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]));
    }
    return value;
  };
  try { return JSON.stringify(normalize(JSON.parse(detailJson))); } catch { return detailJson; }
}

interface ChapterRow extends SqliteRow {
  chapter_id: string;
  chapter_index: number;
  title: string;
  start_offset: number;
  end_offset: number;
  char_count: number;
  content_hash: string;
}

interface ChunkRow extends SqliteRow {
  chunk_id: string;
  chapter_id: string;
  chunk_index: number;
  start_offset: number;
  end_offset: number;
  char_count: number;
  content_hash: string;
  extraction_status: string;
}

interface EntityRow extends SqliteRow {
  entity_id: string;
  type: string;
  name: string;
  first_seen_chapter_id: string | null;
}

interface AliasRow extends SqliteRow {
  entity_id: string;
  alias: string;
  score: number;
}

interface FactRow extends SqliteRow {
  fact_id: string;
  subject_entity_id: string;
  predicate: string;
  value_json: string;
  value_key: string;
  status: string;
  confidence: number;
  valid_from: string | null;
  valid_to: string | null;
  reveal_at: string | null;
  scope: string;
}

const MULTI_VALUED_PREDICATES = new Set(['skill', 'relationship', 'owns_item']);

/**
 * The discriminant inside a fact value: multi-valued predicates (a character
 * has several skills, relationships, items) key their facts by the referenced
 * thing, so two facts about *different* skills coexist. Single-valued
 * predicates (home, faction, rank, ...) conflict on any value change.
 */
export function factValueKey(predicate: string, value: Record<string, unknown>): string {
  if (!MULTI_VALUED_PREDICATES.has(predicate)) return '';
  const item = value.skill ?? value.person ?? value.item;
  return typeof item === 'string' ? item : JSON.stringify(value);
}

interface FactSourceRow extends SqliteRow {
  fact_id: string;
  chapter_id: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  quote_sha256: string;
}

interface EventRow extends SqliteRow {
  event_id: string;
  title: string;
  summary: string;
  world_time_order: number | null;
  narrative_chapter_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: string;
}

interface DependencyRow extends SqliteRow {
  event_id: string;
  depends_on_event_id: string;
}

interface MappingRow extends SqliteRow {
  mapping_id: string;
  target_entity_id: string;
  mapping_kind: string;
  mapping_json: string;
  evidence_refs_json: string;
  ruleset_version: string;
  status: string;
}

interface JobRow extends SqliteRow {
  job_id: string;
  kind: string;
  target_id: string | null;
  status: string;
  attempts: number;
  content_hash: string | null;
  extractor_version: string | null;
  model_fingerprint: string | null;
  usage_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface EventProposalRow extends SqliteRow {
  chunk_id: string;
  event_id: string;
  title: string;
  summary: string;
  world_time_order: number | null;
  narrative_chapter_id: string | null;
  depends_on_event_keys_json: string;
  status: string;
}

function requireString(row: SqliteRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Expected string column ${key}.`);
  return value;
}

function requireNumber(row: SqliteRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected numeric column ${key}.`);
  }
  return value;
}

function optionalString(row: SqliteRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function optionalNumber(row: SqliteRow, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class SqliteWorldStore implements WorldStore {
  constructor(private readonly db: SqliteDatabase) {}

  async createWorld(record: WorldRecord): Promise<void> {
    // INSERT OR REPLACE would DELETE the existing row and cascade-wipe every
    // child table (jobs, chunks, facts), breaking resume; upsert instead.
    await this.db.execute(
      `INSERT INTO worlds
        (world_id, title, source_sha256, legacy_source_sha256, source_bytes, normalize_version,
         chapter_split_version, build_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id) DO UPDATE SET
         title = excluded.title,
         source_sha256 = excluded.source_sha256,
         legacy_source_sha256 = COALESCE(worlds.legacy_source_sha256, excluded.legacy_source_sha256),
         normalize_version = excluded.normalize_version,
         chapter_split_version = excluded.chapter_split_version,
         build_status = excluded.build_status,
         updated_at = excluded.updated_at`,
      [
        record.worldId,
        record.title,
        record.sourceSha256,
        record.legacySourceSha256 ?? null,
        record.sourceBytes,
        record.normalizeVersion,
        record.chapterSplitVersion,
        record.buildStatus,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async getWorld(worldId: string): Promise<WorldRecord | null> {
    const row = await this.db.queryOne<WorldRow>(
      'SELECT * FROM worlds WHERE world_id = ?',
      [worldId],
    );
    if (!row) return null;
    return {
      worldId: row.world_id,
      title: row.title,
      sourceSha256: row.source_sha256,
      sourceBytes: row.source_bytes,
      normalizeVersion: row.normalize_version,
      chapterSplitVersion: row.chapter_split_version,
      buildStatus: row.build_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async setWorldStatus(worldId: string, status: string, updatedAt: string): Promise<void> {
    await this.db.execute(
      'UPDATE worlds SET build_status = ?, updated_at = ? WHERE world_id = ?',
      [status, updatedAt, worldId],
    );
  }

  /** Bookshelf listing: every imported world, newest update first. */
  async listWorlds(): Promise<WorldRecord[]> {
    const rows = await this.db.queryAll<WorldRow>('SELECT * FROM worlds ORDER BY updated_at DESC');
    return rows.map(row => ({
      worldId: row.world_id,
      title: row.title,
      sourceSha256: row.source_sha256,
      legacySourceSha256: optionalString(row, 'legacy_source_sha256'),
      sourceBytes: row.source_bytes,
      normalizeVersion: row.normalize_version,
      chapterSplitVersion: row.chapter_split_version,
      buildStatus: row.build_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async saveImportedSource(worldId: string, parsed: ParsedTxtSource, createdAt: string): Promise<void> {
    await this.db.transaction(async tx => {
      for (const chapter of parsed.chapters) {
        await tx.execute(
          `INSERT INTO source_chapters
            (world_id, chapter_id, chapter_index, title, start_offset, end_offset,
             char_count, content_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(world_id, chapter_id) DO UPDATE SET
             chapter_index = excluded.chapter_index,
             title = excluded.title,
             start_offset = excluded.start_offset,
             end_offset = excluded.end_offset,
             char_count = excluded.char_count,
             content_hash = excluded.content_hash`,
          [
            worldId,
            chapter.chapterId,
            chapter.index,
            chapter.title,
            chapter.startOffset,
            chapter.endOffset,
            chapter.charCount,
            chapter.contentHash,
            createdAt,
          ],
        );
      }
      for (const chunk of parsed.chunks) {
        // Closeout C1: rows written by the pre-fix mobile hash adapter stored
        // the whole-file digest for every chunk. Re-importing the same novel
        // with correct per-chunk digests must REPLACE that residue and reset
        // the extraction status, so "done" markers recorded against the wrong
        // hash are never trusted again. Rows whose hash did not change keep
        // their status (idempotent resume for correct imports).
        await tx.execute(
          `INSERT INTO source_chunks
            (world_id, chunk_id, chapter_id, chunk_index, start_offset, end_offset,
             char_count, content_hash, extraction_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
           ON CONFLICT(world_id, chunk_id) DO UPDATE SET
             chapter_id = excluded.chapter_id,
             chunk_index = excluded.chunk_index,
             start_offset = excluded.start_offset,
             end_offset = excluded.end_offset,
             char_count = excluded.char_count,
             content_hash = excluded.content_hash,
             extraction_status = CASE
               WHEN source_chunks.content_hash IS NOT excluded.content_hash THEN 'pending'
               ELSE source_chunks.extraction_status
             END`,
          [
            worldId,
            chunk.chunkId,
            chunk.chapterId,
            chunk.chunkIndex,
            chunk.startOffset,
            chunk.endOffset,
            chunk.charCount,
            chunk.contentHash,
            createdAt,
          ],
        );
      }
    });
  }

  async getChapters(worldId: string): Promise<StoredChapter[]> {
    const rows = await this.db.queryAll<ChapterRow>(
      `SELECT chapter_id, chapter_index, title, start_offset, end_offset, char_count, content_hash
         FROM source_chapters WHERE world_id = ? ORDER BY chapter_index`,
      [worldId],
    );
    return rows.map(row => ({
      worldId,
      chapterId: row.chapter_id,
      index: row.chapter_index,
      title: row.title,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      charCount: row.char_count,
      contentHash: row.content_hash,
    }));
  }

  async getChunks(worldId: string): Promise<StoredChunk[]> {
    const rows = await this.db.queryAll<ChunkRow>(
      `SELECT chunk_id, chapter_id, chunk_index, start_offset, end_offset, char_count,
              content_hash, extraction_status
         FROM source_chunks WHERE world_id = ? ORDER BY chapter_id, chunk_index`,
      [worldId],
    );
    return rows.map(row => this.chunkFromRow(worldId, row));
  }

  async getChunksByStatus(worldId: string, status: StoredChunk['extractionStatus']): Promise<StoredChunk[]> {
    const rows = await this.db.queryAll<ChunkRow>(
      `SELECT chunk_id, chapter_id, chunk_index, start_offset, end_offset, char_count,
              content_hash, extraction_status
         FROM source_chunks WHERE world_id = ? AND extraction_status = ?
        ORDER BY chapter_id, chunk_index`,
      [worldId, status],
    );
    return rows.map(row => this.chunkFromRow(worldId, row));
  }

  async setChunkExtractionStatus(worldId: string, chunkId: string, status: StoredChunk['extractionStatus']): Promise<void> {
    await this.db.execute(
      'UPDATE source_chunks SET extraction_status = ? WHERE world_id = ? AND chunk_id = ?',
      [status, worldId, chunkId],
    );
  }

  private chunkFromRow(worldId: string, row: ChunkRow): StoredChunk {
    const status = row.extraction_status;
    if (status !== 'pending' && status !== 'extracted' && status !== 'failed') {
      throw new Error(`Invalid chunk extraction status: ${status}.`);
    }
    return {
      worldId,
      chunkId: row.chunk_id,
      chapterId: row.chapter_id,
      chunkIndex: row.chunk_index,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      charCount: row.char_count,
      contentHash: row.content_hash,
      extractionStatus: status,
    };
  }

  async upsertEntity(entity: StoredEntity, createdAt: string): Promise<void> {
    await this.db.transaction(async tx => this.upsertEntityTx(tx, entity, createdAt));
  }

  private async upsertEntityTx(tx: SqliteTransaction, entity: StoredEntity, createdAt: string): Promise<void> {
    const existing = await tx.queryOne<EntityRow>(
      'SELECT entity_id, type, name, first_seen_chapter_id FROM entities WHERE world_id = ? AND entity_id = ?',
      [entity.worldId, entity.entityId],
    );
    if (existing) {
      await tx.execute(
        'UPDATE entities SET type = ?, name = ?, first_seen_chapter_id = COALESCE(first_seen_chapter_id, ?) WHERE world_id = ? AND entity_id = ?',
        [entity.type, entity.name, entity.firstSeenChapterId, entity.worldId, entity.entityId],
      );
    } else {
      await tx.execute(
        `INSERT INTO entities (world_id, entity_id, type, name, first_seen_chapter_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entity.worldId, entity.entityId, entity.type, entity.name, entity.firstSeenChapterId, createdAt],
      );
    }
    for (const alias of entity.aliases) {
      await tx.execute(
        `INSERT OR IGNORE INTO entity_aliases (world_id, alias_id, entity_id, alias, score, evidence_json, created_at)
         VALUES (?, ?, ?, ?, 1.0, '[]', ?)`,
        [entity.worldId, `al-${entity.entityId}-${alias}`, entity.entityId, alias, createdAt],
      );
    }
  }

  async getEntity(worldId: string, entityId: string): Promise<StoredEntity | null> {
    const row = await this.db.queryOne<EntityRow>(
      'SELECT entity_id, type, name, first_seen_chapter_id FROM entities WHERE world_id = ? AND entity_id = ?',
      [worldId, entityId],
    );
    if (!row) return null;
    const aliases = await this.db.queryAll<AliasRow>(
      'SELECT entity_id, alias, score FROM entity_aliases WHERE world_id = ? AND entity_id = ?',
      [worldId, entityId],
    );
    return {
      worldId,
      entityId: row.entity_id,
      type: row.type as EntityType,
      name: row.name,
      firstSeenChapterId: optionalString(row, 'first_seen_chapter_id'),
      aliases: aliases.map(a => a.alias),
    };
  }

  async listEntities(worldId: string): Promise<StoredEntity[]> {
    const rows = await this.db.queryAll<EntityRow>(
      'SELECT entity_id, type, name, first_seen_chapter_id FROM entities WHERE world_id = ? ORDER BY entity_id',
      [worldId],
    );
    const aliases = await this.db.queryAll<AliasRow>(
      'SELECT entity_id, alias, score FROM entity_aliases WHERE world_id = ?',
      [worldId],
    );
    const byEntity = new Map<string, string[]>();
    for (const alias of aliases) {
      const list = byEntity.get(alias.entity_id) ?? [];
      list.push(alias.alias);
      byEntity.set(alias.entity_id, list);
    }
    return rows.map(row => ({
      worldId,
      entityId: row.entity_id,
      type: row.type as EntityType,
      name: row.name,
      firstSeenChapterId: optionalString(row, 'first_seen_chapter_id'),
      aliases: byEntity.get(row.entity_id) ?? [],
    }));
  }

  async addEntityAlias(worldId: string, entityId: string, alias: string, score: number, evidenceJson: string, createdAt: string): Promise<void> {
    await this.db.execute(
      `INSERT OR IGNORE INTO entity_aliases (world_id, alias_id, entity_id, alias, score, evidence_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [worldId, `al-${entityId}-${alias}`, entityId, alias, score, evidenceJson, createdAt],
    );
  }

  async saveFact(fact: StoredFact, createdAt: string): Promise<'inserted' | 'duplicate' | 'conflict'> {
    return this.db.transaction(async tx => this.saveFactTx(tx, fact, createdAt));
  }

  /** Dedupe rules shared by single-fact saves and atomic chunk commits. */
  private async saveFactTx(
    tx: SqliteTransaction,
    fact: StoredFact,
    createdAt: string,
  ): Promise<'inserted' | 'duplicate' | 'conflict'> {
    const valueKey = factValueKey(fact.predicate, fact.value);
    const existingRows = await tx.queryAll<FactRow>(
      `SELECT fact_id, value_json, value_key, status FROM canon_facts
        WHERE world_id = ? AND subject_entity_id = ? AND predicate = ?`,
      [fact.worldId, fact.subjectEntityId, fact.predicate],
    );
    for (const existing of existingRows) {
      if (existing.value_json === JSON.stringify(fact.value)) {
        return 'duplicate';
      }
      if (existing.value_key === valueKey && fact.status === 'explicit') {
        // A conflicting explicit fact keeps BOTH rows, but replays (another
        // run over the same world) must not collide on the deterministic
        // base factId - suffix until unique.
        let conflictId = fact.factId;
        let suffix = 1;
        while (await tx.queryOne(
          'SELECT 1 FROM canon_facts WHERE world_id = ? AND fact_id = ?',
          [fact.worldId, conflictId],
        )) {
          conflictId = `${fact.factId}-c${suffix}`;
          suffix += 1;
          if (suffix > 100) break;
        }
        await this.insertFact(tx, { ...fact, factId: conflictId, status: 'conflict' }, createdAt);
        return 'conflict';
      }
    }
    await this.insertFact(tx, fact, createdAt);
    return 'inserted';
  }

  private async insertFact(tx: Pick<SqliteTransaction, 'execute'>, fact: StoredFact, createdAt: string): Promise<void> {
    await tx.execute(
      `INSERT INTO canon_facts
        (world_id, fact_id, subject_entity_id, predicate, value_json, value_key, status, confidence,
         valid_from, valid_to, reveal_at, scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fact.worldId,
        fact.factId,
        fact.subjectEntityId,
        fact.predicate,
        JSON.stringify(fact.value),
        factValueKey(fact.predicate, fact.value),
        fact.status,
        fact.confidence,
        fact.validFrom,
        fact.validTo,
        fact.revealAt,
        fact.scope,
        createdAt,
      ],
    );
    for (let i = 0; i < fact.sources.length; i += 1) {
      const source: FactSourceSpan | undefined = fact.sources[i];
      if (!source) continue;
      await tx.execute(
        `INSERT INTO fact_sources
          (world_id, fact_id, source_index, chapter_id, start_offset, end_offset, quote, quote_sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fact.worldId,
          fact.factId,
          i,
          source.chapterId,
          source.startOffset,
          source.endOffset,
          source.quote,
          source.quoteSha256,
          createdAt,
        ],
      );
    }
  }

  async getFactsBySubject(worldId: string, subjectEntityId: string): Promise<StoredFact[]> {
    const rows = await this.db.queryAll<FactRow>(
      `SELECT fact_id, subject_entity_id, predicate, value_json, status, confidence,
              valid_from, valid_to, reveal_at, scope
         FROM canon_facts WHERE world_id = ? AND subject_entity_id = ?
        ORDER BY fact_id`,
      [worldId, subjectEntityId],
    );
    return this.factsFromRows(worldId, rows);
  }

  async listFacts(worldId: string): Promise<StoredFact[]> {
    const rows = await this.db.queryAll<FactRow>(
      `SELECT fact_id, subject_entity_id, predicate, value_json, status, confidence,
              valid_from, valid_to, reveal_at, scope
         FROM canon_facts WHERE world_id = ? ORDER BY fact_id`,
      [worldId],
    );
    return this.factsFromRows(worldId, rows);
  }

  private async factsFromRows(worldId: string, rows: readonly FactRow[]): Promise<StoredFact[]> {
    if (rows.length === 0) return [];
    const sources = await this.db.queryAll<FactSourceRow>(
      `SELECT fact_id, chapter_id, start_offset, end_offset, quote, quote_sha256
         FROM fact_sources WHERE world_id = ? ORDER BY fact_id, source_index`,
      [worldId],
    );
    const byFact = new Map<string, FactSourceSpan[]>();
    for (const row of sources) {
      const list = byFact.get(row.fact_id) ?? [];
      list.push({
        chapterId: row.chapter_id,
        startOffset: row.start_offset,
        endOffset: row.end_offset,
        quote: row.quote,
        quoteSha256: row.quote_sha256,
      });
      byFact.set(row.fact_id, list);
    }
    return rows.map(row => ({
      worldId,
      factId: row.fact_id,
      subjectEntityId: row.subject_entity_id,
      predicate: row.predicate,
      value: JSON.parse(row.value_json) as Record<string, unknown>,
      status: row.status as FactStatus,
      confidence: row.confidence,
      validFrom: optionalString(row, 'valid_from'),
      validTo: optionalString(row, 'valid_to'),
      revealAt: optionalString(row, 'reveal_at'),
      scope: requireString(row, 'scope'),
      sources: byFact.get(row.fact_id) ?? [],
    }));
  }

  async saveEvent(event: StoredEvent, createdAt: string): Promise<void> {
    await this.db.transaction(async tx => {
      const existing = await tx.queryOne<EventRow>(
        'SELECT event_id FROM canon_events WHERE world_id = ? AND event_id = ?',
        [event.worldId, event.eventId],
      );
      if (existing) {
        await tx.execute(
          `UPDATE canon_events SET title = ?, summary = ?, world_time_order = ?,
             narrative_chapter_id = ?, valid_from = ?, valid_to = ?, status = ?
           WHERE world_id = ? AND event_id = ?`,
          [
            event.title,
            event.summary,
            event.worldTimeOrder,
            event.narrativeChapterId,
            event.validFrom,
            event.validTo,
            event.status,
            event.worldId,
            event.eventId,
          ],
        );
      } else {
        await tx.execute(
          `INSERT INTO canon_events
            (world_id, event_id, title, summary, world_time_order, narrative_chapter_id,
             valid_from, valid_to, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            event.worldId,
            event.eventId,
            event.title,
            event.summary,
            event.worldTimeOrder,
            event.narrativeChapterId,
            event.validFrom,
            event.validTo,
            event.status,
            createdAt,
          ],
        );
      }
      for (const dependency of event.dependsOnEventIds) {
        // Forward references are legal in proposal order (a real novel's
        // timeline cites later events); the FK requires the dependency row
        // to exist first. Guard the insert instead of failing the whole
        // event commit - a missing dependency is simply not recorded yet
        // and the resolver's floor semantics (drop unknown deps) apply.
        const exists = await tx.queryOne<{ n: number }>(
          'SELECT COUNT(*) AS n FROM canon_events WHERE world_id = ? AND event_id = ?',
          [event.worldId, dependency],
        );
        if (exists && Number(exists.n) > 0) {
          await tx.execute(
            `INSERT OR IGNORE INTO event_dependencies (world_id, event_id, depends_on_event_id, created_at)
             VALUES (?, ?, ?, ?)`,
            [event.worldId, event.eventId, dependency, createdAt],
          );
        }
      }
    });
  }

  async listEvents(worldId: string, branchId?: string): Promise<StoredEvent[]> {
    const rows = await this.db.queryAll<EventRow>(
      `SELECT event_id, title, summary, world_time_order, narrative_chapter_id,
              valid_from, valid_to, status
         FROM canon_events WHERE world_id = ? ORDER BY COALESCE(world_time_order, 999999)`,
      [worldId],
    );
    const dependencies = await this.db.queryAll<DependencyRow>(
      'SELECT event_id, depends_on_event_id FROM event_dependencies WHERE world_id = ?',
      [worldId],
    );
    const byEvent = new Map<string, string[]>();
    for (const row of dependencies) {
      const list = byEvent.get(row.event_id) ?? [];
      list.push(row.depends_on_event_id);
      byEvent.set(row.event_id, list);
    }
    // Branch divergence overlay: statuses for THIS branch sit on top of the
    // shared canon; the shared canon_events rows are never rewritten.
    const overrides = branchId
      ? await this.db.queryAll<{ event_id: string; status: string }>(
        'SELECT event_id, status FROM branch_canon_overrides WHERE world_id = ? AND branch_id = ?',
        [worldId, branchId],
      )
      : [];
    const overrideByEvent = new Map(overrides.map(row => [row.event_id, row.status as StoredEvent['status']]));
    return rows.map(row => ({
      worldId,
      eventId: row.event_id,
      title: row.title,
      summary: row.summary,
      worldTimeOrder: optionalNumber(row, 'world_time_order'),
      narrativeChapterId: optionalString(row, 'narrative_chapter_id'),
      validFrom: optionalString(row, 'valid_from'),
      validTo: optionalString(row, 'valid_to'),
      status: overrideByEvent.get(row.event_id) ?? (row.status as StoredEvent['status']),
      dependsOnEventIds: byEvent.get(row.event_id) ?? [],
    }));
  }

  /**
   * Marks canonical events after the anchor as pending FOR ONE BRANCH via the
   * branch_canon_overrides overlay. The shared canon_events.status is left
   * untouched, so a second campaign of the same novel never sees this
   * branch's divergence.
   */
  async markEventsPendingAfter(worldId: string, anchorEventId: string, branchId: string): Promise<number> {
    return this.db.transaction(async tx => {
      const anchor = await tx.queryOne<EventRow>(
        'SELECT world_time_order FROM canon_events WHERE world_id = ? AND event_id = ?',
        [worldId, anchorEventId],
      );
      if (!anchor) throw new Error(`Unknown anchor event: ${anchorEventId}.`);
      const anchorOrder = optionalNumber(anchor, 'world_time_order');
      if (anchorOrder === null) {
        throw new Error('Anchor event has no world_time_order; cannot mark divergence.');
      }
      const affected = await tx.queryAll<EventRow>(
        `SELECT event_id FROM canon_events
          WHERE world_id = ? AND status = 'canon'
            AND world_time_order IS NOT NULL AND world_time_order > ?`,
        [worldId, anchorOrder],
      );
      const createdAt = new Date().toISOString();
      for (const row of affected) {
        await tx.execute(
          `INSERT INTO branch_canon_overrides (world_id, branch_id, event_id, status, reason, created_at)
           VALUES (?, ?, ?, 'pending', 'divergence_after_anchor', ?)
           ON CONFLICT(world_id, branch_id, event_id) DO NOTHING`,
          [worldId, branchId, row.event_id, createdAt],
        );
      }
      return affected.length;
    });
  }

  async saveRuleMapping(mapping: StoredRuleMapping, createdAt: string): Promise<void> {
    await this.db.transaction(async tx => this.saveRuleMappingTx(tx, mapping, createdAt));
  }

  private async saveRuleMappingTx(tx: SqliteTransaction, mapping: StoredRuleMapping, createdAt: string): Promise<void> {
    await tx.execute(
      `INSERT INTO world_rule_mappings
        (world_id, mapping_id, target_entity_id, mapping_kind, mapping_json,
         evidence_refs_json, ruleset_version, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id, mapping_id) DO UPDATE SET
         mapping_kind = excluded.mapping_kind,
         mapping_json = excluded.mapping_json,
         evidence_refs_json = excluded.evidence_refs_json,
         ruleset_version = excluded.ruleset_version,
         status = excluded.status`,
      [
        mapping.worldId,
        mapping.mappingId,
        mapping.targetEntityId,
        mapping.mappingKind,
        JSON.stringify(mapping.mapping),
        JSON.stringify(mapping.evidenceRefs),
        mapping.rulesetVersion,
        mapping.status,
        createdAt,
      ],
    );
  }

  async listRuleMappings(worldId: string): Promise<StoredRuleMapping[]> {
    const rows = await this.db.queryAll<MappingRow>(
      `SELECT mapping_id, target_entity_id, mapping_kind, mapping_json,
              evidence_refs_json, ruleset_version, status
         FROM world_rule_mappings WHERE world_id = ? ORDER BY mapping_id`,
      [worldId],
    );
    return rows.map(row => ({
      worldId,
      mappingId: row.mapping_id,
      targetEntityId: row.target_entity_id,
      mappingKind: row.mapping_kind as StoredRuleMapping['mappingKind'],
      mapping: JSON.parse(row.mapping_json) as Record<string, unknown>,
      evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
      rulesetVersion: row.ruleset_version,
      status: row.status as StoredRuleMapping['status'],
    }));
  }

  async recordKnowledge(record: {
    worldId: string;
    knowledgeId: string;
    branchId: string | null;
    actorId: string;
    factId: string | null;
    eventId: string | null;
    knownVia: 'witnessed' | 'told' | 'public' | 'inferred';
    knownAt: string | null;
    sourceJson: string;
    createdAt: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT OR IGNORE INTO knowledge_records
        (world_id, knowledge_id, branch_id, actor_id, fact_id, event_id, known_via, known_at, source_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.worldId,
        record.knowledgeId,
        record.branchId,
        record.actorId,
        record.factId,
        record.eventId,
        record.knownVia,
        record.knownAt,
        record.sourceJson,
        record.createdAt,
      ],
    );
  }

  async upsertJob(job: WorldJobRecord, updatedAt: string): Promise<void> {
    await this.db.transaction(async tx => this.upsertJobTx(tx, job, updatedAt));
  }

  private async upsertJobTx(tx: SqliteTransaction, job: WorldJobRecord, updatedAt: string): Promise<void> {
    await tx.execute(
      `INSERT INTO world_jobs
        (world_id, job_id, kind, target_id, status, attempts, content_hash,
         extractor_version, model_fingerprint, usage_json, result_json, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id, job_id) DO UPDATE SET
         status = excluded.status,
         attempts = excluded.attempts,
         content_hash = excluded.content_hash,
         extractor_version = excluded.extractor_version,
         model_fingerprint = excluded.model_fingerprint,
         usage_json = excluded.usage_json,
         result_json = excluded.result_json,
         error = excluded.error,
         updated_at = excluded.updated_at`,
      [
        job.worldId,
        job.jobId,
        job.kind,
        job.targetId,
        job.status,
        job.attempts,
        job.contentHash,
        job.extractorVersion,
        job.modelFingerprint,
        job.usageJson,
        job.resultJson,
        job.error,
        job.createdAt,
        updatedAt,
      ],
    );
  }

  async getJob(worldId: string, jobId: string): Promise<WorldJobRecord | null> {
    const row = await this.db.queryOne<JobRow>(
      'SELECT * FROM world_jobs WHERE world_id = ? AND job_id = ?',
      [worldId, jobId],
    );
    if (!row) return null;
    return this.jobFromRow(row);
  }

  async findReusableJob(
    worldId: string,
    kind: WorldJobRecord['kind'],
    contentHash: string,
    extractorVersion: string,
    modelFingerprint?: string | null,
  ): Promise<WorldJobRecord | null> {
    // Cache fingerprint (closeout C1): a done job is reusable only when the
    // content AND the extraction configuration match. Jobs recorded under a
    // different model/prompt fingerprint - including rows polluted by the
    // whole-file-hash bug - must not be reused.
    const row = await this.db.queryOne<JobRow>(
      `SELECT * FROM world_jobs
        WHERE world_id = ? AND kind = ? AND content_hash = ? AND extractor_version = ?
          AND status = 'done'
          ${modelFingerprint !== undefined && modelFingerprint !== null ? 'AND model_fingerprint = ?' : ''}
        ORDER BY updated_at DESC LIMIT 1`,
      modelFingerprint !== undefined && modelFingerprint !== null
        ? [worldId, kind, contentHash, extractorVersion, modelFingerprint]
        : [worldId, kind, contentHash, extractorVersion],
    );
    return row ? this.jobFromRow(row) : null;
  }

  async commitChunkResult(input: CommitChunkResultInput): Promise<CommitChunkResultOutcome> {
    const factOutcomes: Array<'inserted' | 'duplicate' | 'conflict'> = [];
    await this.db.transaction(async tx => {
      for (const entity of input.entities) {
        await this.upsertEntityTx(tx, entity, input.createdAt);
      }
      for (const fact of input.facts) {
        factOutcomes.push(await this.saveFactTx(tx, fact, input.createdAt));
      }
      for (const proposal of input.eventProposals) {
        await tx.execute(
          `INSERT INTO world_event_proposals
            (world_id, chunk_id, event_id, title, summary, world_time_order,
             narrative_chapter_id, depends_on_event_keys_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
           ON CONFLICT(world_id, chunk_id, event_id) DO UPDATE SET
             title = excluded.title,
             summary = excluded.summary,
             world_time_order = excluded.world_time_order,
             narrative_chapter_id = excluded.narrative_chapter_id,
             depends_on_event_keys_json = excluded.depends_on_event_keys_json,
             status = 'proposed',
             updated_at = excluded.updated_at`,
          [
            input.worldId,
            input.chunkId,
            proposal.eventId,
            proposal.title,
            proposal.summary,
            proposal.worldTimeOrder,
            proposal.narrativeChapterId,
            JSON.stringify(proposal.dependsOnEventKeys),
            input.createdAt,
            input.updatedAt,
          ],
        );
      }
      // 1M plan P4: rule mappings land in the SAME single transaction; the
      // stable mappingId makes replayed/duplicate commits idempotent.
      for (const mapping of input.ruleMappings ?? []) {
        await this.saveRuleMappingTx(tx, mapping, input.createdAt);
      }
      await tx.execute(
        `UPDATE source_chunks SET extraction_status = 'extracted' WHERE world_id = ? AND chunk_id = ?`,
        [input.worldId, input.chunkId],
      );
      await this.upsertJobTx(tx, input.job, input.updatedAt);
    });
    return { factOutcomes };
  }

  async listEventProposals(worldId: string): Promise<StoredEventProposal[]> {
    const rows = await this.db.queryAll<EventProposalRow>(
      `SELECT chunk_id, event_id, title, summary, world_time_order, narrative_chapter_id,
              depends_on_event_keys_json, status
         FROM world_event_proposals WHERE world_id = ? AND status = 'proposed'
        ORDER BY chunk_id, event_id`,
      [worldId],
    );
    return rows.map(row => ({
      worldId,
      chunkId: row.chunk_id,
      eventId: row.event_id,
      title: row.title,
      summary: row.summary,
      worldTimeOrder: row.world_time_order,
      narrativeChapterId: row.narrative_chapter_id,
      dependsOnEventKeys: JSON.parse(row.depends_on_event_keys_json) as string[],
      status: 'proposed',
    }));
  }

  async markEventProposalsResolved(worldId: string, eventIds: readonly string[], updatedAt: string): Promise<void> {
    if (eventIds.length === 0) return;
    await this.db.transaction(async tx => {
      for (const eventId of eventIds) {
        await tx.execute(
          `UPDATE world_event_proposals SET status = 'resolved', updated_at = ?
             WHERE world_id = ? AND event_id = ? AND status = 'proposed'`,
          [updatedAt, worldId, eventId],
        );
      }
    });
  }

  private jobFromRow(row: JobRow): WorldJobRecord {
    const status = row.status;
    if (status !== 'pending' && status !== 'running' && status !== 'done' && status !== 'failed') {
      throw new Error(`Invalid job status: ${status}.`);
    }
    const kind = row.kind;
    if (
      kind !== 'import' && kind !== 'extract_chunk' &&
      kind !== 'merge_entities' && kind !== 'timeline' && kind !== 'rule_mapping'
    ) {
      throw new Error(`Invalid job kind: ${kind}.`);
    }
    return {
      worldId: requireString(row, 'world_id'),
      jobId: row.job_id,
      kind,
      targetId: optionalString(row, 'target_id'),
      status,
      attempts: requireNumber(row, 'attempts'),
      contentHash: optionalString(row, 'content_hash'),
      extractorVersion: optionalString(row, 'extractor_version'),
      modelFingerprint: optionalString(row, 'model_fingerprint'),
      usageJson: optionalString(row, 'usage_json'),
      resultJson: optionalString(row, 'result_json'),
      error: optionalString(row, 'error'),
      createdAt: requireString(row, 'created_at'),
      updatedAt: requireString(row, 'updated_at'),
    };
  }

  // ---- world packages (Phase 2 three-book source of truth) ---------------

  async saveWorldPackage(input: {
    manifest: WorldPackageManifest;
    entries: readonly ContentEntry[];
    sections: readonly BookSection[];
    validationJson: string;
    createdAt: string;
  }): Promise<void> {
    await this.db.transaction(async tx => {
      const existing = await tx.queryOne<SqliteRow>(
        'SELECT status FROM world_packages WHERE world_id = ? AND revision = ?',
        [input.manifest.worldId, input.manifest.revision],
      );
      if (existing) {
        throw new Error(
          `World package revision already exists: ${input.manifest.worldId} r${input.manifest.revision}; ` +
            'published revisions are immutable - create a new revision instead.',
        );
      }
      await tx.execute(
        `INSERT INTO world_packages
          (world_id, revision, schema_version, source_sha256, ruleset_id, ruleset_version,
           mapping_version, status, content_hash, validation_json, build_scope_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.manifest.worldId,
          input.manifest.revision,
          input.manifest.schemaVersion,
          input.manifest.sourceSha256,
          input.manifest.ruleset.id,
          input.manifest.ruleset.version,
          input.manifest.mappingVersion,
          input.manifest.status,
          input.manifest.contentHash,
          input.validationJson,
          JSON.stringify(input.manifest.buildScope ?? {}),
          input.createdAt,
        ],
      );
      for (const entry of input.entries) {
        await tx.execute(
          `INSERT INTO package_entries
            (world_id, revision, entry_id, kind, definition_json, provenance_json,
             field_provenance_json, visibility, dependency_ids_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.manifest.worldId,
            input.manifest.revision,
            entry.entryId,
            entry.kind,
            JSON.stringify(entry.definition),
            JSON.stringify(entry.provenance),
            JSON.stringify(entry.fieldProvenance),
            entry.visibility,
            JSON.stringify(entry.dependencyIds),
            input.createdAt,
          ],
        );
      }
      for (const section of input.sections) {
        await tx.execute(
          `INSERT INTO book_sections
            (world_id, revision, book, section_key, title, entry_ids_json, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.manifest.worldId,
            input.manifest.revision,
            section.book,
            section.sectionKey,
            section.title,
            JSON.stringify(section.entryIds),
            section.position,
          ],
        );
      }
    });
  }

  /** Imports a remapped published package and its world row in one transaction. */
  async saveImportedWorldPackage(input: {
    world: WorldRecord;
    manifest: WorldPackageManifest;
    entries: readonly ContentEntry[];
    sections: readonly BookSection[];
    validationJson: string;
    createdAt: string;
    canon?: WorldCanonSnapshot;
  }): Promise<void> {
    await this.db.transaction(async tx => {
      const existing = await tx.queryOne<SqliteRow>('SELECT world_id FROM worlds WHERE world_id = ?', [input.world.worldId]);
      if (existing) throw new Error(`World id already exists: ${input.world.worldId}.`);
      await tx.execute(
        `INSERT INTO worlds
          (world_id, title, source_sha256, legacy_source_sha256, source_bytes, normalize_version,
           chapter_split_version, build_status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [input.world.worldId, input.world.title, input.world.sourceSha256, input.world.sourceBytes,
          input.world.normalizeVersion, input.world.chapterSplitVersion, input.world.buildStatus,
          input.world.createdAt, input.world.updatedAt],
      );
      if (input.canon) await this.saveImportedCanonTx(tx, input.world.worldId, input.canon, input.createdAt);
      await tx.execute(
        `INSERT INTO world_packages
          (world_id, revision, schema_version, source_sha256, ruleset_id, ruleset_version,
           mapping_version, status, content_hash, validation_json, build_scope_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.manifest.worldId, input.manifest.revision, input.manifest.schemaVersion, input.manifest.sourceSha256,
          input.manifest.ruleset.id, input.manifest.ruleset.version, input.manifest.mappingVersion,
          input.manifest.status, input.manifest.contentHash, input.validationJson,
          JSON.stringify(input.manifest.buildScope ?? {}), input.createdAt],
      );
      for (const entry of input.entries) {
        await tx.execute(
          `INSERT INTO package_entries
            (world_id, revision, entry_id, kind, definition_json, provenance_json,
             field_provenance_json, visibility, dependency_ids_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [input.manifest.worldId, input.manifest.revision, entry.entryId, entry.kind,
            JSON.stringify(entry.definition), JSON.stringify(entry.provenance), JSON.stringify(entry.fieldProvenance),
            entry.visibility, JSON.stringify(entry.dependencyIds), input.createdAt],
        );
      }
      for (const section of input.sections) {
        await tx.execute(
          `INSERT INTO book_sections
            (world_id, revision, book, section_key, title, entry_ids_json, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [input.manifest.worldId, input.manifest.revision, section.book, section.sectionKey,
            section.title, JSON.stringify(section.entryIds), section.position],
        );
      }
    });
  }

  private async saveImportedCanonTx(
    tx: SqliteTransaction, worldId: string, canon: WorldCanonSnapshot, createdAt: string,
  ): Promise<void> {
    for (const chapter of canon.chapters) {
      await tx.execute(
        `INSERT INTO source_chapters
          (world_id, chapter_id, chapter_index, title, start_offset, end_offset, char_count, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [worldId, chapter.chapterId, chapter.index, chapter.title, chapter.startOffset, chapter.endOffset,
          chapter.charCount, chapter.contentHash, createdAt],
      );
    }
    for (const entity of canon.entities) await this.upsertEntityTx(tx, { ...entity, worldId }, createdAt);
    for (const fact of canon.facts) await this.saveFactTx(tx, { ...fact, worldId }, createdAt);
    // Insert every event before its edges, including forward dependencies.
    for (const event of canon.events) {
      await tx.execute(
        `INSERT INTO canon_events
          (world_id, event_id, title, summary, world_time_order, narrative_chapter_id, valid_from, valid_to, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [worldId, event.eventId, event.title, event.summary, event.worldTimeOrder, event.narrativeChapterId,
          event.validFrom, event.validTo, event.status, createdAt],
      );
    }
    for (const event of canon.events) {
      for (const dependency of event.dependsOnEventIds) {
        await tx.execute(
          'INSERT INTO event_dependencies (world_id, event_id, depends_on_event_id, created_at) VALUES (?, ?, ?, ?)',
          [worldId, event.eventId, dependency, createdAt],
        );
      }
    }
    for (const mapping of canon.ruleMappings) await this.saveRuleMappingTx(tx, { ...mapping, worldId }, createdAt);
  }

  async getWorldPackage(
    worldId: string,
    revision: number,
  ): Promise<{ manifest: WorldPackageManifest; entries: ContentEntry[]; sections: BookSection[] } | null> {
    const row = await this.db.queryOne<SqliteRow>(
      `SELECT revision, schema_version, source_sha256, ruleset_id, ruleset_version,
              mapping_version, status, content_hash, build_scope_json
         FROM world_packages WHERE world_id = ? AND revision = ?`,
      [worldId, revision],
    );
    if (!row) return null;
    const entryRows = await this.db.queryAll<SqliteRow>(
      `SELECT entry_id, kind, definition_json, provenance_json, field_provenance_json,
              visibility, dependency_ids_json, revision
         FROM package_entries WHERE world_id = ? AND revision = ? ORDER BY entry_id`,
      [worldId, revision],
    );
    const sectionRows = await this.db.queryAll<SqliteRow>(
      `SELECT book, section_key, title, entry_ids_json, position
         FROM book_sections WHERE world_id = ? AND revision = ? ORDER BY book, position`,
      [worldId, revision],
    );
    const schemaVersion = String(row.schema_version);
    let buildScope: WorldPackageManifest['buildScope'];
    if (schemaVersion === 'world-package-3') {
      try {
        const parsed = JSON.parse(String(row.build_scope_json ?? '{}')) as WorldPackageManifest['buildScope'];
        if (!parsed || !Array.isArray(parsed.sourceRanges)) throw new Error('missing scope');
        buildScope = parsed;
      } catch {
        throw new Error(`World package ${worldId} r${revision} has invalid progressive scope metadata.`);
      }
    }
    if (schemaVersion !== 'world-package-2' && schemaVersion !== 'world-package-3') {
      throw new Error(`Unsupported world package schema: ${schemaVersion}.`);
    }
    return {
      manifest: {
        worldId,
        revision: Number(row.revision),
        schemaVersion,
        sourceSha256: String(row.source_sha256),
        ruleset: { id: String(row.ruleset_id), version: String(row.ruleset_version) },
        mappingVersion: String(row.mapping_version),
        contentHash: String(row.content_hash),
        status: String(row.status) as WorldPackageManifest['status'],
        ...(buildScope ? { buildScope } : {}),
      },
      entries: entryRows.map(entryRow => ({
        entryId: String(entryRow.entry_id),
        kind: String(entryRow.kind) as ContentEntry['kind'],
        revision: Number(entryRow.revision),
        provenance: JSON.parse(String(entryRow.provenance_json)),
        fieldProvenance: JSON.parse(String(entryRow.field_provenance_json ?? '{}')),
        visibility: String(entryRow.visibility) as ContentEntry['visibility'],
        dependencyIds: JSON.parse(String(entryRow.dependency_ids_json ?? '[]')),
        definition: JSON.parse(String(entryRow.definition_json)),
      })),
      sections: sectionRows.map(sectionRow => ({
        book: String(sectionRow.book) as BookSection['book'],
        sectionKey: String(sectionRow.section_key),
        title: String(sectionRow.title),
        entryIds: JSON.parse(String(sectionRow.entry_ids_json ?? '[]')),
        position: Number(sectionRow.position),
      })),
    };
  }

  /** Loads one append-only branch delta. The caller must check that the
   * selected content manifest references it and verify its content hash. */
  async getProgressiveDeltaPackage(deltaId: string): Promise<ProgressiveDeltaPackage | null> {
    const row = await this.db.queryOne<SqliteRow>(
      `SELECT status, content_hash, package_json FROM progressive_world_deltas WHERE delta_id = ?`,
      [deltaId],
    );
    if (!row) return null;
      let delta: ProgressiveDeltaPackage;
      try { delta = JSON.parse(String(row.package_json)) as ProgressiveDeltaPackage; }
      catch { throw new Error(`Progressive delta package ${deltaId} is malformed.`); }
      if (!delta || typeof delta !== 'object' || Array.isArray(delta) ||
          typeof delta.deltaId !== 'string' || typeof delta.contentHash !== 'string' ||
          delta.deltaId !== deltaId || delta.status !== String(row.status) ||
          delta.contentHash.toLowerCase() !== String(row.content_hash).toLowerCase()) {
      throw new Error(`Progressive delta package ${deltaId} has inconsistent immutable metadata.`);
    }
    return delta;
  }

  async listWorldPackages(worldId: string): Promise<Array<{ revision: number; status: string; contentHash: string; createdAt: string }>> {
    const rows = await this.db.queryAll<SqliteRow>(
      'SELECT revision, status, content_hash, created_at FROM world_packages WHERE world_id = ? ORDER BY revision DESC',
      [worldId],
    );
    return rows.map(row => ({
      revision: Number(row.revision),
      status: String(row.status),
      contentHash: String(row.content_hash),
      createdAt: String(row.created_at),
    }));
  }

  async getWorldPackageDraft(worldId: string): Promise<{ baseRevision: number; draftJson: string; updatedAt: string } | null> {
    const row = await this.db.queryOne<SqliteRow>(
      'SELECT base_revision, draft_json, updated_at FROM world_package_drafts WHERE world_id = ?',
      [worldId],
    );
    if (!row) return null;
    return {
      baseRevision: requireNumber(row, 'base_revision'),
      draftJson: requireString(row, 'draft_json'),
      updatedAt: requireString(row, 'updated_at'),
    };
  }

  async saveWorldPackageDraft(input: {
    worldId: string;
    baseRevision: number;
    draftJson: string;
    updatedAt: string;
  }): Promise<void> {
    if (input.draftJson.length > 15 * 1024 * 1024) throw new Error('World package draft exceeds 15 MB.');
    try { JSON.parse(input.draftJson); } catch { throw new Error('World package draft must be valid JSON.'); }
    await this.db.transaction(async tx => {
      const published = await tx.queryOne<{ revision: number }>(
        "SELECT revision FROM world_packages WHERE world_id = ? AND status = 'published' ORDER BY revision DESC LIMIT 1",
        [input.worldId],
      );
      if (!published || published.revision !== input.baseRevision) {
        throw new Error('World package draft is based on a stale or unpublished revision. Reload the latest published package.');
      }
      const existing = await tx.queryOne<{ base_revision: number }>(
        'SELECT base_revision FROM world_package_drafts WHERE world_id = ?', [input.worldId],
      );
      if (existing && existing.base_revision !== input.baseRevision) {
        throw new Error('An older draft is based on a different published revision. Export or discard it before editing this revision.');
      }
      await tx.execute(
        `INSERT INTO world_package_drafts (world_id, base_revision, draft_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(world_id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at
         WHERE world_package_drafts.base_revision = excluded.base_revision`,
        [input.worldId, input.baseRevision, input.draftJson, input.updatedAt],
      );
    });
  }

  async clearWorldPackageDraft(worldId: string, baseRevision: number): Promise<void> {
    await this.db.execute(
      'DELETE FROM world_package_drafts WHERE world_id = ? AND base_revision = ?',
      [worldId, baseRevision],
    );
  }

  async getPublishedPackageRevision(worldId: string): Promise<number | null> {
    const row = await this.db.queryOne<SqliteRow>(
      "SELECT revision FROM world_packages WHERE world_id = ? AND status = 'published' ORDER BY revision DESC LIMIT 1",
      [worldId],
    );
    return row ? Number(row.revision) : null;
  }

  // ---- review issues (conflicts blocking publication) --------------------

  async saveReviewIssue(input: {
    worldId: string;
    issueId: string;
    kind: string;
    severity: 'blocking' | 'major' | 'minor';
    detailJson: string;
    createdAt: string;
  }): Promise<void> {
    // Only a deliberate human decision on identical content is reusable.
    // Programmatic retirement never creates a policy, and changed evidence
    // or severity reopens the issue. Fact conflicts always require evidence.
    const policy = input.kind === 'canon_conflict' ? null : await this.db.queryOne<SqliteRow>(
      `SELECT resolution, resolved_at FROM review_resolution_policies
       WHERE world_id = ? AND kind = ? AND severity = ? AND detail_json = ?`,
      [input.worldId, input.kind, input.severity, reviewDetailKey(input.detailJson)],
    );
    await this.db.execute(
      `INSERT INTO review_issues (world_id, issue_id, kind, severity, detail_json, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id, issue_id) DO UPDATE SET
         kind = excluded.kind,
         severity = excluded.severity,
         detail_json = excluded.detail_json,
         status = excluded.status,
         resolved_at = excluded.resolved_at`,
      [input.worldId, input.issueId, input.kind, input.severity, input.detailJson,
        policy ? String(policy.resolution) : 'open', input.createdAt, policy ? String(policy.resolved_at) : null],
    );
  }

  /**
   * Reopens or resolves a whole class of issues for one world in a single
   * statement. Used by the world builder to retire the notices of a previous
   * attempt (`mapping-failed`, `invalid-proposal-*`, `canon-conflict`) once the
   * current attempt proves the condition no longer holds - otherwise the
   * publication gate keeps citing a failure that has already been fixed.
   */
  async resolveReviewIssuesByPrefix(
    worldId: string,
    prefixes: readonly string[],
    resolution: 'resolved' | 'waived' = 'resolved',
  ): Promise<string[]> {
    if (prefixes.length === 0) return [];
    const open = await this.listReviewIssues(worldId, 'open');
    const matched = open
      .filter(issue => prefixes.some(prefix => issue.issueId === prefix || issue.issueId.startsWith(`${prefix}-`)))
      .map(issue => issue.issueId);
    for (const issueId of matched) {
      await this.db.execute(
        'UPDATE review_issues SET status = ?, resolved_at = ? WHERE world_id = ? AND issue_id = ?',
        [resolution, new Date().toISOString(), worldId, issueId],
      );
    }
    return matched;
  }

  async listReviewIssues(worldId: string, status: 'open' | 'resolved' | 'waived' | 'all' = 'open'): Promise<Array<{
    issueId: string;
    kind: string;
    severity: string;
    detailJson: string;
    status: string;
  }>> {
    const rows = status === 'all'
      ? await this.db.queryAll<SqliteRow>(
        'SELECT issue_id, kind, severity, detail_json, status FROM review_issues WHERE world_id = ? ORDER BY created_at',
        [worldId],
      )
      : await this.db.queryAll<SqliteRow>(
        'SELECT issue_id, kind, severity, detail_json, status FROM review_issues WHERE world_id = ? AND status = ? ORDER BY created_at',
        [worldId, status],
      );
    return rows.map(row => ({
      issueId: String(row.issue_id),
      kind: String(row.kind),
      severity: String(row.severity),
      detailJson: String(row.detail_json),
      status: String(row.status),
    }));
  }

  async resolveReviewIssue(worldId: string, issueId: string, resolution: 'resolved' | 'waived', remember = true): Promise<void> {
    if (issueId === 'canon-conflict') {
      const pending = await this.db.queryOne<SqliteRow>(
        "SELECT COUNT(*) AS count FROM canon_facts WHERE world_id = ? AND status = 'conflict'", [worldId],
      );
      if (Number(pending?.count ?? 0) > 0) {
        throw new Error('请先逐条核对冲突事实及原文证据，不能只关闭审查提示。');
      }
    }
    await this.db.transaction(async tx => {
      const issue = await tx.queryOne<SqliteRow>(
        'SELECT kind, severity, detail_json FROM review_issues WHERE world_id = ? AND issue_id = ?', [worldId, issueId],
      );
      const resolvedAt = new Date().toISOString();
      if (remember && issue && issue.kind !== 'canon_conflict') {
        await tx.execute(
          `INSERT INTO review_resolution_policies (world_id, kind, severity, detail_json, resolution, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(world_id, kind, severity, detail_json)
           DO UPDATE SET resolution = excluded.resolution, resolved_at = excluded.resolved_at`,
          [worldId, String(issue.kind), String(issue.severity), reviewDetailKey(String(issue.detail_json)), resolution, resolvedAt],
        );
      }
      await tx.execute(
        'UPDATE review_issues SET status = ?, resolved_at = ? WHERE world_id = ? AND issue_id = ?',
        [resolution, resolvedAt, worldId, issueId],
      );
    });
  }

  /** A deliberate reviewer decision; preserves both source rows and an audit. */
  async resolveCanonFactConflict(
    worldId: string, factId: string, resolution: 'complementary' | 'unverified',
  ): Promise<void> {
    if (resolution !== 'complementary' && resolution !== 'unverified') {
      throw new Error('未知事实审查决定。');
    }
    const resolvedAt = new Date().toISOString();
    await this.db.transaction(async tx => {
      const fact = await tx.queryOne<SqliteRow>(
        'SELECT status FROM canon_facts WHERE world_id = ? AND fact_id = ?', [worldId, factId],
      );
      if (!fact || fact.status !== 'conflict') throw new Error('这条事实已处理或不属于当前世界，请刷新审查。');
      if (resolution === 'complementary') {
        const evidence = await tx.queryOne<SqliteRow>(
          'SELECT 1 AS found FROM fact_sources WHERE world_id = ? AND fact_id = ? LIMIT 1', [worldId, factId],
        );
        if (!evidence) throw new Error('缺少原文证据，不能将这条资料确认成事实。');
      }
      await tx.execute(
        'UPDATE canon_facts SET status = ? WHERE world_id = ? AND fact_id = ?',
        [resolution === 'complementary' ? 'explicit' : 'speculation', worldId, factId],
      );
      await tx.execute(
        `INSERT INTO review_issues (world_id, issue_id, kind, severity, detail_json, status, created_at, resolved_at)
         VALUES (?, ?, 'canon_resolution', 'minor', ?, 'resolved', ?, ?)`,
        [worldId, `canon-resolution-${factId}`, JSON.stringify({ factId, resolution }), resolvedAt, resolvedAt],
      );
      const remaining = await tx.queryAll<SqliteRow>(
        "SELECT fact_id FROM canon_facts WHERE world_id = ? AND status = 'conflict'", [worldId],
      );
      await tx.execute(
        'UPDATE review_issues SET status = ?, detail_json = ?, resolved_at = ? WHERE world_id = ? AND issue_id = ?',
        [remaining.length ? 'open' : 'resolved', JSON.stringify({ factIds: remaining.map(row => row.fact_id), count: remaining.length }),
          remaining.length ? null : resolvedAt, worldId, 'canon-conflict'],
      );
    });
  }
}
