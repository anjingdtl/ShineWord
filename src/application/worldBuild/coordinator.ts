/**
 * World build coordinator over persisted sources and runs (closeout C2).
 *
 * Drives a BuildRun's extract units against a persisted SourceStore - the
 * chunk TEXT is always read from shards (bounded), never from an in-memory
 * full novel. Per-unit commits reuse the C1 atomic chunk commit, so world
 * content (facts/entities/event proposals/chunk done) stays single-authority
 * in the WorldStore while runs/units own task state. Recovery is idempotent:
 * a unit whose world-side chunk is already done (hash + fingerprints match)
 * completes without re-paying the LLM.
 */
import type { SourceChunk, SourceChapter } from '../../domain/world/types';
import type { SourceStore } from '../ports/sourceStore';
import type { BuildRunRecord, BuildRunStore, BuildUnitRecord } from '../ports/worldBuildStore';
import type { WorldStore, WorldRecord } from '../ports/worldStore';
import { applyExtraction, eventIdFor, type EvidenceSource, type Sha256Hex } from '../world/extraction';
import type { ExtractionResult } from '../../domain/world/types';

export const PIPELINE_VERSION = 'pipeline-closeout-c2';
export const PLAN_VERSION = 'plan-chunk-1';

/** Extracts one planned unit (a chunk in C2; a segment group from C3 on). */
export interface UnitExtractor {
  readonly version: string;
  extract(input: {
    unitId: string;
    chunk: SourceChunk;
    chunkText: string;
    worldId: string;
  }): Promise<ExtractionResult>;
}

export interface CoordinatorDeps {
  sourceStore: SourceStore;
  runStore: BuildRunStore;
  worldStore: WorldStore;
  extractor: UnitExtractor;
  sha256Hex: Sha256Hex;
  now?: () => string;
  /** Lease TTL in ms; renewals happen between units. */
  leaseTtlMs?: number;
  owner?: string;
  onUnitDone?: (info: { unitsDone: number; unitsTotal: number }) => void;
  signal?: { aborted: boolean };
}

export interface CreateRunInput {
  runId: string;
  worldId: string;
  sourceId: string;
  modelFingerprint: string;
  title: string;
  /** Extractor version baked into unit config fingerprints. */
  extractorVersion: string;
}

function chunkJobId(chunkId: string): string {
  return `job-extract-${chunkId}`;
}

/**
 * Plans one extract unit per persisted chunk, in reading order. C3's group
 * planner will replace this with model-budget-driven groups while keeping
 * the same unit contract.
 */
export async function createExtractionRun(
  deps: Pick<CoordinatorDeps, 'sourceStore' | 'runStore' | 'worldStore' | 'now'>,
  input: CreateRunInput,
): Promise<BuildRunRecord> {
  const now = deps.now ?? (() => new Date().toISOString());
  const manifest = await deps.sourceStore.getManifest(input.sourceId);
  if (!manifest || manifest.status !== 'active') {
    throw new Error(`Source ${input.sourceId} is not active.`);
  }
  const chunks = await deps.sourceStore.getChunks(input.sourceId);
  if (chunks.length === 0) {
    throw new Error(`Source ${input.sourceId} has no chunks.`);
  }
  const configFingerprint = `${PIPELINE_VERSION}#${input.extractorVersion}#${input.modelFingerprint}`;
  const createdAt = now();
  const units: BuildUnitRecord[] = chunks.map((chunk, ord) => ({
    unitId: `${input.runId}-u${String(ord + 1).padStart(4, '0')}`,
    runId: input.runId,
    kind: 'extract_group' as const,
    sourceRangesJson: JSON.stringify([{
      chunkId: chunk.chunkId,
      chapterId: chunk.chapterId,
      startCp: chunk.startOffset,
      endCp: chunk.endOffset,
    }]),
    inputHash: chunk.contentHash,
    configFingerprint,
    parentUnitId: null,
    ord,
    status: 'queued' as const,
    attempt: 0,
    retryAt: null,
    resultRef: null,
    usageJson: null,
    errorCode: null,
    errorMessage: null,
    createdAt,
    updatedAt: createdAt,
  }));

  const run: BuildRunRecord = {
    runId: input.runId,
    worldId: input.worldId,
    sourceId: input.sourceId,
    sourceSnapshotHash: `${manifest.rawSha256Hex}:${manifest.normalizedTreeHash}`,
    pipelineVersion: PIPELINE_VERSION,
    planVersion: PLAN_VERSION,
    modelFingerprint: input.modelFingerprint,
    phase: 'extracting',
    status: 'queued',
    unitsTotal: units.length,
    unitsDone: 0,
    unitsFailed: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    fencingToken: 0,
    heartbeatAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt,
    updatedAt: createdAt,
  };
  await deps.runStore.createRun(run, units);

  // The world row mirrors the source snapshot so the library and publishers
  // keep working with the existing world-scoped tables.
  const existing = await deps.worldStore.getWorld(input.worldId);
  if (!existing) {
    const world: WorldRecord = {
      worldId: input.worldId,
      title: input.title,
      sourceSha256: manifest.rawSha256Hex,
      sourceBytes: manifest.byteLength,
      normalizeVersion: manifest.normalizeVersion,
      chapterSplitVersion: manifest.chapterSplitVersion,
      buildStatus: 'extracting',
      createdAt,
      updatedAt: createdAt,
    };
    await deps.worldStore.createWorld(world);
    // Mirror chapters/chunks into the world-scoped tables: one authority for
    // world content, the source tables stay the import-side truth.
    await deps.worldStore.saveImportedSource(input.worldId, {
      encoding: manifest.encoding,
      sourceSha256Hex: manifest.rawSha256Hex,
      sourceByteLength: manifest.byteLength,
      normalizeVersion: manifest.normalizeVersion,
      chapterSplitVersion: manifest.chapterSplitVersion,
      splitStrategy: manifest.splitStrategy,
      text: '',
      codePointCount: manifest.codePointCount,
      chapters: await deps.sourceStore.getChapters(input.sourceId),
      chunks,
    }, createdAt);
    await deps.worldStore.setWorldStatus(input.worldId, 'extracting', now());
  }
  return run;
}

export interface ExecuteRunResult {
  runId: string;
  completed: boolean;
  unitsDone: number;
  unitsTotal: number;
  unitsFailed: number;
  lostLease: boolean;
}

/**
 * Executes one run under a lease. Between units the lease is re-checked; a
 * lost lease (another owner, cancel) stops the loop without corrupting state.
 */
export async function executeRun(deps: CoordinatorDeps, runId: string): Promise<ExecuteRunResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const owner = deps.owner ?? 'coordinator';
  const ttl = deps.leaseTtlMs ?? 120_000;
  const run = await deps.runStore.getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}.`);

  const fencingToken = await deps.runStore.acquireLease(runId, owner, ttl, now());
  if (fencingToken === null) {
    return { runId, completed: false, unitsDone: run.unitsDone, unitsTotal: run.unitsTotal, unitsFailed: run.unitsFailed, lostLease: true };
  }

  const manifest = await deps.sourceStore.getManifest(run.sourceId);
  if (!manifest || manifest.status !== 'active') {
    await deps.runStore.setRunStatus(runId, 'failed_terminal', now(), 'source_missing', 'Source is no longer active.');
    return { runId, completed: false, unitsDone: run.unitsDone, unitsTotal: run.unitsTotal, unitsFailed: run.unitsFailed, lostLease: false };
  }
  const chapters: SourceChapter[] = await deps.sourceStore.getChapters(run.sourceId);
  const evidenceSource: EvidenceSource = {
    chapters,
    sliceRange: (startCp, endCp) => deps.sourceStore.readRange(run.sourceId, startCp, endCp),
  };
  const chunksByRange = new Map<string, SourceChunk>();
  for (const chunk of await deps.sourceStore.getChunks(run.sourceId)) {
    chunksByRange.set(chunk.chunkId, chunk);
  }

  let lostLease = false;
  try {
    for (;;) {
      if (deps.signal?.aborted) {
        await deps.runStore.releaseLease(runId, owner, fencingToken, now());
        await deps.runStore.setRunStatus(runId, 'paused_user', now());
        return { runId, completed: false, unitsDone: 0, unitsTotal: run.unitsTotal, unitsFailed: 0, lostLease: false };
      }
      const executable = await deps.runStore.listExecutableUnits(runId, now());
      const unit = executable[0];
      if (!unit) break;
      if (!(await deps.runStore.renewLease(runId, owner, fencingToken, ttl, now()))) {
        lostLease = true;
        break;
      }

      const claimed = await deps.runStore.claimUnit(unit.unitId, now());
      if (!claimed) continue;

      const range = JSON.parse(unit.sourceRangesJson)[0] as
        | { chunkId: string; chapterId: string; startCp: number; endCp: number }
        | undefined;
      if (!range) {
        await deps.runStore.completeUnit({
          unitId: unit.unitId, fencingToken, status: 'failed_terminal',
          errorCode: 'bad_range', errorMessage: 'Unit has no source range.', now: now(),
        });
        continue;
      }
      const chunk = chunksByRange.get(range.chunkId);
      if (!chunk || chunk.contentHash !== unit.inputHash) {
        await deps.runStore.completeUnit({
          unitId: unit.unitId, fencingToken, status: 'needs_review',
          errorCode: 'source_changed', errorMessage: 'Chunk no longer matches the planned input hash.', now: now(),
        });
        continue;
      }

      // Idempotent fast path: the world-side chunk already finished under the
      // same content hash and config fingerprints (C1 guards).
      const job = await deps.worldStore.getJob(run.worldId, chunkJobId(chunk.chunkId));
      if (
        job?.status === 'done' && job.contentHash === chunk.contentHash
        && job.extractorVersion === deps.extractor.version
        && (job.modelFingerprint ?? null) === run.modelFingerprint
      ) {
        await deps.runStore.completeUnit({
          unitId: unit.unitId, fencingToken, status: 'completed',
          resultRef: job.jobId, usageJson: job.usageJson, now: now(),
        });
        continue;
      }

      try {
        const chunkText = await deps.sourceStore.readRange(run.sourceId, chunk.startOffset, chunk.endOffset);
        const extraction = await deps.extractor.extract({
          unitId: unit.unitId, chunk, chunkText, worldId: run.worldId,
        });
        const resolved = await applyExtraction({
          worldId: run.worldId,
          source: evidenceSource,
          extraction,
          createdAt: now(),
          sha256Hex: deps.sha256Hex,
        });
        const eventProposals = resolved.events.map(event => ({
          chunkId: chunk.chunkId,
          eventId: eventIdFor(run.worldId, event.eventKey),
          title: event.title,
          summary: event.summary,
          worldTimeOrder: event.worldTimeOrder ?? null,
          narrativeChapterId: event.narrativeChapterId ?? null,
          dependsOnEventKeys: event.dependsOnEventKeys ?? [],
        }));
        let factCounter = 0;
        const factsWithIds = resolved.facts.map(fact => {
          factCounter += 1;
          return { ...fact, factId: `fact-${run.worldId}-${chunk.chunkId}-${factCounter}` };
        });
        await deps.worldStore.commitChunkResult({
          worldId: run.worldId,
          chunkId: chunk.chunkId,
          entities: resolved.entities,
          facts: factsWithIds,
          eventProposals,
          job: {
            worldId: run.worldId,
            jobId: chunkJobId(chunk.chunkId),
            kind: 'extract_chunk',
            targetId: chunk.chunkId,
            status: 'done',
            attempts: (job?.attempts ?? 0) + 1,
            contentHash: chunk.contentHash,
            extractorVersion: deps.extractor.version,
            modelFingerprint: run.modelFingerprint,
            usageJson: JSON.stringify({ entities: resolved.entities.length, facts: resolved.facts.length }),
            resultJson: JSON.stringify({ ok: true, unitId: unit.unitId }),
            error: null,
            createdAt: job?.createdAt ?? now(),
            updatedAt: now(),
          },
          createdAt: now(),
          updatedAt: now(),
        });
        const ok = await deps.runStore.completeUnit({
          unitId: unit.unitId, fencingToken, status: 'completed',
          resultRef: chunkJobId(chunk.chunkId), now: now(),
        });
        if (!ok) {
          lostLease = true;
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const classification = classifyExtractionError(message);
        const backoffMs = classification === 'config' ? 0 : 5_000 * Math.min(unit.attempt, 6);
        await deps.runStore.completeUnit({
          unitId: unit.unitId,
          fencingToken,
          status: classification === 'config' ? 'needs_review' : 'failed_retryable',
          errorCode: classification,
          errorMessage: message.slice(0, 500),
          retryAt: classification === 'config' ? null : new Date(Date.parse(now()) + backoffMs).toISOString(),
          now: now(),
        });
        if (classification === 'config') {
          await deps.runStore.setRunStatus(runId, 'needs_review', now(), classification, message.slice(0, 500));
          break;
        }
      }
    }

    const fresh = await deps.runStore.getRun(runId);
    if (!fresh) throw new Error('Run disappeared.');
    const allUnits = await deps.runStore.listUnits(runId);
    const pending = allUnits.filter(u => u.status === 'queued' || u.status === 'running'
      || u.status === 'failed_retryable' || u.status === 'waiting_network').length;
    // Final verdict comes from unit STATES, not the attempt-failure counter:
    // a unit that failed once and recovered on retry is not a final failure.
    const blocked = allUnits.filter(u => u.status === 'needs_review' || u.status === 'failed_terminal').length;
    if (!lostLease && pending === 0 && blocked === 0) {
      // Final event resolution replays from the persisted proposals (C1).
      await resolveEventProposals(deps, run.worldId);
      await deps.worldStore.setWorldStatus(run.worldId, 'ready', now());
      await deps.runStore.setRunStatus(runId, 'completed', now());
      await deps.runStore.setRunPhase(runId, 'merging', now());
      return {
        runId, completed: true, unitsDone: fresh.unitsDone,
        unitsTotal: fresh.unitsTotal, unitsFailed: fresh.unitsFailed, lostLease: false,
      };
    }
    if (!lostLease && pending === 0 && blocked > 0) {
      await resolveEventProposals(deps, run.worldId);
      await deps.worldStore.setWorldStatus(run.worldId, 'failed', now());
      await deps.runStore.setRunStatus(runId, 'needs_review', now());
    }
    return {
      runId, completed: false, unitsDone: fresh.unitsDone,
      unitsTotal: fresh.unitsTotal, unitsFailed: fresh.unitsFailed, lostLease,
    };
  } finally {
    if (!lostLease) {
      await deps.runStore.releaseLease(runId, owner, fencingToken, now());
    }
  }
}

type ErrorClass = 'network' | 'rate_limit' | 'config' | 'truncation' | 'unknown';

function classifyExtractionError(message: string): ErrorClass {
  const lower = message.toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('rate_limit')) return 'rate_limit';
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('api key') || lower.includes('invalid api')) return 'config';
  if (lower.includes('truncat') || lower.includes('finish_reason') || lower.includes('max_tokens')) return 'truncation';
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('timed out')
    || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('socket')
    || lower.includes('fetch failed') || lower.includes('5')) {
    if (/5\d{2}/.test(lower) || lower.includes('network') || lower.includes('timeout') || lower.includes('timed out')
      || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('socket') || lower.includes('fetch failed')) {
      return 'network';
    }
  }
  return 'unknown';
}

/**
 * Cross-chunk event resolution over the persisted proposals (same rules as
 * the C1 batch builder: dedupe by eventId, resolve dependencies against open
 * proposals and committed canon events).
 */
async function resolveEventProposals(deps: CoordinatorDeps, worldId: string): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const proposals = await deps.worldStore.listEventProposals(worldId);
  const byEventId = new Map(proposals.map(p => [p.eventId, p]));
  for (const existing of await deps.worldStore.listEvents(worldId)) {
    if (!byEventId.has(existing.eventId)) {
      byEventId.set(existing.eventId, {
        worldId,
        chunkId: '',
        eventId: existing.eventId,
        title: existing.title,
        summary: existing.summary,
        worldTimeOrder: existing.worldTimeOrder,
        narrativeChapterId: existing.narrativeChapterId,
        dependsOnEventKeys: existing.dependsOnEventIds.map(id => id),
        status: 'proposed',
      });
    }
  }
  const known = new Set(byEventId.keys());
  const resolvedIds: string[] = [];
  for (const proposal of proposals) {
    const resolvedDependencies = proposal.dependsOnEventKeys
      .map(key => {
        const id = eventIdFor(worldId, key);
        if (known.has(id)) return id;
        return null;
      })
      .filter((id): id is string => id !== null);
    await deps.worldStore.saveEvent({
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
    resolvedIds.push(proposal.eventId);
  }
  await deps.worldStore.markEventProposalsResolved(worldId, resolvedIds, now());
}
