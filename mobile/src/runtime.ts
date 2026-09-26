import { RejectionSamplingRandomSource } from '../../src/domain/rules/random';
import { difficultyForBand } from '../../src/domain/rules/ruleset';
import type { ActionContract } from '../../src/domain/turns/types';
import { OpenAICompatibleProvider } from '../../src/application/llm/openAICompatible';
import { runLlmTurn } from '../../src/application/game/llmTurn';
import type { ApiProfile } from '../../src/application/llm/types';
import { FetchHttpTransport } from './fetchTransport';
import { getDatabaseRuntime } from './database';
import { createNativeRandomBytes, nativeSha256 } from './nativeCrypto';
import { KeychainSecretStore } from './secureKeyStore';

const DEMO_WORLD_CONTEXT = [
  'M2 demo world: a rainy old mansion with a courtyard, archive, corridor and gate.',
  'The player is an ordinary investigator. Do not invent supernatural powers or impossible abilities.',
  'Use actorId "actor-player". Use evidenceIds such as "demo-world".',
  'For risky actions choose one of simple/normal/challenging/hard; ordinary movement can be automatic.',
].join(' ');

export interface PlayedTurn {
  turnId: string;
  text: string;
  grade: string;
  dice?: string;
  resumed: boolean;
}

export async function playIntent(
  profile: ApiProfile,
  intent: string,
): Promise<PlayedTurn> {
  const runtime = await getDatabaseRuntime();
  const state = await runtime.turns.getState('demo-main');
  if (!state) throw new Error('Demo campaign is unavailable.');

  const turnId = `turn-${String(state.stateVersion + 1).padStart(4, '0')}`;
  const provider = new OpenAICompatibleProvider(
    profile,
    new KeychainSecretStore(),
    new FetchHttpTransport(),
  );
  const random = new RejectionSamplingRandomSource(createNativeRandomBytes());

  const result = await runLlmTurn({
    provider,
    store: runtime.turns,
    journal: runtime.turns,
    narratives: runtime.narratives,
    branchId: 'demo-main',
    turnId,
    playerIntent: intent,
    worldContext: DEMO_WORLD_CONTEXT,
    hashProvider: nativeSha256,
    random,
    resolveRollSpec(contract: ActionContract) {
      return {
        attribute: 2,
        skillRank: 'trained',
        difficulty: contract.difficultyBand
          ? difficultyForBand(contract.difficultyBand)
          : 4,
      };
    },
  });

  return {
    turnId,
    text: result.narrative.text,
    grade: result.rollRecord?.grade ?? 'automatic',
    dice: result.rollRecord
      ? `${result.rollRecord.diceCount}d${result.rollRecord.dieSides}: [${result.rollRecord.rolls.join(', ')}]`
      : undefined,
    resumed: result.resumed,
  };
}
