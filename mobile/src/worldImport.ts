import type { ParsedTxtSource } from '../../src/domain/world/types';

declare const btoa: (data: string) => string;
import { importTxtSource } from '../../src/application/import/txtImport';
import { buildWorldFromTxt } from '../../src/application/world/buildWorld';
import { LlmChunkExtractor } from '../../src/application/world/llmExtractor';
import { SqliteWorldStore } from '../../src/infra/sqlite/sqliteWorldStore';
import { getDatabaseRuntime } from './database';
import { nativeSha256, nativeSha256BytesHex } from './nativeCrypto';
import { mobileTextDecoder } from './textDecode';
import { buildPackageFromCanon } from '../../src/application/worldPackage/buildPackageFromCanon';
import type { ApiProfile } from '../../src/application/llm/types';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';

/**
 * Byte-level hashing (P2 acceptance G06): the true digest hashes the raw file
 * bytes via the native module; the legacy re-encode digest is kept ONLY as a
 * resume key for worlds imported before the fix - it is never written over
 * an existing row.
 */
export interface BytesSha {
  sha256BytesHex(bytes: Uint8Array): Promise<string>;
  sha256Hex(input: string): Promise<string>;
}

function makeBytesSha(fileBase64: string | null): BytesSha {
  return {
    async sha256BytesHex(bytes: Uint8Array): Promise<string> {
      if (fileBase64 !== null) {
        // The bytes came from this exact file: hash the original bytes.
        return nativeSha256BytesHex(fileBase64);
      }
      // Fallback (non-file callers): base64-encode in JS, then hash natively.
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      if (typeof btoa !== 'function') throw new Error('btoa is unavailable on this runtime.');
      return nativeSha256BytesHex(btoa(binary));
    },
    sha256Hex: async input => nativeSha256.sha256Hex(input),
  };
}

/** The pre-G6 digest (byte -> binary string -> UTF-8 re-encode). Resume-only. */
async function legacyReencodeDigest(bytes: Uint8Array): Promise<string> {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return nativeSha256.sha256Hex(binary);
}

export interface ImportPreview {
  parsed: ParsedTxtSource;
  title: string;
}

export async function previewNovel(bytes: Uint8Array, fallbackTitle: string): Promise<ImportPreview> {
  const parsed = await importTxtSource(bytes, makeBytesSha(null), mobileTextDecoder);
  return { parsed, title: fallbackTitle };
}

export interface WorldBuildProgress {
  phase: 'importing' | 'extracting' | 'done' | 'failed';
  chunksDone?: number;
  chunksTotal?: number;
  message?: string;
}

export interface BuiltWorldSummary {
  worldId: string;
  title: string;
  chapterCount: number;
  chunkCount: number;
  entityCount: number;
  factCount: number;
  eventCount: number;
  failedChunks: number;
  rejected: number;
  /** True when an existing world with the same source hash was resumed. */
  resumed: boolean;
  /** Published three-book package revision (0 = not published). */
  packageRevision: number;
  /** Open review issues generated during mapping. */
  reviewIssues: number;
  /** True when publication was skipped: extraction still has failed chunks. */
  needsRetry: boolean;
}

export interface WorldLibraryEntry {
  worldId: string;
  title: string;
  sourceSha256: string;
  legacySourceSha256: string | null;
  buildStatus: string;
  updatedAt: string;
}

/** Bookshelf: every imported novel on this device. */
export async function listWorlds(): Promise<WorldLibraryEntry[]> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const worlds = await worldStore.listWorlds();
  return worlds.map(world => ({
    worldId: world.worldId,
    title: world.title,
    sourceSha256: world.sourceSha256,
    legacySourceSha256: world.legacySourceSha256 ?? null,
    buildStatus: world.buildStatus,
    updatedAt: world.updatedAt,
  }));
}

/**
 * Finds a resume target: the same source file matches by the TRUE byte
 * digest, or - for worlds imported before G06 - by the legacy re-encode
 * digest. Old hashes are matched, never overwritten.
 */
async function findWorldBySourceHash(sourceSha256: string, legacySha256: string): Promise<WorldLibraryEntry | null> {
  const worlds = await listWorlds();
  return worlds.find(world => world.sourceSha256 === sourceSha256 || world.legacySourceSha256 === legacySha256) ?? null;
}

function makeTitleFromText(parsed: ParsedTxtSource, fallback: string): string {
  const firstLine = parsed.text.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine.length >= 2 && firstLine.length <= 30) return firstLine;
  return fallback;
}

export async function buildWorldOnDevice(
  bytes: Uint8Array,
  fallbackTitle: string,
  profile: ApiProfile,
  onProgress: (progress: WorldBuildProgress) => void,
  fileBase64: string | null = null,
): Promise<BuiltWorldSummary> {
  onProgress({ phase: 'importing' });
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const bytesSha = makeBytesSha(fileBase64);
  const parsed = await importTxtSource(bytes, bytesSha, mobileTextDecoder);
  const title = makeTitleFromText(parsed, fallbackTitle);
  const legacySha256 = await legacyReencodeDigest(bytes);

  // Resume: the same source bytes continue the existing world instead of
  // cloning a new one. Successful chunk extractions are reused by content
  // hash, so a killed process or a re-import never re-pays for finished work.
  const existing = await findWorldBySourceHash(parsed.sourceSha256Hex, legacySha256);
  const worldId = existing?.worldId ?? `world-${Date.now().toString(36)}`;
  const resumed = Boolean(existing);

  const provider = new OpenAICompatibleProvider(
    profile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
    120_000,
  );
  const extractor = new LlmChunkExtractor(request => provider.complete(request));

  const result = await buildWorldFromTxt({
    worldId,
    title,
    bytes,
    store: worldStore,
    sha: bytesSha,
    decoder: mobileTextDecoder,
    extractor,
    concurrency: 1,
    modelFingerprint: `${profile.endpoint}#${profile.model}`,
    legacySourceSha256: legacySha256,
  });

  // G04 honesty gate: failed chunks mean the novel is NOT fully extracted -
  // publishing three books now would present partial extraction as complete.
  // Facts/entities stay persisted; re-entering the build resumes the chunks.
  if (result.failedChunks.length > 0) {
    onProgress({
      phase: 'failed',
      message: `抽取仍有 ${result.failedChunks.length} 个失败文本块，未发布三宝书。` +
        '已完成的成果已保存；重新进入构建可从失败块续建。',
    });
    return {
      worldId,
      title,
      chapterCount: result.parsed.chapters.length,
      chunkCount: result.parsed.chunks.length,
      entityCount: result.entityCount,
      factCount: result.factCounts.total ?? result.factCounts.inserted + result.factCounts.duplicate,
      eventCount: result.eventCount,
      failedChunks: result.failedChunks.length,
      rejected: result.rejectedCount,
      resumed,
      packageRevision: 0,
      reviewIssues: 0,
      needsRetry: true,
    };
  }

  // Extraction complete: map canon facts into a world package and publish the
  // three-book revision. Conflicts surface as review issues; a blocking
  // conflict or a mapping failure stops publication with an explicit error.
  onProgress({ phase: 'extracting', message: '事实抽取完成，正在映射三宝书…' });
  const world = await worldStore.getWorld(worldId);
  const pkg = await buildPackageFromCanon({
    worldStore,
    provider: {
      // The mapper always speaks as WorldMapper; adapter aligns the role type.
      complete: async request => provider.complete({ ...request, role: 'WorldMapper', maxOutputTokens: request.maxOutputTokens ?? 6000 }),
    },
    sha256Hex: nativeSha256.sha256Hex,
    worldId,
    sourceSha256: world?.sourceSha256 ?? parsed.sourceSha256Hex,
    mappingVersion: `mapper-1#${profile.model}`,
    createdAt: new Date().toISOString(),
    onProgress: info => onProgress({ phase: 'extracting', message: info.message }),
  });

  onProgress({ phase: 'done' });
  return {
    worldId,
    title,
    chapterCount: result.parsed.chapters.length,
    chunkCount: result.parsed.chunks.length,
    entityCount: result.entityCount,
    factCount: result.factCounts.total ?? result.factCounts.inserted + result.factCounts.duplicate,
    eventCount: result.eventCount,
    failedChunks: result.failedChunks.length,
    rejected: result.rejectedCount,
    resumed,
    packageRevision: pkg.manifest.revision,
    reviewIssues: pkg.reviewIssues,
    needsRetry: false,
  };
}
