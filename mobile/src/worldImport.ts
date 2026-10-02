import type { ParsedTxtSource } from '../../src/domain/world/types';
import type { WorldRecord } from '../../src/application/ports/worldStore';
import type { WorldPreparationStatus } from '../../src/application/worldPackage/preparationStatus';

import { importTxtSource } from '../../src/application/import/txtImport';
import { makeBase64NativeByteSha } from '../../src/application/import/byteShaAdapter';
import { buildWorldFromTxt } from '../../src/application/world/buildWorld';
import { LlmChunkExtractor } from '../../src/application/world/llmExtractor';
import { SqliteWorldStore } from '../../src/infra/sqlite/sqliteWorldStore';
import { getDatabaseRuntime } from './database';
import { nativeSha256, nativeSha256BytesHex, nativeSha256BytesBatchHex } from './nativeCrypto';
import { mobileTextDecoder } from './textDecode';
import { buildPackageFromCanon } from '../../src/application/worldPackage/buildPackageFromCanon';
import type { ApiProfile } from '../../src/application/llm/types';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { KeychainSecretStore } from './secureKeyStore';
import { FetchHttpTransport } from './fetchTransport';
import { loadBranchDeltaEntries } from '../../src/application/worldPackage/contentManifest';
import { entriesVisibleAtAnchor } from '../../src/application/campaign/recruitment';
import { isFactVisibleAtAnchor } from '../../src/application/world/opening';
import { summarizeWorldPreparation } from '../../src/application/worldPackage/preparationStatus';
import { buildWholeSourceRanges } from '../../src/application/worldPackage/sourceScope';
import { CodePointOffsetIndex } from '../../src/domain/world/textOffsets';
import { SqliteSourceStore } from '../../src/infra/sqlite/sqliteSourceStore';
import { modelBudgetFromProfile } from '../../src/application/worldBuild/profileModelBudget';
import { freezeRunConfig, providerProfileFromFrozen } from '../../src/application/worldBuild/runConfig';
import { governWorldBuildRequest } from '../../src/application/worldBuild/llmRequest';
import { LedgeredProvider } from '../../src/application/llm/requestLedger';
import { RateScheduledProvider } from '../../src/application/llm/scheduledProvider';
import { llmModelProfileFingerprint } from '../../src/application/llm/profileFingerprint';
import { schedulerForProfile } from './llmScheduler';
import { hasPlayableOpening } from '../../src/application/worldPackage/openingRecovery';

/**
 * The import pipeline's byte-hash provider (closeout C1). Every call hashes
 * EXACTLY the bytes passed in: the whole-file digest once per parse, and each
 * chapter/chunk digest over its own text. The pre-C1 adapter ignored the
 * argument whenever a whole-file base64 was supplied, which made every
 * chapter/chunk digest equal the raw file digest — resume then "reused" one
 * extraction for every chunk and silently skipped the rest of the novel.
 */
export const bytesSha = makeBase64NativeByteSha({
  sha256BytesHexFromBase64: nativeSha256BytesHex,
  sha256BytesBatchHexFromBase64: nativeSha256BytesBatchHex,
  sha256Hex: async input => nativeSha256.sha256Hex(input),
});

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
  /** Latest published three-book revision; 0 = nothing published yet. */
  packageRevision: number;
  openingReady?: boolean;
  /** Review issues the mapping pass left open (real count, may be 0). */
  openReviewIssues: number;
}

/** Bookshelf: every imported novel on this device. */
export async function listWorlds(): Promise<WorldLibraryEntry[]> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const worlds = await worldStore.listWorlds();
  const entries: WorldLibraryEntry[] = [];
  for (const world of worlds) {
    entries.push(await toLibraryEntry(worldStore, world));
  }
  return entries;
}

/** One world row with the same read-only enrichment as the library list. */
export async function getWorldEntry(worldId: string): Promise<WorldLibraryEntry | null> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const world = await worldStore.getWorld(worldId);
  if (!world) return null;
  return toLibraryEntry(worldStore, world);
}

export type WorldPreparationView = WorldPreparationStatus & {
  sourceAvailable: boolean;
  latestPackageRevision: number | null;
  latestFullSourceComplete: boolean;
};

/** Read-only preparation summary for the exact package locked by a campaign. */
export async function getWorldPreparationStatus(
  input: {
    worldId: string;
    packageRevision?: number | null;
    campaignId?: string;
    branchId?: string;
  },
): Promise<WorldPreparationView | null> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const world = await worldStore.getWorld(input.worldId);
  if (!world) return null;
  let revision = input.packageRevision ?? await worldStore.getPublishedPackageRevision(input.worldId);
  let anchorWorldTimeOrder: number | undefined;
  let discoveredIds = new Set<string>();
  if (input.branchId) {
    const binding = await runtime.db.queryOne<{
      campaign_id: string;
      world_id: string;
      package_revision: number;
      anchor_json: string;
    }>(
      `SELECT c.campaign_id, c.world_id, c.package_revision, c.anchor_json FROM branches b
         JOIN campaigns c ON c.campaign_id = b.campaign_id WHERE b.branch_id = ?`, [input.branchId],
    );
    if (!binding || binding.world_id !== input.worldId
      || (input.campaignId && binding.campaign_id !== input.campaignId)) {
      throw new Error('战役分支与当前世界不匹配。');
    }
    revision = Number(binding.package_revision);
    if (input.packageRevision != null && input.packageRevision !== revision) {
      throw new Error('战役锁定的世界包版本与资料页不匹配。');
    }
    try {
      const anchor = JSON.parse(binding.anchor_json) as { worldTimeOrder?: number };
      if (Number.isFinite(anchor.worldTimeOrder)) anchorWorldTimeOrder = anchor.worldTimeOrder;
    } catch {
      throw new Error('战役时间锚点无法读取，资料准备状态暂不可用。');
    }
    const branchState = await runtime.turns.getState(input.branchId);
    discoveredIds = new Set((branchState?.discoveries ?? []).map(discovery => discovery.entryId));
  }
  if (revision === null || revision === undefined) return null;
  const pkg = await worldStore.getWorldPackage(input.worldId, revision);
  if (!pkg || pkg.manifest.status !== 'published') return null;
  let entries = [...pkg.entries];
  let sections = [...pkg.sections];
  if (input.branchId) {
    const state = await runtime.turns.getState(input.branchId);
    const manifest = state?.contentManifest;
    if (state && manifest) {
      const deltas = await loadBranchDeltaEntries({
        manifest,
        worldId: input.worldId,
        branchId: input.branchId,
        stateVersion: state.stateVersion,
        baseRevision: revision,
        baseContentHash: pkg.manifest.contentHash,
        getDelta: deltaId => worldStore.getProgressiveDeltaPackage(deltaId),
        sha256Hex: nativeSha256.sha256Hex,
      });
      entries.push(...deltas.flatMap(delta => delta.entries));
      for (const delta of deltas) {
        for (const section of delta.sections) {
          const current = sections.find(item => item.book === section.book && item.sectionKey === section.sectionKey);
          if (!current) sections.push({ ...section, entryIds: [...section.entryIds] });
          else current.entryIds = [...current.entryIds, ...section.entryIds];
        }
      }
    }
  }
  const [facts, chunks] = await Promise.all([
    worldStore.listFacts(input.worldId),
    worldStore.getChunks(input.worldId),
  ]);
  const playerVisibleFacts = facts.filter(fact => (fact.status === 'explicit' || fact.status === 'inference')
    && (anchorWorldTimeOrder === undefined
      ? fact.validFrom === null && fact.validTo === null && fact.revealAt === null
      : isFactVisibleAtAnchor(fact, anchorWorldTimeOrder)));
  const visibleEntries = entriesVisibleAtAnchor(entries, playerVisibleFacts, anchorWorldTimeOrder)
    .filter(entry => entry.visibility !== 'gm'
      && (entry.visibility !== 'discoverable' || discoveredIds.has(entry.entryId)));
  const visibleIds = new Set(visibleEntries.map(entry => entry.entryId));
  const visibleSections = sections.map(section => ({
    ...section,
    entryIds: section.entryIds.filter(id => visibleIds.has(id)),
  }));
  const source = await new SqliteSourceStore(runtime.db).findActiveByRawHash(world.sourceSha256);
  const latestRevision = await worldStore.getPublishedPackageRevision(input.worldId);
  const latestPackage = latestRevision === null
    ? null
    : await worldStore.getWorldPackage(input.worldId, latestRevision);
  const latestFullSourceComplete = Boolean(source && latestPackage && summarizeWorldPreparation({
    manifest: latestPackage.manifest,
    entries: latestPackage.entries,
    sections: latestPackage.sections,
    facts,
    chunks,
    sourceCodePointCount: source.codePointCount,
  }).fullSourceComplete);
  return {
    ...summarizeWorldPreparation({
      manifest: pkg.manifest,
      entries: visibleEntries,
      sections: visibleSections,
      facts: playerVisibleFacts,
      chunks,
      ...(source ? { sourceCodePointCount: source.codePointCount } : {}),
    }),
    sourceAvailable: Boolean(source),
    latestPackageRevision: latestRevision,
    latestFullSourceComplete,
  };
}

async function toLibraryEntry(
  worldStore: SqliteWorldStore,
  world: WorldRecord,
): Promise<WorldLibraryEntry> {
  // Read-only enrichment for the library card and the world overview: which
  // revision is published, and how many review issues are still open. Both
  // queries already exist on the world store; nothing is written here.
  const packages = await worldStore.listWorldPackages(world.worldId);
  const published = packages.filter(item => item.status === 'published');
  const packageRevision = published.reduce((max, item) => Math.max(max, item.revision), 0);
  let openingReady = packageRevision > 0 && await hasPlayableOpening(worldStore, world.worldId, packageRevision);
  const runtime = await getDatabaseRuntime();
  if (runtime.segmentPlans && await runtime.segmentPlans.getPlan(world.worldId)) openingReady = openingReady && (await runtime.segmentArtifacts.listArtifacts(world.worldId)).some(a => a.basePackage.revision === packageRevision);
  const issues = await worldStore.listReviewIssues(world.worldId, 'open');
  return {
    worldId: world.worldId,
    title: world.title,
    sourceSha256: world.sourceSha256,
    legacySourceSha256: world.legacySourceSha256 ?? null,
    buildStatus: world.buildStatus,
    updatedAt: world.updatedAt,
    packageRevision,
    openingReady,
    openReviewIssues: issues.length,
  };
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
): Promise<BuiltWorldSummary> {
  onProgress({ phase: 'importing' });
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const parsed = await importTxtSource(bytes, bytesSha, mobileTextDecoder);
  const title = makeTitleFromText(parsed, fallbackTitle);
  const legacySha256 = await legacyReencodeDigest(bytes);

  // Resume: the same source bytes continue the existing world instead of
  // cloning a new one. Successful chunk extractions are reused by content
  // hash, so a killed process or a re-import never re-pays for finished work.
  const existing = await findWorldBySourceHash(parsed.sourceSha256Hex, legacySha256);
  const worldId = existing?.worldId ?? `world-${Date.now().toString(36)}`;
  const resumed = Boolean(existing);

  const budget = modelBudgetFromProfile(profile);
  const frozen = freezeRunConfig(profile, budget);
  const frozenProfile = providerProfileFromFrozen(frozen);
  const runId = `legacy-import:${worldId}`;
  const modelProfileFingerprint = llmModelProfileFingerprint(frozenProfile);
  const governance = {
    profile: frozenProfile,
    runId,
    worldId,
    modelProfileFingerprint,
    frozenReserveTokensByRequestKind: frozen.reasoningReservePolicy.reserves,
  };
  const scheduler = schedulerForProfile(frozenProfile);
  const provider = new RateScheduledProvider(new LedgeredProvider(new OpenAICompatibleProvider(
    frozenProfile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
    300_000,
  ), runtime.llmLedger, { modelProfileFingerprint }), scheduler);
  const extractor = new LlmChunkExtractor(
    request => provider.complete(request), budget.maxContentOutputTokens, governance,
  );

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
  const sourceIndex = new CodePointOffsetIndex(result.parsed.text);
  const sourceRanges = await buildWholeSourceRanges({
    chunks: result.parsed.chunks,
    sourceCodePointCount: result.parsed.codePointCount,
    readRange: (start, end) => sourceIndex.slice(start, end),
    sha256Hex: nativeSha256.sha256Hex,
  });
  const pkg = await buildPackageFromCanon({
    requirePlayableOpening: true,
    worldStore,
    provider: {
      // The mapper always speaks as WorldMapper; adapter aligns the role type.
      complete: async request => provider.complete(governWorldBuildRequest({
        request: {
          role: 'WorldMapper', system: request.system, user: request.user,
          maxOutputTokens: request.maxOutputTokens ?? 6_000, jsonMode: true,
        },
        requestKind: 'world_mapping',
        logicalRequestId: request.logicalRequestId ?? `world-mapping:${runId}:${worldId}`,
        reserveMultiplier: request.reserveMultiplier,
        governance,
      })),
    },
    sha256Hex: nativeSha256.sha256Hex,
    worldId,
    runId,
    sourceSha256: world?.sourceSha256 ?? parsed.sourceSha256Hex,
    mappingVersion: `mapper-1#${profile.model}#${frozen.reasoningTier}`,
    createdAt: new Date().toISOString(),
    sourceRanges,
    sourceCodePointCount: result.parsed.codePointCount,
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
