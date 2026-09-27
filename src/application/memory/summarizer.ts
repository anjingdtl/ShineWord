import type { LlmProvider } from '../llm/types';
import { buildSummaryRequest, SUMMARY_INTERVAL_TURNS } from './retrieval';
import type { MemoryRecord, SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';
import type { SqliteTurnStore } from '../../infra/sqlite/sqliteTurnStore';

export interface SummarizerResult {
  memory: MemoryRecord;
  fromStateVersion: number;
  toStateVersion: number;
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Summarizer returned no JSON object.');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Builds a range summary from the committed public summaries and stores it as
 * a derived memory. Numeric state is never read from the summary: the memory
 * only carries narrative recap plus the version range it covers.
 */
export async function summarizeRange(input: {
  provider: LlmProvider;
  gameStore: SqliteGameStore;
  turnStore: SqliteTurnStore;
  branchId: string;
  fromStateVersion: number;
  toStateVersion: number;
  now?: () => string;
}): Promise<SummarizerResult> {
  if (input.toStateVersion - input.fromStateVersion + 1 < SUMMARY_INTERVAL_TURNS) {
    throw new Error(`Summary range must cover at least ${SUMMARY_INTERVAL_TURNS} turns.`);
  }
  const turns = await input.turnStore.listCommittedTurns(input.branchId);
  const turnSummaries: Array<{ turnId: string; publicSummary: string }> = [];
  for (let version = input.fromStateVersion; version <= input.toStateVersion; version += 1) {
    // Committed turns are keyed by their resulting stateVersion.
    const match = turns.find(turn => turn.stateVersion === version);
    turnSummaries.push({
      turnId: match?.turnId ?? `version-${version}`,
      publicSummary: match?.publicSummary ?? '',
    });
  }

  const payload = buildSummaryRequest(input.fromStateVersion, input.toStateVersion, turnSummaries);
  const response = await input.provider.complete({
    role: 'Summarizer',
    system: [
      'You are ShineWord Summarizer.',
      'Output exactly JSON: {"summary": string}.',
      'Summarize what happened in 120 Chinese characters or fewer.',
      'Never restate numeric state; numbers are read from authoritative storage.',
    ].join(' '),
    user: JSON.stringify(payload),
    maxOutputTokens: 800,
    jsonMode: true,
  });

  const parsed = extractJson(response.text) as { summary?: unknown };
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : '';
  if (!summary) throw new Error('Summarizer returned an empty summary.');

  const now = input.now ?? (() => new Date().toISOString());
  const memory: MemoryRecord = {
    branchId: input.branchId,
    memoryId: `mem-${input.branchId}-${input.fromStateVersion}-${input.toStateVersion}`,
    kind: 'turn_range_summary',
    summary,
    fromStateVersion: input.fromStateVersion,
    toStateVersion: input.toStateVersion,
    invalidAt: null,
    createdAt: now(),
  };
  await input.gameStore.saveMemory(memory);
  return { memory, fromStateVersion: input.fromStateVersion, toStateVersion: input.toStateVersion };
}
