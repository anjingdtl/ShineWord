import type { ExtractionResult, ParsedTxtSource } from '../../domain/world/types';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import { CodePointOffsetIndex } from '../../domain/world/textOffsets';
import type { StoredChunk, WorldJobRecord, WorldRecord, WorldStore } from '../ports/worldStore';
import { importTxtSource, type ByteSha256Provider, type TextDecodeProvider, type TxtImportOptions } from '../import/txtImport';
import { applyExtraction, entityIdFor, eventIdFor } from './extraction';

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
  };
  await store.createWorld(world);
  await store.saveImportedSource(worldId, parsed, createdAt);
  await store.setWorldStatus(worldId, 'extracting', now());

  const factCounts = { inserted: 0, duplicate: 0, conflict: 0 };
  const rejected: string[] = [];
  const entityIds = new Set<string>();
  const eventIds = new Set<string>();
  const failedChunks: string[] = [];
  const collectedEvents: Array<{
    eventId: string;
    title: string;
    summary: string;
    worldTimeOrder: number | null;
    narrativeChapterId: string | null;
    dependsOnEventKeys: readonly string[];
  }> = [];
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

      if (existingJob?.status === 'done' && existingJob.contentHash === chunk.contentHash) {
        reusedJobs += 1;
        continue;
      }

      const reusable = await store.findReusableJob(worldId, 'extract_chunk', chunk.contentHash, input.extractor.version);
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
        const absoluteText = await extractChunkText(parsed, chunk);
        const extraction = await input.extractor.extract({ chunk, chunkText: absoluteText, worldId });
        const resolved = await applyExtraction({
          worldId,
          parsed,
          extraction,
          createdAt,
          sha256Hex: input.sha.sha256Hex,
        });

        for (const entity of resolved.entities) {
          if (entityIds.has(entity.entityId)) continue;
          entityIds.add(entity.entityId);
          await store.upsertEntity(entity, createdAt);
        }

        for (const fact of resolved.facts) {
          factCounter += 1;
          const outcome = await store.saveFact(
            { ...fact, factId: `fact-${worldId}-${chunk.chunkId}-${factCounter}` },
            createdAt,
          );
          factCounts[outcome] += 1;
        }

        // Events defer dependency resolution until every chunk has run, so a
        // dependency declared in a later chunk still resolves.
        for (const event of resolved.events) {
          const id = eventIdFor(worldId, event.eventKey);
          if (eventIds.has(id)) continue;
          eventIds.add(id);
          collectedEvents.push({
            eventId: id,
            title: event.title,
            summary: event.summary,
            worldTimeOrder: event.worldTimeOrder ?? null,
            narrativeChapterId: event.narrativeChapterId ?? null,
            dependsOnEventKeys: event.dependsOnEventKeys ?? [],
          });
        }

        for (const issue of resolved.rejected) {
          if (issue.kind !== 'dependency') {
            rejected.push(`${chunk.chunkId}: ${issue.kind}: ${issue.detail}`);
          }
        }

        await store.setChunkExtractionStatus(worldId, chunk.chunkId, 'extracted');
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
          usageJson: JSON.stringify({ entities: resolved.entities.length, facts: resolved.facts.length }),
          resultJson: JSON.stringify({ ok: true }),
          error: null,
          createdAt: existingJob?.createdAt ?? now(),
          updatedAt: now(),
        }, now());
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

  // Global event dependency resolution across chunk boundaries.
  for (const event of collectedEvents) {
    const resolvedDependencies = event.dependsOnEventKeys
      .map(key => {
        const id = eventIdFor(worldId, key);
        if (eventIds.has(id)) return id;
        rejected.push(`event ${event.eventId}: unknown dependency ${key}`);
        return null;
      })
      .filter((id): id is string => id !== null);
    await store.saveEvent({
      worldId,
      eventId: event.eventId,
      title: event.title,
      summary: event.summary,
      worldTimeOrder: event.worldTimeOrder,
      narrativeChapterId: event.narrativeChapterId,
      validFrom: null,
      validTo: null,
      status: 'canon',
      dependsOnEventIds: resolvedDependencies,
    }, now());
  }

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

  await store.setWorldStatus(worldId, 'ready', now());
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

/**
 * Chunks carry absolute code point offsets into the normalized source, so the
 * extractor always sees text that maps 1:1 back to the immutable source.
 */
async function extractChunkText(parsed: ParsedTxtSource, chunk: StoredChunk): Promise<string> {
  const index = new CodePointOffsetIndex(parsed.text);
  return index.slice(chunk.startOffset, chunk.endOffset);
}

export function resolveEntityIdFor(worldId: string, key: string): string {
  return entityIdFor(worldId, key);
}
