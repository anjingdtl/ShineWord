import type { ParsedTxtSource } from '../../src/domain/world/types';
import { importTxtSource } from '../../src/application/import/txtImport';
import { buildWorldFromTxt } from '../../src/application/world/buildWorld';
import { LlmChunkExtractor } from '../../src/application/world/llmExtractor';
import { SqliteWorldStore } from '../../src/infra/sqlite/sqliteWorldStore';
import { getDatabaseRuntime } from './database';
import { nativeSha256 } from './nativeCrypto';
import { mobileTextDecoder } from './textDecode';
import { buildPackageFromCanon } from '../../src/application/worldPackage/buildPackageFromCanon';
import type { ApiProfile } from '../../src/application/llm/types';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';

const bytesSha = {
  async sha256BytesHex(bytes: Uint8Array): Promise<string> {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return nativeSha256.sha256Hex(binary);
  },
  sha256Hex: nativeSha256.sha256Hex,
};

export interface ImportPreview {
  parsed: ParsedTxtSource;
  title: string;
}

export async function previewNovel(bytes: Uint8Array, fallbackTitle: string): Promise<ImportPreview> {
  const parsed = await importTxtSource(bytes, bytesSha, mobileTextDecoder);
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
}

export interface WorldLibraryEntry {
  worldId: string;
  title: string;
  sourceSha256: string;
  buildStatus: string;
  updatedAt: string;
}

/** Bookshelf: every imported novel on this device. */
export async function listWorlds(): Promise<WorldLibraryEntry[]> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  return worldStore.listWorlds();
}

/** Finds an existing world built from the same source bytes (resume target). */
async function findWorldBySourceHash(sourceSha256: string): Promise<WorldLibraryEntry | null> {
  const worlds = await listWorlds();
  return worlds.find(world => world.sourceSha256 === sourceSha256) ?? null;
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
): Promise<BuiltWorldSummary> {
  onProgress({ phase: 'importing' });
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const preview = await previewNovel(bytes, fallbackTitle);
  const title = makeTitleFromText(preview.parsed, fallbackTitle);

  // Resume: the same source bytes continue the existing world instead of
  // cloning a new one. Successful chunk extractions are reused by content
  // hash, so a killed process or a re-import never re-pays for finished work.
  const existing = await findWorldBySourceHash(preview.parsed.sourceSha256Hex);
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
  });

  // Phase 2: after extraction, map canon facts into a world package and
  // publish the three-book revision (P2-4). Conflicts surface as review
  // issues; a blocking conflict stops publication with an explicit error.
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
    sourceSha256: world?.sourceSha256 ?? preview.parsed.sourceSha256Hex,
    mappingVersion: `mapper-1#${profile.model}`,
    createdAt: new Date().toISOString(),
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
  };
}
