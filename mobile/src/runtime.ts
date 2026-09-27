import { RejectionSamplingRandomSource } from '../../src/domain/rules/random';
// Static imports: runtime module groups must ship in the initial bundle, not
// lazy-fetch at play time (lazy group requests can fail on device networks).
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import type { ApiProfile } from '../../src/application/llm/types';
import { CampaignSession, type PlayTurnResult } from '../../src/application/campaign/session';
import type { ActorCard } from '../../src/domain/characters/card';
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

export interface CampaignPlayState {
  campaignId: string;
  branchId: string;
  title: string;
  worldId: string;
  goal: string;
  stateVersion: number;
  locationId: string;
  clockMinutes: number;
  playerCard: ActorCard | null;
  playerResources: Record<string, number>;
  cards: ActorCard[];
}

export async function getCampaignState(
  campaignId: string,
  branchId: string,
): Promise<CampaignPlayState> {
  const session = await createSessionNoop();
  const summary = await session.getSummary(campaignId, branchId);
  const playerCard = summary.cards.find(card => card.controller === 'player') ?? null;
  return {
    campaignId: summary.campaignId,
    branchId: summary.branchId,
    title: summary.title,
    worldId: summary.worldId,
    goal: summary.goal,
    stateVersion: summary.state.stateVersion,
    locationId: Object.values(summary.state.actors)[0]?.locationId ?? 'unknown',
    clockMinutes: summary.state.clockMinutes,
    playerCard,
    playerResources: playerCard
      ? summary.state.actors[playerCard.actorId]?.resources ?? {}
      : {},
    cards: summary.cards,
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
