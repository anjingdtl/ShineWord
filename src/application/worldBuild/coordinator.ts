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
 *
 * 1M resident plan (§4/§6): runs execute with N concurrent workers (default
 * 3, capped 1-4 and TPM-scheduled); 'resident' mode keeps the whole book as
 * a byte-stable [system, user] prefix and varies only a final per-unit scope
 * message so provider prefix caches hit.
 */
import type { SourceChunk, SourceChapter } from '../../domain/world/types';
import type { SourceStore } from '../ports/sourceStore';
import type { BuildRunPhase, BuildRunRecord, BuildRunStore, BuildUnitRecord } from '../ports/worldBuildStore';
import type { WorldStore, WorldRecord } from '../ports/worldStore';
import { applyExtraction, eventIdFor, type EvidenceSource, type Sha256Hex } from '../world/extraction';
import type { ExtractionResult } from '../../domain/world/types';
import { LlmRequestFailure } from '../llm/types';
import {
  DEFAULT_MODEL_BUDGET,
  DEFAULT_PROMPT_OVERHEAD_TOKENS,
  OutputPerChunkCalibrator,
  planExtractGroups,
  splitPartCount,
  type ModelBudget,
} from './groupPlanner';
import type { GroupExtractionResult, GroupSegmentInput, LlmGroupExtractor } from '../world/llmGroupExtractor';

export const PIPELINE_VERSION = 'pipeline-closeout-c3';
export const PLAN_VERSION_CHUNK = 'plan-chunk-1';
export const PLAN_VERSION_GROUP = 'plan-group-1';
export const PLAN_VERSION_RESIDENT = 'plan-resident-1';

/** Resident viability (1M plan §4.1): book + overhead <= 85% of the window. */
export const RESIDENT_WINDOW_RATIO = 0.85;
export const RESIDENT_DEGRADED_TOO_LARGE = 'resident_degraded_book_too_large';
export const RESIDENT_DEGRADED_NO_CACHE = 'resident_degraded_no_prompt_cache';
export const DEFAULT_WORKER_CONCURRENCY = 3;
export const MAX_WORKER_CONCURRENCY = 4;
/** Conservative TPM scheduling share (plan §6); cached traffic counts fully. */
export const TPM_SCHEDULING_RATIO = 0.7;
/** Reasoning-reserve bump ladder for reasoning_only retries (plan §3.3). */
const REASONING_RESERVE_LADDER = [2_048, 4_096, 8_192, 16_384, 32_768] as const;

export function nextReasoningReserve(current: number): number {
  for (const step of REASONING_RESERVE_LADDER) {
    if (step > current) return step;
  }
  return current * 2;
}

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
  /**
   * Worker concurrency for extract units (1-4; default 3, additionally
   * capped by TPM scheduling, plan §6). Units still commit per chunk in a
   * single transaction each, so concurrency never weakens atomicity.
   */
  concurrency?: number;
  /** Provider tokens-per-minute for conservative worker capping (§6). */
  tpmTokensPerMinute?: number;
  /**
   * The planning budget. Resident-mode degradation and reasoning_only
   * reserve-bump retries read it; production callers pass the same budget
   * they planned the run with.
   */
  budget?: ModelBudget;
  /**
   * Pass 0 (plan §4.3): builds the whole-book entity registry before the
   * first resident unit; the returned compact summary is injected into every
   * scope instruction ("prefer these entity keys"). Failures degrade to a
   * registry-free run - the registry is an enhancement, never a gate.
   */
  buildRegistry?: (input: {
    segmentBody: string;
    worldId: string;
    contentHash: string;
    modelFingerprint: string;
  }) => Promise<string | undefined>;
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
  mode?: 'chunk' | 'group' | 'resident';
  budget?: ModelBudget;
}

export interface ResidentViability {
  viable: boolean;
  code?: typeof RESIDENT_DEGRADED_TOO_LARGE | typeof RESIDENT_DEGRADED_NO_CACHE;
  reason?: string;
}

/**
 * Resident viability (1M plan §4.1): the whole book (conservative 1
 * token/code point) plus prompt overhead must fit in 85% of the context
 * window, and the model must support prefix caching - without cache hits a
 * resident run re-prefills the whole book per unit and is strictly worse
 * than windowed packing.
 */
export function assessResidentViability(
  chunks: readonly SourceChunk[],
  budget: ModelBudget | undefined,
): ResidentViability {
  if (!budget) {
    return {
      viable: false,
      code: RESIDENT_DEGRADED_TOO_LARGE,
      reason: 'resident 模式需要模型预算（budget）才能评估全书驻留窗口。',
    };
  }
  const bookTokens = chunks.reduce((sum, chunk) => sum + Math.ceil(chunk.charCount), 0);
  const total = bookTokens + DEFAULT_PROMPT_OVERHEAD_TOKENS;
  const allowed = Math.floor(budget.contextWindowTokens * RESIDENT_WINDOW_RATIO);
  if (total > allowed) {
    return {
      viable: false,
      code: RESIDENT_DEGRADED_TOO_LARGE,
      reason: `全书估算 ${total} token 超过驻留窗口上限 ${allowed}（contextWindow×0.85），resident 退化为窗口模式。`,
    };
  }
  if (!budget.supportsPromptCache) {
    return {
      viable: false,
      code: RESIDENT_DEGRADED_NO_CACHE,
      reason: '模型不支持前缀缓存（cached_tokens=0），resident 退化为窗口模式以避免每单元重复全书 prefill。',
    };
  }
  return { viable: true };
}

/**
 * Conservative worker capping (plan §6): N x prompt-tokens-per-request must
 * stay within TPM x 0.7, cached traffic counted in full.
 */
export function capWorkersByTpm(
  requested: number,
  tpm: number | undefined,
  promptTokensPerRequest: number,
): number {
  const base = Math.max(1, Math.min(MAX_WORKER_CONCURRENCY, Math.floor(requested)));
  if (!tpm || tpm <= 0 || promptTokensPerRequest <= 0) return base;
  const allowed = Math.floor((tpm * TPM_SCHEDULING_RATIO) / promptTokensPerRequest);
  return Math.max(1, Math.min(base, allowed));
}

/** Contiguous even split of an ordered list into `parts` non-empty slices. */
export function splitRangesEvenly<T>(items: readonly T[], parts: number): T[][] {
  if (parts < 1 || items.length === 0) return [items.slice()];
  const bounded = Math.min(parts, items.length);
  const result: T[][] = [];
  const base = Math.floor(items.length / bounded);
  const remainder = items.length % bounded;
  let offset = 0;
  for (let index = 0; index < bounded; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    result.push(items.slice(offset, offset + size));
    offset += size;
  }
  return result;
}

function chunkJobId(chunkId: string): string {
  return `job-extract-${chunkId}`;
}

/**
 * Plans extraction units. 'chunk' keeps one unit per chunk (C2 baseline);
 * 'group' packs consecutive chunks into output-budget-bounded groups whose
 * coverage ledger is exactly the ordered chunk list (closeout C3 + 1M §5);
 * 'resident' (1M plan §4) plans the same ranges but executes each unit
 * against a byte-stable whole-book prefix - it transparently degrades to
 * 'group' when the book does not fit 85% of the window or the model has no
 * prefix-cache support, recording the reason on the run.
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
  const requestedMode = input.mode ?? 'chunk';
  let mode: 'chunk' | 'group' | 'resident' = requestedMode;
  let residentDegraded: ResidentViability | null = null;
  if (mode === 'resident') {
    const viability = assessResidentViability(chunks, input.budget);
    if (!viability.viable) {
      mode = 'group';
      residentDegraded = viability;
    }
  }
  const configFingerprint = `${PIPELINE_VERSION}#${input.extractorVersion}#${input.modelFingerprint}`;
  const createdAt = now();

  const units: BuildUnitRecord[] = [];
  if (mode === 'group' || mode === 'resident') {
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
    planVersion: mode === 'resident'
      ? PLAN_VERSION_RESIDENT
      : mode === 'group' ? PLAN_VERSION_GROUP : PLAN_VERSION_CHUNK,
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
    lastErrorCode: residentDegraded?.code ?? null,
    lastErrorMessage: residentDegraded?.reason ?? null,
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
 * Executes one run under a lease with N concurrent workers (default 3, plan
 * §6). Claims are atomic per unit (transactional compare-and-set plus an
 * in-process ownership set), commits stay per-chunk single-transaction, and
 * a lost lease (another owner, cancel) stops every worker without corrupting
 * state.
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
  const allChunks: SourceChunk[] = [];
  for (const chunk of await deps.sourceStore.getChunks(run.sourceId)) {
    chunksByRange.set(chunk.chunkId, chunk);
    allChunks.push(chunk);
  }
  allChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  const globalSegmentIndexOf = new Map(allChunks.map((chunk, index) => [chunk.chunkId, index + 1]));

  const resident = run.planVersion === PLAN_VERSION_RESIDENT;

  // Resident context is built ONCE per execution: the whole-book prefix is
  // byte-stable for every unit (same reads, same assembly - 1M plan §4.2).
  let bookSegments: readonly GroupSegmentInput[] | null = null;
  let bookPromptTokens = 0;
  let registrySummary: string | undefined;
  if (resident) {
    if (!deps.groupExtractor) {
      throw new Error('Resident run planned but no group extractor was provided.');
    }
    const titleByChapter = new Map(chapters.map(chapter => [chapter.chapterId, chapter.title]));
    const segments: GroupSegmentInput[] = [];
    for (const chunk of allChunks) {
      const text = await deps.sourceStore.readRange(run.sourceId, chunk.startOffset, chunk.endOffset);
      segments.push({
        chunkId: chunk.chunkId,
        chapterId: chunk.chapterId,
        chapterTitle: titleByChapter.get(chunk.chapterId) ?? chunk.chapterId,
        startCp: chunk.startOffset,
        text,
      });
    }
    bookSegments = segments;
    bookPromptTokens = allChunks.reduce((sum, chunk) => sum + Math.ceil(chunk.charCount), 0)
      + DEFAULT_PROMPT_OVERHEAD_TOKENS;

    // Pass 0 (plan §4.3): one registry request over the same byte-stable
    // prefix; failure degrades to a registry-free run, never blocks it.
    if (deps.buildRegistry) {
      try {
        const segmentBody = segments.map((segment, index) => {
          const header = `[S${index + 1} ${segment.chapterTitle}]`;
          return `${header}\n${segment.text}`;
        }).join('\n\n');
        const contentHash = await deps.sha256Hex(
          segments.map(segment => segment.chunkId).join('|'),
        );
        registrySummary = await deps.buildRegistry({
          segmentBody,
          worldId: run.worldId,
          contentHash,
          modelFingerprint: run.modelFingerprint,
        }) ?? undefined;
      } catch {
        registrySummary = undefined;
      }
    }
  }

  // Worker count: profile-configured 1-4 (default 3), TPM-capped (§6).
  let windowedPromptTokens = 0;
  if (!resident) {
    const planned = await deps.runStore.listUnits(runId);
    for (const unit of planned) {
      const ranges = JSON.parse(unit.sourceRangesJson) as Array<{ chunkId: string }>;
      let body = 0;
      for (const range of ranges) {
        const chunk = chunksByRange.get(range.chunkId);
        if (chunk) body += Math.ceil(chunk.charCount);
      }
      windowedPromptTokens = Math.max(windowedPromptTokens, body);
    }
    windowedPromptTokens += DEFAULT_PROMPT_OVERHEAD_TOKENS;
  }
  const workerCount = capWorkersByTpm(
    deps.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    deps.tpmTokensPerMinute,
    resident ? bookPromptTokens : windowedPromptTokens,
  );

  let lostLease = false;
  let stopRequested = false;
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

  type UnitOutcome = 'continue' | 'lost_lease' | 'paused' | 'stopped';

  // Concurrency bookkeeping (plan §6): in-process claim ownership, online
  // output calibration, and one reasoning-reserve bump per unit (§3.3).
  const claimedByWorkers = new Set<string>();
  const calibrator = new OutputPerChunkCalibrator();
  const reasoningBumpRetried = new Set<string>();
  let completedGroups = run.unitsDone;
  let unitsDoneLocal = run.unitsDone;

  let claimChain: Promise<unknown> = Promise.resolve();
  const claimNextUnit = async (candidates: readonly BuildUnitRecord[]): Promise<BuildUnitRecord | null> => {
    const attempt = async (): Promise<BuildUnitRecord | null> => {
      for (const unit of candidates) {
        if (claimedByWorkers.has(unit.unitId)) continue;
        if (await deps.runStore.claimUnit(unit.unitId, now())) {
          claimedByWorkers.add(unit.unitId);
          return unit;
        }
      }
      return null;
    };
    const next = claimChain.then(attempt, attempt);
    claimChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const isReasoningOnlyFailure = (error: unknown): boolean =>
    error instanceof LlmRequestFailure
    && error.requestMetrics.some(metric =>
      metric.completionState === 'reasoning_only' || metric.outcome === 'reasoning_only');

  const contentBudgetForSplits = (): number =>
    deps.budget?.maxContentOutputTokens ?? DEFAULT_MODEL_BUDGET.maxContentOutputTokens;

  const recordCalibrationSample = (group: GroupExtractionResult, chunkCount: number): void => {
    const metrics = group.requestMetrics ?? [];
    const last = metrics[metrics.length - 1];
    const outputTokens = last?.usage?.outputTokens;
    if (typeof outputTokens !== 'number' || chunkCount < 1) return;
    const reasoningTokens = typeof last?.usage?.reasoningTokens === 'number' ? last.usage.reasoningTokens : 0;
    calibrator.record(Math.max(0, outputTokens - reasoningTokens), chunkCount);
  };

  const usageSummaryFor = (group: GroupExtractionResult): string => {
    const metrics = group.requestMetrics ?? [];
    const last = metrics[metrics.length - 1];
    return JSON.stringify({
      rejectedQuotes: group.rejectedQuotes,
      requestMetrics: metrics,
      outputTokens: last?.usage?.outputTokens ?? null,
      cachedInputTokens: last?.usage?.cachedInputTokens ?? null,
      reasoningTokens: last?.usage?.reasoningTokens ?? null,
    });
  };

  /**
   * reasoning_only handling (plan §3.3): bump the reasoning reserve one
   * ladder step and retry the SAME unit once before any split. The provider
   * has already grown its own budget twice by the time we see the failure.
   */
  const runWithReasoningReserveBump = async (
    unit: BuildUnitRecord,
    makeRequest: (maxOutputTokens?: number) => Promise<GroupExtractionResult>,
  ): Promise<GroupExtractionResult> => {
    try {
      return await makeRequest();
    } catch (error) {
      if (!isReasoningOnlyFailure(error) || !deps.budget || reasoningBumpRetried.has(unit.unitId)) {
        throw error;
      }
      reasoningBumpRetried.add(unit.unitId);
      if (error instanceof LlmRequestFailure && error.requestMetrics.length > 0) {
        await deps.runStore.appendUnitRequestMetrics(
          unit.unitId, fencingToken, error.requestMetrics, now(),
        );
      }
      const bumpedReserve = nextReasoningReserve(deps.budget.reasoningReserveTokens);
      const bumpedOutput = deps.budget.maxContentOutputTokens + bumpedReserve;
      return await makeRequest(bumpedOutput);
    }
  };

  const processUnit = async (unit: BuildUnitRecord): Promise<UnitOutcome> => {
    const ranges = JSON.parse(unit.sourceRangesJson) as Array<
      { chunkId: string; chapterId: string; startCp: number; endCp: number }
    >;
    if (ranges.length === 0) {
      await deps.runStore.completeUnit({
        unitId: unit.unitId, fencingToken, status: 'failed_terminal',
        errorCode: 'bad_range', errorMessage: 'Unit has no source range.', now: now(),
      });
      return 'continue';
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
        return 'continue';
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
        if (!ok) { lostLease = true; return 'lost_lease'; }
        unitsDoneLocal += 1;
        deps.onUnitDone?.({ unitsDone: unitsDoneLocal, unitsTotal: run.unitsTotal });
        return 'continue';
      }

      if (ranges.length === 1 && !resident) {
        const chunk = pendingChunks[0]!;
        const chunkText = await deps.sourceStore.readRange(run.sourceId, chunk.startOffset, chunk.endOffset);
        const extraction = await deps.extractor.extract({
          unitId: unit.unitId, chunk, chunkText, worldId: run.worldId,
        });
        if (deps.signal?.aborted) return 'paused';
        if (!(await confirmLeaseAfterRequest())) { lostLease = true; return 'lost_lease'; }
        const committed = await commitExtractionForChunks(
          deps, run, [chunk], extraction, evidenceSource,
        );
        if (!committed) { lostLease = true; return 'lost_lease'; }
        const ok = await deps.runStore.completeUnit({
          unitId: unit.unitId, fencingToken, status: 'completed',
          resultRef: chunkJobId(chunk.chunkId), now: now(),
        });
        if (!ok) { lostLease = true; return 'lost_lease'; }
        unitsDoneLocal += 1;
        deps.onUnitDone?.({ unitsDone: unitsDoneLocal, unitsTotal: run.unitsTotal });
      } else {
        // C3 group path (windowed) or resident path (1M plan §4.2): one
        // budget-bounded request over segments.
        if (!deps.groupExtractor) {
          throw new Error('Group unit planned but no group extractor was provided.');
        }
        let group: GroupExtractionResult;
        if (resident && bookSegments) {
          const firstSegment = globalSegmentIndexOf.get(ranges[0]!.chunkId) ?? 1;
          const lastSegment = globalSegmentIndexOf.get(ranges[ranges.length - 1]!.chunkId) ?? firstSegment;
          const makeRequest = async (maxOutputTokens?: number): Promise<GroupExtractionResult> =>
            deps.groupExtractor!.extractResident({
              unitId: unit.unitId,
              segments: bookSegments,
              scope: { firstSegment, lastSegment },
              worldId: run.worldId,
              registrySummary,
              maxOutputTokens,
            });
          group = await runWithReasoningReserveBump(unit, makeRequest);
        } else {
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
          const makeRequest = async (maxOutputTokens?: number): Promise<GroupExtractionResult> =>
            deps.groupExtractor!.extract({
              unitId: unit.unitId, segments, worldId: run.worldId, maxOutputTokens,
            });
          group = await runWithReasoningReserveBump(unit, makeRequest);
        }
        if (deps.signal?.aborted) return 'paused';
        if (!(await confirmLeaseAfterRequest())) { lostLease = true; return 'lost_lease'; }
        await commitGroupResult(deps, run, pendingChunks, group, evidenceSource);
        recordCalibrationSample(group, pendingChunks.length);
        completedGroups += 1;
        if (calibrator.due(completedGroups)) calibrator.recalibrate();
        const ok = await deps.runStore.completeUnit({
          unitId: unit.unitId,
          fencingToken,
          status: 'completed',
          usageJson: usageSummaryFor(group),
          resultRef: pendingChunks.map(chunk => chunkJobId(chunk.chunkId)).join(','),
          now: now(),
        });
        if (!ok) { lostLease = true; return 'lost_lease'; }
        unitsDoneLocal += 1;
        deps.onUnitDone?.({ unitsDone: unitsDoneLocal, unitsTotal: run.unitsTotal });
      }
    } catch (error) {
      if (error instanceof LlmRequestFailure && error.requestMetrics.length > 0) {
        const recorded = await deps.runStore.appendUnitRequestMetrics(
          unit.unitId, fencingToken, error.requestMetrics, now(),
        );
        if (!recorded) lostLease = true;
      }
      if (lostLease) return 'lost_lease';
      if (deps.signal?.aborted) return 'paused';
      const message = error instanceof Error ? error.message : String(error);
      const classification = classifyExtractionError(message);
      const persistedMessage = error instanceof LlmRequestFailure
        ? safeProviderFailureText(error, classification)
        : message.slice(0, 500);
      if (classification === 'truncation' && ranges.length > 1) {
        // Transactional split (plan §7.2, generalized by §5 calibration): the
        // oversized group is replaced by calibrated, output-budget-fitting
        // child units; the parent is canceled and never counts.
        const parts = splitPartCount(ranges.length, calibrator.currentEstimate, contentBudgetForSplits());
        const childDefs = splitRangesEvenly(ranges, parts);
        const children = [];
        for (let index = 0; index < childDefs.length; index += 1) {
          const part = childDefs[index]!;
          children.push({
            unitId: `${unit.unitId}-s${index + 1}`,
            kind: 'extract_group' as const,
            sourceRangesJson: JSON.stringify(part),
            inputHash: await deps.sha256Hex(part.map(range => `${range.chunkId}:${range.startCp}-${range.endCp}`).join('|')),
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
        if (!replaced) { lostLease = true; return 'lost_lease'; }
        return 'continue';
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
        stopRequested = true;
        return 'stopped';
      }
    }
    return 'continue';
  };

  const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

  const worker = async (): Promise<'done' | 'lost_lease' | 'paused' | 'stopped'> => {
    for (;;) {
      if (lostLease) return 'lost_lease';
      if (stopRequested) return 'stopped';
      if (deps.signal?.aborted) return 'paused';
      const executable = await deps.runStore.listExecutableUnits(runId, now());
      if (executable.length === 0) return 'done';
      const candidates = executable.filter(unit => !claimedByWorkers.has(unit.unitId));
      if (candidates.length === 0) {
        // Every visible unit is owned by a sibling worker; back-to-back
        // execution keeps the resident prefix cache warm (§4.2).
        await sleep(200);
        continue;
      }
      if (!(await deps.runStore.renewLease(runId, owner, fencingToken, ttl, now()))) {
        lostLease = true;
        return 'lost_lease';
      }
      const unit = await claimNextUnit(candidates);
      if (!unit) continue;
      let outcome: UnitOutcome;
      try {
        outcome = await processUnit(unit);
      } finally {
        claimedByWorkers.delete(unit.unitId);
      }
      if (outcome === 'lost_lease') return 'lost_lease';
      if (outcome === 'paused') return 'paused';
      if (outcome === 'stopped') return 'stopped';
    }
  };

  try {
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    if (deps.signal?.aborted) return await pauseResultAfterRequest();

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
  // Group-level rule mappings may cite evidence from ANY member chunk, so the
  // verbatim-verified quotes travel with the commit (1M plan P4); mappings
  // themselves ride the FIRST chunk commit only - the store dedupes by stable
  // mappingId on replay.
  const groupVerifiedQuotes = group.facts.map(fact => fact.evidence.quote);
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
      ruleMappings: chunk === fallbackChunk ? group.ruleMappings : [],
    };
    if (facts.length === 0 && extraction.events.length === 0 && group.entities.length === 0
      && extraction.ruleMappings.length === 0) continue;
    const resolved = await applyExtraction({
      worldId: run.worldId,
      source: evidenceSource,
      extraction,
      createdAt: now(),
      sha256Hex: deps.sha256Hex,
      additionalVerifiedQuotes: groupVerifiedQuotes,
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
    ruleMappings: resolved.ruleMappings,
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
