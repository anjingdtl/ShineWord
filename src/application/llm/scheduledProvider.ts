/** Each physical dispatch is admitted once. Queued work is never recorded as sent. */
import { LlmRequestFailure } from './types';
import type { LlmProvider, LlmRequest, LlmResponse, LlmUsage, LlmPhysicalRequestMetric } from './types';
import { LedgeredProvider } from './requestLedger';
import type { LedgeredProviderOptions } from './requestLedger';
import type { LlmRequestLedgerStore } from '../ports/llmLedger';
import { GlobalRateScheduler, estimateRequestTokens, SchedulerQueueError } from '../worldBuild/rateScheduler';
import { stableFingerprint } from './requestPlan';
import type { RequestSchedulingMetadataV1 } from '../ports/phase6';

/** Compatibility roles are closed and deterministic; old extraction never defaults to P0. */
export function schedulingRoleForRequest(request: LlmRequest): Pick<RequestSchedulingMetadataV1, 'role' | 'priority'> {
  switch (request.requestKind) {
    case 'opening_goal': return { role: 'goal_recommender', priority: 'P1' };
    // Ancillary guidance yields to player actions (plan §8.3): P1, never P0.
    case 'narrator_guidance': return { role: 'goal_recommender', priority: 'P1' };
    case 'style_analyzer': return { role: 'style_analyzer', priority: 'P3' };
    // P9 campaign planning: background build grade, never preempts P0 play.
    case 'campaign_plan': return { role: 'mapper', priority: 'P2' };
    case 'planner': return { role: 'planner', priority: 'P0' };
    case 'narrator': return { role: 'narrator', priority: 'P0' };
    case 'world_extract': case 'timeline': case 'registry': return { role: 'extractor', priority: 'P3' };
    case 'world_mapping': case 'world_adjudication': return { role: 'mapper', priority: 'P3' };
    case 'summarizer': case 'memory_checkpoint': case 'memory_repair': return { role: 'summarizer', priority: 'P3' };
    default:
      switch (request.role) {
        case 'Planner': return { role: 'planner', priority: 'P0' };
        case 'Narrator': return { role: 'narrator', priority: 'P0' };
        case 'Extractor': return { role: 'extractor', priority: 'P3' };
        case 'WorldMapper': case 'Checker': return { role: 'mapper', priority: 'P3' };
        case 'Summarizer': return { role: 'summarizer', priority: 'P3' };
      }
  }
}
function totalUsage(metrics: readonly LlmPhysicalRequestMetric[], final: LlmUsage | undefined): LlmUsage | undefined {
  if (metrics.length === 0) return final;
  const samples = [...metrics.map(metric => metric.usage), final];
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'reasoningTokens'): number | undefined => {
    if (samples.some(sample => !sample || !Number.isFinite(sample[key]) || sample[key]! < 0)) return undefined;
    return samples.reduce((total, sample) => total + sample![key]!, 0);
  };
  return { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'),
    cachedInputTokens: sum('cachedInputTokens'), reasoningTokens: sum('reasoningTokens'),
    estimated: samples.some(sample => !sample || sample.estimated) };
}
export class RateScheduledProvider implements LlmProvider {
  constructor(private readonly inner: LlmProvider, private readonly scheduler: GlobalRateScheduler) {}

  /** CampaignSession uses this instead of placing the sent ledger outside the queue. */
  withLedger(store: LlmRequestLedgerStore, options: LedgeredProviderOptions): RateScheduledProvider {
    if (this.inner instanceof LedgeredProvider) return this;
    return new RateScheduledProvider(new LedgeredProvider(this.inner, store, options), this.scheduler);
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const metadata = request.scheduling;
    if (metadata && (metadata.endpointBucketId !== this.scheduler.endpointBucketId
      || !metadata.logicalTaskId || !metadata.requestPlanHash
      || !Number.isFinite(metadata.estimatedInputTokens) || metadata.estimatedInputTokens < 0
      || !Number.isFinite(metadata.reservedOutputTokens) || metadata.reservedOutputTokens < 0)) {
      throw new SchedulerQueueError('invalid_metadata', 'Request scheduling metadata does not match the endpoint or budget.');
    }
    const estimated = Math.max(estimateRequestTokens(request), metadata
      ? Math.ceil(metadata.estimatedInputTokens) + Math.max(request.maxOutputTokens, Math.ceil(metadata.reservedOutputTokens)) : 0);
    const mapping = schedulingRoleForRequest(request);
    if ((metadata?.priority ?? mapping.priority) === 'P0') this.scheduler.reserveInteraction(estimated);
    const maximum = request.maxPhysicalRequests ?? 3;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 3) throw new Error('maxPhysicalRequests must be an integer from 1 to 3.');
    const priorMetrics: LlmPhysicalRequestMetric[] = [];
    for (let attempt = 0; attempt < maximum; attempt += 1) {
      const queuedAt = Date.now();
      const lease = await this.scheduler.acquire(estimated, {
        priority: metadata?.priority ?? mapping.priority,
        logicalTaskId: metadata?.logicalTaskId ?? request.ledger?.logicalRequestId,
        requestPlanHash: metadata?.requestPlanHash ?? stableFingerprint({ role: request.role,
          requestKind: request.requestKind, system: request.system, user: request.user,
          followUpUserMessages: request.followUpUserMessages, maxOutputTokens: request.maxOutputTokens,
          reasoningTier: request.reasoningTier, reasoningPolicyVersion: request.reasoningPolicyVersion }),
        worldId: metadata?.worldId ?? request.ledger?.worldId,
        queueDeadlineAt: metadata?.queueDeadlineAt, expectedDurationMs: metadata?.expectedDurationMs,
        signal: request.queueSignal,
      });
      const queueMs = Math.max(0, Date.now() - queuedAt);
      try {
        // A legacy reasoning-only retry re-enters admission and the ledger. The frozen wire
        // ceiling remains unchanged; governed callers already use a kernel-planned max1 retry.
        const response = await this.inner.complete({ ...request, maxPhysicalRequests: 1 });
        await lease.settle(response.usage);
        this.scheduler.noteSuccess();
        const current = response.requestMetrics?.map(metric => ({ ...metric,
          attempt: priorMetrics.length + metric.attempt,
          timings: { ...metric.timings, localQueueMs: queueMs } }));
        return { ...response, usage: totalUsage(priorMetrics, response.usage),
          requestMetrics: priorMetrics.length > 0 || current ? [...priorMetrics, ...(current ?? [])] : undefined };
      } catch (error) {
        if (!(error instanceof LlmRequestFailure)) throw error;
        for (let index = error.requestMetrics.length - 1; index >= 0; index -= 1) {
          const metric = error.requestMetrics[index];
          if (metric?.httpStatus === 429) { this.scheduler.noteRateLimited({ retryAfterMs: metric.retryAfterMs ?? null }); break; }
        }
        if (error.requestMetrics.length === 1) await lease.settle(error.requestMetrics[0]?.usage);
        const offset = priorMetrics.length;
        priorMetrics.push(...error.requestMetrics.map(metric => ({ ...metric, attempt: offset + metric.attempt,
          timings: { ...metric.timings, localQueueMs: queueMs } })));
        const last = error.requestMetrics[error.requestMetrics.length - 1];
        if ((last?.outcome !== 'reasoning_only' && last?.completionState !== 'reasoning_only') || attempt + 1 >= maximum) {
          throw new LlmRequestFailure(error.message, priorMetrics);
        }
      } finally {
        await lease.release();
        await this.scheduler.flush();
      }
    }
    throw new Error('Bounded physical request loop exhausted.');
  }
}
