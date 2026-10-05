import type { WorldRuleConfiguration } from '../../src/domain/rules/worldRuleConfiguration';
import { RejectionSamplingRandomSource } from '../../src/domain/rules/random';
// Static imports: runtime module groups must ship in the initial bundle, not
// lazy-fetch at play time (lazy group requests can fail on device networks).
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { RateScheduledProvider } from '../../src/application/llm/scheduledProvider';
import { llmModelProfileFingerprint } from '../../src/application/llm/profileFingerprint';
import type { ApiProfile, LlmProvider } from '../../src/application/llm/types';
import type { TurnGuidanceV1 } from '../../src/application/guidance/types';
import { schedulerForProfile, setSchedulerActivity } from './llmScheduler';
import { CampaignSession, projectPlayerEntriesAtAnchor, type PlayTurnResult } from '../../src/application/campaign/session';
import type { ActorCard } from '../../src/domain/characters/card';
import type { ItemSourceSnapshotEntry, PartySnapshotEntry } from '../../src/domain/state/types';
import type { BookName, BookSection, BranchContentManifest, ContentEntry, WorldPackageManifest } from '../../src/domain/content/types';
import { createBaseContentManifest, loadBranchDeltaEntries } from '../../src/application/worldPackage/contentManifest';
import { FetchHttpTransport } from './fetchTransport';
import { getDatabaseRuntime } from './database';
import { createNativeRandomBytes, nativeSha256 } from './nativeCrypto';
import { KeychainSecretStore } from './secureKeyStore';
import { publishUserRequestedSourceLookupDelta } from '../../src/application/worldPackage/progressiveDelta';
import { SqliteInteractionOperationJournal } from '../../src/application/campaign/interactionOrchestrator';
import type { StoryEntry } from '../../src/application/campaign/storyEntry';
import * as playRecovery from '../../src/application/campaign/playRecovery';

export type { PlayRecovery } from '../../src/application/campaign/playRecovery';
export async function loadPlayRecovery(campaignId: string, branchId: string) {
  return playRecovery.loadPlayRecovery((await getDatabaseRuntime()).db, campaignId, branchId);
}
export async function savePlayIntentDraft(campaignId: string, branchId: string, intent: string) {
  return playRecovery.savePlayIntentDraft((await getDatabaseRuntime()).db, campaignId, branchId, intent);
}
export async function clearPlayIntentDraft(branchId: string, version: number) {
  return playRecovery.clearPlayIntentDraft((await getDatabaseRuntime()).db, branchId, version);
}
export async function acknowledgePlayReplay(campaignId: string, branchId: string, version: number, ids: string[]) {
  return playRecovery.acknowledgePlayReplay((await getDatabaseRuntime()).llmLedger, campaignId, branchId, version, ids);
}
export async function acknowledgeMemoryReplay(campaignId: string, branchId: string, attemptIds: readonly string[]) {
  return (await getDatabaseRuntime()).llmLedger.acknowledgeMemoryReplay({ campaignId, branchId, attemptIds });
}

export type { PlayTurnResult };

export interface CampaignListItem {
  campaignId: string;
  title: string;
  worldId: string;
  status: string;
  createdAt: string;
  /** Playable branch within the campaign (rewind creates siblings). */
  branchId?: string;
}

/**
 * Phase 2 session runtime: every entry point carries an explicit campaign /
 * branch identity. The fixed `demo-main` path is gone - world context comes
 * from the locked world package and roll specs come from the character cards.
 */
export async function createSession(
  profile: ApiProfile,
  provider: LlmProvider,
): Promise<CampaignSession> {
  const runtime = await getDatabaseRuntime();
  return new CampaignSession(
    {
      db: runtime.db,
      turns: runtime.turns,
      game: runtime.game,
      worldStore: runtime.worldStore,
      narratives: runtime.narratives,
      progressiveTurnContext: runtime.progressiveTurnContext,
      sourceStore: runtime.sourceStore,
      projectStyle: runtime.projectStyle,
      segmentContent: runtime.segmentPublication,
      onForegroundActivity: playing => setSchedulerActivity({ playing }),
      llmLedger: runtime.llmLedger,
      storyMemory: { store: runtime.storyMemory },
      episodic: { store: runtime.episodic },
      guidance: runtime.guidance,
      hashProvider: nativeSha256,
      random: new RejectionSamplingRandomSource(createNativeRandomBytes()),
    },
    provider,
    profile,
  );
}

export async function getInteractionOperationJournal(): Promise<SqliteInteractionOperationJournal> {
  const runtime = await getDatabaseRuntime();
  return new SqliteInteractionOperationJournal(runtime.db);
}

export async function buildProvider(profile: ApiProfile): Promise<LlmProvider> {
  // Rate governance (2026-10-01): game turns ride the same per-endpoint
  // scheduler as world build, so 429 penalties learned during a build keep
  // pacing the play loop and vice versa.
  const runtime = await getDatabaseRuntime();
  return new RateScheduledProvider(
    new OpenAICompatibleProvider(profile, new KeychainSecretStore(), new FetchHttpTransport(), 300_000),
    schedulerForProfile(profile),
  ).withLedger(runtime.llmLedger, { modelProfileFingerprint: llmModelProfileFingerprint(profile) });
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const session = await createSessionNoop();
  return session.listCampaigns();
}

/** Read-only stub profile: list/read paths never call the provider. */
function stubProfile(): ApiProfile {
  return {
    id: 'local',
    name: 'local',
    endpoint: 'https://unused.invalid',
    model: 'none',
    keyRef: 'none',
    capabilities: {
      supportsJson: true,
      supportsStreaming: false,
      reportsUsage: false,
      contextWindow: 0,
      maxOutputTokens: 0,
    },
  };
}

async function createSessionNoop(): Promise<CampaignSession> {
  return createSession(stubProfile(), await buildProvider(stubProfile()));
}

/**
 * Read-only session for list screens and projections (P4.1). Never calls the
 * LLM: the stub profile is unreachable by design, so any accidental write or
 * provider use would fail loudly instead of spending the user's quota.
 */
export async function createReadOnlySession(): Promise<CampaignSession> {
  return createSessionNoop();
}

export interface CampaignPlayState {
  campaignId: string;
  branchId: string;
  title: string;
  worldId: string;
  goal: string;
  stateVersion: number;
  anchorWorldTimeOrder: number | null;
  locationId: string;
  clockMinutes: number;
  playerCard: ActorCard | null;
  playerResources: Record<string, number>;
  playerLifeStatus: string;
  playerConditions: string[];
  partyStatuses: Record<string, { lifeStatus: string; conditions: string[] }>;
  cards: ActorCard[];
  party: PartySnapshotEntry[];
  items: Array<{ itemId: string; ownerActorId: string; source: ItemSourceSnapshotEntry | null }>;
  packageRevision: number;
  playerActorId: string | null;
  discoveredEntryIds: string[];
}

export async function getCampaignState(
  campaignId: string,
  branchId: string,
): Promise<CampaignPlayState> {
  const session = await createSessionNoop();
  const summary = await session.getSummary(campaignId, branchId);
  const playerCard = summary.cards.find(card => card.controller === 'player') ?? null;
  const playerGroupId = summary.state.party?.find(member => member.role === 'protagonist')?.groupId ?? 'main';
  const visiblePartyIds = new Set((summary.state.party ?? [])
    .filter(member => (member.groupId ?? 'main') === playerGroupId).map(member => member.actorId));
  return {
    campaignId: summary.campaignId,
    branchId: summary.branchId,
    title: summary.title,
    worldId: summary.worldId,
    packageRevision: summary.packageRevision,
    goal: summary.goal,
    stateVersion: summary.state.stateVersion,
    anchorWorldTimeOrder: summary.anchorWorldTimeOrder,
    locationId: playerCard ? summary.state.actors[playerCard.actorId]?.locationId ?? 'unknown' : 'unknown',
    clockMinutes: summary.state.clockMinutes,
    playerCard,
    playerResources: playerCard
      ? summary.state.actors[playerCard.actorId]?.resources ?? {}
      : {},
    playerLifeStatus: playerCard ? summary.state.actors[playerCard.actorId]?.lifeStatus ?? 'active' : 'active',
    playerConditions: playerCard ? [...(summary.state.actors[playerCard.actorId]?.conditions ?? [])] : [],
    partyStatuses: Object.fromEntries([...visiblePartyIds].flatMap(actorId => {
      const actor = summary.state.actors[actorId];
      return actor ? [[actorId, { lifeStatus: actor.lifeStatus ?? 'active', conditions: [...actor.conditions] }]] : [];
    })),
    cards: summary.cards,
    party: summary.state.party ?? [],
    items: Object.entries(summary.state.itemOwners)
      .filter(([, ownerActorId]) => visiblePartyIds.has(ownerActorId))
      .map(([itemId, ownerActorId]) => ({ itemId, ownerActorId, source: summary.state.itemSources?.[itemId] ?? null })),
    playerActorId: playerCard?.actorId ?? null,
    discoveredEntryIds: summary.state.discoveries
      ?.filter(discovery => discovery.actorId === playerCard?.actorId)
      .map(discovery => discovery.entryId) ?? [],
  };
}

/** Structured roll of one committed turn (plan §18.2) — never a formatted string. */
export interface TurnRollView {
  diceCount: number;
  dieSides: number;
  rolls: number[];
  highest: number;
  difficulty: number;
  margin: number;
  grade: string;
}

export interface TurnView extends Omit<StoryEntry, 'grade'> {
  grade: string;
  /** Branch state version this turn committed as. */
  stateVersion: number;
  resumed: boolean;
  /** Absent for turns that needed no roll (deterministic auto-success). */
  roll?: TurnRollView;
  /** P7 guidance for the decision point this turn created (read-only view). */
  guidance?: TurnGuidanceV1;
}

/** Latest committed guidance at or before a state version (P7 UI refresh). */
export async function getGuidanceAtVersion(branchId: string, stateVersion: number): Promise<TurnGuidanceV1 | null> {
  const runtime = await getDatabaseRuntime();
  try {
    return await runtime.guidance.latestForVersion(branchId, stateVersion);
  } catch {
    return null;
  }
}

export async function subscribeGuidanceUpdates(listener: (branchId: string) => void): Promise<() => void> {
  const runtime = await getDatabaseRuntime();
  return runtime.guidance.subscribe(listener);
}

export async function loadHistory(branchId: string): Promise<TurnView[]> {
  const runtime = await getDatabaseRuntime();
  const rows = await runtime.turns.listStoryEntries(branchId);
  // P7: attach committed guidance per decision point (source turn keyed).
  const guidanceByTurn = new Map<string, TurnGuidanceV1>();
  try {
    for (const guidance of await runtime.guidance.listAll(branchId)) {
      guidanceByTurn.set(guidance.decisionPoint.sourceTurnId, guidance);
    }
  } catch {
    // Guidance is derived; a read failure degrades to unadorned history.
  }
  return rows.map(row => {
    const guidance = guidanceByTurn.get(row.turnId);
    return {
      turnId: row.turnId,
      text: row.text,
      grade: row.grade,
      mechanicalOnly: row.mechanicalOnly,
      ...(row.choice ? { choice: row.choice } : {}),
      ...(row.result ? { result: row.result } : {}),
      ...(row.resultDetails ? { resultDetails: row.resultDetails } : {}),
      stateVersion: row.stateVersion,
      resumed: false,
      ...(guidance ? { guidance } : {}),
      ...(row.rollRecord
        ? {
            roll: {
              diceCount: row.rollRecord.diceCount,
              dieSides: row.rollRecord.dieSides,
              rolls: [...row.rollRecord.rolls],
              highest: row.rollRecord.highest,
              difficulty: row.rollRecord.difficulty,
              margin: row.rollRecord.margin,
              grade: row.rollRecord.grade,
            },
          }
        : {}),
    };
  });
}

export { saveApiProfile } from './profileStore';

// ---------------------------------------------------------------------------
// Save export / import (P2-5) and the review queue (G05).
// ---------------------------------------------------------------------------

import {
  exportSave,
  restoreSave,
  validateSaveJson,
  SAVE_SCHEMA_VERSION,
  type SaveFile,
} from '../../src/application/export/saveFile';
import { SqliteWorldStore } from '../../src/infra/sqlite/sqliteWorldStore';
import type { EncounterView } from '../../src/application/campaign/encounterService';
import { validatePackage } from '../../src/application/worldPackage/validate';
import { publishWorldPackage } from '../../src/application/worldPackage/publish';
import { encodeWorldPackageArchive, importPortableWorldPackage, importProgressiveBranchContentArchive } from '../../src/application/export/worldPackageArchive';
import { exportPortableCanon } from '../../src/application/export/portableCanon';
import { ensureBaseBranchContentManifest } from '../../src/application/worldPackage/branchContentStore';

export { SAVE_SCHEMA_VERSION };
export type { SaveFile, EncounterView };

export async function exportCampaignSave(
  campaignId: string,
  branchId: string,
): Promise<{ save: SaveFile; json: string }> {
  const runtime = await getDatabaseRuntime();
  const result = await exportSave({
    projectStyleArchive: runtime.projectStyle,
    db: runtime.db,
    sha256Hex: nativeSha256.sha256Hex,
    campaignId,
    branchId,
    createdAt: new Date().toISOString(),
  });
  return { save: result.save, json: result.json };
}

export async function importCampaignSave(json: string): Promise<{ campaignId: string; branchId: string }> {
  const runtime = await getDatabaseRuntime();
  const validation = await validateSaveJson(json, nativeSha256.sha256Hex);
  if (!validation.ok) {
    throw new Error(`存档校验失败：${validation.errors.join('；')}`);
  }
  const save = JSON.parse(json) as SaveFile;
  const campaignId = `camp-${Date.now().toString(36)}`;
  const branchId = `${campaignId}-main`;
  await restoreSave({
    projectStyleArchive: runtime.projectStyle,
    db: runtime.db,
    save,
    sha256Hex: nativeSha256.sha256Hex,
    newCampaignId: campaignId,
    newBranchId: branchId,
    createdAt: new Date().toISOString(),
  });
  return { campaignId, branchId };
}

export interface CanonConflictView {
  factId: string;
  subjectName: string;
  predicate: string;
  value: Record<string, unknown>;
  quotes: string[];
  existing: Array<{ value: Record<string, unknown>; quotes: string[] }>;
}

export interface ReviewIssueView {
  issueId: string;
  kind: string;
  severity: string;
  status: string;
  detailJson: string;
  conflicts?: CanonConflictView[];
}

export async function listReviewIssues(worldId: string): Promise<ReviewIssueView[]> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const issues = await worldStore.listReviewIssues(worldId, 'open');
  const [facts, entities] = issues.some(issue => issue.kind === 'canon_conflict')
    ? await Promise.all([worldStore.listFacts(worldId), worldStore.listEntities(worldId)])
    : [[], []];
  return issues.map(issue => ({
    issueId: issue.issueId,
    kind: issue.kind,
    severity: issue.severity,
    status: issue.status,
    detailJson: issue.detailJson,
    ...(issue.kind === 'canon_conflict' ? { conflicts: facts.filter(fact => fact.status === 'conflict').map(fact => ({
      factId: fact.factId,
      subjectName: entities.find(entity => entity.entityId === fact.subjectEntityId)?.name ?? '原著人物',
      predicate: fact.predicate,
      value: fact.value,
      quotes: fact.sources.map(source => source.quote),
      existing: facts.filter(other => other.subjectEntityId === fact.subjectEntityId
        && other.predicate === fact.predicate && other.status === 'explicit')
        .map(other => ({ value: other.value, quotes: other.sources.map(source => source.quote) })),
    })) } : {}),
  }));
}

export async function resolveReviewIssue(worldId: string, issueId: string, resolution: 'resolved' | 'waived', remember = true): Promise<void> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  await worldStore.resolveReviewIssue(worldId, issueId, resolution, remember);
}

export async function resolveCanonFactConflict(
  worldId: string, factId: string, resolution: 'complementary' | 'unverified',
): Promise<void> {
  const runtime = await getDatabaseRuntime();
  await runtime.worldStore.resolveCanonFactConflict(worldId, factId, resolution);
}

export async function loadWorldPackageDraft(worldId: string): Promise<{
  baseRevision: number;
  draftJson: string;
  updatedAt: string;
} | null> {
  const runtime = await getDatabaseRuntime();
  return new SqliteWorldStore(runtime.db).getWorldPackageDraft(worldId);
}

export async function saveWorldPackageDraft(input: {
  worldId: string;
  baseRevision: number;
  entries: ContentEntry[];
  sections: BookSection[];
  ruleConfiguration?: WorldRuleConfiguration;
}): Promise<void> {
  const runtime = await getDatabaseRuntime();
  await new SqliteWorldStore(runtime.db).saveWorldPackageDraft({
    ...input,
    draftJson: JSON.stringify({ entries: input.entries, sections: input.sections, ruleConfiguration: input.ruleConfiguration }),
    updatedAt: new Date().toISOString(),
  });
}

export function validateWorldPackageDraft(input: {
  worldId: string;
  revision: number;
  entries: ContentEntry[];
  sections: BookSection[];
}): ReturnType<typeof validatePackage> {
  return validatePackage({ worldId: input.worldId, revision: input.revision }, input.entries, input.sections);
}

export async function publishWorldPackageDraft(input: {
  worldId: string;
  baseRevision: number;
  entries: ContentEntry[];
  sections: BookSection[];
  ruleConfiguration?: WorldRuleConfiguration;
}): Promise<{ manifest: WorldPackageManifest; warnings: string[] }> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const world = await worldStore.getWorld(input.worldId);
  if (!world) throw new Error(`Unknown world: ${input.worldId}.`);
  const currentRevision = await worldStore.getPublishedPackageRevision(input.worldId);
  if (currentRevision !== input.baseRevision) throw new Error('Published world revision changed while this draft was open; reload before publishing.');
  const base = await worldStore.getWorldPackage(input.worldId, input.baseRevision);
  if (!base) throw new Error(`Base package r${input.baseRevision} is missing.`);
  const result = await publishWorldPackage({
    worldStore,
    sha256Hex: nativeSha256.sha256Hex,
    worldId: input.worldId,
    sourceSha256: world.sourceSha256,
    mappingVersion: base.manifest.mappingVersion,
    entries: input.entries,
    sections: input.sections,
    buildScope: base.manifest.buildScope,
    ruleConfiguration: input.ruleConfiguration,
    createdAt: new Date().toISOString(),
  });
  await worldStore.clearWorldPackageDraft(input.worldId, input.baseRevision);
  return { manifest: result.manifest, warnings: result.report.warnings };
}

export async function exportPortableWorldPackage(worldId: string): Promise<{
  bytes: Uint8Array;
  title: string;
  revision: number;
}> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const world = await worldStore.getWorld(worldId);
  if (!world) throw new Error(`Unknown world: ${worldId}.`);
  const revision = await worldStore.getPublishedPackageRevision(worldId);
  if (revision === null) throw new Error('This world has no published package to export.');
  const pkg = await worldStore.getWorldPackage(worldId, revision);
  if (!pkg) throw new Error(`Published package r${revision} is missing.`);
  const canon = await exportPortableCanon(worldStore, pkg.manifest, pkg.entries, nativeSha256.sha256Hex);
  const bytes = await encodeWorldPackageArchive({ title: world.title, ...pkg, canon, segmentArtifacts: await runtime.segmentArtifacts.listArtifacts(worldId), projectStyle: (await runtime.projectStyle.exportProjectStyle(worldId)) ?? undefined }, nativeSha256.sha256Hex);
  return { bytes, title: world.title, revision };
}

export async function importPortableWorldPackageFile(archive: Uint8Array): Promise<{
  worldId: string;
  title: string;
  revision: number;
}> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const timestamp = Date.now().toString(36);
  let suffix = 0;
  let worldId = `world-import-${timestamp}`;
  while (await worldStore.getWorld(worldId)) worldId = `world-import-${timestamp}-${++suffix}`;
  const imported = await importPortableWorldPackage({
    projectStyleArchive: runtime.projectStyle,
    worldStore,
    sha256Hex: nativeSha256.sha256Hex,
    archive,
    newWorldId: worldId,
    createdAt: new Date().toISOString(),
  });
  return { worldId: imported.worldId, title: imported.title, revision: imported.revision };
}

export interface WorldBookProjection {
  entries: ContentEntry[];
  sections: BookSection[];
  stateVersion: number | null;
  contentVersion: number;
  deltaCount: number;
  anchorWorldTimeOrder: number | null;
}

export interface ProgressiveBookLookupResult {
  status: 'found' | 'not_found' | 'review_required';
  entryIds: string[];
  count: number;
  message: string;
}

/** Explicit, local-only full-source lookup. Results return IDs/count only so
 * the UI cannot reveal a passage until the player confirms it as known. */
export async function lookupProgressiveBookSource(input: {
  worldId: string;
  campaignId: string;
  branchId: string;
  book: BookName;
  query: string;
  signal?: AbortSignal;
}): Promise<ProgressiveBookLookupResult> {
  const query = input.query.trim();
  if (!query || Array.from(query).length > 80) throw new Error('查书词句需为一至八十个字符。');
  const runtime = await getDatabaseRuntime();
  const session = await createReadOnlySession();
  const summary = await session.getSummary(input.campaignId, input.branchId);
  if (summary.worldId !== input.worldId || summary.packageRevision < 1) {
    throw new Error('所选战役与当前世界不匹配，或尚未锁定开局世界包。');
  }
  const base = await runtime.worldStore.getWorldPackage(summary.worldId, summary.packageRevision);
  if (!base || base.manifest.status !== 'published') throw new Error('战役锁定的已发布世界包无法读取。');
  const activeSource = await runtime.sourceStore.findActiveByRawHash(base.manifest.sourceSha256);
  if (!activeSource || activeSource.status !== 'active') throw new Error('当前没有可用于本地查书的已导入原文。');
  const isCurrent = async (): Promise<boolean> =>
    (await runtime.turns.getState(input.branchId))?.stateVersion === summary.state.stateVersion;
  const lookup = await runtime.progressiveTurnContext.activeBookLookup({
    campaignId: input.campaignId,
    branchId: input.branchId,
    worldId: input.worldId,
    sourceSha256: base.manifest.sourceSha256,
    stateVersion: summary.state.stateVersion,
    query,
    isCurrent,
    signal: input.signal,
  });
  if (!lookup || lookup.passages.length === 0) {
    return {
      status: 'not_found', entryIds: [], count: 0,
      message: '本地索引没有匹配；这不表示原著中不存在相关内容。',
    };
  }
  if (input.signal?.aborted || !await isCurrent()) {
    const error = new Error('查书期间战役状态发生变化，请重新查询。');
    error.name = input.signal?.aborted ? 'AbortError' : 'StaleProgressiveBuildError';
    throw error;
  }
  const manifest = summary.state.contentManifest ?? createBaseContentManifest({
    worldId: summary.worldId,
    branchId: input.branchId,
    stateVersion: summary.state.stateVersion,
    basePackage: { revision: summary.packageRevision, contentHash: base.manifest.contentHash },
  });
  const activeDeltas = await loadBranchDeltaEntries({
    manifest,
    worldId: summary.worldId,
    branchId: input.branchId,
    stateVersion: summary.state.stateVersion,
    baseRevision: summary.packageRevision,
    baseContentHash: base.manifest.contentHash,
    getDelta: deltaId => runtime.worldStore.getProgressiveDeltaPackage(deltaId),
    sha256Hex: nativeSha256.sha256Hex,
  });
  const existingEntryIds = new Set([
    ...base.entries.map(entry => entry.entryId),
    ...activeDeltas.flatMap(delta => delta.entries.map(entry => entry.entryId)),
  ]);
  if (summary.state.segmentContentBinding) {
    const effective = await runtime.segmentPublication.loadEffectiveCatalog({
      campaignId: input.campaignId, branchId: input.branchId, binding: summary.state.segmentContentBinding,
    });
    for (const entry of effective.entries) existingEntryIds.add(entry.entryId);
  }
  const publication = await publishUserRequestedSourceLookupDelta({
    db: runtime.db,
    worldStore: runtime.worldStore,
    sourceStore: runtime.sourceStore,
    sha256Hex: nativeSha256.sha256Hex,
    worldId: summary.worldId,
    branchId: input.branchId,
    stateVersion: summary.state.stateVersion,
    baseRevision: summary.packageRevision,
    sourceSha256: base.manifest.sourceSha256,
    book: input.book,
    passages: lookup.passages,
    existingEntryIds,
    rebaseLegacyOverlay: (tx, manifests) => runtime.segmentPublication.rebaseLegacyOverlay(tx, manifests),
    createdAt: new Date().toISOString(),
    signal: input.signal,
  });
  if (publication.status === 'needs_review') {
    return { status: 'review_required', entryIds: [], count: 0,
      message: '查书命中未通过发布校验，已留待复核，当前不会显示或记入角色知识。' };
  }
  const availableIds = new Set(existingEntryIds);
  if (publication.status === 'published') {
    for (const entry of publication.publication?.delta.entries ?? []) availableIds.add(entry.entryId);
  }
  const entryIds = publication.entryIds.filter(entryId => availableIds.has(entryId));
  if (entryIds.length !== publication.entryIds.length) {
    throw new Error('查书增量尚未进入当前分支清单，请重新查询后再确认。');
  }
  return {
    status: 'found', entryIds, count: entryIds.length,
    message: `找到 ${entryIds.length} 条，已暂存为当前分支的待发现摘录；确认后才会记入角色已知。`,
  };
}

/** Knowledge recording is a local lifecycle commit; the provider is never called. */
export async function recordProgressiveSourceKnowledge(input: {
  campaignId: string;
  branchId: string;
  entryIds: readonly string[];
}): Promise<void> {
  const session = await createSessionNoop();
  await session.recordProgressiveSourceKnowledge(input);
}

/** Exact locked base + active branch deltas, filtered through the branch time anchor. */
export async function getWorldBookProjection(input: {
  worldId: string;
  packageRevision: number;
  campaignId?: string;
  branchId?: string;
}): Promise<WorldBookProjection> {
  const runtime = await getDatabaseRuntime();
  const worldPackage = await runtime.worldStore.getWorldPackage(input.worldId, input.packageRevision);
  if (!worldPackage || worldPackage.manifest.status !== 'published') {
    throw new Error('无法读取战役锁定的已发布世界包。');
  }
  let entries = [...worldPackage.entries];
  let sections = worldPackage.sections.map(section => ({ ...section, entryIds: [...section.entryIds] }));
  let stateVersion: number | null = null;
  let contentManifest: BranchContentManifest | null = null;
  let anchorWorldTimeOrder: number | null = null;
  let discoveredEntryIds = new Set<string>();
  if (input.campaignId && input.branchId) {
    const session = await createReadOnlySession();
    const summary = await session.getSummary(input.campaignId, input.branchId);
    if (summary.worldId !== input.worldId || summary.packageRevision !== input.packageRevision) {
      throw new Error('战役分支与当前世界包版本不匹配。');
    }
    stateVersion = summary.state.stateVersion;
    anchorWorldTimeOrder = summary.anchorWorldTimeOrder;
    const playerActorId = summary.cards.find(card => card.controller === 'player')?.actorId;
    discoveredEntryIds = new Set((summary.state.discoveries ?? [])
      .filter(discovery => discovery.actorId === playerActorId)
      .map(discovery => discovery.entryId));
    contentManifest = summary.state.contentManifest ?? createBaseContentManifest({
      worldId: input.worldId,
      branchId: input.branchId,
      stateVersion,
      basePackage: { revision: input.packageRevision, contentHash: worldPackage.manifest.contentHash },
    });
    const deltas = await loadBranchDeltaEntries({
      manifest: contentManifest,
      worldId: input.worldId,
      branchId: input.branchId,
      stateVersion,
      baseRevision: input.packageRevision,
      baseContentHash: worldPackage.manifest.contentHash,
      getDelta: deltaId => runtime.worldStore.getProgressiveDeltaPackage(deltaId),
      sha256Hex: nativeSha256.sha256Hex,
    });
    if (summary.state.segmentContentBinding) {
      const effective = await runtime.segmentPublication.loadEffectiveCatalog({ campaignId: input.campaignId, branchId: input.branchId, binding: summary.state.segmentContentBinding });
      entries = effective.entries; sections = effective.sections.map(section => ({ ...section, entryIds: [...section.entryIds] }));
    } else entries.push(...deltas.flatMap(delta => delta.entries));
    for (const delta of summary.state.segmentContentBinding ? [] : deltas) {
      for (const section of delta.sections) {
        const current = sections.find(item => item.book === section.book && item.sectionKey === section.sectionKey);
        if (!current) sections.push({ ...section, entryIds: [...section.entryIds] });
        else current.entryIds = [...current.entryIds, ...section.entryIds];
      }
    }
  }
  const facts = await runtime.worldStore.listFacts(input.worldId);
  if (new Set(entries.map(entry => entry.entryId)).size !== entries.length) {
    throw new Error('当前世界书投影含有冲突的不可变条目 ID。');
  }
  const visibleAtAnchor = projectPlayerEntriesAtAnchor(entries, facts,
    anchorWorldTimeOrder === null ? undefined : anchorWorldTimeOrder, discoveredEntryIds);
  const visibleEntryIds = new Set(visibleAtAnchor.map(entry => entry.entryId));
  sections = sections.map(section => ({
    ...section,
    entryIds: section.entryIds.filter(entryId => visibleEntryIds.has(entryId)),
  })).filter(section => section.entryIds.length > 0);
  return {
    entries: visibleAtAnchor,
    sections,
    stateVersion,
    contentVersion: contentManifest?.contentVersion ?? 0,
    deltaCount: contentManifest?.deltas.length ?? 0,
    anchorWorldTimeOrder,
  };
}

/** Branch-bound world archive for moving immutable progressive expansions.
 * Unlike the library export, this carries only the active manifest/deltas for
 * the selected campaign snapshot and still excludes novel source text. */
export async function exportProgressiveBranchWorldArchive(campaignId: string, branchId: string): Promise<{
  bytes: Uint8Array;
  title: string;
  revision: number;
  stateVersion: number;
  deltaCount: number;
}> {
  const runtime = await getDatabaseRuntime();
  const session = await createReadOnlySession();
  const summary = await session.getSummary(campaignId, branchId);
  const pkg = await runtime.worldStore.getWorldPackage(summary.worldId, summary.packageRevision);
  if (!pkg || pkg.manifest.status !== 'published') throw new Error('Campaign locked package is missing or unpublished.');
  let manifest = summary.state.contentManifest;
  if (!manifest) {
    manifest = await ensureBaseBranchContentManifest({
      db: runtime.db, branchId, worldId: summary.worldId, stateVersion: summary.state.stateVersion,
      packageRevision: summary.packageRevision, packageContentHash: pkg.manifest.contentHash,
      createdAt: new Date().toISOString(),
    });
  }
  const deltas = await loadBranchDeltaEntries({
    manifest, worldId: summary.worldId, branchId, stateVersion: summary.state.stateVersion,
    baseRevision: summary.packageRevision, baseContentHash: pkg.manifest.contentHash,
    getDelta: id => runtime.worldStore.getProgressiveDeltaPackage(id), sha256Hex: nativeSha256.sha256Hex,
  });
  const world = await runtime.worldStore.getWorld(summary.worldId);
  if (!world) throw new Error(`Campaign world is missing: ${summary.worldId}.`);
  const bytes = await encodeWorldPackageArchive({
    title: world.title,
    ...pkg,
    canon: await exportPortableCanon(runtime.worldStore, pkg.manifest, pkg.entries, nativeSha256.sha256Hex),
    branchContent: { manifest, deltas },
  }, nativeSha256.sha256Hex);
  return { bytes, title: world.title, revision: summary.packageRevision,
    stateVersion: summary.state.stateVersion, deltaCount: deltas.length };
}

export async function importProgressiveBranchWorldArchive(archive: Uint8Array, branchId: string): Promise<{
  branchId: string;
  stateVersion: number;
  manifestHash: string;
  deltaCount: number;
}> {
  const runtime = await getDatabaseRuntime();
  return importProgressiveBranchContentArchive({
    db: runtime.db, worldStore: runtime.worldStore, sha256Hex: nativeSha256.sha256Hex,
    archive, branchId, createdAt: new Date().toISOString(),
  });
}

/** Companion cards of a branch (for the play screen party strip). */
export async function listPartyCards(branchId: string): Promise<ActorCard[]> {
  const runtime = await getDatabaseRuntime();
  const rows = await runtime.db.queryAll<{ card_json: string; controller: string }>(
    `SELECT card_json, controller FROM actor_cards
       JOIN party_members ON party_members.branch_id = actor_cards.branch_id AND party_members.actor_id = actor_cards.actor_id
      WHERE actor_cards.branch_id = ?
      ORDER BY actor_cards.actor_id`,
    [branchId],
  );
  return rows.map(row => JSON.parse(row.card_json) as ActorCard);
}
