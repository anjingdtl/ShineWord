import type { ExtractionResult, ParsedTxtSource } from '../../domain/world/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import { CodePointOffsetIndex } from '../../domain/world/textOffsets';
import type { StoredChunk, WorldJobRecord, WorldRecord, WorldStore } from '../ports/worldStore';
import { importTxtSource, type ByteSha256Provider, type TextDecodeProvider, type TxtImportOptions } from '../import/txtImport';
import { applyExtraction, entityIdFor, eventIdFor, type EvidenceSource } from './extraction';

export interface ChunkExtractor {
  readonly version: string;
  extract(input: {
    chunk: StoredChunk;
    chunkText: string;
    worldId: string;
  }): Promise<ExtractionResult>;
}

export interface BuildWorldInput {
  worldId: string;
  title: string;
  bytes: Uint8Array;
  store: WorldStore;
  sha: ByteSha256Provider & Sha256HexProvider;
  decoder: TextDecodeProvider;
  extractor: ChunkExtractor;
  modelFingerprint?: string;
  concurrency?: 1 | 2;
  importOptions?: TxtImportOptions;
  now?: () => string;
  /**
   * Pre-G6 re-encode digest of the same bytes, stored for resume matching on
   * worlds imported before true byte hashing (P2 acceptance G06). Optional.
   */
  legacySourceSha256?: string;
}

export interface BuildWorldResult {
  worldId: string;
  parsed: ParsedTxtSource;
  entityCount: number;
  factCounts: { inserted: number; duplicate: number; conflict: number; total: number };
  eventCount: number;
  rejectedCount: number;
  failedChunks: string[];
  reusedJobs: number;
}

function chunkJobId(chunkId: string): string {
  return `job-extract-${chunkId}`;
}

export async function buildWorldFromTxt(input: BuildWorldInput): Promise<BuildWorldResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const concurrency = input.concurrency ?? 1;
  const { worldId, store } = input;

  const parsed = await importTxtSource(input.bytes, input.sha, input.decoder, input.importOptions);
  const createdAt = now();
  // One shared index for the whole build (closeout C1/C2): chunk text reads
  // and evidence slices reuse it instead of rebuilding an O(N) index per chunk.
  const index = new CodePointOffsetIndex(parsed.text);
  const evidenceSource: EvidenceSource = {
    chapters: parsed.chapters,
    sliceRange: (startCp, endCp) => Promise.resolve(index.slice(startCp, endCp)),
  };

  const world: WorldRecord = {
    worldId,
    title: input.title,
    sourceSha256: parsed.sourceSha256Hex,
    sourceBytes: parsed.sourceByteLength,
    normalizeVersion: parsed.normalizeVersion,
    chapterSplitVersion: parsed.chapterSplitVersion,
    buildStatus: 'importing',
    createdAt,
    updatedAt: createdAt,
    ...(input.legacySourceSha256 ? { legacySourceSha256: input.legacySourceSha256 } : {}),
  };
  await store.createWorld(world);
  await store.saveImportedSource(worldId, parsed, createdAt);
  await store.setWorldStatus(worldId, 'extracting', now());

  const factCounts = { inserted: 0, duplicate: 0, conflict: 0 };
  const rejected: string[] = [];
  const entityIds = new Set<string>();
  const failedChunks: string[] = [];
  let reusedJobs = 0;
  let factCounter = 0;

  const pendingChunks = await store.getChunks(worldId);
  const queue = [...pendingChunks];

  const worker = async (): Promise<void> => {
    for (;;) {
      const chunk: StoredChunk | undefined = queue.shift();
      if (!chunk) return;
      const jobId = chunkJobId(chunk.chunkId);
      const existingJob = await store.getJob(worldId, jobId);

      // Reuse guards (closeout C1): content hash, extractor version AND model
      // fingerprint must match. Rows written by the pre-fix mobile hash
      // adapter stored the whole-file digest for every chunk; after
      // saveImportedSource corrects the stored digests those stale jobs no
      // longer match and re-extract.
      if (
        existingJob?.status === 'done' &&
        existingJob.contentHash === chunk.contentHash &&
        existingJob.extractorVersion === input.extractor.version &&
        (existingJob.modelFingerprint ?? null) === (input.modelFingerprint ?? null)
      ) {
        reusedJobs += 1;
        continue;
      }

      const reusable = await store.findReusableJob(
        worldId,
        'extract_chunk',
        chunk.contentHash,
        input.extractor.version,
        input.modelFingerprint ?? null,
      );
      if (reusable?.resultJson) {
        await store.upsertJob({
          worldId,
          jobId,
          kind: 'extract_chunk',
          targetId: chunk.chunkId,
          status: 'done',
          attempts: (existingJob?.attempts ?? 0) + 1,
          contentHash: chunk.contentHash,
          extractorVersion: input.extractor.version,
          modelFingerprint: input.modelFingerprint ?? null,
          usageJson: JSON.stringify({ reusedFrom: reusable.jobId }),
          resultJson: reusable.resultJson,
          error: null,
          createdAt: existingJob?.createdAt ?? now(),
          updatedAt: now(),
        }, now());
        reusedJobs += 1;
        await store.setChunkExtractionStatus(worldId, chunk.chunkId, 'extracted');
        continue;
      }

      await store.upsertJob({
        worldId,
        jobId,
        kind: 'extract_chunk',
        targetId: chunk.chunkId,
        status: 'running',
        attempts: (existingJob?.attempts ?? 0) + 1,
        contentHash: chunk.contentHash,
        extractorVersion: input.extractor.version,
        modelFingerprint: input.modelFingerprint ?? null,
        usageJson: null,
        resultJson: null,
        error: null,
        createdAt: existingJob?.createdAt ?? now(),
        updatedAt: now(),
      }, now());

      try {
        const absoluteText = index.slice(chunk.startOffset, chunk.endOffset);
        const extraction = await input.extractor.extract({ chunk, chunkText: absoluteText, worldId });
        const resolved = await applyExtraction({
          worldId,
          source: evidenceSource,
          extraction,
          createdAt,
          sha256Hex: input.sha.sha256Hex,
        });

        // Event proposals are part of the atomic chunk commit (closeout C1):
        // a crash between "chunk done" and the final timeline pass loses
        // nothing, because resolution replays from world_event_proposals.
        const eventProposals = resolved.events.map(event => {
          const id = eventIdFor(worldId, event.eventKey);
          return {
            chunkId: chunk.chunkId,
            eventId: id,
            title: event.title,
            summary: event.summary,
            worldTimeOrder: event.worldTimeOrder ?? null,
            narrativeChapterId: event.narrativeChapterId ?? null,
            dependsOnEventKeys: event.dependsOnEventKeys ?? [],
          };
        });

        const factsWithIds = resolved.facts.map(fact => {
          factCounter += 1;
          return { ...fact, factId: `fact-${worldId}-${chunk.chunkId}-${factCounter}` };
        });

        // One transaction: entities + dedup facts + proposals + chunk status
        // + done marker. A write failure leaves the chunk not-done so the
        // next run re-extracts it; fact dedupe absorbs the re-request cost.
        const committed = await store.commitChunkResult({
          worldId,
          chunkId: chunk.chunkId,
          entities: resolved.entities.filter(entity => !entityIds.has(entity.entityId)),
          facts: factsWithIds,
          eventProposals,
          job: {
            worldId,
            jobId,
            kind: 'extract_chunk',
            targetId: chunk.chunkId,
            status: 'done',
            attempts: (existingJob?.attempts ?? 0) + 1,
            contentHash: chunk.contentHash,
            extractorVersion: input.extractor.version,
            modelFingerprint: input.modelFingerprint ?? null,
            usageJson: JSON.stringify({ entities: resolved.entities.length, facts: resolved.facts.length }),
            resultJson: JSON.stringify({ ok: true }),
            error: null,
            createdAt: existingJob?.createdAt ?? now(),
            updatedAt: now(),
          },
          createdAt,
          updatedAt: now(),
        });
        for (const entity of resolved.entities) entityIds.add(entity.entityId);
        for (const outcome of committed.factOutcomes) factCounts[outcome] += 1;

        for (const issue of resolved.rejected) {
          if (issue.kind !== 'dependency') {
            rejected.push(`${chunk.chunkId}: ${issue.kind}: ${issue.detail}`);
          }
        }
      } catch (error) {
        failedChunks.push(chunk.chunkId);
        await store.setChunkExtractionStatus(worldId, chunk.chunkId, 'failed');
        await store.upsertJob({
          worldId,
          jobId,
          kind: 'extract_chunk',
          targetId: chunk.chunkId,
          status: 'failed',
          attempts: (existingJob?.attempts ?? 0) + 1,
          contentHash: chunk.contentHash,
          extractorVersion: input.extractor.version,
          modelFingerprint: input.modelFingerprint ?? null,
          usageJson: null,
          resultJson: null,
          error: error instanceof Error ? error.message : String(error),
          createdAt: existingJob?.createdAt ?? now(),
          updatedAt: now(),
        }, now());
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);

  // Global event dependency resolution, replayed from the persisted proposals
  // (closeout C1): covers chunks finished in EARLIER interrupted runs too,
  // not just this run's in-memory set. Dependencies may point at events that
  // were already resolved and committed in a previous run, so the known-id
  // set includes existing canon events, not only open proposals.
  const proposals = await store.listEventProposals(worldId);
  const proposalsByEventId = new Map<string, typeof proposals[number]>();
  for (const proposal of proposals) {
    if (!proposalsByEventId.has(proposal.eventId)) proposalsByEventId.set(proposal.eventId, proposal);
  }
  const knownEventIds = new Set(proposalsByEventId.keys());
  for (const existingEvent of await store.listEvents(worldId)) {
    knownEventIds.add(existingEvent.eventId);
  }
  const resolvedEventIds: string[] = [];
  for (const proposal of proposalsByEventId.values()) {
    const resolvedDependencies = proposal.dependsOnEventKeys
      .map(key => {
        const id = eventIdFor(worldId, key);
        if (knownEventIds.has(id)) return id;
        rejected.push(`event ${proposal.eventId}: unknown dependency ${key}`);
        return null;
      })
      .filter((id): id is string => id !== null);
    await store.saveEvent({
      worldId,
      eventId: proposal.eventId,
      title: proposal.title,
      summary: proposal.summary,
      worldTimeOrder: proposal.worldTimeOrder,
      narrativeChapterId: proposal.narrativeChapterId,
      validFrom: null,
      validTo: null,
      status: 'canon',
      dependsOnEventIds: resolvedDependencies,
    }, now());
    resolvedEventIds.push(proposal.eventId);
  }
  await store.markEventProposalsResolved(worldId, resolvedEventIds, now());

  await store.setWorldStatus(worldId, 'merging', now());
  // Entity merges are candidates only — never auto-applied on name equality.
  const entities = await store.listEntities(worldId);
  const mergeCandidates = entities.filter(entity => entity.aliases.length > 1);
  await store.upsertJob({
    worldId,
    jobId: `job-merge-${worldId}`,
    kind: 'merge_entities',
    targetId: null,
    status: 'done',
    attempts: 1,
    contentHash: parsed.sourceSha256Hex,
    extractorVersion: input.extractor.version,
    modelFingerprint: input.modelFingerprint ?? null,
    usageJson: null,
    resultJson: JSON.stringify({ candidates: mergeCandidates.map(entity => entity.entityId) }),
    error: null,
    createdAt: now(),
    updatedAt: now(),
  }, now());

  // Honesty gate (closeout C1): failed chunks mean the world is NOT fully
  // extracted; persisting 'ready' here used to contradict the actual state.
  // Facts/entities stay saved; re-entering the build resumes failed chunks.
  await store.setWorldStatus(worldId, failedChunks.length === 0 ? 'ready' : 'failed', now());
  // Totals read back from the store so a RESUMED build reports the world's
  // cumulative content, not just this run's delta (which is 0 when every
  // chunk was reused).
  const [totalEntities, totalFacts, totalEvents] = await Promise.all([
    store.listEntities(worldId),
    store.listFacts(worldId),
    store.listEvents(worldId),
  ]);
  return {
    worldId,
    parsed,
    entityCount: totalEntities.length,
    factCounts: {
      inserted: factCounts.inserted,
      duplicate: factCounts.duplicate,
      conflict: factCounts.conflict,
      total: totalFacts.length,
    },
    eventCount: totalEvents.length,
    rejectedCount: rejected.length,
    failedChunks,
    reusedJobs,
  };
}

export function resolveEntityIdFor(worldId: string, key: string): string {
  return entityIdFor(worldId, key);
}
