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
import type { BuildRunPhase, BuildRunRecord, BuildRunStore, BuildUnitRecord } from '../ports/worldBuildStore';
import type { WorldStore, WorldRecord } from '../ports/worldStore';
import { applyExtraction, eventIdFor, type EvidenceSource, type Sha256Hex } from '../world/extraction';
import type { ExtractionResult } from '../../domain/world/types';
import { LlmRequestFailure } from '../llm/types';
import { planExtractGroups, type ModelBudget } from './groupPlanner';
import type { GroupExtractionResult, GroupSegmentInput, LlmGroupExtractor } from '../world/llmGroupExtractor';

export const PIPELINE_VERSION = 'pipeline-closeout-c3';
export const PLAN_VERSION_CHUNK = 'plan-chunk-1';
export const PLAN_VERSION_GROUP = 'plan-group-1';

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
  /** Group-mode extractor (closeout C3); required when the run plans groups. */
  groupExtractor?: LlmGroupExtractor;
  sha256Hex: Sha256Hex;
  now?: () => string;
  /** Lease TTL in ms; renewals happen between units. */
  leaseTtlMs?: number;
  owner?: string;
  onUnitDone?: (info: { unitsDone: number; unitsTotal: number }) => void;
  /** Optional final publication runs under the same renewable build lease. */
  onFinalize?: (input: {
    run: BuildRunRecord;
    setPhase: (phase: BuildRunPhase) => Promise<void>;
  }) => Promise<void>;
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
  /** C3 group mode: pack chunks into budget-bounded multi-chunk requests. */
  mode?: 'chunk' | 'group';
  budget?: ModelBudget;
}

function chunkJobId(chunkId: string): string {
  return `job-extract-${chunkId}`;
}

/**
 * Plans extraction units. 'chunk' keeps one unit per chunk (C2 baseline);
 * 'group' packs consecutive chunks into model-budget-bounded groups whose
 * coverage ledger is exactly the ordered chunk list (closeout C3).
 */
export async function createExtractionRun(
  deps: Pick<CoordinatorDeps, 'sourceStore' | 'runStore' | 'worldStore' | 'now' | 'sha256Hex'>,
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
  const mode = input.mode ?? 'chunk';
  const configFingerprint = `${PIPELINE_VERSION}#${input.extractorVersion}#${input.modelFingerprint}`;
  const createdAt = now();

  const units: BuildUnitRecord[] = [];
  if (mode === 'group') {
    const groups = planExtractGroups(chunks, input.budget);
    for (const group of groups) {
      const inputHash = await deps.sha256Hex(
        group.segments.map(segment => `${segment.chunkId}:${segment.startCp}-${segment.endCp}`).join('|'),
      );
      units.push({
        unitId: `${input.runId}-g${String(group.ord + 1).padStart(4, '0')}`,
        runId: input.runId,
        kind: 'extract_group' as const,
        sourceRangesJson: JSON.stringify(group.segments.map(segment => ({
          chunkId: segment.chunkId,
          chapterId: segment.chapterId,
          startCp: segment.startCp,
          endCp: segment.endCp,
        }))),
        inputHash,
        configFingerprint,
        parentUnitId: null,
        ord: group.ord,
        status: 'queued' as const,
        attempt: 0,
        retryAt: null,
        resultRef: null,
        usageJson: null,
        errorCode: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
      });
    }
  } else {
    chunks.forEach((chunk, ord) => {
      units.push({
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
      });
    });
  }

  const run: BuildRunRecord = {
    runId: input.runId,
    worldId: input.worldId,
    sourceId: input.sourceId,
    sourceSnapshotHash: `${manifest.rawSha256Hex}:${manifest.normalizedTreeHash}`,
    pipelineVersion: PIPELINE_VERSION,
    planVersion: mode === 'group' ? PLAN_VERSION_GROUP : PLAN_VERSION_CHUNK,
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
  let leaseRenewalInFlight: Promise<void> | null = null;
  const renewLeaseInBackground = (): void => {
    if (leaseRenewalInFlight || lostLease) return;
    leaseRenewalInFlight = deps.runStore.renewLease(runId, owner, fencingToken, ttl, now())
      .then(renewed => { if (!renewed) lostLease = true; })
      .catch(() => { lostLease = true; })
      .finally(() => { leaseRenewalInFlight = null; });
  };
  const leaseTimer = setInterval(renewLeaseInBackground, Math.max(25, Math.floor(ttl / 3)));
  const confirmLeaseAfterRequest = async (): Promise<boolean> => {
    if (lostLease) return false;
    const renewed = await deps.runStore.renewLease(runId, owner, fencingToken, ttl, now());
    if (!renewed) lostLease = true;
    return renewed;
  };
  const pauseResultAfterRequest = async (): Promise<ExecuteRunResult> => {
    await deps.runStore.setRunStatus(runId, 'paused_user', now());
    const paused = await deps.runStore.getRun(runId);
    return {
      runId,
      completed: false,
      unitsDone: paused?.unitsDone ?? run.unitsDone,
      unitsTotal: paused?.unitsTotal ?? run.unitsTotal,
      unitsFailed: paused?.unitsFailed ?? run.unitsFailed,
      lostLease: false,
    };
  };
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

      const ranges = JSON.parse(unit.sourceRangesJson) as Array<
        { chunkId: string; chapterId: string; startCp: number; endCp: number }
      >;
      if (ranges.length === 0) {
        await deps.runStore.completeUnit({
          unitId: unit.unitId, fencingToken, status: 'failed_terminal',
          errorCode: 'bad_range', errorMessage: 'Unit has no source range.', now: now(),
        });
        continue;
      }

      try {
        const unitChunks: SourceChunk[] = [];
        let sourceDrifted = false;
        for (const range of ranges) {
          const chunk = chunksByRange.get(range.chunkId);
          if (!chunk) {
            sourceDrifted = true;
            break;
          }
          unitChunks.push(chunk);
        }
        if (sourceDrifted) {
          await deps.runStore.completeUnit({
            unitId: unit.unitId, fencingToken, status: 'needs_review',
            errorCode: 'source_changed', errorMessage: 'A planned chunk no longer exists.', now: now(),
          });
          continue;
        }

        // Idempotent fast path per chunk: world-side done under the same
        // content hash and config fingerprints (C1 guards) needs no LLM call.
        const pendingChunks: SourceChunk[] = [];
        for (const chunk of unitChunks) {
          if (!(await isChunkDone(deps, run, chunk))) pendingChunks.push(chunk);
        }
        if (pendingChunks.length === 0) {
          const ok = await deps.runStore.completeUnit({
            unitId: unit.unitId, fencingToken, status: 'completed',
            resultRef: ranges.map(range => chunkJobId(range.chunkId)).join(','), now: now(),
          });
          if (!ok) { lostLease = true; break; }
          continue;
        }

        if (ranges.length === 1) {
          const chunk = pendingChunks[0]!;
          const chunkText = await deps.sourceStore.readRange(run.sourceId, chunk.startOffset, chunk.endOffset);
          const extraction = await deps.extractor.extract({
            unitId: unit.unitId, chunk, chunkText, worldId: run.worldId,
          });
          if (deps.signal?.aborted) return await pauseResultAfterRequest();
          if (!(await confirmLeaseAfterRequest())) { lostLease = true; break; }
          const committed = await commitExtractionForChunks(
            deps, run, [chunk], extraction, evidenceSource,
          );
          if (!committed) { lostLease = true; break; }
          const ok = await deps.runStore.completeUnit({
            unitId: unit.unitId, fencingToken, status: 'completed',
            resultRef: chunkJobId(chunk.chunkId), now: now(),
          });
          if (!ok) { lostLease = true; break; }
        } else {
          // Closeout C3 group path: one budget-bounded request over segments.
          if (!deps.groupExtractor) {
            throw new Error('Group unit planned but no group extractor was provided.');
          }
          const titleByChapter = new Map(chapters.map(chapter => [chapter.chapterId, chapter.title]));
          const segments: GroupSegmentInput[] = [];
          for (const chunk of pendingChunks) {
            const text = await deps.sourceStore.readRange(run.sourceId, chunk.startOffset, chunk.endOffset);
            segments.push({
              chunkId: chunk.chunkId,
              chapterId: chunk.chapterId,
              chapterTitle: titleByChapter.get(chunk.chapterId) ?? chunk.chapterId,
              startCp: chunk.startOffset,
              text,
            });
          }
          const group = await deps.groupExtractor.extract({
            unitId: unit.unitId, segments, worldId: run.worldId,
          });
          if (deps.signal?.aborted) return await pauseResultAfterRequest();
          if (!(await confirmLeaseAfterRequest())) { lostLease = true; break; }
          await commitGroupResult(deps, run, pendingChunks, group, evidenceSource);
          const ok = await deps.runStore.completeUnit({
            unitId: unit.unitId, fencingToken, status: 'completed',
            usageJson: JSON.stringify({
              rejectedQuotes: group.rejectedQuotes,
              requestMetrics: group.requestMetrics ?? [],
            }),
            resultRef: pendingChunks.map(chunk => chunkJobId(chunk.chunkId)).join(','),
            now: now(),
          });
          if (!ok) { lostLease = true; break; }
        }
      } catch (error) {
        if (error instanceof LlmRequestFailure && error.requestMetrics.length > 0) {
          const recorded = await deps.runStore.appendUnitRequestMetrics(
            unit.unitId, fencingToken, error.requestMetrics, now(),
          );
          if (!recorded) lostLease = true;
        }
        if (lostLease) break;
        if (deps.signal?.aborted) return await pauseResultAfterRequest();
        const message = error instanceof Error ? error.message : String(error);
        const classification = classifyExtractionError(message);
        const persistedMessage = error instanceof LlmRequestFailure
          ? safeProviderFailureText(error, classification)
          : message.slice(0, 500);
        if (classification === 'truncation' && ranges.length > 1) {
          // Transactional split (plan §7.2): replace the oversized group with
          // halved child units; the parent is canceled and never counts.
          const mid = Math.floor(ranges.length / 2);
          const childDefs = [ranges.slice(0, mid), ranges.slice(mid)];
          const children = [];
          for (let index = 0; index < childDefs.length; index += 1) {
            const half = childDefs[index]!;
            children.push({
              unitId: `${unit.unitId}-s${index + 1}`,
              kind: 'extract_group' as const,
              sourceRangesJson: JSON.stringify(half),
              inputHash: await deps.sha256Hex(half.map(range => `${range.chunkId}:${range.startCp}-${range.endCp}`).join('|')),
              configFingerprint: unit.configFingerprint,
            parentUnitId: unit.unitId,
            ord: unit.ord,
            status: 'queued' as const,
            attempt: 0,
            retryAt: null,
            resultRef: null,
            usageJson: null,
            errorCode: null,
            errorMessage: null,
              createdAt: now(),
              updatedAt: now(),
            });
          }
          const replaced = await deps.runStore.replaceUnitWithChildren({
            unitId: unit.unitId, fencingToken, children, now: now(),
          });
          if (!replaced) { lostLease = true; break; }
          continue;
        }
        // claimUnit increments the persisted attempt after `unit` was read;
        // account for that in the first backoff too, or a failed first request
        // is immediately sent a second physical time before the loop yields.
        const backoffMs = classification === 'config' ? 0 : 5_000 * Math.min(unit.attempt + 1, 6);
        await deps.runStore.completeUnit({
          unitId: unit.unitId,
          fencingToken,
          status: classification === 'config' ? 'needs_review' : 'failed_retryable',
          errorCode: classification,
          errorMessage: persistedMessage,
          retryAt: classification === 'config' ? null : new Date(Date.parse(now()) + backoffMs).toISOString(),
          now: now(),
        });
        if (classification === 'config') {
          await deps.runStore.setRunStatus(runId, 'needs_review', now(), classification, persistedMessage);
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
      if (deps.onFinalize) {
        try {
          await deps.onFinalize({
            run: fresh,
            setPhase: phase => deps.runStore.setRunPhase(runId, phase, now()),
          });
        } catch (error) {
          if (deps.signal?.aborted) return await pauseResultAfterRequest();
          const reason = error instanceof Error ? error.message : String(error);
          const errorCode = reason.includes('连续覆盖全文')
            ? 'source_coverage_incomplete'
            : reason.includes('原文源')
              ? 'source_missing'
              : 'package_finalize_failed';
          await deps.runStore.setRunStatus(
            runId,
            'failed_retryable',
            now(),
            errorCode,
            'Full-source finalization failed; the existing published package remains available.',
          );
          return {
            runId, completed: false, unitsDone: fresh.unitsDone,
            unitsTotal: fresh.unitsTotal, unitsFailed: fresh.unitsFailed, lostLease: false,
          };
        }
      }
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
    clearInterval(leaseTimer);
    if (leaseRenewalInFlight) await leaseRenewalInFlight;
    if (!lostLease) {
      await deps.runStore.releaseLease(runId, owner, fencingToken, now());
    }
  }
}

type ErrorClass = 'network' | 'rate_limit' | 'config' | 'truncation' | 'unknown';

/** World-side done check (C1 guards) for one chunk. */
async function isChunkDone(
  deps: Pick<CoordinatorDeps, 'worldStore' | 'extractor'>,
  run: BuildRunRecord,
  chunk: SourceChunk,
): Promise<boolean> {
  const job = await deps.worldStore.getJob(run.worldId, chunkJobId(chunk.chunkId));
  return job?.status === 'done'
    && job.contentHash === chunk.contentHash
    && job.extractorVersion === deps.extractor.version
    && (job.modelFingerprint ?? null) === run.modelFingerprint;
}

/**
 * Validates + commits one extraction result covering the given chunks. Each
 * chunk's facts/entities/event proposals land through the C1 atomic chunk
 * commit, so partial group commits are still crash-safe per chunk.
 */
async function commitExtractionForChunks(
  deps: CoordinatorDeps,
  run: BuildRunRecord,
  chunks: readonly SourceChunk[],
  extraction: ExtractionResult,
  evidenceSource: EvidenceSource,
): Promise<boolean> {
  const now = deps.now ?? (() => new Date().toISOString());
  for (const chunk of chunks) {
    const resolved = await applyExtraction({
      worldId: run.worldId,
      source: evidenceSource,
      extraction,
      createdAt: now(),
      sha256Hex: deps.sha256Hex,
    });
    await commitResolvedChunk(deps, run, chunk, resolved);
  }
  return true;
}

/**
 * Commits a C3 group result: facts/events are partitioned by the chunk each
 * evidence quote came from; entities go with every chunk commit (the store
 * dedupes). Group-level events whose chunk is already done are attributed to
 * the first still-pending chunk so they are never lost.
 */
async function commitGroupResult(
  deps: CoordinatorDeps,
  run: BuildRunRecord,
  chunks: readonly SourceChunk[],
  group: GroupExtractionResult,
  evidenceSource: EvidenceSource,
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const fallbackChunk = chunks[0]!;
  for (const chunk of chunks) {
    const facts = group.facts.filter(fact => fact.chunkId === chunk.chunkId);
    const events = group.events.filter(event => event.chunkId === chunk.chunkId);
    const extraction: ExtractionResult = {
      entities: group.entities,
      facts: facts.map(({ chunkId: _chunkId, ...fact }) => fact),
      events: events.length > 0 || chunk === fallbackChunk
        ? (chunk === fallbackChunk
          ? [
            ...events.map(({ chunkId: _chunkId, ...event }) => event),
            ...group.events
              .filter(event => event.chunkId !== chunk.chunkId && !chunks.some(c => c.chunkId === event.chunkId))
              .map(({ chunkId: _chunkId, ...event }) => event),
          ]
          : events.map(({ chunkId: _chunkId, ...event }) => event))
        : [],
      ruleMappings: group.ruleMappings,
    };
    if (facts.length === 0 && extraction.events.length === 0 && group.entities.length === 0) continue;
    const resolved = await applyExtraction({
      worldId: run.worldId,
      source: evidenceSource,
      extraction,
      createdAt: now(),
      sha256Hex: deps.sha256Hex,
    });
    await commitResolvedChunk(deps, run, chunk, resolved);
  }
}

/** Shared C1 atomic commit for already-resolved extraction output. */
async function commitResolvedChunk(
  deps: CoordinatorDeps,
  run: BuildRunRecord,
  chunk: SourceChunk,
  resolved: Awaited<ReturnType<typeof applyExtraction>>,
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const eventProposals = resolved.events.map(event => ({
    chunkId: chunk.chunkId,
    eventId: eventIdFor(run.worldId, event.eventKey),
    title: event.title,
    summary: event.summary,
    worldTimeOrder: event.worldTimeOrder ?? null,
    narrativeChapterId: event.narrativeChapterId ?? null,
    dependsOnEventKeys: event.dependsOnEventKeys ?? [],
  }));
  const existing = await deps.worldStore.getJob(run.worldId, chunkJobId(chunk.chunkId));
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
      attempts: (existing?.attempts ?? 0) + 1,
      contentHash: chunk.contentHash,
      extractorVersion: deps.extractor.version,
      modelFingerprint: run.modelFingerprint,
      usageJson: JSON.stringify({ entities: resolved.entities.length, facts: resolved.facts.length }),
      resultJson: JSON.stringify({ ok: true }),
      error: null,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    },
    createdAt: now(),
    updatedAt: now(),
  });
}

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

function safeProviderFailureText(error: LlmRequestFailure, classification: ErrorClass): string {
  const metric = error.requestMetrics[error.requestMetrics.length - 1];
  if (metric?.httpStatus !== null && metric?.httpStatus !== undefined) {
    return `模型服务请求失败（HTTP ${metric.httpStatus}，${classification}）。`;
  }
  if (metric?.errorCategory === 'timeout') {
    return `模型请求超时（${metric.durationMs}ms）。`;
  }
  if (metric?.errorCategory === 'network') return '模型网络连接失败。';
  if (metric?.completionState === 'content_filter') return '模型输出被服务商内容过滤拦截。';
  if (metric?.completionState === 'reasoning_only') return '模型只返回推理内容，正文未完成。';
  if (classification === 'truncation') return '模型响应被截断，结果未通过本地解析。';
  return '模型结果未通过本地校验。';
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
