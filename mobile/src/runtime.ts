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
  return new OpenAICompatibleProvider(profile, new KeychainSecretStore(), new FetchHttpTransport(), 120_000);
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
