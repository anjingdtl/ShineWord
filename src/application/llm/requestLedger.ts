/**
 * Ledger service layer (infrastructure plan §51-§56): failure classification,
 * the provider wrapper that records every physical dispatch, and the
 * cold-start recovery sweep. The wrapper REJECTS a logical request whose
 * previous attempt ended outcome_unknown - automatic replay after an
 * unobservable outcome is forbidden (double-billing guard).
 */

import type { LlmProvider, LlmRequest, LlmResponse } from './types';
import { LlmRequestFailure } from './types';
import type {
  LlmAttemptPatch,
  LlmFailureClass,
  LlmRequestAttemptRecord,
  LlmRequestLedgerStore,
} from '../ports/llmLedger';

/** Classifies a completion failure from the provider's redacted metrics. */
export function classifyLlmFailure(error: unknown): LlmFailureClass {
  if (error instanceof LlmRequestFailure) {
    const metrics = error.requestMetrics;
    const last = metrics[metrics.length - 1];
    if (last?.errorCategory === 'timeout') return 'timeout_unknown';
    if (last?.errorCategory === 'network') return 'network_connect';
    if (last?.errorCategory === 'invalid_response') {
      if (last.completionState === 'content_filter') return 'content_filter';
      if (last.completionState === 'reasoning_only') return 'reasoning_only';
      if (last.completionState === 'length') return 'length';
      if (last.completionState === 'empty') return 'empty';
      if (last.completionState === 'no_choices') return 'no_choices';
      return 'invalid_transport_json';
    }
    if (typeof last?.httpStatus === 'number') {
      if (last.httpStatus === 429) return 'http_rate_limit';
      if (last.httpStatus >= 500) return 'http_server';
      return 'http_client';
    }
  }
  const name = error instanceof Error ? error.name : '';
  if (name === 'BudgetInfeasibleError') return 'budget_infeasible';
  if (name === 'StructuredParseError') return 'schema_invalid';
  if (name === 'Error' && /timed? ?out|timeout/i.test(String((error as Error).message))) {
    return 'timeout_unknown';
  }
  return 'unknown';
}

function lastHttpStatus(error: unknown): number | null {
  if (error instanceof LlmRequestFailure) {
    const metrics = error.requestMetrics;
    const last = metrics[metrics.length - 1];
    return last?.httpStatus ?? null;
  }
  return null;
}

export class OutcomeUnknownReplayError extends Error {
  constructor(readonly logicalRequestId: string) {
    super(
      `LLM 请求 ${logicalRequestId} 存在 outcome_unknown 尝试；服务端可能已完成并计费，禁止自动重发。` +
        ' 请在请求账本中人工确认结果后再继续。',
    );
    this.name = 'OutcomeUnknownReplayError';
  }
}

export interface LedgeredProviderOptions {
  modelProfileFingerprint: string;
  clock?: () => number;
  /** Test/operator escape hatch; production keeps the replay guard ON. */
  allowOutcomeUnknownReplay?: boolean;
}

/**
 * Wraps any LlmProvider: requests carrying `ledger` metadata produce durable
 * prepared/sent rows before dispatch and a terminal row afterwards. Requests
 * without metadata pass through untouched (world build migrates later).
 */
export class LedgeredProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly store: LlmRequestLedgerStore,
    private readonly options: LedgeredProviderOptions,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const meta = request.ledger;
    if (!meta) return this.inner.complete(request);

    const prior = await this.store.listAttempts(meta.logicalRequestId);
    if (
      !this.options.allowOutcomeUnknownReplay &&
      prior.some(attempt => attempt.status === 'outcome_unknown')
    ) {
      throw new OutcomeUnknownReplayError(meta.logicalRequestId);
    }

    const now = this.options.clock ?? Date.now;
    const attempt = await this.store.beginAttempt(
      {
        logicalRequestId: meta.logicalRequestId,
        requestKind: meta.requestKind,
        campaignId: meta.campaignId ?? null,
        branchId: meta.branchId ?? null,
        worldId: meta.worldId ?? null,
        stateVersion: meta.stateVersion ?? null,
        modelProfileFingerprint: this.options.modelProfileFingerprint,
        reasoningTier: request.reasoningTier ?? meta.reasoningTier ?? null,
      },
      now(),
    );
    // prepared -> sent is durable BEFORE the HTTP dispatch: a crash between
    // them still leaves an interruptable row for the cold-start sweep.
    await this.store.updateAttempt(attempt.attemptId, { status: 'sent' });

    try {
      const response = await this.inner.complete(request);
      const patch: LlmAttemptPatch = {
        status: 'succeeded',
        providerRequestId: response.requestId ?? null,
        inputTokens: response.usage?.inputTokens ?? null,
        outputTokens: response.usage?.outputTokens ?? null,
        reasoningTokens: response.usage?.reasoningTokens ?? null,
        cachedInputTokens: response.usage?.cachedInputTokens ?? null,
        estimatedUsage: response.usage?.estimated ? 1 : 0,
        finishedAt: now(),
      };
      await this.store.updateAttempt(attempt.attemptId, patch);
      return response;
    } catch (error) {
      await this.store.updateAttempt(attempt.attemptId, {
        status: 'failed',
        failureClass: classifyLlmFailure(error),
        errorCode: error instanceof Error ? error.name : 'unknown',
        httpStatus: lastHttpStatus(error),
        finishedAt: now(),
      });
      throw error;
    }
  }
}

/**
 * Cold-start recovery (plan §53): every prepared/sent row without a terminal
 * state becomes outcome_unknown. The caller NEVER auto-resends them.
 */
export async function recoverInterruptedAttempts(
  store: LlmRequestLedgerStore,
  clock: () => number = Date.now,
): Promise<{ recoveredAttemptIds: string[] }> {
  const ids = await store.listInterruptedAttemptIds();
  for (const id of ids) {
    await store.updateAttempt(id, {
      status: 'outcome_unknown',
      errorCode: 'interrupted_by_process_exit',
      finishedAt: clock(),
    });
  }
  return { recoveredAttemptIds: ids };
}

export type { LlmRequestAttemptRecord };
