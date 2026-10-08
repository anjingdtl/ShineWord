/**
 * Ledger service layer (infrastructure plan §51-§56): failure classification,
 * the provider wrapper that records every physical dispatch, and the
 * cold-start recovery sweep. The wrapper REJECTS a logical request whose
 * previous attempt ended outcome_unknown - automatic replay after an
 * unobservable outcome is forbidden (double-billing guard).
 */

import type { LlmProvider, LlmRequest, LlmResponse } from './types';
import { LlmRequestFailure } from './types';
import { stableFingerprint } from './requestPlan';
import { REASONING_USAGE_ROLLING_WINDOW } from './reasoningPolicy';
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
    // Empty reasoning completions are represented as a dedicated outcome,
    // not a transport/HTTP error category.
    if (last?.completionState === 'reasoning_only' || last?.outcome === 'reasoning_only') {
      return 'reasoning_only';
    }
    if (last?.errorCategory === 'timeout') return 'timeout_unknown';
    if (last?.errorCategory === 'network') {
      return last.dispatchState === 'not_sent' ? 'network_connect' : 'network_unknown';
    }
    if (last?.errorCategory === 'invalid_response') {
      if (last.completionState === 'content_filter') return 'content_filter';
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

function failedUsagePatch(error: unknown): Pick<
  LlmAttemptPatch,
  'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cachedInputTokens' | 'estimatedUsage'
> {
  if (!(error instanceof LlmRequestFailure) || error.requestMetrics.length === 0) {
    return { inputTokens: null, outputTokens: null, reasoningTokens: null, cachedInputTokens: null, estimatedUsage: 1 };
  }
  const metrics = error.requestMetrics;
  const totalIfComplete = (key: 'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cachedInputTokens'): number | null => {
    if (metrics.some(metric => typeof metric.usage?.[key] !== 'number'
      || !Number.isFinite(metric.usage[key]) || metric.usage[key]! < 0)) return null;
    return metrics.reduce((sum, metric) => sum + metric.usage![key]!, 0);
  };
  return {
    inputTokens: totalIfComplete('inputTokens'),
    outputTokens: totalIfComplete('outputTokens'),
    reasoningTokens: totalIfComplete('reasoningTokens'),
    cachedInputTokens: totalIfComplete('cachedInputTokens'),
    estimatedUsage: metrics.every(metric => metric.usage && !metric.usage.estimated) ? 0 : 1,
  };
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

  async readReasoningUsage(input: { requestKind: import('./types').LlmRequestKind; tier: import('./types').ReasoningTier }) {
    return this.store.listRecentReasoningUsage?.({ modelProfileFingerprint: this.options.modelProfileFingerprint,
      reasoningTier: input.tier, requestKind: input.requestKind, limit: REASONING_USAGE_ROLLING_WINDOW }) ?? [];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const meta = request.ledger;
    if (!meta) return this.inner.complete(request);

    const prior = await this.store.listAttempts(meta.logicalRequestId);
    if (
      !this.options.allowOutcomeUnknownReplay &&
      prior.some(attempt => attempt.status === 'outcome_unknown' && attempt.replayApprovedAt == null)
    ) {
      throw new OutcomeUnknownReplayError(meta.logicalRequestId);
    }

    const now = this.options.clock ?? Date.now;
    const requestFingerprint = stableFingerprint({ system: request.system, user: request.user, role: request.role,
      maxOutputTokens: request.maxOutputTokens, jsonMode: request.jsonMode, reasoningTier: request.reasoningTier,
      reasoningReserveTokens: request.reasoningReserveTokens, model: this.options.modelProfileFingerprint });
    if (['planner', 'narrator'].includes(meta.requestKind)) {
      const retained = prior.find(a => a.status === 'succeeded' && a.requestFingerprint === requestFingerprint && a.responseJson);
      if (retained?.responseJson) {
        const response = JSON.parse(retained.responseJson) as LlmResponse;
        if (stableFingerprint(response) !== retained.responseHash) throw new Error('Retained LLM response hash mismatch; refusing dispatch.');
        return response;
      }
    }
    const attempt = await this.store.beginAttempt(
      {
        logicalRequestId: meta.logicalRequestId,
        requestFingerprint,
        physicalAttemptLimit: meta.physicalAttemptLimit,
        allowOutcomeUnknownReplay: this.options.allowOutcomeUnknownReplay,
        requestKind: meta.requestKind,
        campaignId: meta.campaignId ?? null,
        branchId: meta.branchId ?? null,
        worldId: meta.worldId ?? null,
        stateVersion: meta.stateVersion ?? null,
        modelProfileFingerprint: this.options.modelProfileFingerprint,
        reasoningTier: request.reasoningTier ?? null,
        reasoningReserveTokens: request.reasoningReserveTokens ?? null,
        reasoningPolicyVersion: request.reasoningPolicyVersion ?? null,
        wireOutputTokens: request.maxOutputTokens,
      },
      now(),
    );
    // prepared -> sent is durable BEFORE the HTTP dispatch: a crash between
    // them still leaves an interruptable row for the cold-start sweep.
    await this.store.updateAttempt(attempt.attemptId, { status: 'sent' });

    try {
      const response = await this.inner.complete({ ...request, maxPhysicalRequests: 1 });
      const patch: LlmAttemptPatch = {
        status: 'succeeded',
        responseJson: JSON.stringify(response),
        responseHash: stableFingerprint(response),
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
      const failureClass = classifyLlmFailure(error);
      await this.store.updateAttempt(attempt.attemptId, {
        // A timeout or unclassified disconnect says nothing about whether
        // the server completed and billed. Only explicit not-sent transport
        // evidence permits a network retry without player acknowledgement.
        status: failureClass === 'timeout_unknown' || failureClass === 'network_unknown' || failureClass === 'unknown'
          ? 'outcome_unknown' : 'failed',
        failureClass,
        errorCode: error instanceof Error ? error.name : 'unknown',
        httpStatus: lastHttpStatus(error),
        ...failedUsagePatch(error),
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
