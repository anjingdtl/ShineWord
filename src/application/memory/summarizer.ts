import type { LlmProvider, LlmRequest } from '../llm/types';
import {
  type ReasoningPolicySelection,
} from '../llm/reasoningPolicy';
import { recoverReasoningPolicy, observedReasoningTokensFromFailure } from '../llm/reasoningFeedback';
import type { FrozenModelCapabilities } from '../llm/requestPlan';
import { DEFAULT_OUTPUT_DEMANDS, planLlmRequest } from '../llm/requestBudgetKernel';
import { classifyLlmFailure } from '../llm/requestLedger';
import { parseStructuredOutput } from '../llm/structuredOutput';
import { estimateTokens } from '../context/tokenEstimate';
import { buildSummaryRequest, SUMMARY_INTERVAL_TURNS } from './retrieval';
import type { MemoryRecord, SqliteGameStore } from '../../infra/sqlite/sqliteGameStore';
import type { SqliteTurnStore } from '../../infra/sqlite/sqliteTurnStore';

export interface SummarizerResult {
  memory: MemoryRecord;
  fromStateVersion: number;
  toStateVersion: number;
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
  capabilities: FrozenModelCapabilities;
  reasoningPolicy: ReasoningPolicySelection;
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
  const system = [
    'You are ShineWord Summarizer.',
    'Output exactly JSON: {"summary": string}.',
    'Summarize what happened in 120 Chinese characters or fewer.',
    'Never restate numeric state; numbers are read from authoritative storage.',
  ].join(' ');
  const user = JSON.stringify(payload);
  const planRequest = (reasoningPolicy: ReasoningPolicySelection) => planLlmRequest({
    capabilities: input.capabilities,
    requestKind: 'summarizer',
    estimatedMandatoryInputTokens: estimateTokens(system) + 96,
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.summarizer,
    contextDemands: [{
      id: 'summarizer-range', board: 'storyMemory', requirement: 'mandatory',
      priority: 100, relevance: 1,
      estimatedTokens: estimateTokens(user), minTokens: estimateTokens(user),
      targetTokens: estimateTokens(user), clipMode: 'whole_item',
    }],
    reasoningPolicy,
  });
  const makeRequest = (outputPlan: ReturnType<typeof planRequest>): LlmRequest => ({
    role: 'Summarizer',
    system,
    user,
    maxOutputTokens: outputPlan.wireOutputTokens,
    maxPhysicalRequests: 1,
    jsonMode: true,
    reasoningTier: outputPlan.reasoningPolicy?.tier,
    reasoningReserveTokens: outputPlan.reasoningPolicy?.reserveTokens,
    reasoningPolicyVersion: outputPlan.reasoningPolicy?.policyVersion,
    requestKind: 'summarizer',
    ledger: {
      logicalRequestId: `summarizer:${input.branchId}:${input.fromStateVersion}-${input.toStateVersion}`,
      requestKind: 'summarizer',
      branchId: input.branchId,
      stateVersion: input.toStateVersion,
    },
  });
  const plan = planRequest(input.reasoningPolicy);
  let response;
  try {
    response = await input.provider.complete(makeRequest(plan));
  } catch (error) {
    if (classifyLlmFailure(error) !== 'reasoning_only') throw error;
    const boostedPlan = planRequest(recoverReasoningPolicy(input.reasoningPolicy,
      plan.reasoningPolicy!.reserveTokens, observedReasoningTokensFromFailure(error)));
    if ((boostedPlan.reasoningPolicy?.reserveTokens ?? 0) <= (plan.reasoningPolicy?.reserveTokens ?? 0)) {
      throw error;
    }
    response = await input.provider.complete(makeRequest(boostedPlan));
  }

  const parsed = parseStructuredOutput<{ summary?: unknown }>(response.text, {
    label: 'Summarizer summary',
  }).value;
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
