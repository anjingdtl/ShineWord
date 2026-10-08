/**
 * Streaming world import orchestration for the device (closeout C2).
 *
 * Replaces the pre-C2 whole-file flow: pick -> native staged copy (hashed on
 * the way) -> streaming normalize/chapter-split with shards persisted to
 * SQLite -> activation -> world + build run -> coordinator-driven extraction
 * reading chunk text from shards. Resuming a build never re-reads the picked
 * file; re-importing the same file reuses the active source.
 */
import { importTxtSourceStreaming, DEFAULT_READ_WINDOW_BYTES } from '../../src/application/import/streamingTxtImport';
import { SqliteSourceStore } from '../../src/infra/sqlite/sqliteSourceStore';
import { SqliteBuildRunStore } from '../../src/infra/sqlite/sqliteBuildRunStore';
import { createExtractionRun, executeRun, resolveEventProposals, type UnitExtractor } from '../../src/application/worldBuild/coordinator';
import { LlmChunkExtractor, worldBuildExtractorVersion } from '../../src/application/world/llmExtractor';
import { LlmGroupExtractor } from '../../src/application/world/llmGroupExtractor';
import { buildBookRegistry, registrySummaryFor } from '../../src/application/world/bookRegistry';
import { runTimelinePass } from '../../src/application/world/timelinePass';
import { replayCompletedLocationAdapter } from '../../src/application/worldBuild/replayLocationAdapter';
import { isRunExtractionComplete } from '../../src/application/worldBuild/buildProgress';
import { remapEntryReferences } from '../../src/application/worldPackage/remapEntryReferences';
import { sourceIdForChapter } from '../../src/application/incrementalMapping/canonSelection';
import { rangeCovered } from '../../src/application/segmentPublication/protocol';
import { modelBudgetFromProfile } from '../../src/application/worldBuild/profileModelBudget';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { LedgeredProvider } from '../../src/application/llm/requestLedger';
import { llmModelProfileFingerprint } from '../../src/application/llm/profileFingerprint';
import type { LlmRequest, LlmResponse } from '../../src/application/llm/types';
import { governWorldBuildRequest, type WorldBuildRequestGovernance } from '../../src/application/worldBuild/llmRequest';
import type { ApiProfile } from '../../src/application/llm/types';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';
import { getDatabaseRuntime } from './database';
import { nativeSha256 } from './nativeCrypto';
import { stageUri, stagedTextSource, deleteStaged } from './textSource';
import type { SourceManifest } from '../../src/application/ports/sourceStore';
import type { WorldRecord } from '../../src/application/ports/worldStore';
import { bytesSha } from './worldImport';
import type { WorldBuildProgress } from './worldImport';
import { buildPackageFromCanon, buildPackageDraftFromCanon } from '../../src/application/worldPackage/buildPackageFromCanon';
import { sourceRangesCoverWholeText, summarizeWorldPreparation } from '../../src/application/worldPackage/preparationStatus';
import { buildWholeSourceRanges } from '../../src/application/worldPackage/sourceScope';
import { SqliteStagePlanStore } from '../../src/infra/sqlite/sqliteStagePlanStore';
import {
  ensureStagePlan,
  queueInitialStages,
  evaluateAndClaimTriggers,
  markStageRunStatus,
  builtStageRanges,
  type StageRunTemplate,
} from '../../src/application/worldBuild/stageOrchestrator';
import { deriveNarrativeAnchorCp } from '../../src/application/worldBuild/stagePlan';
import { freezeRunConfig, reviveRunConfig, providerProfileFromFrozen } from '../../src/application/worldBuild/runConfig';
import { RateScheduledProvider } from '../../src/application/llm/scheduledProvider';
import { schedulerForProfile } from './llmScheduler';
import { activatePendingStages } from '../../src/application/worldPackage/stageActivation';
import { requestRunControl } from './buildServiceBridge';
import {
  evaluatePlayabilityGate,
  loadPlayabilitySnapshot,
} from '../../src/application/worldPackage/playabilityGate';
import { hasPlayableOpening } from '../../src/application/worldPackage/openingRecovery';
import { executeWithAutomaticMappingRecovery } from '../../src/application/worldBuild/automaticMappingRecovery';
import { OPENING_POLICY_VERSION, OPENING_EXTRACTION_FOCUS, openingInputCodePoints } from '../../src/application/worldBuild/openingPolicy';
import { OpeningSurveyService, type OpeningSurveyV1 } from '../../src/application/segmentBuild/openingSurvey';
import type { BuildIntentV1 } from '../../src/domain/build/phase6';
import { canonicalStringify, type CanonicalJson } from '../../src/domain/turns/canonical';
import type { SqliteTransaction } from '../../src/application/ports/sqlite';

async function assertSegmentExecution(tx: SqliteTransaction, intent: BuildIntentV1,
  runId: string, token: number, owner: string | null): Promise<void> {
  const now = new Date().toISOString();
  const current = await tx.queryOne<{ fencing_token: number; lease_owner: string | null; lease_expires_at: string | null;
    cancel_requested: number; pause_requested: number; status: string }>(
    'SELECT fencing_token,lease_owner,lease_expires_at,cancel_requested,pause_requested,status FROM world_build_runs WHERE run_id=? AND world_id=?', [runId,intent.worldId]);
  const segment = await tx.queryOne<{ intent_json: string }>('SELECT intent_json FROM world_segments WHERE segment_id=? AND world_id=?', [intent.segmentId,intent.worldId]);
  const world = await tx.queryOne('SELECT world_id FROM worlds WHERE world_id=?', [intent.worldId]);
  if (!world || !current || current.fencing_token !== token || current.lease_owner !== owner
    || !current.lease_expires_at || current.lease_expires_at <= now || current.cancel_requested || current.pause_requested
    || current.status !== 'running' || !segment || JSON.parse(segment.intent_json).generation !== intent.generation) throw new Error('stale_segment_execution');
  for (const member of intent.sourceBinding.members) {
    const source = await tx.queryOne<{ normalized_tree_hash: string; status: string; source_ordinal: number }>(
      'SELECT s.normalized_tree_hash,s.status,m.source_ordinal FROM imported_sources s JOIN world_sources m ON m.source_id=s.source_id WHERE m.world_id=? AND m.source_id=?', [intent.worldId,member.sourceId]);
    if (!source || source.status !== 'active' || source.normalized_tree_hash !== member.normalizedTreeHash
      || source.source_ordinal !== member.sourceOrdinal) throw new Error('stale_segment_source');
  }
}

async function governMappingRequest(
  request: { system: string; user: string; maxOutputTokens?: number; logicalRequestId?: string; reserveMultiplier?: number },
  complete: (request: LlmRequest) => Promise<LlmResponse>,
  governance: WorldBuildRequestGovernance,
  execution: { fencingToken: number; leaseOwner: string | null },
): Promise<LlmResponse> {
  const baseRequest: LlmRequest = {
    role: 'WorldMapper',
    system: request.system,
    user: request.user,
    maxOutputTokens: request.maxOutputTokens ?? 6_000,
    jsonMode: true,
  };
  const logicalRequestId = request.logicalRequestId ?? `world-mapping:${governance.runId}:${governance.worldId}`;
  const runtime = await getDatabaseRuntime();
  const runs = new SqliteBuildRunStore(runtime.db);
  const run = await runs.getRun(governance.runId);
  if (!run) throw new Error('project_deleted');
  if (run.leaseOwner !== execution.leaseOwner) throw new Error('mapping_request_fence_lost');
  await runs.recordMappingRequest(run.runId, logicalRequestId, execution.fencingToken, new Date().toISOString());
  return complete(governWorldBuildRequest({
    request: baseRequest,
    requestKind: 'world_mapping',
    logicalRequestId,
    governance,
    reserveMultiplier: request.reserveMultiplier,
  }));
}

/** Unified-build import summary (P3): stage plan + first queued runs. */
export interface UnifiedImportSummary {
  sourceId: string;
  worldId: string;
  strategy: 'full' | 'progressive';
  runIds: string[];
  stages: Array<{ index: number; startCp: number; endCp: number; ratio: number }>;
  byteLength: number;
  codePointCount: number;
  chapterCount: number;
  chunkCount: number;
  reusedSource: boolean;
}

export interface StreamedImportSummary {
  sourceId: string;
  worldId: string;
  runId: string;
  byteLength: number;
  codePointCount: number;
  chapterCount: number;
  chunkCount: number;
  reusedSource: boolean;
}

function makeSourceId(rawSha256: string): string {
  return `src-${rawSha256.slice(0, 16)}-${Date.now().toString(36)}`;
}

/**
 * Full streaming import: stage -> normalize/split -> activate -> create run.
 * Extraction itself is driven separately (`executeRun`) so background runners
 * (closeout C5) own the long LLM phase.
 */
interface StagedSourceActivation {
  sourceId: string;
  manifest: SourceManifest;
  reusedSource: boolean;
  fileName: string;
}

/**
 * Shared staging + activation for every import entry: streams the picked
 * document, reuses an existing active source for identical bytes, or parses
 * and activates a new one. Emits the parse-finished closure progress.
 */
async function stageAndActivateSource(
  uri: string,
  fileName: string,
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<StagedSourceActivation> {
  onProgress({ phase: 'importing', message: '正在读取并解析小说…' });
  const runtime = await getDatabaseRuntime();
  const sourceStore = new SqliteSourceStore(runtime.db);

  // Stage the picked document natively (streaming copy + SHA-256).
  const staged = await stageUri(uri, `pending-${Date.now().toString(36)}`);
  const source = await stagedTextSource(staged);

  // Fast path: the same raw bytes already produced an active source.
  const existing = await sourceStore.findActiveByRawHash(staged.sha256);
  const now = new Date().toISOString();
  let sourceId: string;
  let reusedSource = true;
  let manifest: SourceManifest;
  if (existing) {
    sourceId = existing.sourceId;
    manifest = existing;
    await deleteStaged(staged.path);
  } else {
    reusedSource = false;
    sourceId = makeSourceId(staged.sha256);
    await sourceStore.beginStaging({
      sourceId,
      rawSha256Hex: staged.sha256,
      normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1',
      byteLength: staged.byteLength,
      codePointCount: 0,
      encoding: source.encoding,
      normalizeVersion: 'normalize-1',
      chapterSplitVersion: 'chapter-split-1',
      normalizeShardScheme: 'normalize-shard-1',
      splitStrategy: 'standard',
      fileName,
      title: null,
      status: 'staging',
      createdAt: now,
      updatedAt: now,
    });

    const result = await importTxtSourceStreaming(source, sourceStore, sourceId, {
      readWindowBytes: DEFAULT_READ_WINDOW_BYTES,
      onProgress: info => {
        if (info.phase === 'reading') {
          onProgress({
            phase: 'importing',
            message: `解析中 ${Math.round((info.bytesRead / Math.max(info.totalBytes, 1)) * 100)}%`,
          });
        } else {
          onProgress({ phase: 'importing', message: info.phase === 'planning' ? '整理原文来源坐标'
            : `校验原文分段 ${info.completedRecords ?? 0}/${info.totalRecords ?? 0}` });
        }
      },
      sha256Hex: async input => nativeSha256.sha256Hex(input),
      sha256BytesHex: bytes => bytesSha.sha256BytesHex(bytes),
      sha256BytesBatchHex: bytesSha.sha256BytesBatchHex,
    });
    const title = fileName.replace(/\.txt$/i, '') || '未命名小说';
    await sourceStore.activateSource({
      manifest: {
        sourceId,
        rawSha256Hex: staged.sha256,
        normalizedTreeHash: result.normalizedTreeHash,
        normalizeTreeHashVersion: 'normalize-hash-shard-tree-1',
        byteLength: result.byteLength,
        codePointCount: result.codePointCount,
        encoding: result.encoding,
        normalizeVersion: result.normalizeVersion,
        chapterSplitVersion: result.chapterSplitVersion,
        normalizeShardScheme: result.normalizeShardScheme,
        splitStrategy: result.splitStrategy,
        fileName,
        title,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      chapters: result.chapters,
      chunks: result.chunks,
    });
    manifest = (await sourceStore.getManifest(sourceId))!;
    // The staged raw copy is no longer needed once shards are authoritative.
    await deleteStaged(staged.path);
  }

  // P0-1 import closure: the LAST reading progress can legitimately sit at
  // 99% (final window boundary), so the parse-finished state must be an
  // explicit event. Reused sources get the same closure - a re-import must
  // never keep rendering the previous run's stale percentage.
  const parsedCounts = await runtime.db.queryOne<{ chapters: number; chunks: number }>(
    `SELECT
       (SELECT COUNT(*) FROM imported_source_chapters WHERE source_id = ?) AS chapters,
       (SELECT COUNT(*) FROM imported_source_chunks WHERE source_id = ?) AS chunks`,
    [sourceId, sourceId],
  );
  onProgress({
    phase: 'importing',
    message: `原文解析完成：${parsedCounts?.chapters ?? 0} 章 · ${parsedCounts?.chunks ?? 0} 块`,
  });
  return { sourceId, manifest, reusedSource, fileName };
}

async function importNovelInternal(
  uri: string,
  fileName: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
  mode: 'full' | 'unified',
  unifiedStrategy: 'full' | 'progressive' = 'progressive',
): Promise<StreamedImportSummary | UnifiedImportSummary> {
  const runtime = await getDatabaseRuntime();
  const runStore = new SqliteBuildRunStore(runtime.db);
  const { sourceId, manifest, reusedSource } = await stageAndActivateSource(uri, fileName, onProgress);
  const sourceStore = new SqliteSourceStore(runtime.db);

  if (mode === 'unified') {
    // Phase 6 uses bounded, dependency-driven segments. The stage coordinator
    // remains the execution adapter for frozen legacy runs; its old 30/30/40
    // plan is used only when the segment runtime is unavailable.
    const worldId = `world-${sourceId}`;
    const budget = modelBudgetFromProfile(profile);
    const openingBudget = runtime.segments && unifiedStrategy === 'progressive'
      ? { ...budget, maxContentOutputTokens: Math.min(6000, budget.maxContentOutputTokens) } : budget;
    const config = freezeRunConfig(profile, openingBudget, runtime.segments && unifiedStrategy === 'progressive'
      ? { openingPolicyVersion: OPENING_POLICY_VERSION, bodyTargetRatio: 0.10 } : {});
    const stageStore = new SqliteStagePlanStore(runtime.db);
    const deps = {
      db: runtime.db,
      stageStore,
      runStore,
      sourceStore,
      worldStore: runtime.worldStore,
      sha256Hex: async (input: string) => nativeSha256.sha256Hex(input),
    };
    // Mirror chapters/chunks world-side up front: evidence FKs (fact_sources
    // chapters) point at the world tables, and createExtractionRun only
    // mirrors when the world row is new (a re-import would otherwise skip it).
    {
      const worldStore = runtime.worldStore;
      let world = await worldStore.getWorld(worldId);
      if (!world) {
        world = {
          worldId,
          title: manifest.title ?? fileName,
          sourceSha256: manifest.rawSha256Hex,
          sourceBytes: manifest.byteLength,
          normalizeVersion: manifest.normalizeVersion,
          chapterSplitVersion: manifest.chapterSplitVersion,
          buildStatus: 'extracting',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies WorldRecord;
        await worldStore.createWorld(world);
      }
      await worldStore.saveImportedSource(worldId, {
        encoding: manifest.encoding,
        sourceSha256Hex: manifest.rawSha256Hex,
        sourceByteLength: manifest.byteLength,
        normalizeVersion: manifest.normalizeVersion,
        chapterSplitVersion: manifest.chapterSplitVersion,
        splitStrategy: manifest.splitStrategy,
        text: '',
        codePointCount: manifest.codePointCount,
        chapters: await sourceStore.getChapters(sourceId),
        chunks: await sourceStore.getChunks(sourceId),
      }, new Date().toISOString());
    }
    // New tasks use the same run/unit engine with small logical segments.
    // The legacy stage path remains readable for pre-schema-29 tasks.
    if (runtime.segments && unifiedStrategy === 'progressive') {
      await runtime.worldStore.addWorldSource({ worldId, sourceId, sourceOrdinal: 1,
        rawSha256: manifest.rawSha256Hex, createdAt: new Date().toISOString() });
      const fingerprint = await runtime.segmentConfigs.register(worldId, config);
      const bootstrap = await runtime.segments.ensureBootstrap({ worldId, executionConfigFingerprint: fingerprint, maxCodePoints: openingInputCodePoints(openingBudget) });
      await runtime.sourceIndex.ensureIndexed(bootstrap.intent.ranges);
      if (!bootstrap.runIds.length && bootstrap.lastErrorCode === 'execution_prepare_failed') {
        await runtime.segments.retryPreparation(worldId, bootstrap.intent.segmentId);
      }
      const queued = await runtime.segments.dispatch(worldId);
      const runIds = queued.flatMap(segment => [...segment.runIds]);
      onProgress({ phase: 'extracting', chunksDone: 0, message: '正在准备有原文依据的开局资料' });
      return { sourceId, worldId, strategy: 'progressive', runIds, stages: [],
        byteLength: manifest.byteLength, codePointCount: manifest.codePointCount,
        chapterCount: (await sourceStore.getChapters(sourceId)).length,
        chunkCount: (await sourceStore.getChunks(sourceId)).length, reusedSource };
    }
    const { plan } = await ensureStagePlan(deps, {
      worldId, sourceId, strategy: unifiedStrategy,
      configFingerprint: `${config.model}#${config.reasoningTier}#${config.contentOutputTokens}`,
    });
    const template: StageRunTemplate = {
      extractorVersion: worldBuildExtractorVersion(budget.reasoningTier ?? 'low'),
      modelFingerprint: `${profile.endpoint}#${profile.model}`,
      mode: 'group',
      budget,
      config,
    };
    const queued = await queueInitialStages(deps, {
      worldId,
      title: manifest.title ?? fileName,
      template,
    });
    // P0-1 import closure: once runs exist the UI must leave the importing
    // state - even if the LLM phase has not produced its first unit yet.
    let queuedUnits = 0;
    for (const entry of queued) {
      const run = await runStore.getRun(entry.runId);
      queuedUnits += run?.unitsTotal ?? 0;
    }
    onProgress({
      phase: 'extracting',
      chunksDone: 0,
      chunksTotal: queuedUnits,
      message: queuedUnits > 0
        ? `已创建 ${queuedUnits} 个构建组，等待模型处理`
        : '构建任务已入队，等待模型处理',
    });
    const summary: UnifiedImportSummary = {
      sourceId,
      worldId,
      strategy: unifiedStrategy,
      runIds: queued.map(entry => entry.runId),
      stages: plan.stages.map(stage => ({
        index: stage.index, startCp: stage.startCp, endCp: stage.endCp, ratio: stage.ratio,
      })),
      byteLength: manifest.byteLength,
      codePointCount: manifest.codePointCount,
      chapterCount: (await sourceStore.getChapters(sourceId)).length,
      chunkCount: (await sourceStore.getChunks(sourceId)).length,
      reusedSource,
    };
    return summary;
  }

  // World + run: continue the existing world for this source if there is one.
  const worldId = `world-${sourceId}`;
  const runId = `run-${sourceId}-${Date.now().toString(36)}`;
  const runBudget = modelBudgetFromProfile(profile);
  const frozenConfig = freezeRunConfig(profile, runBudget);
  const extractorVersion = worldBuildExtractorVersion(runBudget.reasoningTier ?? 'low');
  const created = await createExtractionRun(
    { sourceStore, runStore, worldStore: runtime.worldStore, sha256Hex: async input => nativeSha256.sha256Hex(input) },
    {
      runId,
      worldId,
      sourceId,
      modelFingerprint: `${profile.endpoint}#${profile.model}`,
      title: manifest.title ?? fileName,
      extractorVersion,
      // Resident mode (1M plan §4): whole-book prefix with per-unit scope
      // instructions when the book fits 85% of the window and the model
      // supports prefix caching; otherwise the planner degrades to the
      // windowed group mode and records why on the run.
      mode: 'resident',
      budget: runBudget,
      config: frozenConfig,
    },
  );
  onProgress({
    phase: 'extracting',
    chunksDone: 0,
    chunksTotal: created.unitsTotal,
    message: `已创建 ${created.unitsTotal} 个构建组，等待模型处理`,
  });
  return {
    sourceId,
    worldId,
    runId,
    byteLength: manifest.byteLength,
    codePointCount: manifest.codePointCount,
    chapterCount: (await sourceStore.getChapters(sourceId)).length,
    chunkCount: (await sourceStore.getChunks(sourceId)).length,
    reusedSource,
  };
}

/** Full novel extraction is retained as an explicit refinement path. */
export async function importNovelStreaming(
  uri: string,
  fileName: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<StreamedImportSummary> {
  return await importNovelInternal(uri, fileName, profile, onProgress, 'full') as StreamedImportSummary;
}

/** Compatibility entry: use the same evidence-gated segment opening pipeline. */
export async function importNovelForOpeningStreaming(
  uri: string,
  fileName: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<UnifiedImportSummary> {
  return importNovelUnified(uri, fileName, profile, 'progressive', onProgress);
}

/**
 * Progressive opening extracts a bounded front range and publishes only after
 * evidence and playable dependency closure pass. Full mode extends this with
 * bounded background windows. Frozen legacy stage plans remain resumable.
 */
export async function importNovelUnified(
  uri: string,
  fileName: string,
  profile: ApiProfile,
  strategy: 'full' | 'progressive',
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<UnifiedImportSummary> {
  return await importNovelInternal(uri, fileName, profile, onProgress, 'unified', strategy) as UnifiedImportSummary;
}

/**
 * Multi-part append (product ask 2026-10-01 #2): imports another book of the
 * same saga into an EXISTING project. The part registers as world_sources
 * ordinal N, mirrors its chapters/chunks with the `s{N}-` prefix (world-side
 * ids stay globally unique) and runs one whole-source extraction run - no
 * stage plan, because TTFP already happened with part 1. Canon accumulates
 * in the same world; the next published revision includes both parts.
 */
export async function importNovelPartToProject(
  uri: string,
  fileName: string,
  worldId: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<UnifiedImportSummary> {
  const runtime = await getDatabaseRuntime();
  const world = await runtime.worldStore.getWorld(worldId);
  if (!world) throw new Error('目标项目不存在；请先从书库进入该项目。');
  const { sourceId, manifest, reusedSource } = await stageAndActivateSource(uri, fileName, onProgress);

  const membership = await runtime.worldStore.findWorldOfSource(sourceId);
  if (membership && membership.worldId === worldId) {
    throw new Error('这一部已经在当前项目里了；请选择下一部的 TXT。');
  }
  if (membership && membership.worldId !== worldId) {
    throw new Error('这个文件已属于另一个项目；同一份 TXT 不能同时挂在两个项目下。');
  }

  const budget = modelBudgetFromProfile(profile);
  const config = freezeRunConfig(profile, budget);
  const runId = `run-${sourceId}-part-${Date.now().toString(36)}`;
  const run = await createExtractionRun(
    {
      sourceStore: new SqliteSourceStore(runtime.db),
      runStore: new SqliteBuildRunStore(runtime.db),
      worldStore: runtime.worldStore,
      sha256Hex: async (input: string) => nativeSha256.sha256Hex(input),
    },
    {
      runId,
      worldId,
      sourceId,
      modelFingerprint: `${profile.endpoint}#${profile.model}`,
      title: world.title,
      extractorVersion: worldBuildExtractorVersion(budget.reasoningTier ?? 'low'),
      mode: 'group',
      budget,
      config,
      ...(runtime.segments ? { scope: { startCp: 0, endCp: Math.min(3200, manifest.codePointCount) } } : {}),
    },
  );
  if (runtime.segments) {
    // Registration/mirroring above is the original M1 path. Adopt its exact
    // bounded work in M3; cancel only the unused pre-plan run before sending.
    await new SqliteBuildRunStore(runtime.db).setRunStatus(run.runId, 'canceled', new Date().toISOString());
    const fingerprint = await runtime.segmentConfigs.register(worldId, config);
    const range = await runtime.sourceCatalog.createRange(sourceId, 0, Math.min(3200, manifest.codePointCount));
    await runtime.segments.requestDemand({ worldId, executionConfigFingerprint: fingerprint, ranges: [range], reason: 'near_domain' });
    await runtime.sourceIndex.ensureIndexed([range]);
    const queued = await runtime.segments.dispatch(worldId);
    return { sourceId, worldId, strategy: 'progressive', runIds: queued.flatMap(s => [...s.runIds]), stages: [],
      byteLength: manifest.byteLength, codePointCount: manifest.codePointCount,
      chapterCount: (await runtime.sourceStore.getChapters(sourceId)).length,
      chunkCount: (await runtime.sourceStore.getChunks(sourceId)).length, reusedSource };
  }

  const partStore = new SqliteSourceStore(runtime.db);
  const chapterCount = (await partStore.getChapters(sourceId)).length;
  const chunkCount = (await partStore.getChunks(sourceId)).length;

  onProgress({
    phase: 'extracting',
    chunksDone: 0,
    chunksTotal: run.unitsTotal,
    message: `新的一部已入队：${run.unitsTotal} 个构建组`,
  });

  return {
    sourceId,
    worldId,
    strategy: 'full',
    runIds: [run.runId],
    stages: [],
    byteLength: manifest.byteLength,
    codePointCount: manifest.codePointCount,
    chapterCount,
    chunkCount,
    reusedSource,
  };
}

/**
 * Anchor derivation over persisted rows (see deriveNarrativeAnchorCp for the
 * policy): the campaign's locked opening chapters plus the current scene
 * location's evidence spans. One bounded query set; misses degrade to no
 * anchor (the passive trigger then simply stays inert).
 */
async function deriveStageAnchorFromCampaign(
  runtime: Awaited<ReturnType<typeof getDatabaseRuntime>>,
  input: { worldId: string; campaignId: string; anchorLocationId: string | null },
): Promise<number | null> {
  try {
    const anchorRow = await runtime.db.queryOne<{ anchor_json: string | null }>(
      'SELECT anchor_json FROM campaigns WHERE campaign_id = ?',
      [input.campaignId],
    );
    const anchorOrder = (() => {
      try {
        const parsed = anchorRow?.anchor_json ? JSON.parse(anchorRow.anchor_json) as { worldTimeOrder?: unknown } : null;
        return Number.isFinite(parsed?.worldTimeOrder) ? Number(parsed?.worldTimeOrder) : 0;
      } catch {
        return 0;
      }
    })();
    const events = await runtime.db.queryAll<{ world_time_order: number; narrative_chapter_id: string | null }>(
      'SELECT world_time_order, narrative_chapter_id FROM canon_events WHERE world_id = ?',
      [input.worldId],
    );
    const chapterRows = await runtime.db.queryAll<{ chapter_id: string; start_offset: number; end_offset: number }>(
      'SELECT chapter_id, start_offset, end_offset FROM source_chapters WHERE world_id = ?',
      [input.worldId],
    );
    const chapterSpans = new Map(chapterRows.map(row =>
      [row.chapter_id, { startCp: Number(row.start_offset), endCp: Number(row.end_offset) }]));
    let locationSpans: Array<{ startCp: number; endCp: number }> = [];
    if (input.anchorLocationId) {
      const factRows = await runtime.db.queryAll<{ start_offset: number; end_offset: number }>(
        `SELECT fs.start_offset, fs.end_offset
           FROM fact_sources fs
           JOIN canon_facts f ON f.fact_id = fs.fact_id AND f.world_id = fs.world_id
           JOIN entities e ON e.entity_id = f.subject_entity_id AND e.world_id = f.world_id
          WHERE e.world_id = ? AND e.type = 'location' AND e.name = ?`,
        [input.worldId, input.anchorLocationId],
      );
      locationSpans = factRows.map(row => ({ startCp: Number(row.start_offset), endCp: Number(row.end_offset) }));
    }
    return deriveNarrativeAnchorCp({
      events: events.map(row => ({
        worldTimeOrder: Number(row.world_time_order),
        narrativeChapterId: row.narrative_chapter_id,
      })),
      chapterSpans,
      anchorWorldTimeOrder: anchorOrder,
      locationSpans,
    });
  } catch {
    return null;
  }
}

/**
 * Narrative-trigger hook (P3 §3): evaluates boundary proximity / dependency
 * demand, claims at most one task per stage, and hands new runs to the
 * foreground service. `neededEntityId` resolves the entity's evidence spans
 * into neededRanges; `anchorCp` is the narrative position of the current
 * confirmed scene. Callers without an explicit anchor pass the campaign id
 * and the player's current scene location - the anchor is then derived from
 * the campaign's locked opening chapters plus that location's evidence.
 */
export async function checkStageTriggers(input: {
  worldId: string;
  anchorCp?: number | null;
  neededEntityId?: string | null;
  campaignId?: string | null;
  anchorLocationId?: string | null;
}): Promise<Array<{ stageIndex: number; reason: string; runId: string | null; deduped: boolean }>> {
  const runtime = await getDatabaseRuntime();
  const sourceStore = new SqliteSourceStore(runtime.db);
  const stageStore = new SqliteStagePlanStore(runtime.db);
  const worldStore = runtime.worldStore;
  const world = await worldStore.getWorld(input.worldId);
  if (!world) return [];
  let neededRanges: Array<{ startCp: number; endCp: number }> | undefined;
  if (input.neededEntityId) {
    const facts = await worldStore.listFacts(input.worldId);
    const spans = facts
      .filter(fact => fact.subjectEntityId === input.neededEntityId)
      .flatMap(fact => fact.sources ?? []);
    if (spans.length > 0) {
      neededRanges = spans.map(span => ({ startCp: span.startOffset, endCp: span.endOffset }));
    }
  }
  let anchorCp = input.anchorCp ?? null;
  if (anchorCp === null && input.campaignId) {
    anchorCp = await deriveStageAnchorFromCampaign(runtime, {
      worldId: input.worldId,
      campaignId: input.campaignId,
      anchorLocationId: input.anchorLocationId ?? null,
    });
  }
  const deps = {
    db: runtime.db,
    stageStore,
    runStore: new SqliteBuildRunStore(runtime.db),
    sourceStore,
    worldStore,
    sha256Hex: async (text: string) => nativeSha256.sha256Hex(text),
  };
  const outcomes = await evaluateAndClaimTriggers(deps, {
    worldId: input.worldId,
    title: world.title,
    anchorCp,
    neededRanges,
    template: await stageRunTemplateFromWorld(input.worldId),
  });
  for (const outcome of outcomes) {
    if (!outcome.deduped && outcome.runId) {
      const { startOrResumeBuild } = await import('./buildWatchdog');
      void startOrResumeBuild(outcome.runId, null).catch(() => undefined);
    }
  }
  return outcomes;
}

async function stageRunTemplateFromWorld(worldId: string): Promise<StageRunTemplate> {
  // Reuse the frozen config of this world's most recent run so triggered
  // stages never drift to a different model mid-world (P1 §1).
  const runtime = await getDatabaseRuntime();
  const stageStore = new SqliteStagePlanStore(runtime.db);
  const runStore = new SqliteBuildRunStore(runtime.db);
  const plan = await stageStore.getStagePlanByWorld(worldId);
  let config = null as ReturnType<typeof reviveRunConfig>;
  if (plan) {
    const states = await stageStore.listStageStates(plan.planId);
    for (const state of states) {
      if (!state.runId) continue;
      const run = await runStore.getRun(state.runId);
      if (run?.configJson) {
        config = reviveRunConfig(run.configJson);
        if (config) break;
      }
    }
  }
  if (!config) {
    throw new Error('该世界尚无冻结的构建配置，无法触法续建；请先完成初始阶段构建。');
  }
  return {
    extractorVersion: 'llm-chunk-extractor-1',
    modelFingerprint: `${config.endpoint}#${config.model}`,
    mode: 'group',
    config,
    budget: {
      contextWindowTokens: config.contextWindowTokens,
      maxContentOutputTokens: config.contentOutputTokens,
      reasoningReserveTokens: config.reasoningReserveTokens,
      reasoningEffort: config.reasoningTier,
      reasoningTier: config.reasoningTier,
      supportsPromptCache: config.supportsPromptCache,
      reserveTokens: 2_000,
    },
  };
}

/**
 * Safe-boundary activation hook (P3 §4): called between turns; pending stage
 * packages of this world's campaigns activate only when no turn is frozen.
 */
export async function tryActivateStagePackages(worldId: string): Promise<number> {
  const runtime = await getDatabaseRuntime();
  const stageStore = new SqliteStagePlanStore(runtime.db);
  const rows = await runtime.db.queryAll<{ campaign_id: string; branch_id: string; state_version: number }>(
    `SELECT c.campaign_id, b.branch_id, b.state_version
       FROM campaigns c JOIN branches b ON b.campaign_id = c.campaign_id
      WHERE c.world_id = ? AND b.parent_branch_id IS NULL`, [worldId],
  );
  let activated = 0;
  for (const row of rows) {
    const result = await activatePendingStages(
      { db: runtime.db, stageStore },
      {
        campaignId: row.campaign_id,
        branchId: row.branch_id,
        stateVersion: Number(row.state_version),
        worldId,
        now: new Date().toISOString(),
      },
    );
    if (result.activated) activated += 1;
  }
  return activated;
}

/** Explicit full mode advances only two bounded windows at a time. */
async function queueExplicitFullWindows(worldId: string): Promise<string[]> {
  const runtime = await getDatabaseRuntime();
  const plan = await runtime.segmentPlans.getPlan(worldId);
  if (!plan || plan.pauseReason) return [];
  const readiness = await runtime.segments.readReadiness({ worldId });
  if (!readiness.availableArtifacts.length) throw new Error('请先完成有证据的开局资料，再启动完整整理。');
  let pending = readiness.segments.filter(s=>s.intent.reason==='user_full'&&!['ready','canceled','stale','failed_terminal'].includes(s.status)).length;
  const { members } = await runtime.sourceCatalog.snapshot(worldId);
  const newlyPlanned = new Set<string>();
  const occupied = [...readiness.availableArtifacts.flatMap(a=>a.coverage), ...readiness.segments.filter(s=>!['canceled','stale','failed_terminal'].includes(s.status)).flatMap(s=>s.intent.ranges)];
  for (const member of members) {
    if (pending >= 2) break;
    let cursor = 0;
    const known = occupied.filter(r=>r.sourceId===member.sourceId).sort((a,b)=>a.startCp-b.startCp);
    while (pending < 2 && cursor < member.codePointCount) {
      const containing = known.filter(r=>r.startCp<=cursor&&r.endCp>cursor);
      if (containing.length) { cursor=Math.max(...containing.map(r=>r.endCp)); continue; }
      const next = known.find(r=>r.startCp>cursor);
      const range = await runtime.sourceCatalog.createRange(member.sourceId,cursor,Math.min(member.codePointCount,cursor+3200,next?.startCp??member.codePointCount));
      const records = await runtime.segments.requestDemand({worldId,executionConfigFingerprint:plan.executionConfigFingerprint,ranges:[range],reason:'user_full',priority:'P3'});
      for (const record of records) newlyPlanned.add(record.intent.segmentId);
      known.push(range);known.sort((a,b)=>a.startCp-b.startCp);cursor=range.endCp;pending++;
    }
  }
  const queued=await runtime.segments.dispatch(worldId);
  return queued.filter(s=>newlyPlanned.has(s.intent.segmentId)).flatMap(s=>[...s.runIds]);
}

/**
 * Mode switch progressive -> full (P3 §6): claim every still-untriggered
 * stage and queue its run. Already-built stages are never re-paid; the
 * frozen config of the world's existing runs is reused.
 */
export async function switchToFullBuild(worldId: string): Promise<string[]> {
  const runtime = await getDatabaseRuntime();
  if (await runtime.segmentPlans?.getPlan(worldId)) {
    const ids=await queueExplicitFullWindows(worldId);
    const { startSegmentRun }=await import('./segmentRuntime');
    for (const id of ids) void startSegmentRun(id).catch(()=>undefined);
    return ids;
  }
  const stageStore = new SqliteStagePlanStore(runtime.db);
  const plan = await stageStore.getStagePlanByWorld(worldId);
  if (!plan) throw new Error('该世界没有阶段计划。');
  if (plan.strategy === 'full') return [];
  const deps = {
    db: runtime.db,
    stageStore,
    runStore: new SqliteBuildRunStore(runtime.db),
    sourceStore: new SqliteSourceStore(runtime.db),
    worldStore: runtime.worldStore,
    sha256Hex: async (text: string) => nativeSha256.sha256Hex(text),
  };
  const template = await stageRunTemplateFromWorld(worldId);
  const queued: string[] = [];
  for (const stage of plan.stages) {
    const claimed = await stageStore.claimStageTrigger({
      planId: plan.planId,
      stageIndex: stage.index,
      reason: 'switch_to_full',
      dedupeKey: `full:${stage.index}`,
      now: new Date().toISOString(),
    });
    if (!claimed) continue;
    // Create the scoped run directly for the claimed stage.
    const runId = `run-${worldId}-s${stage.index + 1}-${Date.now().toString(36)}`;
    await createExtractionRun(
      {
        sourceStore: deps.sourceStore, runStore: deps.runStore, worldStore: runtime.worldStore,
        sha256Hex: deps.sha256Hex,
      },
      {
        runId, worldId, sourceId: plan.sourceId,
        modelFingerprint: template.modelFingerprint,
        title: plan.worldId,
        extractorVersion: template.extractorVersion,
        mode: template.mode ?? 'group',
        budget: template.budget,
        config: template.config,
        scope: { startCp: stage.startCp, endCp: stage.endCp },
      },
    );
    await stageStore.setStageStatus({
      planId: plan.planId, stageIndex: stage.index, status: 'queued', runId,
      now: new Date().toISOString(),
    });
    queued.push(runId);
  }
  for (const runId of queued) {
    const { startOrResumeBuild } = await import('./buildWatchdog');
    void startOrResumeBuild(runId, null).catch(() => undefined);
  }
  return queued;
}

/** Stage plan view for UI: statuses + ranges of a world's stages. */
export async function getStagePlanView(worldId: string): Promise<{
  strategy: 'full' | 'progressive';
  stages: Array<{ index: number; startCp: number; endCp: number; ratio: number; status: string; runId: string | null; packageRevision: number | null }>;
} | null> {
  const runtime = await getDatabaseRuntime();
  const stageStore = new SqliteStagePlanStore(runtime.db);
  const plan = await stageStore.getStagePlanByWorld(worldId);
  if (!plan) {
    if (!await runtime.segmentPlans?.getPlan(worldId)) return null;
    const readiness=await runtime.segments.readReadiness({worldId});
    const {members}=await runtime.sourceCatalog.snapshot(worldId);
    const total=Math.max(1,members.reduce((sum,m)=>sum+m.codePointCount,0));
    const full=(await runtime.segmentPlans.listDemands(worldId)).some(d=>d.active&&d.reason==='user_full');
    const revision=await runtime.worldStore.getPublishedPackageRevision(worldId);
    return {strategy:full?'full':'progressive',stages:readiness.segments.map((segment,index)=>({
      index,startCp:segment.intent.ranges[0]?.startCp??0,endCp:segment.intent.ranges[0]?.endCp??0,
      ratio:segment.intent.ranges.reduce((sum,r)=>sum+r.endCp-r.startCp,0)/total,
      status:segment.status,runId:segment.runIds[0]??null,packageRevision:segment.artifactIds.length?revision:null,
    }))};
  }
  const states = await stageStore.listStageStates(plan.planId);
  return {
    strategy: plan.strategy,
    stages: plan.stages.map(stage => {
      const state = states.find(candidate => candidate.stageIndex === stage.index);
      return {
        index: stage.index, startCp: stage.startCp, endCp: stage.endCp, ratio: stage.ratio,
        status: state?.status ?? 'untriggered',
        runId: state?.runId ?? null,
        packageRevision: state?.packageRevision ?? null,
      };
    }),
  };
}

/** Adapter from the chunk extractor to the run coordinator's unit contract. */
/** Single-chunk fallback extractor (used when a split reduces to one chunk). */
export function coordinatorExtractor(
  profile: ApiProfile,
  governance?: WorldBuildRequestGovernance,
  complete?: (request: LlmRequest) => Promise<import('../../src/application/llm/types').LlmResponse>,
): UnitExtractor {
  const provider = complete ? null : new OpenAICompatibleProvider(
    profile, new KeychainSecretStore(), new FetchHttpTransport(), 300_000,
  );
  const maxBusinessOutputTokens = governance?.profile.contentOutputTokens
    ?? modelBudgetFromProfile(profile).maxContentOutputTokens;
  const inner = new LlmChunkExtractor(
    request => complete ? complete(request) : provider!.complete(request),
    maxBusinessOutputTokens,
    governance,
  );
  return {
    version: inner.version,
    extract: async input => inner.extract({
      chunk: { ...input.chunk, worldId: input.worldId, extractionStatus: 'pending' },
      chunkText: input.chunkText,
      worldId: input.worldId,
      unitId: input.unitId,
      route: input.route,
      reserveMultiplier: input.reserveMultiplier,
    }),
  };
}

/** C3 group extractor over the same provider; output cap comes from the
 *  profile-derived budget (content + reasoning reserve), never a hard 8k. */
export function coordinatorGroupExtractor(
  profile: ApiProfile,
  governance?: WorldBuildRequestGovernance,
  complete?: (request: LlmRequest) => Promise<import('../../src/application/llm/types').LlmResponse>,
): LlmGroupExtractor {
  const provider = complete ? null : new OpenAICompatibleProvider(
    profile, new KeychainSecretStore(), new FetchHttpTransport(), 300_000,
  );
  const maxBusinessOutputTokens = governance?.profile.contentOutputTokens
    ?? modelBudgetFromProfile(profile).maxContentOutputTokens;
  return new LlmGroupExtractor(
    request => complete ? complete(request) : provider!.complete(request),
    maxBusinessOutputTokens,
    governance?.profile.reasoningTier ?? profile.reasoningTier ?? profile.reasoningEffort ?? 'low',
    governance,
  );
}

/**
 * Module-level abort registry: pause asks the in-flight executeRun loop to
 * stop at the next unit boundary (the lease is released and the run persists
 * as paused_user - the DB stays the single source of truth for progress).
 * A stop marks stopRequested so the coordinator persists stopped_user
 * (recoverable stop, never a delete of completed units).
 */
const activeRuns = new Map<string, { aborted: boolean; stopRequested?: boolean }>();
const controlWrites = new Map<string, Promise<void>>();

/** Preserve tap order even when a native pause write is still in flight. */
export async function requestSegmentRunControl(runId: string, command: 'pause' | 'resume' | 'cancel'): Promise<void> {
  await writeRunControl(runId, command);
}

function writeRunControl(runId: string, kind: 'pause' | 'cancel' | 'resume'): Promise<void> {
  const previous = controlWrites.get(runId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    let approvedKnownOutcome = false;
    if (kind === 'resume') {
      const runtime = await getDatabaseRuntime();
      const run = await new SqliteBuildRunStore(runtime.db).getRun(runId);
      if (run) {
        const outcome = await runtime.llmLedger.readBuildRequestOutcome(runId, run.worldId);
        if (outcome === 'outcome_unknown') throw new Error('上次构建请求的扣费结果未知，请先确认该请求的重试。');
        approvedKnownOutcome = outcome === 'known';
      }
    }
    await requestRunControl(runId, kind);
    // The selected runtime is the authority. A native acknowledgement cannot
    // replace this idempotent write (including old installed bridge versions).
    const selectedRuntime = await getDatabaseRuntime();
    await new SqliteBuildRunStore(selectedRuntime.db).requestRunControl(runId, kind, new Date().toISOString());
    if (kind === 'resume') {
      const runtime = await getDatabaseRuntime();
      const now = new Date().toISOString();
      await runtime.db.execute(
        `UPDATE world_build_runs SET status = CASE
            WHEN lease_owner IS NOT NULL AND lease_expires_at > ? THEN 'running' ELSE 'queued' END,
            updated_at = ?
          WHERE run_id = ? AND (status IN ('paused_user', 'stopped_user', 'paused_system')
            OR (status = 'needs_review' AND last_error_code = 'canon_conflict'
              AND NOT EXISTS (SELECT 1 FROM canon_facts f
                WHERE f.world_id = world_build_runs.world_id AND f.status = 'conflict')
              AND NOT EXISTS (SELECT 1 FROM review_issues i
                WHERE i.world_id = world_build_runs.world_id AND i.status = 'open' AND i.severity = 'blocking')
              AND NOT EXISTS (SELECT 1 FROM world_build_units u
                WHERE u.run_id = world_build_runs.run_id
                  AND u.status NOT IN ('completed', 'canceled'))))
            AND pause_requested = 0 AND cancel_requested = 0`,
        [now, now, runId],
      );
      // Retry-safe review recovery: units parked by transport/4xx failures go
      // back to the queue on an explicit resume. outcome_unknown stays parked
      // (request-ledger replay gate); canon conflicts keep their review gate
      // through the run-level code filter below. Content-moderation rejects
      // are deterministic for an identical body: they stay parked for human
      // handling (or an in-run downsize split) and never re-enter the queue.
      await runtime.db.execute(
        `UPDATE world_build_units SET status = 'queued', retry_at = NULL, updated_at = ?
           WHERE run_id = ? AND status = 'needs_review'
             AND (error_code IN ('network', 'unknown', 'input_too_large', 'config')
               OR (? = 1 AND instr(error_code, 'outcome_unknown') > 0))`,
        [now, runId, approvedKnownOutcome ? 1 : 0],
      );
      await runtime.db.execute(
        `UPDATE world_build_runs SET status = 'queued', updated_at = ?
           WHERE run_id = ? AND status = 'needs_review'
             AND (last_error_code IS NULL OR last_error_code IN
               ('network', 'unknown', 'input_too_large', 'config', 'mapping_failed', 'package_finalize_failed')
               OR (? = 1 AND instr(last_error_code, 'outcome_unknown') > 0))
             AND NOT EXISTS (SELECT 1 FROM world_build_units u
                WHERE u.run_id = world_build_runs.run_id AND u.status = 'needs_review'
                  AND u.error_code <> 'content_filter')`,
        [now, runId, approvedKnownOutcome ? 1 : 0],
      );
    }
    if (kind !== 'resume' && !activeRuns.has(runId)) {
      // Queued/backoff runs have no executor to honor the flag. Complete the
      // control atomically only if no other process has a live lease.
      const runtime = await getDatabaseRuntime();
      const now = new Date().toISOString();
      const flag = kind === 'cancel' ? 'cancel_requested' : 'pause_requested';
      await runtime.db.execute(
        `UPDATE world_build_runs SET status = ?, pause_requested = 0, cancel_requested = 0, updated_at = ?
          WHERE run_id = ? AND ${flag} = 1
            AND status NOT IN ('completed', 'failed_terminal', 'canceled')
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        [kind === 'cancel' ? 'stopped_user' : 'paused_user', now, runId, now],
      );
    }
  });
  controlWrites.set(runId, write);
  void write.finally(() => {
    if (controlWrites.get(runId) === write) controlWrites.delete(runId);
  }).catch(() => undefined);
  return write;
}

export function pauseRun(runId: string): boolean {
  const signal = activeRuns.get(runId);
  if (signal) signal.aborted = true;
  // Cross-process (P4): a headless-executed run reads the persisted flag
  // between units; a same-process run also gets the immediate signal above.
  void writeRunControl(runId, 'pause').catch(() => undefined);
  return true;
}

/**
 * Stop semantics (P0-4): the visible "停止构建" asks the coordinator to stop
 * claiming further units. Completed units, retryable failures and the run
 * row itself are all preserved; the run persists as stopped_user and stays
 * resumable.
 */
export async function cancelRun(runId: string): Promise<void> {
  const signal = activeRuns.get(runId);
  if (signal) {
    signal.aborted = true;
    signal.stopRequested = true;
  }
  await writeRunControl(runId, 'cancel');
}

/** Revokes both local interrupt signals and the persisted control flags. */
export async function resumeRun(runId: string): Promise<{ activeInProcess: boolean }> {
  const signal = activeRuns.get(runId);
  if (signal) {
    signal.aborted = false;
    signal.stopRequested = false;
  }
  await writeRunControl(runId, 'resume');
  return { activeInProcess: activeRuns.has(runId) };
}

/** Explicit user opt-in: retry a stopped/failed run with the selected API.
 * Completed extraction stays committed; a live executor's config is immutable. */
export async function useCurrentApiForRun(runId: string, profile: ApiProfile): Promise<string> {
  if (activeRuns.has(runId)) throw new Error('请先暂停当前构建，再切换构建所用的 API。');
  const config = freezeRunConfig(profile, modelBudgetFromProfile(profile));
  const runtime = await getDatabaseRuntime();
  const runs=new SqliteBuildRunStore(runtime.db);
  const oldRun=await runs.getRun(runId);
  if (oldRun && await runtime.llmLedger.readBuildRequestOutcome(runId, oldRun.worldId) === 'outcome_unknown') {
    throw new Error('上次构建请求的扣费结果未知，请先确认该请求的重试。');
  }
  const segment=await runtime.segmentPlans?.findSegmentByRunId(runId);
  if (segment && oldRun) {
    if (oldRun.leaseOwner && oldRun.leaseExpiresAt && oldRun.leaseExpiresAt > new Date().toISOString()) throw new Error('构建仍在执行，请先暂停后切换 API。');
    const oldConfig=reviveRunConfig(oldRun.configJson);
    const budget=modelBudgetFromProfile(profile);
    const nextConfig=freezeRunConfig(profile, oldConfig?.openingPolicyVersion ? {...budget,maxContentOutputTokens:Math.min(6000,budget.maxContentOutputTokens)} : budget,
      oldConfig?.openingPolicyVersion ? {openingPolicyVersion:oldConfig.openingPolicyVersion,bodyTargetRatio:0.10} : {});
    const fingerprint=await runtime.segmentConfigs.register(oldRun.worldId,nextConfig);
    const replacements=await runtime.segments.replaceStoppedExecution({worldId:oldRun.worldId,segmentId:segment.intent.segmentId,executionConfigFingerprint:fingerprint});
    await cancelRun(runId);
    const replacementIds=new Set(replacements.map(s=>s.intent.segmentId));
    const queued=await runtime.segments.dispatch(oldRun.worldId);
    const id=queued.find(s=>replacementIds.has(s.intent.segmentId))?.runIds[0];
    if (!id) throw new Error('replacement_run_unavailable');
    return id;
  }
  const now = new Date().toISOString();
  const changed = await runtime.db.execute(
    `UPDATE world_build_runs SET config_json = ?, model_fingerprint = ?, updated_at = ?
      WHERE run_id = ? AND status IN ('paused_user', 'stopped_user', 'failed_retryable', 'needs_review', 'waiting_unlock')
        AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
    [JSON.stringify(config), `${profile.endpoint}#${profile.model}`, now, runId, now],
  );
  if (!changed) throw new Error('构建仍在执行或已经完成，暂时不能切换 API。');
  await runtime.db.execute('DELETE FROM world_jobs WHERE job_id = ?', [`job-map-recovery-${runId}`]);
  return runId;
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

/** Start or resume the explicitly requested full-source refinement. */
export async function startFullWorldRefinement(
  worldId: string,
  profile: ApiProfile,
): Promise<{ runId: string; resumed: boolean }> {
  const runtime = await getDatabaseRuntime();
  const sourceStore = new SqliteSourceStore(runtime.db);
  const runStore = new SqliteBuildRunStore(runtime.db);
  const world = await runtime.worldStore.getWorld(worldId);
  if (!world) throw new Error('找不到这个世界。');
  const source = await sourceStore.findActiveByRawHash(world.sourceSha256);
  if (!source) throw new Error('本机未找到此世界的流式原文；请从书库重新导入同一文件，再启动全量精编。');
  const latestRevision = await runtime.worldStore.getPublishedPackageRevision(worldId);
  if (latestRevision !== null) {
    const latestPackage = await runtime.worldStore.getWorldPackage(worldId, latestRevision);
    const [facts, chunks] = await Promise.all([
      runtime.worldStore.listFacts(worldId),
      runtime.worldStore.getChunks(worldId),
    ]);
    if (latestPackage && summarizeWorldPreparation({
      manifest: latestPackage.manifest,
      entries: latestPackage.entries,
      sections: latestPackage.sections,
      facts,
      chunks,
      sourceCodePointCount: source.codePointCount,
    }).fullSourceComplete) {
      throw new Error(`全文已整理并发布至 r${latestRevision}。`);
    }
  }

  const modelFingerprint = `${profile.endpoint}#${profile.model}`;
  const relatedRuns = (await runStore.listResumableRuns())
    .filter(run => run.worldId === worldId && run.sourceId === source.sourceId);
  const active = relatedRuns.find(run => ['queued', 'running', 'waiting_network', 'waiting_unlock', 'paused_system'].includes(run.status));
  if (active && active.modelFingerprint !== modelFingerprint) {
    throw new Error('已有全文任务正使用另一模型配置；请先从书库任务卡完成或暂停该任务。');
  }
  if (active) return { runId: active.runId, resumed: true };
  const blocked = relatedRuns.find(run => run.status === 'needs_review'
    && run.modelFingerprint === modelFingerprint);
  if (blocked) throw new Error('已有构建需要人工审查；请先处理该任务，避免重复请求。');
  const resumable = relatedRuns.find(run => ['failed_retryable', 'paused_user', 'stopped_user'].includes(run.status)
    && run.modelFingerprint === modelFingerprint);
  if (resumable) return { runId: resumable.runId, resumed: true };

  const runId = `run-full-${worldId}-${Date.now().toString(36)}`;
  const runBudget = modelBudgetFromProfile(profile);
  const extractorVersion = worldBuildExtractorVersion(runBudget.reasoningTier ?? 'low');
  await createExtractionRun(
    { sourceStore, runStore, worldStore: runtime.worldStore, sha256Hex: async input => nativeSha256.sha256Hex(input) },
    {
      runId,
      worldId,
      sourceId: source.sourceId,
      modelFingerprint,
      title: world.title,
      extractorVersion,
      mode: 'resident',
      budget: runBudget,
      config: freezeRunConfig(profile, runBudget),
    },
  );
  return { runId, resumed: false };
}

/** Minimal persisted progress for a world detail screen polling a background run. */
export async function getBuildRunProgress(runId: string): Promise<{
  status: string;
  phase: string;
  unitsDone: number;
  unitsTotal: number;
  unitsFailed: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
} | null> {
  const runtime = await getDatabaseRuntime();
  const run = await new SqliteBuildRunStore(runtime.db).getRun(runId);
  if (!run) return null;
  return {
    status: run.status,
    phase: run.phase,
    unitsDone: run.unitsDone,
    unitsTotal: run.unitsTotal,
    unitsFailed: run.unitsFailed,
    lastErrorCode: run.lastErrorCode,
    lastErrorMessage: run.lastErrorMessage,
  };
}

/** Drives an existing run to completion (used by the UI now, C5 runner later). */
type ExtractionResult = { completed: boolean; unitsDone: number; unitsTotal: number; unitsFailed: number };
const extractions = new Map<string, Promise<ExtractionResult>>();

/**
 * TTFP serialization: at most one Opening-Package gate evaluation in flight
 * per world per process. Workers of one run may finish batches concurrently;
 * the chain collapses their evaluations, and the published-revision re-check
 * inside makes the publish itself exactly-once.
 */
const openingPublishChains = new Map<string, Promise<void>>();

/** Same-process starters join the active executor without replacing its signal. */
export function runExtraction(
  runId: string,
  profile: ApiProfile | null,
  onProgress: (progress: WorldBuildProgress & { chunksDone?: number; chunksTotal?: number }) => void,
): Promise<ExtractionResult> {
  const existing = extractions.get(runId);
  if (existing) return existing;
  const signal = { aborted: false, stopRequested: false };
  activeRuns.set(runId, signal);
  const extraction = (async () => {
    const runtime = await getDatabaseRuntime();
    return executeWithAutomaticMappingRecovery({
      runStore: new SqliteBuildRunStore(runtime.db), worldStore: runtime.worldStore, signal,
      execute: () => runExtractionInternal(runId, profile, onProgress, signal),
      onWaiting: message => onProgress({ phase: 'extracting', message }),
    }, runId);
  })().finally(() => {
    activeRuns.delete(runId);
    extractions.delete(runId);
  });
  extractions.set(runId, extraction);
  return extraction;
}

async function runExtractionInternal(
  runId: string,
  profile: ApiProfile | null,
  onProgress: (progress: WorldBuildProgress & { chunksDone?: number; chunksTotal?: number }) => void,
  signal: { aborted: boolean; stopRequested: boolean },
): Promise<ExtractionResult> {
  const runtime = await getDatabaseRuntime();
  const runStore = new SqliteBuildRunStore(runtime.db);
  const sourceStore = new SqliteSourceStore(runtime.db);
  const run = await runStore.getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}.`);

  // A late service callback never requeues a user-held or terminal run.
  if (run.pauseRequested || run.cancelRequested
    || ['paused_user', 'stopped_user', 'canceled', 'completed', 'failed_terminal', 'needs_review'].includes(run.status)) {
    return { completed: run.status === 'completed', unitsDone: run.unitsDone,
      unitsTotal: run.unitsTotal, unitsFailed: run.unitsFailed };
  }

  // Frozen run config (P1): a run executes with the endpoint/model/budgets it
  // was created with; later profile edits never mutate it. Legacy runs keep
  // the passed-in live profile.
  const runConfig = reviveRunConfig(run.configJson);
  if (!runConfig && !profile) {
    throw new Error('旧版构建缺少冻结配置且当前无可用模型配置。');
  }
  const effectiveProfile: ApiProfile = runConfig ? providerProfileFromFrozen(runConfig) : profile!;
  if (runConfig) {
    const key = await new KeychainSecretStore().get(runConfig.keyRef);
    if (!key) {
      // Locked Keychain (device locked / secret evicted): wait, never move
      // the key into AsyncStorage or the task payload.
      await runStore.setRunStatus(runId, 'waiting_unlock', new Date().toISOString(),
        'keychain_locked', '密钥暂不可用（设备锁定）；等待解锁后继续。');
      return { completed: false, unitsDone: run.unitsDone, unitsTotal: run.unitsTotal, unitsFailed: run.unitsFailed };
    }
  }

  onProgress({
    phase: 'extracting',
    chunksDone: run.unitsDone,
    chunksTotal: run.unitsTotal,
    message: `抽取中 ${run.unitsDone}/${run.unitsTotal} 组`,
  });
  const runBudget = runConfig ? {
    contextWindowTokens: runConfig.contextWindowTokens,
    maxContentOutputTokens: runConfig.contentOutputTokens,
    reasoningReserveTokens: runConfig.reasoningReserveTokens,
    reasoningEffort: runConfig.reasoningTier,
    reasoningTier: runConfig.reasoningTier,
    reasoningDialect: runConfig.reasoningDialect,
    reasoningPolicyVersion: runConfig.reasoningReservePolicy.policyVersion,
    supportsPromptCache: runConfig.supportsPromptCache,
    reserveTokens: 2_000,
  } : modelBudgetFromProfile(effectiveProfile);
  const segmentRecord = runtime.segmentPlans ? await runtime.segmentPlans.findSegmentByRunId(runId) : null;
  const modelProfileFingerprint = llmModelProfileFingerprint(effectiveProfile);
  const requestGovernance: WorldBuildRequestGovernance = {
    profile: effectiveProfile,
    runId,
    worldId: run.worldId,
    modelProfileFingerprint,
    frozenReserveTokensByRequestKind: runConfig?.reasoningReservePolicy.reserves,
  };
  // Global RPM/TPM scheduler (P1 §5): every billable request of this run -
  // extraction, registry, timeline, mapping - shares one budget. The
  // registry keeps the scheduler per endpoint+model so adaptive 429 pacing
  // survives run boundaries and covers the play loop as well.
  const scheduler = schedulerForProfile(effectiveProfile);
  const scheduledProvider = () => new RateScheduledProvider(
    new LedgeredProvider(
      new OpenAICompatibleProvider(effectiveProfile, new KeychainSecretStore(), new FetchHttpTransport(), 300_000),
      runtime.llmLedger,
      { modelProfileFingerprint },
    ),
    scheduler,
  );
  const makeProvider = () => ({ complete: (request: LlmRequest) => scheduledProvider().complete(segmentRecord ? {
    ...request, scheduling: { logicalTaskId: segmentRecord.intent.intentId,
      role: request.role === 'WorldMapper' ? 'mapper' : 'extractor', priority: segmentRecord.intent.priority,
      endpointBucketId: scheduler.endpointBucketId,
      requestPlanHash: segmentRecord.intent.executionConfigFingerprint,
      estimatedInputTokens: Math.ceil((request.system.length + request.user.length) / 2), reservedOutputTokens: request.maxOutputTokens,
      worldId: run.worldId, expectedDurationMs: 90_000 },
  } : request) });
  let openingSurvey: OpeningSurveyV1 | null = null;
  const result = await executeRun(
    {
      sourceStore,
      runStore,
      worldStore: runtime.worldStore,
      extractor: coordinatorExtractor(effectiveProfile, requestGovernance, request => makeProvider().complete(request)),
      groupExtractor: coordinatorGroupExtractor(effectiveProfile, requestGovernance, request => makeProvider().complete(request)),
      sha256Hex: async input => nativeSha256.sha256Hex(input),
      owner: `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      signal,
      concurrency: effectiveProfile.concurrency ?? 2,
      tpmTokensPerMinute: effectiveProfile.tpm,
      budget: runBudget,
      ...(segmentRecord ? { prepareContext: async ({ fencingToken, owner }: { fencingToken: number; owner: string }) => {
        if (segmentRecord.intent.reason !== 'bootstrap') {
          const texts = await Promise.all(segmentRecord.intent.ranges.map(range => runtime.sourceCatalog.readRange(range)));
          const body = texts.join('\n');
          const names = (await runtime.worldStore.listEntities(run.worldId)).filter(entity => [entity.name,...entity.aliases]
            .some(name => name.length >= 2 && body.includes(name))).slice(0,40)
            .map(entity => ({ name: entity.name, type: entity.type, aliases: entity.aliases.slice(0,8) }));
          return '增量精准抽取：只抽取本授权片段的新事实与明确变化，不重复重述旧身份、历史和未改变的所在地。以下本地名称表仅用于复用同一实体的名称/别名，不是新事实或指令；引用仍必须逐字来自本请求正文。回忆、传闻、未来不作为 current_location。名称表：' + JSON.stringify(names);
        }
        if ((runConfig?.openingPolicyVersion === 'opening-90s-1' || runConfig?.openingPolicyVersion === 'opening-90s-2' || runConfig?.openingPolicyVersion === OPENING_POLICY_VERSION)) {
          onProgress({ phase: 'extracting', message: '正在一次精准阅读开局所需内容；输入不超过上下文 10%' });
          return OPENING_EXTRACTION_FOCUS;
        }
        onProgress({ phase: 'extracting', message: '以模型上下文 10% 为上限，精准粗读开局所需的人物、地点、事件与关系' });
        const service = new OpeningSurveyService({ catalog: runtime.sourceCatalog, store: runtime.openingSurveys,
          provider: makeProvider(), profile: effectiveProfile, governance: requestGovernance, sha256Hex: async input => nativeSha256.sha256Hex(input) });
        openingSurvey = await service.prepare({ worldId: run.worldId, sourceId: run.sourceId,
          configFingerprint: segmentRecord.intent.executionConfigFingerprint,
          assertCurrent: tx => assertSegmentExecution(tx, segmentRecord.intent, run.runId, fencingToken, owner) });
        if (!openingSurvey) {
          await runtime.segmentArtifacts.recordDiagnostic({ worldId: run.worldId, segmentId: segmentRecord.intent.segmentId,
            generation: segmentRecord.intent.generation, errors: ['opening_survey_failed_using_exact_bootstrap'], createdAt: new Date().toISOString() });
          onProgress({ phase: 'extracting', message: '粗读未形成有效选段，已记录诊断，继续精抽取开局；内容门禁保持有效' });
          return undefined;
        }
        // Evidence suggests a bounded contiguous prefix. Exact analysis still
        // runs as small segments and must pass the unchanged playability gate.
        if (openingSurvey.recommendedEndCp > 3200) {
          const range = await runtime.sourceCatalog.createRange(run.sourceId, 0, openingSurvey.recommendedEndCp);
          await runtime.segments.requestDemand({ worldId: run.worldId,
            executionConfigFingerprint: segmentRecord.intent.executionConfigFingerprint, ranges: [range], reason: 'bootstrap', priority: 'P1' });
        }
        return `开局精抽取关注以下原文已出现名称，仍只从本请求授权片段验证和抽取，不把粗读建议当事实：${openingSurvey.evidence.map(e => `${e.category}:${e.label}`).join('；')}`;
      } } : {}),
      buildRegistry: async ({ segmentBody, worldId, contentHash, modelFingerprint }) => {
        if (segmentRecord) return ''; // existing local entity resolver deduplicates small-range canon
        const provider = makeProvider();
        const registry = await buildBookRegistry({
          worldStore: runtime.worldStore,
          complete: request => provider.complete(request),
          segmentBody,
          worldId,
          modelFingerprint,
          contentHash,
          createdAt: new Date().toISOString(),
          governance: requestGovernance,
        });
        return registrySummaryFor(registry.entities);
      },
      onTimeline: async ({ worldId, contentHash }) => {
        if (segmentRecord) return; // local proposal resolution preserves prior event order
        const provider = makeProvider();
        await runTimelinePass({
          worldStore: runtime.worldStore,
          complete: request => provider.complete(request),
          worldId,
          modelFingerprint: `${effectiveProfile.endpoint}#${effectiveProfile.model}`,
          contentHash,
          createdAt: new Date().toISOString(),
          governance: requestGovernance,
        });
      },
      onUnitDone: info => {
        onProgress({
          phase: 'extracting',
          chunksDone: info.unitsDone,
          chunksTotal: info.unitsTotal,
          message: `抽取中 ${info.unitsDone}/${info.unitsTotal} 组`,
        });
      },
      onBatchCommitted: async ({ run }) => {
        if (segmentRecord) {
          // A partial storage chunk is not complete logical coverage. Finalize
          // publishes the first bounded segment, without waiting for a book ratio.
          return;
        }
        // TTFP (task §11): after every completed batch of a stage-scoped
        // planner-v2 run, evaluate the deterministic playability gate over
        // persisted canon; on the first pass publish the Opening Package over
        // the contiguous extracted prefix. Serialized per world; exactly-once
        // via the published-revision re-check. The ONLY paid step is the
        // regular mapping pass itself - never a "can we open?" request.
        const worldId = run.worldId;
        const previous = openingPublishChains.get(worldId) ?? Promise.resolve();
        const next = previous.then(async () => {
          const worldStore = runtime.worldStore;
          const latest = await worldStore.getPublishedPackageRevision(worldId);
          if (latest !== null) return;
          const blocking = await runtime.db.queryOne<{ count: number }>(
            "SELECT COUNT(*) AS count FROM review_issues WHERE world_id = ? AND status = 'open' AND severity = 'blocking'",
            [worldId],
          );
          const [entities, facts, events, proposals] = await Promise.all([
            worldStore.listEntities(worldId),
            worldStore.listFacts(worldId),
            worldStore.listEvents(worldId),
            worldStore.listEventProposals(worldId),
          ]);
          const verdict = evaluatePlayabilityGate({
            entities,
            facts,
            eventCount: events.filter(event => event.status === 'canon').length + proposals.length,
            openBlockingReviewIssues: blocking?.count ?? 0,
            conflictFactCount: facts.filter(fact => fact.status === 'conflict').length,
          });
          if (!verdict.playable) return;
          const chunks = (await worldStore.getChunks(worldId))
            .slice().sort((a, b) => a.startOffset - b.startOffset);
          let prefixEnd = 0;
          for (const chunk of chunks) {
            if (chunk.extractionStatus !== 'extracted' || chunk.startOffset !== prefixEnd) break;
            prefixEnd = chunk.endOffset;
          }
          if (prefixEnd <= 0) return;
          const manifest = await sourceStore.getManifest(run.sourceId);
          if (!manifest || manifest.status !== 'active') return;
          const coveredText = await sourceStore.readRange(run.sourceId, 0, prefixEnd);
          const coveredHash = await nativeSha256.sha256Hex(coveredText);
          const provider = makeProvider();
          await buildPackageFromCanon({
            requirePlayableOpening: true,
            worldStore,
            provider: {
              complete: request => governMappingRequest(request, request => provider.complete(request), requestGovernance, run),
            },
            sha256Hex: nativeSha256.sha256Hex,
            worldId,
            runId: run.runId,
            sourceSha256: manifest.rawSha256Hex,
            mappingVersion: `mapper-3#${effectiveProfile.model}#${requestGovernance.profile.reasoningTier ?? 'low'}`,
            createdAt: new Date().toISOString(),
            stageScope: {
              ranges: [{ startCodePoint: 0, endCodePoint: prefixEnd, contentSha256: coveredHash }],
              coversWholeText: prefixEnd >= manifest.codePointCount,
            },
            sourceCodePointCount: manifest.codePointCount,
            signal,
          });
        }).catch(async error => {
          await runtime.worldStore.saveReviewIssue({ worldId, issueId: `opening-attempt-${run.runId}`,
            kind: 'opening_publication', severity: 'minor',
            detailJson: JSON.stringify({ code: 'opening_publication_failed', runId: run.runId,
              errorClass: error instanceof Error ? error.name : 'unknown' }), createdAt: new Date().toISOString() });
          onProgress({ phase: 'extracting', message: '提前发布尚未通过；诊断已保存，可在审查中查看。' });
        });
        openingPublishChains.set(worldId, next);
        await next;
        if (openingPublishChains.get(worldId) === next) openingPublishChains.delete(worldId);
      },
      onFinalize: async ({ run, setPhase }) => {
        if (segmentRecord) {
          const intent = segmentRecord.intent;
          const assertCurrent = async () => {
            const current = await runStore.getRun(run.runId);
            const record = await runtime.segmentPlans.findSegmentByRunId(run.runId);
            if (!current || current.fencingToken !== run.fencingToken || current.cancelRequested || current.pauseRequested
              || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date().toISOString()
              || !record || record.intent.generation !== intent.generation
              || !await runtime.worldStore.getWorld(run.worldId)
              || !await runtime.sourceCatalog.isBindingCompatible(run.worldId, intent.sourceBinding)) throw new Error('stale_segment_execution');
          };
          await assertCurrent();
          // Multi-range segments finalize only after all of their other ranges.
          for (const linked of segmentRecord.runIds) if (linked !== run.runId) {
            const r = await runStore.getRun(linked);
            if (r?.status !== 'completed') return;
          }
          if (intent.reason === 'bootstrap') await replayCompletedLocationAdapter({ worldStore: runtime.worldStore, sourceStore, run, sha256Hex: nativeSha256.sha256Hex,
            assertCurrent: tx => assertSegmentExecution(tx, intent, run.runId, run.fencingToken, run.leaseOwner) });
          await setPhase('mapping');
          await resolveEventProposals({ worldStore: runtime.worldStore }, run.worldId);
          const published = await runtime.segmentArtifacts.listArtifacts(run.worldId);
          if (published.some(a => a.segmentId === intent.segmentId && a.generation === intent.generation)) return;
          const baseRevision = await runtime.worldStore.getPublishedPackageRevision(run.worldId);
          const openingBuild = baseRevision === null || intent.reason === 'bootstrap' && published.length === 0;
          const previousBase = baseRevision === null ? null : await runtime.worldStore.getWorldPackage(run.worldId, baseRevision);
          const compatibleArtifacts = [];
          for (const artifact of published) if (await runtime.sourceCatalog.isBindingCompatible(run.worldId, artifact.sourceBinding)) compatibleArtifacts.push(artifact);
          const world = await runtime.worldStore.getWorld(run.worldId);
          if (!world) throw new Error('project_deleted');
          const ranges = [...intent.ranges];
          if (openingBuild) for (const segment of await runtime.segmentPlans.listSegments(run.worldId)) {
            if (segment.intent.reason !== 'bootstrap' || segment.intent.segmentId === intent.segmentId || !segment.runIds.length) continue;
            const linked = await Promise.all(segment.runIds.map(id => runStore.getRun(id)));
            const complete = await Promise.all(linked.map(async r => r !== null
              && isRunExtractionComplete(r, await runStore.listUnits(r.runId))));
            if (complete.every(Boolean)) ranges.push(...segment.intent.ranges);
          }
          const provider = makeProvider();
          const localOpening = openingBuild && intent.reason === 'bootstrap' && (runConfig?.openingPolicyVersion === 'opening-90s-1' || runConfig?.openingPolicyVersion === 'opening-90s-2' || runConfig?.openingPolicyVersion === OPENING_POLICY_VERSION);
          const mappingVersion = localOpening ? 'opening-local-rules-1' : `mapper-3#${effectiveProfile.model}#${effectiveProfile.reasoningTier ?? 'low'}`;
          const input = { worldStore: runtime.worldStore,
            provider: { complete: (request: Parameters<typeof governMappingRequest>[0]) => governMappingRequest(request, r => provider.complete(r), requestGovernance, run) },
            sha256Hex: nativeSha256.sha256Hex, worldId: run.worldId, runId: run.runId,
            sourceSha256: world.sourceSha256, mappingVersion, ...(localOpening ? { mappingMode: 'startup_local' as const } : {}), createdAt: new Date().toISOString(),
            executionConfigFingerprint: intent.executionConfigFingerprint, requirePlayableOpening: openingBuild,
            incrementalMapping: { kind: openingBuild ? 'opening' as const : 'incremental' as const,
              ranges, sourceBinding: intent.sourceBinding, executionConfigFingerprint: intent.executionConfigFingerprint,
              ...(!openingBuild ? { previousEntries: [...previousBase!.entries, ...compatibleArtifacts.flatMap(a => [...a.entries])],
                publishedEvidence: compatibleArtifacts.map(a => ({ sourceFactIds: [...new Set(a.citations.flatMap(c => [...c.sourceFactIds]))], coverage: a.coverage })),
                outputMode: 'change_set' as const } : {}),
              ...(localOpening ? { openingFactLimit: 40, openingEventPolicy: 'latest_covered' as const } : {}) },
            assertCurrent, assertCurrentTx: (tx: SqliteTransaction) => assertSegmentExecution(tx, intent, run.runId, run.fencingToken, run.leaseOwner), signal };
          try {
            const draft = await buildPackageDraftFromCanon(input);
            await assertCurrent();
            if (openingBuild && !draft.entries.some(e => e.kind === 'scene' && e.visibility === 'public'
              && ((e.definition as { actors?: string[]; questIds?: string[] }).actors?.length
                || (e.definition as { questIds?: string[] }).questIds?.length))) throw new Error('开局缺少带证据的行动依赖闭包');
            let base = previousBase;
            if (!base || openingBuild && canonicalStringify(base.entries as unknown as CanonicalJson)
              !== canonicalStringify(draft.entries.map(e => ({ ...e, revision: base!.manifest.revision })) as unknown as CanonicalJson)) {
              const end = Math.max(...ranges.map(r => r.endCp));
              const text = await sourceStore.readRange(run.sourceId, 0, end);
              const built = await buildPackageFromCanon({ ...input, stageScope: { ranges: [{ startCodePoint: 0, endCodePoint: end,
                contentSha256: await nativeSha256.sha256Hex(text) }], coversWholeText: false,
                ...(localOpening ? { openingWorldTimeOrder: Math.max(0, ...draft.selection.events.filter(e => e.worldTimeOrder !== null).map(e => e.worldTimeOrder!)) } : {}) }, sourceCodePointCount: (await sourceStore.getManifest(run.sourceId))?.codePointCount });
              base = { manifest: built.manifest, entries: built.entries, sections: built.sections };
            }
            const known = new Map([...base.entries, ...published.flatMap(a => [...a.entries])].map(e => [e.entryId, e]));
            const renames = new Map(draft.entries.filter(e => known.has(e.entryId)
              && JSON.stringify(known.get(e.entryId)) !== JSON.stringify({ ...e, revision: base!.manifest.revision })).map(e => [e.entryId, `${e.entryId}:segment-${intent.segmentId.slice(-12)}`]));
            const entries = openingBuild ? base.entries : draft.entries.map(e => ({ ...remapEntryReferences(e, renames), revision: base!.manifest.revision,
              ...(e.provenance.kind !== 'design_fill' && e.visibility === 'public'
                ? { visibility: 'discoverable' as const, revealPolicyId: 'segment-explicit-discovery' } : {}),
              }));
            const sections = openingBuild ? base.sections : draft.sections.map(s => ({ ...s, entryIds: s.entryIds.map(id => renames.get(id) ?? id) }));
            // Reuse only the exact dependency evidence, not the entire old
            // segment. Existing publication bounds/validator stay unchanged.
            const publicationCoverage = [...ranges];
            const citedFacts = new Set(entries.flatMap(e => [...e.provenance.sourceFactIds, ...Object.values(e.fieldProvenance).flatMap(p => p.sourceFactIds)]));
            if (!openingBuild) for (const fact of draft.selection.facts.filter(f => citedFacts.has(f.factId))) for (const span of fact.sources) {
              const sourceId = sourceIdForChapter(span.chapterId, intent.sourceBinding);
              if (!sourceId) throw new Error('dependency_source_missing');
              const range = await runtime.sourceCatalog.createRange(sourceId, span.startOffset, span.endOffset);
              if (!rangeCovered(range, publicationCoverage)) publicationCoverage.push(range);
            }
            await setPhase('validating');
            await assertCurrent();
            await runtime.segmentPublication.publishIntentDraft({ intent, coverage: publicationCoverage,
              basePackage: { revision: base.manifest.revision, contentHash: base.manifest.contentHash },
              ruleset: base.manifest.ruleset, mappingVersion: base.manifest.mappingVersion,
              canonSnapshotHash: draft.canonSnapshotHash, entries, sections, createdAt: input.createdAt,
              ...(openingBuild ? { openingRequirements: {
                requiredEntityIds: draft.selection.entities.map(e => e.entityId), requiredFactIds: [],
                requiredEventIds: draft.selection.events.map(e => e.eventId), requiredEntryIds: [], ranges } } : {}),
              dependencies: compatibleArtifacts.filter(a => entries.some(e => [...e.provenance.sourceFactIds, ...Object.values(e.fieldProvenance).flatMap(p => p.sourceFactIds)]
                .some(id => a.citations.some(c => c.sourceFactIds.includes(id))))
                || entries.some(e => e.dependencyIds.some(id => a.entries.some(prior => prior.entryId === id)))
                || a.entries.some(prior => entries.some(e => e.entryId === prior.entryId)))
                .map(a => ({ artifactId: a.artifactId, contentHash: a.contentHash })),
              assertCurrent: tx => assertSegmentExecution(tx, intent, run.runId, run.fencingToken, run.leaseOwner) });
            await runtime.segments.readReadiness({ worldId: run.worldId });
            if ((await runtime.segmentPlans.listDemands(run.worldId)).some(d=>d.active&&d.reason==='user_full')) {
              const ids=await queueExplicitFullWindows(run.worldId);
              void import('./segmentRuntime').then(module=>{for(const id of ids) void module.startSegmentRun(id).catch(()=>undefined);});
            }
            if (openingBuild && runtime.projectStyle) {
              void import('./writerStyle').then(module => module.ensureAutomaticProjectStyleAnalysis(run.worldId)).catch(async () => {
                if (!await runtime.worldStore.getWorld(run.worldId)) return;
                await runtime.segmentArtifacts.recordDiagnostic({ worldId: run.worldId, segmentId: intent.segmentId,
                  generation: intent.generation, errors: ['optional_style_analysis_unavailable'], createdAt: new Date().toISOString() });
              });
            }
            onProgress({ phase: 'done', message: openingBuild ? '开局资料已就绪，可以开始游玩' : '近期资料已就绪，可在回合间采用' });
          } catch (error) {
            await runtime.segmentArtifacts.recordDiagnostic({ worldId: run.worldId, segmentId: intent.segmentId,
              generation: intent.generation, errors: [error instanceof Error ? error.message.slice(0, 500) : 'publication_failed'], createdAt: input.createdAt });
            // Only missing opening evidence extends the bounded bootstrap. A
            // conflict, unknown paid outcome or provider error stays parked.
            const message = error instanceof Error ? error.message : '';
            if (openingBuild && /事实不足|开局缺少|来源闭包|引用实体缺失/.test(message)) {
              const source = (await runtime.sourceCatalog.snapshot(run.worldId)).members.find(m => m.sourceId === run.sourceId);
              const end = Math.max(...ranges.filter(r => r.sourceId === run.sourceId).map(r => r.endCp));
              if (source && end < source.codePointCount && end < 12000) {
                const range = await runtime.sourceCatalog.createRange(run.sourceId, end, Math.min(source.codePointCount, end + 3200, 12000));
                await runtime.segments.requestDemand({ worldId: run.worldId, executionConfigFingerprint: intent.executionConfigFingerprint,
                  ranges: [range], reason: 'bootstrap', priority: 'P1' });
                const next = await runtime.segments.dispatch(run.worldId);
                const { startOrResumeBuild } = await import('./buildWatchdog');
                for (const segment of next) for (const id of segment.runIds) if (id !== run.runId) void startOrResumeBuild(id, null);
              }
            }
            throw error;
          }
          return;
        }
        const sourceManifest = await sourceStore.getManifest(run.sourceId);
        if (!sourceManifest || sourceManifest.status !== 'active') {
          throw new Error('原文源已不可用，全文映射暂未发布。');
        }
        const runScope = run.scopeJson
          ? JSON.parse(run.scopeJson) as { startCp: number; endCp: number }
          : null;
        const [sourceChunks, worldChunks] = await Promise.all([
          sourceStore.getChunks(run.sourceId),
          runtime.worldStore.getChunks(run.worldId),
        ]);
        const worldChunksById = new Map(worldChunks.map(chunk => [chunk.chunkId, chunk]));
        const chunkExtracted = (chunk: typeof sourceChunks[number]): boolean => {
          const extracted = worldChunksById.get(chunk.chunkId);
          return extracted?.extractionStatus === 'extracted'
            && extracted.startOffset === chunk.startOffset
            && extracted.endOffset === chunk.endOffset
            && extracted.contentHash === chunk.contentHash;
        };
        const relevantChunks = runScope
          ? sourceChunks.filter(chunk => chunk.endOffset > runScope.startCp && chunk.startOffset < runScope.endCp)
          : sourceChunks;
        const everyChunkExtracted = relevantChunks.length > 0 && relevantChunks.every(chunkExtracted);
        if (!everyChunkExtracted) {
          throw new Error(runScope
            ? '阶段文本块没有全部完成抽取；不发布阶段包。'
            : '文本块没有连续覆盖全文且全部完成抽取；保留现有开局包，不发布全量精编包。');
        }

        const provider = makeProvider();
        const world = await runtime.worldStore.getWorld(run.worldId);
        if (!world) throw new Error('世界记录已不可用，全文映射暂未发布。');
        let phaseWrites = Promise.resolve();
        await setPhase('mapping');

        if (runScope) {
          // Stage finalize (P3): publish the CUMULATIVE built prefix as an
          // incremental stage package (whole_source/complete when finished),
          // then leave it pending_activation for the next safe boundary.
          const stageStore = new SqliteStagePlanStore(runtime.db);
          const deps = {
            db: runtime.db, stageStore, runStore, sourceStore,
            worldStore: runtime.worldStore,
            sha256Hex: async (input: string) => nativeSha256.sha256Hex(input),
          };
          const built = await builtStageRanges(deps, run.worldId);
          const builtEnd = built?.ranges[0]?.endCp ?? 0;
          const coveredEnd = Math.max(builtEnd, runScope.endCp);
          const coveredText = await sourceStore.readRange(run.sourceId, 0, coveredEnd);
          const coveredHash = await nativeSha256.sha256Hex(coveredText);
          const coversWholeText = coveredEnd >= sourceManifest.codePointCount;
          const built2 = await buildPackageFromCanon({
            requirePlayableOpening: true,
            worldStore: runtime.worldStore,
            provider: {
              complete: request => governMappingRequest(request, request => provider.complete(request), requestGovernance, run),
            },
            sha256Hex: nativeSha256.sha256Hex,
            worldId: run.worldId,
            runId: run.runId,
            sourceSha256: world.sourceSha256,
            mappingVersion: `mapper-3#${effectiveProfile.model}#${requestGovernance.profile.reasoningTier ?? 'low'}`,
            createdAt: new Date().toISOString(),
            stageScope: {
              ranges: [{ startCodePoint: 0, endCodePoint: coveredEnd, contentSha256: coveredHash }],
              coversWholeText,
            },
            sourceCodePointCount: sourceManifest.codePointCount,
            signal,
            onProgress: info => {
              onProgress({ phase: 'extracting', message: info.message ?? '正在编译阶段三宝书…' });
              if (info.phase === 'publish') {
                phaseWrites = phaseWrites.then(() => setPhase('validating'));
              } else if (info.phase === 'validated' || info.phase === 'published') {
                phaseWrites = phaseWrites.then(() => setPhase('publishing'));
              }
            },
          });
          await phaseWrites;
          const planRow = await stageStore.getStagePlanByWorld(run.worldId);
          if (planRow) {
            const stageStates = await stageStore.listStageStates(planRow.planId);
            const thisStage = stageStates.find(state => state.runId === run.runId);
            if (thisStage) {
              await markStageRunStatus(deps, {
                worldId: run.worldId, stageIndex: thisStage.stageIndex, status: 'built',
                packageRevision: built2.manifest.revision,
              });
              await markStageRunStatus(deps, {
                worldId: run.worldId, stageIndex: thisStage.stageIndex, status: 'pending_activation',
                packageRevision: built2.manifest.revision,
              });
            }
          }
          await tryActivateStagePackages(run.worldId);
          return;
        }

        const sourceRanges = await buildWholeSourceRanges({
          chunks: sourceChunks,
          sourceCodePointCount: sourceManifest.codePointCount,
          readRange: (start, end) => sourceStore.readRange(run.sourceId, start, end),
          sha256Hex: nativeSha256.sha256Hex,
        });
        if (!sourceRangesCoverWholeText(sourceRanges, sourceManifest.codePointCount)) {
          throw new Error('全文来源范围无法连续覆盖原文；保留现有开局包，不发布全量精编包。');
        }

        const residentMapping = run.planVersion === 'plan-resident-1';
        await buildPackageFromCanon({
          requirePlayableOpening: true,
          worldStore: runtime.worldStore,
          resident: residentMapping,
          provider: {
            complete: request => governMappingRequest(request, request => provider.complete(request), requestGovernance, run),
          },
          sha256Hex: nativeSha256.sha256Hex,
          worldId: run.worldId,
          runId: run.runId,
          sourceSha256: world.sourceSha256,
          mappingVersion: residentMapping
            ? `mapper-3#${effectiveProfile.model}#${requestGovernance.profile.reasoningTier ?? 'low'}`
            : `mapper-3#${effectiveProfile.model}#${requestGovernance.profile.reasoningTier ?? 'low'}`,
          createdAt: new Date().toISOString(),
          sourceRanges,
          sourceCodePointCount: sourceManifest.codePointCount,
          signal,
          onProgress: info => {
            onProgress({ phase: 'extracting', message: info.message ?? '正在全量精编三宝书…' });
            if (info.phase === 'mapping') {
              phaseWrites = phaseWrites.then(() => setPhase('mapping'));
            } else if (info.phase === 'publish') {
              phaseWrites = phaseWrites.then(() => setPhase('validating'));
            } else if (info.phase === 'validated' || info.phase === 'published') {
              phaseWrites = phaseWrites.then(() => setPhase('publishing'));
            }
          },
        });
        await phaseWrites;
      },
    },
    runId,
  );
  onProgress({
    phase: result.completed ? 'done' : 'failed',
    chunksDone: result.unitsDone,
    chunksTotal: result.unitsTotal,
    message: result.completed ? '抽取完成' : '抽取未全部完成，可重试续建',
  });
  return result;
}
