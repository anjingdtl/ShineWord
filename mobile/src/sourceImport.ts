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
import { createExtractionRun, executeRun, type UnitExtractor } from '../../src/application/worldBuild/coordinator';
import { LlmChunkExtractor } from '../../src/application/world/llmExtractor';
import { LlmGroupExtractor } from '../../src/application/world/llmGroupExtractor';
import { buildBookRegistry, registrySummaryFor } from '../../src/application/world/bookRegistry';
import { modelBudgetFromProfile } from '../../src/application/worldBuild/profileModelBudget';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import type { ApiProfile } from '../../src/application/llm/types';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';
import { getDatabaseRuntime } from './database';
import { nativeSha256 } from './nativeCrypto';
import { stageUri, stagedTextSource, deleteStaged } from './textSource';
import type { SourceManifest } from '../../src/application/ports/sourceStore';
import type { WorldRecord, WorldJobRecord } from '../../src/application/ports/worldStore';
import { bytesSha } from './worldImport';
import type { WorldBuildProgress } from './worldImport';
import {
  compileProgressiveOpeningPackage,
  extractOpeningDossier,
  openingSourceBudgetForProfile,
  OPENING_DOSSIER_VERSION,
  OpeningPreparationError,
} from '../../src/application/worldPackage/progressiveOpening';
import { buildPackageFromCanon } from '../../src/application/worldPackage/buildPackageFromCanon';
import { sourceRangesCoverWholeText, summarizeWorldPreparation } from '../../src/application/worldPackage/preparationStatus';
import { buildWholeSourceRanges } from '../../src/application/worldPackage/sourceScope';

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

export interface ProgressiveOpeningSummary {
  sourceId: string;
  worldId: string;
  packageRevision: number;
  byteLength: number;
  codePointCount: number;
  chapterCount: number;
  chunkCount: number;
  reusedSource: boolean;
  alreadyPlayable: boolean;
  physicalRequests: number;
  totalMs: number;
  extractionMs: number;
}

function makeSourceId(rawSha256: string): string {
  return `src-${rawSha256.slice(0, 16)}-${Date.now().toString(36)}`;
}

/**
 * Full streaming import: stage -> normalize/split -> activate -> create run.
 * Extraction itself is driven separately (`executeRun`) so background runners
 * (closeout C5) own the long LLM phase.
 */
async function importNovelInternal(
  uri: string,
  fileName: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
  mode: 'full' | 'opening',
): Promise<StreamedImportSummary | ProgressiveOpeningSummary> {
  const importStartedAt = Date.now();
  onProgress({ phase: 'importing', message: '正在读取并解析小说…' });
  const runtime = await getDatabaseRuntime();
  const sourceStore = new SqliteSourceStore(runtime.db);
  const runStore = new SqliteBuildRunStore(runtime.db);

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
        }
      },
      sha256Hex: async input => nativeSha256.sha256Hex(input),
      sha256BytesHex: bytes => bytesSha.sha256BytesHex(bytes),
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

  if (mode === 'opening') {
    return prepareProgressiveOpening({
      sourceId,
      sourceManifest: manifest,
      reusedSource,
      fileName,
      profile,
      onProgress,
      totalStartedAt: importStartedAt,
    });
  }

  // World + run: continue the existing world for this source if there is one.
  const worldId = `world-${sourceId}`;
  const runId = `run-${sourceId}-${Date.now().toString(36)}`;
  const extractor = new LlmChunkExtractor(request => {
    const provider = new OpenAICompatibleProvider(
      profile,
      new KeychainSecretStore(),
      new FetchHttpTransport(),
      300_000,
    );
    return provider.complete(request);
  });
  await createExtractionRun(
    { sourceStore, runStore, worldStore: runtime.worldStore, sha256Hex: async input => nativeSha256.sha256Hex(input) },
    {
      runId,
      worldId,
      sourceId,
      modelFingerprint: `${profile.endpoint}#${profile.model}`,
      title: manifest.title ?? fileName,
      extractorVersion: extractor.version,
      // Resident mode (1M plan §4): whole-book prefix with per-unit scope
      // instructions when the book fits 85% of the window and the model
      // supports prefix caching; otherwise the planner degrades to the
      // windowed group mode and records why on the run.
      mode: 'resident',
      budget: modelBudgetFromProfile(profile),
    },
  );
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

/** Default import path: build and publish a bounded playable opening only. */
export async function importNovelForOpeningStreaming(
  uri: string,
  fileName: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<ProgressiveOpeningSummary> {
  return await importNovelInternal(uri, fileName, profile, onProgress, 'opening') as ProgressiveOpeningSummary;
}

async function prepareProgressiveOpening(input: {
  sourceId: string;
  sourceManifest: SourceManifest;
  reusedSource: boolean;
  fileName: string;
  profile: ApiProfile;
  onProgress: (progress: WorldBuildProgress) => void;
  totalStartedAt: number;
}): Promise<ProgressiveOpeningSummary> {
  const runtime = await getDatabaseRuntime();
  const sourceStore = new SqliteSourceStore(runtime.db);
  const worldStore = runtime.worldStore;
  const worldId = `world-${input.sourceId}`;
  const createdAt = new Date().toISOString();
  const chapters = await sourceStore.getChapters(input.sourceId);
  const chunks = await sourceStore.getChunks(input.sourceId);
  let world = await worldStore.getWorld(worldId);
  if (!world) {
    world = {
      worldId,
      title: input.sourceManifest.title ?? input.fileName.replace(/\.txt$/i, '') ?? '未命名小说',
      sourceSha256: input.sourceManifest.rawSha256Hex,
      sourceBytes: input.sourceManifest.byteLength,
      normalizeVersion: input.sourceManifest.normalizeVersion,
      chapterSplitVersion: input.sourceManifest.chapterSplitVersion,
      buildStatus: 'extracting',
      createdAt,
      updatedAt: createdAt,
    } satisfies WorldRecord;
    await worldStore.createWorld(world);
  }
  await worldStore.saveImportedSource(worldId, {
    encoding: input.sourceManifest.encoding,
    sourceSha256Hex: input.sourceManifest.rawSha256Hex,
    sourceByteLength: input.sourceManifest.byteLength,
    normalizeVersion: input.sourceManifest.normalizeVersion,
    chapterSplitVersion: input.sourceManifest.chapterSplitVersion,
    splitStrategy: input.sourceManifest.splitStrategy,
    text: '',
    codePointCount: input.sourceManifest.codePointCount,
    chapters,
    chunks,
  }, createdAt);

  // A completed world already has an immutable playable revision; importing
  // the same bytes must not replace it or spend another model request.
  const publishedRevision = await worldStore.getPublishedPackageRevision(worldId);
  if (publishedRevision !== null) {
    await worldStore.setWorldStatus(worldId, 'ready', createdAt);
    return {
      sourceId: input.sourceId,
      worldId,
      packageRevision: publishedRevision,
      byteLength: input.sourceManifest.byteLength,
      codePointCount: input.sourceManifest.codePointCount,
      chapterCount: chapters.length,
      chunkCount: chunks.length,
      reusedSource: input.reusedSource,
      alreadyPlayable: true,
      physicalRequests: 0,
      totalMs: Date.now() - input.totalStartedAt,
      extractionMs: 0,
    };
  }

  const sourceExcerptCodePoints = Math.min(
    input.sourceManifest.codePointCount,
    8_000,
  );
  const sourceExcerpt = await sourceStore.readRange(input.sourceId, 0, sourceExcerptCodePoints);
  let requestBudget: ReturnType<typeof openingSourceBudgetForProfile>;
  try {
    requestBudget = openingSourceBudgetForProfile(input.profile, input.sourceManifest.codePointCount);
  } catch (error) {
    const category = error instanceof OpeningPreparationError ? error.errorCode : 'profile_budget';
    await recordOpeningJob({
      worldStore,
      worldId,
      sourceExcerpt,
      model: input.profile.model,
      status: 'failed',
      requestMetrics: [],
      usage: null,
      errorCode: category,
      resultJson: { schema: OPENING_DOSSIER_VERSION, sourceCodePoints: sourceExcerptCodePoints, physicalRequests: 0 },
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);
    await worldStore.setWorldStatus(worldId, 'failed', new Date().toISOString()).catch(() => undefined);
    if (error instanceof OpeningPreparationError) throw error;
    throw new OpeningPreparationError('profile_budget');
  }
  const sourceEndCodePoint = requestBudget.sourceCodePoints;
  if (sourceEndCodePoint <= 0) throw new Error('小说没有可用于开局的文本。');
  if (!sourceExcerpt.trim()) throw new Error('小说开头没有可用于开局的文本。');
  const localChapters = await worldStore.getChapters(worldId);
  const extractionStartedAt = Date.now();
  const requestMetrics: import('../../src/application/llm/types').LlmPhysicalRequestMetric[] = [];
  let physicalRequests = 0;
  let usage: import('../../src/application/llm/types').LlmUsage | null = null;
  let dossierResult: Awaited<ReturnType<typeof extractOpeningDossier>> | null = null;
  const provider = new OpenAICompatibleProvider(
    input.profile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
    180_000,
    { maxPhysicalRequests: 1 },
  );
  try {
    input.onProgress({
      phase: 'extracting',
      message: `整理开局资料：只向模型提交小说开头 ${sourceEndCodePoint.toLocaleString()} 个码点…`,
    });
    dossierResult = await extractOpeningDossier({
      provider,
      sourceExcerpt,
      maxOutputTokens: requestBudget.maxOutputTokens,
    });
    requestMetrics.push(...dossierResult.requestMetrics);
    physicalRequests = dossierResult.physicalRequests;
    usage = dossierResult.usage;
    const extractionMs = Date.now() - extractionStartedAt;
    input.onProgress({ phase: 'extracting', message: '原文引文校验通过，正在本地编译并校验开局范围包…' });
    const compileStartedAt = Date.now();
    const packageResult = await compileProgressiveOpeningPackage({
      worldStore,
      sha256Hex: async value => nativeSha256.sha256Hex(value),
      worldId,
      sourceSha256: input.sourceManifest.rawSha256Hex,
      sourceExcerpt,
      sourceEndCodePoint,
      chapters: localChapters,
      dossier: dossierResult.dossier,
      requestMetrics,
      usage,
      extractionMs,
      createdAt: new Date().toISOString(),
    });
    const compileAndPublishMs = Date.now() - compileStartedAt;
    await recordOpeningJob({
      worldStore,
      worldId,
      sourceExcerpt,
      model: input.profile.model,
      status: 'done',
      requestMetrics,
      usage,
      resultJson: {
        schema: OPENING_DOSSIER_VERSION,
        packageRevision: packageResult.manifest.revision,
        packageHash: packageResult.manifest.contentHash,
        sourceCodePoints: sourceEndCodePoint,
        physicalRequests,
        repairUsed: dossierResult.repairUsed,
        extractionMs,
        compileAndPublishMs,
        totalMs: Date.now() - input.totalStartedAt,
      },
      createdAt: new Date().toISOString(),
    });
    await worldStore.setWorldStatus(worldId, 'ready', new Date().toISOString());
    input.onProgress({ phase: 'done', message: '开局范围包已发布，可创建角色并开始第一回合。' });
    return {
      sourceId: input.sourceId,
      worldId,
      packageRevision: packageResult.manifest.revision,
      byteLength: input.sourceManifest.byteLength,
      codePointCount: input.sourceManifest.codePointCount,
      chapterCount: chapters.length,
      chunkCount: chunks.length,
      reusedSource: input.reusedSource,
      alreadyPlayable: false,
      physicalRequests,
      totalMs: Date.now() - input.totalStartedAt,
      extractionMs,
    };
  } catch (error) {
    const safeMetrics = requestMetrics.length > 0
      ? requestMetrics
      : error instanceof OpeningPreparationError ? [...error.requestMetrics] : [];
    const category = error instanceof OpeningPreparationError ? error.errorCode : 'preparation_failed';
    await recordOpeningJob({
      worldStore,
      worldId,
      sourceExcerpt,
      model: input.profile.model,
      status: 'failed',
      requestMetrics: safeMetrics,
      usage,
      errorCode: category,
      resultJson: {
        schema: OPENING_DOSSIER_VERSION,
        sourceCodePoints: sourceEndCodePoint,
        physicalRequests: safeMetrics.length,
        elapsedMs: Date.now() - extractionStartedAt,
      },
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);
    await worldStore.setWorldStatus(worldId, 'failed', new Date().toISOString()).catch(() => undefined);
    if (error instanceof OpeningPreparationError) throw error;
    throw new OpeningPreparationError('provider_failure', safeMetrics);
  }
}

async function recordOpeningJob(input: {
  worldStore: import('../../src/infra/sqlite/sqliteWorldStore').SqliteWorldStore;
  worldId: string;
  sourceExcerpt: string;
  model: string;
  status: 'done' | 'failed';
  requestMetrics: readonly import('../../src/application/llm/types').LlmPhysicalRequestMetric[];
  usage: import('../../src/application/llm/types').LlmUsage | null;
  errorCode?: string;
  resultJson: Record<string, unknown>;
  createdAt: string;
}): Promise<void> {
  const contentHash = await nativeSha256.sha256Hex(input.sourceExcerpt);
  const jobId = `job-progressive-opening-${input.worldId}`;
  const existing = await input.worldStore.getJob(input.worldId, jobId);
  const job: WorldJobRecord = {
    worldId: input.worldId,
    jobId,
    kind: 'rule_mapping',
    targetId: 'progressive-opening-dossier',
    status: input.status,
    attempts: (existing?.attempts ?? 0) + input.requestMetrics.length,
    contentHash,
    extractorVersion: OPENING_DOSSIER_VERSION,
    modelFingerprint: input.model,
    usageJson: JSON.stringify({ usage: input.usage, requestMetrics: input.requestMetrics }),
    resultJson: JSON.stringify(input.resultJson),
    error: input.errorCode ?? null,
    createdAt: existing?.createdAt ?? input.createdAt,
    updatedAt: input.createdAt,
  };
  await input.worldStore.upsertJob(job, input.createdAt);
}

/** Adapter from the chunk extractor to the run coordinator's unit contract. */
/** Single-chunk fallback extractor (used when a split reduces to one chunk). */
export function coordinatorExtractor(profile: ApiProfile): UnitExtractor {
  const provider = new OpenAICompatibleProvider(
    profile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
    300_000,
  );
  const inner = new LlmChunkExtractor(request => provider.complete(request));
  return {
    version: inner.version,
    extract: async input => inner.extract({
      chunk: { ...input.chunk, worldId: input.worldId, extractionStatus: 'pending' },
      chunkText: input.chunkText,
      worldId: input.worldId,
    }),
  };
}

/** C3 group extractor over the same provider; output cap comes from the
 *  profile-derived budget (content + reasoning reserve), never a hard 8k. */
export function coordinatorGroupExtractor(profile: ApiProfile): LlmGroupExtractor {
  const provider = new OpenAICompatibleProvider(
    profile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
    300_000,
  );
  const budget = modelBudgetFromProfile(profile);
  return new LlmGroupExtractor(
    request => provider.complete(request),
    budget.maxContentOutputTokens + budget.reasoningReserveTokens,
    budget.reasoningEffort,
  );
}

/**
 * Module-level abort registry: pause asks the in-flight executeRun loop to
 * stop at the next unit boundary (the lease is released and the run persists
 * as paused_user - the DB stays the single source of truth for progress).
 */
const activeRuns = new Map<string, { aborted: boolean }>();

export function pauseRun(runId: string): boolean {
  const signal = activeRuns.get(runId);
  if (!signal) return false;
  signal.aborted = true;
  return true;
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
  const resumable = relatedRuns.find(run => run.status === 'failed_retryable'
    && run.modelFingerprint === modelFingerprint);
  if (resumable) return { runId: resumable.runId, resumed: true };

  const runId = `run-full-${worldId}-${Date.now().toString(36)}`;
  const extractor = coordinatorExtractor(profile);
  await createExtractionRun(
    { sourceStore, runStore, worldStore: runtime.worldStore, sha256Hex: async input => nativeSha256.sha256Hex(input) },
    {
      runId,
      worldId,
      sourceId: source.sourceId,
      modelFingerprint,
      title: world.title,
      extractorVersion: extractor.version,
      mode: 'resident',
      budget: modelBudgetFromProfile(profile),
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
export async function runExtraction(
  runId: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress & { chunksDone?: number; chunksTotal?: number }) => void,
): Promise<{ completed: boolean; unitsDone: number; unitsTotal: number; unitsFailed: number }> {
  const runtime = await getDatabaseRuntime();
  const runStore = new SqliteBuildRunStore(runtime.db);
  const sourceStore = new SqliteSourceStore(runtime.db);
  const run = await runStore.getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}.`);
  onProgress({
    phase: 'extracting',
    chunksDone: run.unitsDone,
    chunksTotal: run.unitsTotal,
    message: `抽取中 ${run.unitsDone}/${run.unitsTotal} 组`,
  });
  const signal = { aborted: false };
  activeRuns.set(runId, signal);
  const runBudget = modelBudgetFromProfile(profile);
  try {
  const result = await executeRun(
    {
      sourceStore,
      runStore,
      worldStore: runtime.worldStore,
      extractor: coordinatorExtractor(profile),
      groupExtractor: coordinatorGroupExtractor(profile),
      sha256Hex: async input => nativeSha256.sha256Hex(input),
      owner: 'ui',
      signal,
      concurrency: profile.concurrency ?? 3,
      tpmTokensPerMinute: profile.tpm,
      budget: runBudget,
      buildRegistry: async ({ segmentBody, worldId, contentHash, modelFingerprint }) => {
        const provider = new OpenAICompatibleProvider(
          profile,
          new KeychainSecretStore(),
          new FetchHttpTransport(),
          300_000,
        );
        const registry = await buildBookRegistry({
          worldStore: runtime.worldStore,
          complete: request => provider.complete(request),
          segmentBody,
          worldId,
          modelFingerprint,
          contentHash,
          createdAt: new Date().toISOString(),
        });
        return registrySummaryFor(registry.entities);
      },
      onUnitDone: info => {
        onProgress({
          phase: 'extracting',
          chunksDone: info.unitsDone,
          chunksTotal: info.unitsTotal,
          message: `抽取中 ${info.unitsDone}/${info.unitsTotal} 组`,
        });
      },
      onFinalize: async ({ run, setPhase }) => {
        const sourceManifest = await sourceStore.getManifest(run.sourceId);
        if (!sourceManifest || sourceManifest.status !== 'active') {
          throw new Error('原文源已不可用，全文映射暂未发布。');
        }
        const [sourceChunks, worldChunks] = await Promise.all([
          sourceStore.getChunks(run.sourceId),
          runtime.worldStore.getChunks(run.worldId),
        ]);
        const worldChunksById = new Map(worldChunks.map(chunk => [chunk.chunkId, chunk]));
        const everyChunkExtracted = sourceChunks.length > 0
          && worldChunks.length === sourceChunks.length
          && sourceChunks.every(chunk => {
            const extracted = worldChunksById.get(chunk.chunkId);
            return extracted?.extractionStatus === 'extracted'
              && extracted.startOffset === chunk.startOffset
              && extracted.endOffset === chunk.endOffset
              && extracted.contentHash === chunk.contentHash;
          });
        if (!everyChunkExtracted) {
          throw new Error('文本块没有连续覆盖全文且全部完成抽取；保留现有开局包，不发布全量精编包。');
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

        const provider = new OpenAICompatibleProvider(
          profile,
          new KeychainSecretStore(),
          new FetchHttpTransport(),
          300_000,
        );
        const world = await runtime.worldStore.getWorld(run.worldId);
        if (!world) throw new Error('世界记录已不可用，全文映射暂未发布。');
        let phaseWrites = Promise.resolve();
        await setPhase('mapping');
        await buildPackageFromCanon({
          worldStore: runtime.worldStore,
          provider: {
            complete: async request => provider.complete({
              ...request,
              role: 'WorldMapper',
              maxOutputTokens: request.maxOutputTokens ?? 6000,
            }),
          },
          sha256Hex: nativeSha256.sha256Hex,
          worldId: run.worldId,
          sourceSha256: world.sourceSha256,
          mappingVersion: `mapper-1#${profile.model}`,
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
            } else if (info.phase === 'published') {
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
  } finally {
    activeRuns.delete(runId);
  }
}
