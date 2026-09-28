import { RejectionSamplingRandomSource } from '../../src/domain/rules/random';
// Static imports: runtime module groups must ship in the initial bundle, not
// lazy-fetch at play time (lazy group requests can fail on device networks).
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import type { ApiProfile } from '../../src/application/llm/types';
import { CampaignSession, type PlayTurnResult } from '../../src/application/campaign/session';
import type { ActorCard } from '../../src/domain/characters/card';
import type { ItemSourceSnapshotEntry, PartySnapshotEntry } from '../../src/domain/state/types';
import type { BookSection, ContentEntry, WorldPackageManifest } from '../../src/domain/content/types';
import { FetchHttpTransport } from './fetchTransport';
import { getDatabaseRuntime } from './database';
import { createNativeRandomBytes, nativeSha256 } from './nativeCrypto';
import { KeychainSecretStore } from './secureKeyStore';

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
  provider: OpenAICompatibleProvider,
): Promise<CampaignSession> {
  const runtime = await getDatabaseRuntime();
  return new CampaignSession(
    {
      db: runtime.db,
      turns: runtime.turns,
      game: runtime.game,
      worldStore: runtime.worldStore,
      narratives: runtime.narratives,
      hashProvider: nativeSha256,
      random: new RejectionSamplingRandomSource(createNativeRandomBytes()),
    },
    provider,
    profile,
  );
}

export async function buildProvider(profile: ApiProfile): Promise<OpenAICompatibleProvider> {
  return new OpenAICompatibleProvider(profile, new KeychainSecretStore(), new FetchHttpTransport(), 300_000);
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

export interface TurnView {
  turnId: string;
  text: string;
  grade: string;
  dice?: string;
  resumed: boolean;
}

export async function loadHistory(branchId: string): Promise<TurnView[]> {
  const runtime = await getDatabaseRuntime();
  const rows = await runtime.turns.listCommittedTurns(branchId);
  return rows
    .filter(row => row.narrativeText !== null)
    .map(row => ({
      turnId: row.turnId,
      text: row.narrativeText ?? row.publicSummary,
      grade: row.rollRecord?.grade ?? row.outcomeGrade,
      dice: row.rollRecord
        ? `${row.rollRecord.diceCount}d${row.rollRecord.dieSides}: [${row.rollRecord.rolls.join(', ')}]`
        : undefined,
      resumed: false,
    }));
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
import { encodeWorldPackageArchive, importPortableWorldPackage } from '../../src/application/export/worldPackageArchive';

export { SAVE_SCHEMA_VERSION };
export type { SaveFile, EncounterView };

export async function exportCampaignSave(
  campaignId: string,
  branchId: string,
): Promise<{ save: SaveFile; json: string }> {
  const runtime = await getDatabaseRuntime();
  const result = await exportSave({
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
    db: runtime.db,
    save,
    newCampaignId: campaignId,
    newBranchId: branchId,
    createdAt: new Date().toISOString(),
  });
  return { campaignId, branchId };
}

export interface ReviewIssueView {
  issueId: string;
  kind: string;
  severity: string;
  status: string;
  detailJson: string;
}

export async function listReviewIssues(worldId: string): Promise<ReviewIssueView[]> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  const issues = await worldStore.listReviewIssues(worldId, 'open');
  return issues.map(issue => ({
    issueId: issue.issueId,
    kind: issue.kind,
    severity: issue.severity,
    status: issue.status,
    detailJson: issue.detailJson,
  }));
}

export async function resolveReviewIssue(worldId: string, issueId: string, resolution: 'resolved' | 'waived'): Promise<void> {
  const runtime = await getDatabaseRuntime();
  const worldStore = new SqliteWorldStore(runtime.db);
  await worldStore.resolveReviewIssue(worldId, issueId, resolution);
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
}): Promise<void> {
  const runtime = await getDatabaseRuntime();
  await new SqliteWorldStore(runtime.db).saveWorldPackageDraft({
    ...input,
    draftJson: JSON.stringify({ entries: input.entries, sections: input.sections }),
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
  const bytes = await encodeWorldPackageArchive({ title: world.title, ...pkg }, nativeSha256.sha256Hex);
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
    worldStore,
    sha256Hex: nativeSha256.sha256Hex,
    archive,
    newWorldId: worldId,
    createdAt: new Date().toISOString(),
  });
  return { worldId: imported.worldId, title: imported.title, revision: imported.revision };
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
