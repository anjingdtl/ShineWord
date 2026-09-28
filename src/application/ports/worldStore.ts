import type {
  EntityType,
  EventStatus,
  FactStatus,
  ParsedTxtSource,
} from '../../domain/world/types';

export interface WorldRecord {
  worldId: string;
  title: string;
  sourceSha256: string;
  /**
   * Pre-G6 worlds were hashed over a re-encoded byte string, not the raw
   * file bytes. The legacy digest is kept for resume matching and old save
   * manifests; it is never silently rewritten.
   */
  legacySourceSha256?: string | null;
  sourceBytes: number;
  normalizeVersion: string;
  chapterSplitVersion: string;
  buildStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChapter {
  worldId: string;
  chapterId: string;
  index: number;
  title: string;
  startOffset: number;
  endOffset: number;
  charCount: number;
  contentHash: string;
}

export interface StoredChunk {
  worldId: string;
  chunkId: string;
  chapterId: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  charCount: number;
  contentHash: string;
  extractionStatus: 'pending' | 'extracted' | 'failed';
}

export interface StoredEntity {
  worldId: string;
  entityId: string;
  type: EntityType;
  name: string;
  firstSeenChapterId: string | null;
  aliases: readonly string[];
}

export interface StoredFact {
  worldId: string;
  factId: string;
  subjectEntityId: string;
  predicate: string;
  value: Record<string, unknown>;
  status: FactStatus;
  confidence: number;
  validFrom: string | null;
  validTo: string | null;
  revealAt: string | null;
  scope: string;
  sources: readonly FactSourceSpan[];
}

export interface FactSourceSpan {
  chapterId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  quoteSha256: string;
}

export interface StoredEvent {
  worldId: string;
  eventId: string;
  title: string;
  summary: string;
  worldTimeOrder: number | null;
  narrativeChapterId: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: EventStatus;
  dependsOnEventIds: readonly string[];
}

/**
 * Closeout C1 event checkpoint: extraction defers cross-chunk dependency
 * resolution until every chunk ran, so per-chunk proposals are persisted in
 * the SAME transaction that marks the chunk done. A crash between "chunk
 * committed" and "timeline resolved" therefore loses nothing — the next run
 * replays resolution from these rows instead of trusting in-memory state.
 */
export interface StoredEventProposal {
  worldId: string;
  chunkId: string;
  eventId: string;
  title: string;
  summary: string;
  worldTimeOrder: number | null;
  narrativeChapterId: string | null;
  dependsOnEventKeys: readonly string[];
  status: 'proposed' | 'resolved';
}

/**
 * Single-transaction chunk commit (closeout C1): entities, deduplicated facts,
 * event proposals, chunk extraction status and the done-job marker either all
 * land or none do. A write failure must never leave a chunk marked done.
 */
export interface CommitChunkResultInput {
  worldId: string;
  chunkId: string;
  entities: readonly StoredEntity[];
  facts: readonly StoredFact[];
  eventProposals: readonly Omit<StoredEventProposal, 'worldId' | 'status'>[];
  job: WorldJobRecord;
  createdAt: string;
  updatedAt: string;
}

export interface CommitChunkResultOutcome {
  factOutcomes: Array<'inserted' | 'duplicate' | 'conflict'>;
}

export interface StoredRuleMapping {
  worldId: string;
  mappingId: string;
  targetEntityId: string;
  mappingKind: 'attribute' | 'skill' | 'power_tier' | 'resource';
  mapping: Record<string, unknown>;
  evidenceRefs: readonly string[];
  rulesetVersion: string;
  status: 'active' | 'retired';
}

export interface WorldJobRecord {
  worldId: string;
  jobId: string;
  kind: 'import' | 'extract_chunk' | 'merge_entities' | 'timeline' | 'rule_mapping';
  targetId: string | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  contentHash: string | null;
  extractorVersion: string | null;
  modelFingerprint: string | null;
  usageJson: string | null;
  resultJson: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorldStore {
  createWorld(record: WorldRecord): Promise<void>;
  getWorld(worldId: string): Promise<WorldRecord | null>;
  setWorldStatus(worldId: string, status: string, updatedAt: string): Promise<void>;

  saveImportedSource(worldId: string, parsed: ParsedTxtSource, createdAt: string): Promise<void>;
  getChapters(worldId: string): Promise<StoredChapter[]>;
  getChunks(worldId: string): Promise<StoredChunk[]>;
  getChunksByStatus(worldId: string, status: StoredChunk['extractionStatus']): Promise<StoredChunk[]>;
  setChunkExtractionStatus(worldId: string, chunkId: string, status: StoredChunk['extractionStatus']): Promise<void>;

  upsertEntity(entity: StoredEntity, createdAt: string): Promise<void>;
  getEntity(worldId: string, entityId: string): Promise<StoredEntity | null>;
  listEntities(worldId: string): Promise<StoredEntity[]>;
  addEntityAlias(worldId: string, entityId: string, alias: string, score: number, evidenceJson: string, createdAt: string): Promise<void>;

  saveFact(fact: StoredFact, createdAt: string): Promise<'inserted' | 'duplicate' | 'conflict'>;
  getFactsBySubject(worldId: string, subjectEntityId: string): Promise<StoredFact[]>;
  listFacts(worldId: string): Promise<StoredFact[]>;

  saveEvent(event: StoredEvent, createdAt: string): Promise<void>;
  listEvents(worldId: string, branchId?: string): Promise<StoredEvent[]>;
  /** Branch-scoped divergence overlay; never rewrites shared canon_events. */
  markEventsPendingAfter(worldId: string, anchorEventId: string, branchId: string): Promise<number>;

  saveRuleMapping(mapping: StoredRuleMapping, createdAt: string): Promise<void>;
  listRuleMappings(worldId: string): Promise<StoredRuleMapping[]>;

  recordKnowledge(record: {
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
  }): Promise<void>;

  upsertJob(job: WorldJobRecord, updatedAt: string): Promise<void>;
  getJob(worldId: string, jobId: string): Promise<WorldJobRecord | null>;
  findReusableJob(
    worldId: string,
    kind: WorldJobRecord['kind'],
    contentHash: string,
    extractorVersion: string,
    modelFingerprint?: string | null,
  ): Promise<WorldJobRecord | null>;

  /**
   * Atomically commits one finished chunk: entities, deduplicated facts,
   * event proposals, chunk status 'extracted' and the done job. Returns the
   * per-fact dedupe outcomes so callers can report honest counters.
   */
  commitChunkResult(input: CommitChunkResultInput): Promise<CommitChunkResultOutcome>;

  /** Every unresolved event proposal for the world, across runs. */
  listEventProposals(worldId: string): Promise<StoredEventProposal[]>;
  /** Marks proposals resolved once their canon events are committed. */
  markEventProposalsResolved(worldId: string, eventIds: readonly string[], updatedAt: string): Promise<void>;
}
