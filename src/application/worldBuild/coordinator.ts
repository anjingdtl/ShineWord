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
import { mirrorSourceId } from '../ports/worldStore';
import { applyExtraction, eventIdFor, type EvidenceSource, type Sha256Hex } from '../world/extraction';
import type { ExtractionResult } from '../../domain/world/types';
import { LlmRequestFailure } from '../llm/types';
import { OutcomeUnknownReplayError } from '../llm/requestLedger';
import { BudgetInfeasibleError } from '../llm/requestPlan';
import {
  DEFAULT_MODEL_BUDGET,
  DEFAULT_PROMPT_OVERHEAD_TOKENS,
  OutputPerChunkCalibrator,
  planExtractGroups,
  splitPartCount,
  type ModelBudget,
} from './groupPlanner';
import {
  nextBodyTargetRatio,
  orderChunksByChapter,
  planChapterBatches,
  type ExtractionRoute,
} from './chapterBatchPlanner';
import {
  capSourceRatioByDensity,
  densitySplitPartCount,
  nextSourceRatioDown,
  nextSourceRatioUp,
  planAnalysisBatches,
  PLAN_VERSION_ANALYSIS,
  SOURCE_RATIO_PROBE_START,
  TokenDensityCalibrator,
  DEFAULT_EXTRACTION_DENSITY,
} from './analysisBatchPlanner';
import { revivePlanState, type FrozenRunConfig, type RunPlanState } from './runConfig';
import type { GroupExtractionResult, GroupSegmentInput, LlmGroupExtractor } from '../world/llmGroupExtractor';
import { deriveSafetyMargin } from '../context/modelEnvelope';
import { AUTOMATIC_MAPPING_RETRY, isAutomaticMappingFailure } from './automaticMappingRecovery';

export const PIPELINE_VERSION = 'pipeline-unified-1';
export const PLAN_VERSION_CHUNK = 'plan-chunk-1';
export const PLAN_VERSION_GROUP = 'plan-group-1';
export const PLAN_VERSION_RESIDENT = 'plan-resident-1';
/** Chapter-aligned windowed planning (unified build P1 §2). */
export const PLAN_VERSION_CHAPTER = 'plan-chapter-1';
/** Chapter-first, token-budget analysis batches (planner-v2). */
export { PLAN_VERSION_ANALYSIS };

/** Resident viability (1M plan §4.1): book + overhead <= 85% of the window. */
export const RESIDENT_WINDOW_RATIO = 0.85;
export const RESIDENT_DEGRADED_TOO_LARGE = 'resident_degraded_book_too_large';
export const RESIDENT_DEGRADED_NO_CACHE = 'resident_degraded_no_prompt_cache';
/**
 * Default worker concurrency (2026-10-01: 3 -> 2). Rate-limited accounts
 * 429-storm far more often at 3 wide; the global scheduler's adaptive
 * spacing serializes further under pressure anyway.
 */
export const DEFAULT_WORKER_CONCURRENCY = 2;
export const MAX_WORKER_CONCURRENCY = 4;
/** Conservative TPM scheduling share (plan §6); cached traffic counts fully. */
export const TPM_SCHEDULING_RATIO = 0.7;
/**
 * Exponential unit backoff for provider rate limiting: the account itself
 * needs recovery time, and the global scheduler floor stacks on top of this.
 * 15s -> 30s -> 60s -> 120s -> 240s (cap), plus jitter so sibling workers
 * that failed together do not retry in lockstep.
 */
const RATE_LIMIT_BACKOFF_BASE_MS = 15_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 240_000;
const RATE_LIMIT_BACKOFF_JITTER_MS = 3_000;
/** Legacy reserve helper retained for imported run records and compatibility tests. */
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
    route?: string;
    reserveMultiplier?: number;
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
  /**
   * Pass 3 (plan §4.3): whole-book timeline ordering/dependencies BEFORE the
   * local resolver runs - the model proposes, resolveEventProposals stays as
   * the floor for anything this pass misses. Failure is non-fatal.
   */
  onTimeline?: (input: { worldId: string; contentHash: string }) => Promise<void>;
  onUnitDone?: (info: { unitsDone: number; unitsTotal: number }) => void;
  /**
   * TTFP hook (planner-v2 progressive runs): called after each completed
   * extract unit of a stage-scoped run. The implementation evaluates the
   * deterministic playability gate over persisted canon and, when it first
   * passes, publishes the Opening Package - the user may start playing while
   * the remaining batches keep building in the background. Failures are
   * non-fatal: the run's regular finalize still publishes at the end.
   */
  onBatchCommitted?: (info: { run: BuildRunRecord; unitsDone: number; unitsTotal: number }) => Promise<void>;
  /** Optional final publication runs under the same renewable build lease. */
  onFinalize?: (input: {
    run: BuildRunRecord;
    setPhase: (phase: BuildRunPhase) => Promise<void>;
  }) => Promise<void>;
  signal?: { aborted: boolean; stopRequested?: boolean };
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
  /**
   * Frozen run configuration (unified build P1 §1): endpoint/model/keyRef and
   * non-secret execution parameters. Persisted on the run; later profile
   * edits must not change this run.
   */
  config?: FrozenRunConfig;
  /**
   * Stage scope restriction (unified build P3): only chunks overlapping this
   * codepoint range are planned. Null/undefined = whole source.
   */
  scope?: { startCp: number; endCp: number } | null;
  /**
   * Dual-route extraction (unified build P1 §4): the same batch body is
   * extracted twice with route-focused prompts (characters/relations/states
   * vs world rules/events/timeline). Default 'single'.
   */
  routes?: 'single' | 'dual';
  /** Initial body target ratio override (default from frozen config / 0.30). */
  bodyTargetRatio?: number;
  /** Planner-v2 probe start override (default SOURCE_RATIO_PROBE_START). */
  initialSourceRatio?: number;
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
  const hardInput = budget.contextWindowTokens - budget.maxContentOutputTokens
    - budget.reasoningReserveTokens - budget.reserveTokens
    - deriveSafetyMargin(budget.contextWindowTokens);
  const allowed = Math.min(
    Math.floor(budget.contextWindowTokens * RESIDENT_WINDOW_RATIO),
    hardInput,
  );
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

export interface UnitRangeEntry {
  chunkId: string;
  chapterId: string;
  startCp: number;
  endCp: number;
}

/**
 * Parses a unit's source ranges. New units use the v2 envelope
 * {version, route, ranges}; legacy units are bare arrays. Route travels with
 * the unit so dual-route runs resume correctly after process death.
 */
export function parseUnitRanges(sourceRangesJson: string): { route: ExtractionRoute | null; ranges: UnitRangeEntry[] } {
  const parsed: unknown = JSON.parse(sourceRangesJson);
  if (Array.isArray(parsed)) {
    return { route: null, ranges: parsed as UnitRangeEntry[] };
  }
  if (parsed && typeof parsed === 'object') {
    const envelope = parsed as { version?: unknown; route?: unknown; ranges?: unknown };
    if (Array.isArray(envelope.ranges)) {
      const route = envelope.route === 'characters' || envelope.route === 'world' ? envelope.route : null;
      return { route, ranges: envelope.ranges as UnitRangeEntry[] };
    }
  }
  throw new Error('Unrecognized unit sourceRangesJson shape.');
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
  // Stage scope (unified P3): plan only chunks overlapping [startCp, endCp).
  let plannedChunks = chunks;
  if (input.scope) {
    plannedChunks = chunks.filter(chunk =>
      chunk.endOffset > input.scope!.startCp && chunk.startOffset < input.scope!.endCp);
    if (plannedChunks.length === 0) {
      throw new Error(`Scope [${input.scope.startCp}, ${input.scope.endCp}) covers no chunks.`);
    }
  }
  let mode: 'chunk' | 'group' | 'resident' = requestedMode;
  let residentDegraded: ResidentViability | null = null;
  if (mode === 'resident') {
    // Scoped (stage) runs only ever see the authorized range in the resident
    // prefix (plan §3: never send un-triggered stages through "optimizations").
    const viability = assessResidentViability(plannedChunks, input.budget);
    if (!viability.viable) {
      mode = 'group';
      residentDegraded = viability;
    }
  }
  const configFingerprint = `${PIPELINE_VERSION}#${input.extractorVersion}#${input.modelFingerprint}`;
  const createdAt = now();

  const routes = input.routes ?? 'single';
  const planState: RunPlanState = mode === 'group'
    ? {
      bodyTargetRatio: 0.30,
      plannerVersion: PLAN_VERSION_ANALYSIS,
      sourceRatio: input.initialSourceRatio ?? SOURCE_RATIO_PROBE_START,
      density: DEFAULT_EXTRACTION_DENSITY,
      replanCount: 0,
    }
    : {
      bodyTargetRatio: input.bodyTargetRatio ?? input.config?.bodyTargetRatio ?? 0.30,
      replanCount: 0,
    };

  const units: BuildUnitRecord[] = [];
  if (mode === 'group' || mode === 'resident') {
    if (mode === 'group') {
      // Planner-v2 (plan-analysis-1): chapter-first AnalysisSlices packed by
      // pure token budgets (window share + hard input room + output density).
      // Storage chunk counts no longer bound the batch in ANY way.
      const chapters = await deps.sourceStore.getChapters(input.sourceId);
      const batches = planAnalysisBatches(chapters, plannedChunks, input.budget ?? DEFAULT_MODEL_BUDGET, {
        sourceRatio: planState.sourceRatio,
        density: planState.density,
        routes,
      });
      for (const batch of batches) {
        const seed = `${batch.inputHashSeed}|${batch.route ?? 'all'}`;
        const inputHash = await deps.sha256Hex(seed);
        units.push({
          unitId: `${input.runId}-g${String(batch.ord + 1).padStart(4, '0')}${batch.route === 'characters' ? 'c' : batch.route === 'world' ? 'w' : ''}`,
          runId: input.runId,
          kind: 'extract_group' as const,
          sourceRangesJson: JSON.stringify({
            version: 2 as const,
            route: batch.route ?? null,
            ranges: batch.segments.map(segment => ({
              chunkId: segment.chunkId,
              chapterId: segment.chapterId,
              startCp: segment.startCp,
              endCp: segment.endCp,
            })),
          }),
          inputHash,
          configFingerprint,
          parentUnitId: null,
          ord: batch.ord,
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
      const groups = planExtractGroups(plannedChunks, input.budget);
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
    }
  } else {
    plannedChunks.forEach((chunk, ord) => {
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
      : mode === 'group' ? PLAN_VERSION_ANALYSIS : PLAN_VERSION_CHUNK,
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
    configJson: input.config ? JSON.stringify(input.config) : null,
    planStateJson: JSON.stringify(planState),
    scopeJson: input.scope ? JSON.stringify(input.scope) : null,
    pauseRequested: false,
    cancelRequested: false,
  };
  await deps.runStore.createRun(run, units);

  // The world row mirrors the source snapshot so the library and publishers
  // keep working with the existing world-scoped tables. Multi-part imports
  // (product ask 2026-10-01 #2): a source not yet registered under this world
  // is mirrored even when the world row already exists - part N>=2 mirrors
  // with an `s{N}-` id prefix and a globally continuing chapter index.
  const existing = await deps.worldStore.getWorld(input.worldId);
  const memberships = await deps.worldStore.listWorldSources(input.worldId);
  const registered = memberships.find(m => m.sourceId === input.sourceId);
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
  }
  // Register after the world row exists (world_sources carries FKs to both).
  const sourceOrdinal = registered
    ? registered.sourceOrdinal
    : await deps.worldStore.addWorldSource({
      worldId: input.worldId,
      sourceOrdinal: memberships.length + 1,
      sourceId: input.sourceId,
      rawSha256: manifest.rawSha256Hex,
      createdAt,
    });
  if (!registered) {
    // Mirror chapters/chunks into the world-scoped tables: one authority for
    // world content, the source tables stay the import-side truth. The base
    // index continues after every already-mirrored part.
    const chaptersSoFar = memberships.length > 0
      ? (await deps.worldStore.getChapters(input.worldId)).length
      : 0;
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
    }, createdAt, { sourceOrdinal, baseChapterCount: chaptersSoFar });
  }
  if (!existing) {
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
  // Multi-part mirror view (product ask 2026-10-01 #2): world-side ids for a
  // part N>=2 source carry the `s{N}-` prefix, while every read of the raw
  // text and every unit range keeps native source ids. The wrappers below
  // are the single translation point for the whole executor.
  const memberships = await deps.worldStore.listWorldSources(run.worldId);
  const sourceOrdinal = memberships.find(m => m.sourceId === run.sourceId)?.sourceOrdinal ?? 1;
  const toWorldChunk = (chunk: SourceChunk): SourceChunk => sourceOrdinal <= 1 ? chunk : {
    ...chunk,
    chunkId: mirrorSourceId(sourceOrdinal, chunk.chunkId),
    chapterId: mirrorSourceId(sourceOrdinal, chunk.chapterId),
  };
  const evidenceSource: EvidenceSource = {
    chapters: sourceOrdinal <= 1 ? chapters : chapters.map(chapter => ({
      ...chapter,
      chapterId: mirrorSourceId(sourceOrdinal, chapter.chapterId),
    })),
    sliceRange: (startCp, endCp) => deps.sourceStore.readRange(run.sourceId, startCp, endCp),
  };
  const chunksByRange = new Map<string, SourceChunk>();
  const allChunks: SourceChunk[] = [];
  for (const chunk of await deps.sourceStore.getChunks(run.sourceId)) {
    chunksByRange.set(chunk.chunkId, chunk);
    allChunks.push(chunk);
  }
  // Canonical order is chapter order then per-chunk order: the streaming
  // importer resets chunkIndex per chapter, so chunkIndex alone is not global.
  const orderedAllChunks = orderChunksByChapter(chapters, allChunks);
  allChunks.length = 0;
  allChunks.push(...orderedAllChunks);
  // Stage scope (unified P3): the resident prefix and segment numbering only
  // ever contain the run's authorized range - un-triggered stages never ride
  // along, not even as "context".
  const runScope = run.scopeJson ? JSON.parse(run.scopeJson) as { startCp: number; endCp: number } : null;
  const bookChunks = runScope
    ? allChunks.filter(chunk => chunk.endOffset > runScope.startCp && chunk.startOffset < runScope.endCp)
    : allChunks;
  const globalSegmentIndexOf = new Map(bookChunks.map((chunk, index) => [chunk.chunkId, index + 1]));

  const resident = run.planVersion === PLAN_VERSION_RESIDENT;
  const chapterPlanned = run.planVersion === PLAN_VERSION_CHAPTER;
  const analysisPlanned = run.planVersion === PLAN_VERSION_ANALYSIS;
  const planState = revivePlanState(run.planStateJson, {
    bodyTargetRatio: deps.budget ? 0.30 : 0.30,
  });
  if (analysisPlanned) {
    // v2 policy fields are written at run creation; guard against a legacy or
    // hand-edited planStateJson so the arithmetic below never sees undefined.
    if (typeof planState.sourceRatio !== 'number') planState.sourceRatio = SOURCE_RATIO_PROBE_START;
    if (typeof planState.density !== 'number') planState.density = DEFAULT_EXTRACTION_DENSITY;
  }
  // Narrowed accessors: closures below read these mutable policy fields, and
  // TS cannot keep property narrowing across closure boundaries.
  const getSourceRatio = (): number => (analysisPlanned ? planState.sourceRatio ?? SOURCE_RATIO_PROBE_START : 0.30);
  const getDensity = (): number => (analysisPlanned ? planState.density ?? DEFAULT_EXTRACTION_DENSITY : DEFAULT_EXTRACTION_DENSITY);

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
    for (const chunk of bookChunks) {
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
    bookPromptTokens = bookChunks.reduce((sum, chunk) => sum + Math.ceil(chunk.charCount), 0)
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
      const ranges = parseUnitRanges(unit.sourceRangesJson).ranges;
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
  /**
   * In-process interrupt (pause or stop): the final status distinguishes the
   * two intents - paused_user keeps the run one tap away from resuming,
   * stopped_user records an explicit "stop building" that still never drops
   * completed units.
   */
  const interruptedResultAfterRequest = async (control?: 'paused' | 'stopped'): Promise<ExecuteRunResult> => {
    const stopped = control === 'stopped' || deps.signal?.stopRequested;
    await deps.runStore.requestRunControl(runId, 'resume', now());
    await deps.runStore.setRunStatus(runId, stopped ? 'stopped_user' : 'paused_user', now());
    const fresh = await deps.runStore.getRun(runId);
    return {
      runId,
      completed: false,
      unitsDone: fresh?.unitsDone ?? run.unitsDone,
      unitsTotal: fresh?.unitsTotal ?? run.unitsTotal,
      unitsFailed: fresh?.unitsFailed ?? run.unitsFailed,
      lostLease: false,
    };
  };

  type UnitOutcome = 'continue' | 'lost_lease' | 'paused' | 'stopped';

  // Concurrency bookkeeping (plan §6): in-process claim ownership, online
  // output calibration, and one reasoning-reserve bump per unit (§3.3).
  const claimedByWorkers = new Set<string>();
  const calibrator = new OutputPerChunkCalibrator();
  const densityCalibrator = new TokenDensityCalibrator(planState.density);
  const reasoningBumpRetried = new Set<string>();
  let completedGroups = run.unitsDone;
  let unitsDoneLocal = run.unitsDone;
  let truncationsSinceCheckpoint = 0;

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

  const recordCalibrationSample = (group: GroupExtractionResult, chunkCount: number, inputTokens: number): void => {
    const metrics = group.requestMetrics ?? [];
    const last = metrics[metrics.length - 1];
    const outputTokens = last?.usage?.outputTokens;
    if (typeof outputTokens !== 'number' || typeof last?.usage?.reasoningTokens !== 'number' || chunkCount < 1) return;
    const reasoningTokens = last.usage.reasoningTokens;
    calibrator.record(Math.max(0, outputTokens - reasoningTokens), chunkCount);
    if (analysisPlanned && inputTokens > 0) {
      // Density model (§7): content output per source input token - measured
      // against the same body estimate the planner uses (conservative 1
      // token/code point), so prediction and calibration stay comparable.
      densityCalibrator.record(inputTokens, Math.max(0, outputTokens - reasoningTokens));
    }
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

  /** Retry the same unit once at the frozen tier with a bounded reserve increase. */
  const runWithReasoningReserveBump = async (
    unit: BuildUnitRecord,
    makeRequest: (reserveMultiplier?: number) => Promise<GroupExtractionResult>,
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
      return await makeRequest(1.5);
    }
  };

  /**
   * Calibrated replanning (unified P1 §8 + planner-v2 §7/§8): re-plan every
   * still-QUEUED unit under a new source ratio and/or calibrated extraction
   * density. Completed/running/retrying/blocked units keep their identity;
   * the replacement is a single fenced transaction and the coverage ledger of
   * the queued range is preserved exactly.
   */
  const replanQueuedUnits = async (next: {
    bodyTargetRatio?: number;
    estOutputPerChunk?: number;
    sourceRatio?: number;
    density?: number;
  }): Promise<boolean> => {
    if ((!chapterPlanned && !analysisPlanned) || !deps.budget) return false;
    const unitsAll = await deps.runStore.listUnits(runId);
    const queued = unitsAll.filter(u => u.status === 'queued');
    if (queued.length === 0) return false;
    const queuedChunkIds: string[] = [];
    for (const unit of queued) {
      for (const range of parseUnitRanges(unit.sourceRangesJson).ranges) {
        queuedChunkIds.push(range.chunkId);
      }
    }
    const idSet = new Set(queuedChunkIds);
    const chunksToPlan = bookChunks.filter(chunk => idSet.has(chunk.chunkId));
    if (chunksToPlan.length === 0) return false;
    const generation = planState.replanCount + 1;
    const routes: 'single' | 'dual' = queued.some(u => parseUnitRanges(u.sourceRangesJson).route !== null)
      ? 'dual'
      : 'single';
    const batches = analysisPlanned
      ? planAnalysisBatches(chapters, chunksToPlan, deps.budget, {
        sourceRatio: next.sourceRatio ?? getSourceRatio(),
        density: next.density ?? getDensity(),
        routes,
      })
      : planChapterBatches(chapters, chunksToPlan, deps.budget, {
        bodyTargetRatio: next.bodyTargetRatio ?? planState.bodyTargetRatio,
        estOutputPerChunk: next.estOutputPerChunk ?? planState.estOutputPerChunk,
        routes,
      });
    const minOrd = Math.min(...queued.map(u => u.ord));
    const createdAtReplan = now();
    const replacementUnits = [];
    for (const batch of batches) {
      const inputHash = await deps.sha256Hex(`re${generation}|${batch.inputHashSeed}|${batch.route ?? 'all'}`);
      replacementUnits.push({
        unitId: `${runId}-r${generation}b${String(batch.ord + 1).padStart(4, '0')}${batch.route === 'characters' ? 'c' : batch.route === 'world' ? 'w' : ''}`,
        kind: 'extract_group' as const,
        sourceRangesJson: JSON.stringify({
          version: 2 as const,
          route: batch.route ?? null,
          ranges: batch.segments.map(segment => ({
            chunkId: segment.chunkId,
            chapterId: segment.chapterId,
            startCp: segment.startCp,
            endCp: segment.endCp,
          })),
        }),
        inputHash,
        configFingerprint: queued[0]!.configFingerprint,
        parentUnitId: null,
        ord: minOrd + batch.ord,
        status: 'queued' as const,
        attempt: 0,
        retryAt: null,
        resultRef: null,
        usageJson: null,
        errorCode: null,
        errorMessage: null,
        createdAt: createdAtReplan,
        updatedAt: createdAtReplan,
      });
    }
    const nextState: RunPlanState = analysisPlanned
      ? {
        bodyTargetRatio: planState.bodyTargetRatio,
        plannerVersion: PLAN_VERSION_ANALYSIS,
        sourceRatio: next.sourceRatio ?? getSourceRatio(),
        density: next.density ?? getDensity(),
        replanCount: generation,
      }
      : {
        bodyTargetRatio: next.bodyTargetRatio ?? planState.bodyTargetRatio,
        estOutputPerChunk: next.estOutputPerChunk ?? planState.estOutputPerChunk,
        replanCount: generation,
      };
    const replaced = await deps.runStore.replaceUnclaimedUnits({
      runId, fencingToken, units: replacementUnits,
      planStateJson: JSON.stringify(nextState), now: createdAtReplan,
    });
    if (replaced) {
      if (analysisPlanned) {
        planState.sourceRatio = nextState.sourceRatio!;
        planState.density = nextState.density!;
      } else {
        planState.bodyTargetRatio = nextState.bodyTargetRatio;
        planState.estOutputPerChunk = nextState.estOutputPerChunk;
      }
      planState.replanCount = nextState.replanCount;
    }
    return replaced;
  };

  const processUnit = async (unit: BuildUnitRecord): Promise<UnitOutcome> => {
    const { route, ranges } = parseUnitRanges(unit.sourceRangesJson);
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
        // World-side identity (mirrored for part N>=2) from here on: chunk
        // jobs, fact evidence and package provenance all use these ids.
        unitChunks.push(toWorldChunk(chunk));
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
        const extractInput = {
          unitId: unit.unitId, chunk, chunkText, worldId: run.worldId, route: route ?? 'all',
        };
        let extraction: ExtractionResult;
        try {
          extraction = await deps.extractor.extract(extractInput);
        } catch (error) {
          if (!isReasoningOnlyFailure(error) || !deps.budget || reasoningBumpRetried.has(unit.unitId)) throw error;
          reasoningBumpRetried.add(unit.unitId);
          if (error instanceof LlmRequestFailure && error.requestMetrics.length > 0) {
            await deps.runStore.appendUnitRequestMetrics(unit.unitId, fencingToken, error.requestMetrics, now());
          }
          extraction = await deps.extractor.extract({ ...extractInput, reserveMultiplier: 1.5 });
        }
        // A user pause/stop waits for this paid request's fenced commit. Dropping
        // a successful response here would bill the same unit again on resume.
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
          const makeRequest = async (reserveMultiplier?: number): Promise<GroupExtractionResult> =>
            deps.groupExtractor!.extractResident({
              unitId: unit.unitId,
              segments: bookSegments,
              scope: { firstSegment, lastSegment },
              worldId: run.worldId,
              registrySummary,
              reserveMultiplier,
              route: route ?? undefined,
            });
          group = await runWithReasoningReserveBump(unit, makeRequest);
        } else {
          // pendingChunks carry world-side (mirrored) chapter ids for part
          // N>=2, so title lookup mirrors the same way (identity at N=1).
          const titleByChapter = new Map(
            chapters.map(chapter => [mirrorSourceId(sourceOrdinal, chapter.chapterId), chapter.title]),
          );
          const segments: GroupSegmentInput[] = [];
          if (analysisPlanned) {
            // Planner-v2 wire protocol: ONE segment per contiguous same-chapter
            // run of the unit's chunks (an AnalysisSlice). The model reads
            // whole chapters; evidence maps back to member storage chunks.
            let index = 0;
            while (index < pendingChunks.length) {
              const runStart = index;
              const chapterId = pendingChunks[index]!.chapterId;
              while (index < pendingChunks.length && pendingChunks[index]!.chapterId === chapterId) {
                index += 1;
              }
              const members = pendingChunks.slice(runStart, index);
              const first = members[0]!;
              const last = members[members.length - 1]!;
              const text = await deps.sourceStore.readRange(run.sourceId, first.startOffset, last.endOffset);
              segments.push({
                chunkId: first.chunkId,
                chapterId,
                chapterTitle: titleByChapter.get(chapterId) ?? chapterId,
                startCp: first.startOffset,
                text,
                memberChunks: members.map(chunk => ({
                  chunkId: chunk.chunkId,
                  startCp: chunk.startOffset,
                  endCp: chunk.endOffset,
                })),
              });
            }
          } else {
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
          }
          const makeRequest = async (reserveMultiplier?: number): Promise<GroupExtractionResult> =>
            deps.groupExtractor!.extract({
              unitId: unit.unitId, segments, worldId: run.worldId, reserveMultiplier,
              route: route ?? undefined,
            });
          group = await runWithReasoningReserveBump(unit, makeRequest);
        }
        if (!(await confirmLeaseAfterRequest())) { lostLease = true; return 'lost_lease'; }
        await commitGroupResult(deps, run, pendingChunks, group, evidenceSource);
        const unitInputTokens = pendingChunks.reduce((sum, chunk) => sum + Math.ceil(chunk.charCount), 0);
        recordCalibrationSample(group, pendingChunks.length, unitInputTokens);
        completedGroups += 1;
        if (analysisPlanned) {
          // Planner-v2 checkpoints (§6/§8): calibrate the extraction density
          // after batches 1/2/3 then every 3; on a clean window GROW the source
          // ratio (capped by what the calibrated density can still answer).
          if (densityCalibrator.due(completedGroups)) {
            const before = densityCalibrator.currentDensity;
            const after = densityCalibrator.recalibrate();
            const densityChanged = Math.abs(after - before) / Math.max(1e-9, before) > 0.25;
            const currentRatio = getSourceRatio();
            const growCandidate = Math.min(
              nextSourceRatioUp(currentRatio),
              capSourceRatioByDensity(deps.budget ?? DEFAULT_MODEL_BUDGET, after),
            );
            const ratioChanged = growCandidate > currentRatio + 1e-9 && truncationsSinceCheckpoint === 0;
            if (densityChanged || ratioChanged) {
              try {
                await replanQueuedUnits({
                  ...(densityChanged ? { density: after } : {}),
                  ...(ratioChanged ? { sourceRatio: growCandidate } : {}),
                });
                if (ratioChanged) truncationsSinceCheckpoint = 0;
              } catch { /* replanning is an optimization - never fatal */ }
            }
          }
        } else if (calibrator.due(completedGroups)) {
          const before = calibrator.currentEstimate;
          const after = calibrator.recalibrate();
          // Material change (unified P1 §8): replan the unclaimed tail with the
          // calibrated density so later batches pack to reality, not the guess.
          if (Math.abs(after - before) / Math.max(1, before) > 0.25) {
            try {
              await replanQueuedUnits({ estOutputPerChunk: after });
            } catch { /* replanning is an optimization - never fatal */ }
          }
        }
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
        if (deps.onBatchCommitted && analysisPlanned && run.scopeJson) {
          // TTFP: after every completed batch of a stage-scoped planner-v2
          // run, offer the deterministic playability gate + Opening Package
          // publish. Non-fatal by contract.
          try {
            await deps.onBatchCommitted({ run, unitsDone: unitsDoneLocal, unitsTotal: run.unitsTotal });
          } catch { /* the run finalize still publishes at the end */ }
        }
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
      const classification = classifyExtractionError(message, error);
      const lastMetric = error instanceof LlmRequestFailure
        ? error.requestMetrics[error.requestMetrics.length - 1]
        : undefined;
      // A 300s-class timeout already burned a full request cycle; retrying the
      // SAME oversized body just burns another one. Downsizing on the first
      // timeout (halving + tail-ratio shrink) converges to a size the provider
      // can answer inside the transport cap - retrying never does.
      const isTimeoutFailure = classification === 'network' && lastMetric?.errorCategory === 'timeout';
      // A 4xx rejection is deterministic for an identical body: three strikes
      // on one unit means park it for review WITH the provider's own text.
      const is4xxRejection = (lastMetric?.httpStatus ?? 0) >= 400 && (lastMetric?.httpStatus ?? 0) < 500;
      const requiresReview = classification === 'config' || classification === 'outcome_unknown'
        || (classification === 'unknown' && is4xxRejection && unit.attempt >= 2)
        || (classification === 'input_too_large' && ranges.length === 1)
        || (classification === 'content_filter' && ranges.length === 1);
      const persistedMessage = classification === 'outcome_unknown'
        ? '上次模型请求的扣费结果未知。请先在请求账本确认，避免重复计费。'
        : error instanceof LlmRequestFailure
        ? safeProviderFailureText(error, classification)
        : message.slice(0, 500);
      const needsDownsize = classification === 'truncation' || classification === 'budget_infeasible'
        || classification === 'input_too_large' || classification === 'content_filter'
        || isTimeoutFailure;
      if (needsDownsize && ranges.length > 1) {
        // Transactional split (plan §7.2, generalized by §5 calibration and the
        // timeout/4xx downsize rules): the oversized group is replaced by
        // calibrated, budget-fitting child units; the parent is canceled and
        // never counts. Halving per failure converges: whatever the provider's
        // real window/speed, some split size completes within the transport cap.
        const failedInputTokens = ranges.reduce((sum, range) => {
          const chunk = chunksByRange.get(range.chunkId);
          return sum + (chunk ? Math.ceil(chunk.charCount) : 0);
        }, 0);
        // Content moderation is binary per content, not per size: halve so the
        // clean half proceeds and only the tripped chapters keep splitting.
        const parts = classification === 'content_filter'
          ? 2
          : analysisPlanned
            ? densitySplitPartCount(failedInputTokens, densityCalibrator.currentDensity, contentBudgetForSplits())
            : splitPartCount(ranges.length, calibrator.currentEstimate, contentBudgetForSplits());
        const childDefs = splitRangesEvenly(ranges, Math.max(2, parts));
        const children = [];
        for (let index = 0; index < childDefs.length; index += 1) {
          const part = childDefs[index]!;
          children.push({
            unitId: `${unit.unitId}-s${index + 1}`,
            kind: 'extract_group' as const,
            sourceRangesJson: JSON.stringify(route
              ? { version: 2 as const, route, ranges: part }
              : part),
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
        // Ladder shrink (unified P1 §7 + planner-v2 §6): a downsize-triggering
        // failure proves the current source ratio / density prediction was too
        // ambitious for this content AND provider - shrink the ratio for every
        // unit nobody has claimed yet. The split children above already cover
        // this unit; the replan covers the TAIL (completion, not just the
        // first half at the old size). Content-moderation rejections say
        // nothing about batch SIZE - never shrink the tail for them.
        if (analysisPlanned && classification !== 'content_filter') {
          truncationsSinceCheckpoint += 1;
          const currentRatio = getSourceRatio();
          const shrunk = nextSourceRatioDown(currentRatio);
          if (shrunk < currentRatio - 1e-9) {
            try {
              await replanQueuedUnits({
                sourceRatio: shrunk,
                density: Math.max(densityCalibrator.currentDensity, DEFAULT_EXTRACTION_DENSITY * 2),
              });
            } catch { /* replanning is an optimization - never fatal */ }
          }
        } else if (chapterPlanned) {
          const shrunk = nextBodyTargetRatio(planState.bodyTargetRatio);
          if (shrunk < planState.bodyTargetRatio) {
            try {
              await replanQueuedUnits({ bodyTargetRatio: shrunk });
            } catch { /* replanning is an optimization - never fatal */ }
          }
        }
        return 'continue';
      }
      // claimUnit increments the persisted attempt after `unit` was read;
      // account for that in the first backoff too, or a failed first request
      // is immediately sent a second physical time before the loop yields.
      // Rate limiting backs off exponentially (the account needs recovery
      // time and the global scheduler floor stacks on top); every other
      // retryable class keeps the short linear ladder.
      const backoffMs = requiresReview ? 0
        : classification === 'rate_limit'
          ? Math.min(
            RATE_LIMIT_BACKOFF_BASE_MS * 2 ** Math.min(unit.attempt, 4),
            RATE_LIMIT_BACKOFF_MAX_MS,
          ) + Math.floor(Math.random() * RATE_LIMIT_BACKOFF_JITTER_MS)
          : 5_000 * Math.min(unit.attempt + 1, 6);
      await deps.runStore.completeUnit({
        unitId: unit.unitId,
        fencingToken,
        status: requiresReview ? 'needs_review' : 'failed_retryable',
        errorCode: classification,
        errorMessage: persistedMessage,
        retryAt: requiresReview ? null : new Date(Date.parse(now()) + backoffMs).toISOString(),
        now: now(),
      });
      if (requiresReview) {
        await deps.runStore.setRunStatus(runId, 'needs_review', now(), classification, persistedMessage);
        stopRequested = true;
        return 'stopped';
      }
    }
    return 'continue';
  };

  const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Cross-process control (unified P4): the UI / notification action sets
   * pause/cancel flags directly on the run row, so they reach a coordinator
   * in another process (headless service). Checked between units; an
   * in-flight request still finishes (its result is fenced on commit).
   *
   * Workers only observe intent here. The joined pool honors it after every
   * in-flight response commits, so idle workers cannot pause a live sibling
   * or latch an intent the user subsequently revokes.
   * 'cancel' honors as stopped_user (P0-4 stop semantics): the run keeps
   * every completed unit, keeps queued/failed units for a later resume and
   * stays visible in the task list - it is a RECOVERABLE stop, not a delete.
   */
  const checkControlFlags = async (): Promise<'none' | 'paused' | 'stopped'> => {
    const fresh = await deps.runStore.getRun(runId);
    if (!fresh) return 'none';
    if (fresh.cancelRequested) {
      return 'stopped';
    }
    if (fresh.pauseRequested) {
      return 'paused';
    }
    return 'none';
  };

  const worker = async (): Promise<'done' | 'lost_lease' | 'paused' | 'stopped'> => {
    for (;;) {
      if (lostLease) return 'lost_lease';
      if (stopRequested) return 'stopped';
      if (deps.signal?.aborted) return 'paused';
      const control = await checkControlFlags();
      if (control === 'paused' || control === 'stopped') {
        return control;
      }
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

    if (deps.signal?.aborted) return await interruptedResultAfterRequest();
    const control = await checkControlFlags();
    if (control !== 'none') return await interruptedResultAfterRequest(control);

    // A configuration failure already wrote needs_review in processUnit.
    if (stopRequested) {
      // A sibling worker's in-flight extractor may have re-set a control
      // flag AFTER the honoring worker cleared it (every worker races its
      // own unit boundary); clear once more so a later resume is never
      // immediately re-interrupted by a stale flag.
      await deps.runStore.requestRunControl(runId, 'resume', now()).catch(() => undefined);
      return {
        runId, completed: false, unitsDone: run.unitsDone,
        unitsTotal: run.unitsTotal, unitsFailed: run.unitsFailed, lostLease,
      };
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
      // Pass 3 (plan §4.3): whole-book timeline proposals first - the model
      // proposes, the LOCAL resolver below stays the authoritative floor.
      if (deps.onTimeline) {
        try {
          const eventHash = await deps.sha256Hex(
            allUnits.filter(u => u.status === 'completed')
              .map(u => parseUnitRanges(u.sourceRangesJson).ranges.map(r => r.chunkId).join('+'))
              .join('|'),
          );
          await deps.onTimeline({ worldId: run.worldId, contentHash: eventHash });
        } catch {
          // Non-fatal: the local resolver covers everything below.
        }
      }
      if (deps.signal?.aborted) return await interruptedResultAfterRequest();
      const finalControl = await checkControlFlags();
      if (finalControl !== 'none') return await interruptedResultAfterRequest(finalControl);
      // Final event resolution replays from the persisted proposals (C1).
      await resolveEventProposals(deps, run.worldId);
      if (deps.onFinalize) {
        try {
          await deps.onFinalize({
            run: fresh,
            setPhase: phase => deps.runStore.setRunPhase(runId, phase, now()),
          });
        } catch (error) {
          if (deps.signal?.aborted) return await interruptedResultAfterRequest();
          const reason = error instanceof Error ? error.message : String(error);
          const canonConflict = reason.includes('Canon blocking conflict');
          const missingOpeningLocation = reason.includes('当前开局可用的地点证据');
          const mappingFailed = reason.includes('小说→三宝书映射失败');
          const automaticRecovery = mappingFailed && isAutomaticMappingFailure(reason);
          const errorCode = canonConflict ? 'canon_conflict'
            : missingOpeningLocation ? 'opening_location_missing'
            : mappingFailed ? (automaticRecovery ? AUTOMATIC_MAPPING_RETRY : 'mapping_configuration_required')
            : reason.includes('连续覆盖全文')
            ? 'source_coverage_incomplete'
            : reason.includes('原文源')
              ? 'source_missing'
              : 'package_finalize_failed';
          await deps.runStore.setRunStatus(
            runId,
            canonConflict || missingOpeningLocation ? 'needs_review' : 'failed_retryable',
            now(),
            errorCode,
            canonConflict
              ? '发现需核对的原著事实；请进入「审查」逐条处理，已完成抽取会保留。'
              : missingOpeningLocation
                ? '缺少开局地点的原文证据，请补齐地点资料后继续构建。'
                : automaticRecovery
                  ? '映射正在后台自动恢复：自动调整输出预算、拆小批次并退避续试；已完成成果保留。'
                : mappingFailed
                  ? '当前 API 的配置或能力暂不可用，请核对模型配置；已完成成果保留。'
                : '世界资料发布未完成，已抽取内容已保存；请查看审查问题后继续构建。',
          );
          return {
            runId, completed: false, unitsDone: fresh.unitsDone,
            unitsTotal: fresh.unitsTotal, unitsFailed: fresh.unitsFailed, lostLease: false,
          };
        }
      }
      await deps.worldStore.setWorldStatus(run.worldId, 'ready', now());
      await deps.runStore.setRunStatus(runId, 'completed', now());
      await deps.runStore.setRunPhase(runId, 'publishing', now());
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

type ErrorClass = 'network' | 'rate_limit' | 'config' | 'outcome_unknown' | 'truncation'
  | 'budget_infeasible' | 'input_too_large' | 'content_filter' | 'unknown';

/**
 * Provider rejection signatures that mean "the REQUEST BODY as a whole is too
 * large for this endpoint" (a 400/413 whose real window is smaller than the
 * declared one, gateway input caps...). Such a unit must downsize, not retry:
 * an identical body is deterministically rejected again.
 */
function isInputTooLargeMessage(message: string): boolean {
  return /maximum context length|context length exceeded|context window exceeded|prompt too long|input too long|too many (input )?tokens|request too large|payload too large/i
    .test(message)
    || /上下文.{0,8}(超|过长|超出)|(输入|提示词?|请求体?).{0,6}(过长|超限|超出)|token.{0,4}(数)?超过/i
      .test(message);
}

/**
 * Provider content-moderation rejections (GLM: "不安全或敏感内容"; OpenAI
 * style: content_filter). Deterministic for an identical body, but a SMALLER
 * batch often passes because only a few chapters trip the filter: split
 * once before parking, exactly like an input-too-large downsize.
 */
function isContentModerationMessage(message: string): boolean {
  return /content[_ ]?filter|safety|moderation|sensitive|inappropriate/i
    .test(message)
    || /敏感|不安全|违规|安全策略|内容审核/i
      .test(message);
}

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

function classifyExtractionError(message: string, error?: unknown): ErrorClass {
  if (error instanceof BudgetInfeasibleError) return 'budget_infeasible';
  if (error instanceof OutcomeUnknownReplayError) return 'outcome_unknown';
  if (error instanceof LlmRequestFailure) {
    const metric = error.requestMetrics[error.requestMetrics.length - 1];
    if (metric?.httpStatus === 401 || metric?.httpStatus === 403) return 'config';
    if (metric?.httpStatus === 429) return 'rate_limit';
    if ((metric?.httpStatus ?? 0) >= 500 && (metric?.httpStatus ?? 0) <= 599) return 'network';
    if ((metric?.httpStatus ?? 0) >= 400 && (metric?.httpStatus ?? 0) < 500
      && isInputTooLargeMessage(message)) return 'input_too_large';
    if ((metric?.httpStatus ?? 0) >= 400 && (metric?.httpStatus ?? 0) < 500
      && isContentModerationMessage(message)) return 'content_filter';
    if (metric?.errorCategory === 'timeout' || metric?.errorCategory === 'network') return 'network';
  }
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
    const detail = metric.providerErrorText ? `：${metric.providerErrorText}` : '';
    return `模型服务请求失败（HTTP ${metric.httpStatus}，${classification}）${detail}。`;
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
