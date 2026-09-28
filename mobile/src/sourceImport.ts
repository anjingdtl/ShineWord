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
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import type { ApiProfile } from '../../src/application/llm/types';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';
import { getDatabaseRuntime } from './database';
import { nativeSha256 } from './nativeCrypto';
import { stageUri, stagedTextSource, deleteStaged } from './textSource';
import type { SourceManifest } from '../../src/application/ports/sourceStore';
import { bytesSha } from './worldImport';
import type { WorldBuildProgress } from './worldImport';

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
export async function importNovelStreaming(
  uri: string,
  fileName: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
): Promise<StreamedImportSummary> {
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
      // C3 group mode: consecutive chunks packed into budget-bounded
      // requests with the segment protocol.
      mode: 'group',
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

/** C3 group extractor over the same provider. */
export function coordinatorGroupExtractor(profile: ApiProfile): LlmGroupExtractor {
  const provider = new OpenAICompatibleProvider(
    profile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
    300_000,
  );
  return new LlmGroupExtractor(request => provider.complete(request));
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
  const result = await executeRun(
    {
      sourceStore,
      runStore,
      worldStore: runtime.worldStore,
      extractor: coordinatorExtractor(profile),
      groupExtractor: coordinatorGroupExtractor(profile),
      sha256Hex: async input => nativeSha256.sha256Hex(input),
      owner: 'ui',
      onUnitDone: info => {
        onProgress({
          phase: 'extracting',
          chunksDone: info.unitsDone,
          chunksTotal: info.unitsTotal,
          message: `抽取中 ${info.unitsDone}/${info.unitsTotal} 组`,
        });
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
