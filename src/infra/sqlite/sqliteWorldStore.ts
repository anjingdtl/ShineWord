import type {
  EntityType,
  FactStatus,
  ParsedTxtSource,
} from '../../domain/world/types';
import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';
import type {
  FactSourceSpan,
  StoredChapter,
  StoredChunk,
  StoredEntity,
  StoredEvent,
  StoredFact,
  StoredRuleMapping,
  WorldJobRecord,
  WorldRecord,
  WorldStore,
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
        (world_id, title, source_sha256, source_bytes, normalize_version,
         chapter_split_version, build_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id) DO UPDATE SET
         title = excluded.title,
         normalize_version = excluded.normalize_version,
         chapter_split_version = excluded.chapter_split_version,
         build_status = excluded.build_status,
         updated_at = excluded.updated_at`,
      [
        record.worldId,
        record.title,
        record.sourceSha256,
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

  async saveImportedSource(worldId: string, parsed: ParsedTxtSource, createdAt: string): Promise<void> {
    await this.db.transaction(async tx => {
      for (const chapter of parsed.chapters) {
        await tx.execute(
          `INSERT OR IGNORE INTO source_chapters
            (world_id, chapter_id, chapter_index, title, start_offset, end_offset,
             char_count, content_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        await tx.execute(
          `INSERT OR IGNORE INTO source_chunks
            (world_id, chunk_id, chapter_id, chunk_index, start_offset, end_offset,
             char_count, content_hash, extraction_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
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
    await this.db.transaction(async tx => {
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
    });
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
    return this.db.transaction(async tx => {
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
          await this.insertFact(tx, { ...fact, status: 'conflict' }, createdAt);
          return 'conflict';
        }
      }
      await this.insertFact(tx, fact, createdAt);
      return 'inserted';
    });
  }

  private async insertFact(tx: {
    execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
  }, fact: StoredFact, createdAt: string): Promise<void> {
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
        await tx.execute(
          `INSERT OR IGNORE INTO event_dependencies (world_id, event_id, depends_on_event_id, created_at)
           VALUES (?, ?, ?, ?)`,
          [event.worldId, event.eventId, dependency, createdAt],
        );
      }
    });
  }

  async listEvents(worldId: string): Promise<StoredEvent[]> {
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
    return rows.map(row => ({
      worldId,
      eventId: row.event_id,
      title: row.title,
      summary: row.summary,
      worldTimeOrder: optionalNumber(row, 'world_time_order'),
      narrativeChapterId: optionalString(row, 'narrative_chapter_id'),
      validFrom: optionalString(row, 'valid_from'),
      validTo: optionalString(row, 'valid_to'),
      status: row.status as StoredEvent['status'],
      dependsOnEventIds: byEvent.get(row.event_id) ?? [],
    }));
  }

  async markEventsPendingAfter(worldId: string, anchorEventId: string): Promise<number> {
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
      for (const row of affected) {
        await tx.execute(
          `UPDATE canon_events SET status = 'pending' WHERE world_id = ? AND event_id = ?`,
          [worldId, row.event_id],
        );
      }
      return affected.length;
    });
  }

  async saveRuleMapping(mapping: StoredRuleMapping, createdAt: string): Promise<void> {
    await this.db.execute(
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
    await this.db.execute(
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
  ): Promise<WorldJobRecord | null> {
    const row = await this.db.queryOne<JobRow>(
      `SELECT * FROM world_jobs
        WHERE world_id = ? AND kind = ? AND content_hash = ? AND extractor_version = ?
          AND status = 'done'
        ORDER BY updated_at DESC LIMIT 1`,
      [worldId, kind, contentHash, extractorVersion],
    );
    return row ? this.jobFromRow(row) : null;
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
}
