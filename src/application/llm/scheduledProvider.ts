/**
 * Provider wrapper that funnels every physical request through the global
 * RPM/TPM scheduler (unified build P1 §5). Extraction, mapping, probes and
 * the foreground game loop share one scheduler instance per provider so the
 * budget is never multiplied by batch x route x worker.
 *
 * Rate-limit governance (2026-10-01): a 429 observed on ANY physical attempt
 * feeds the scheduler's adaptive penalty + spacing before the error
 * propagates, and every successful response relaxes them again.
 */
import { LlmRequestFailure } from './types';
import type { LlmProvider, LlmRequest, LlmResponse } from './types';
import {
  GlobalRateScheduler,
  estimateRequestTokens,
} from '../worldBuild/rateScheduler';

export class RateScheduledProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly scheduler: GlobalRateScheduler,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const estimated = estimateRequestTokens({
      system: request.system,
      user: request.user,
      followUpUserMessages: request.followUpUserMessages,
      maxOutputTokens: request.maxOutputTokens,
    });
    const lease = await this.scheduler.acquire(estimated);
    try {
      const response = await this.inner.complete(request);
      this.scheduler.settle(response.usage);
      this.scheduler.noteSuccess();
      return response;
    } catch (error) {
      this.noteRateLimitToScheduler(error);
      throw error;
    } finally {
      lease.release();
    }
  }

  /**
   * Extracts the newest 429 metric from a failed completion and pushes it
   * into the scheduler as an adaptive penalty. Non-429 failures pass through
   * untouched - they never pace the account.
   */
  private noteRateLimitToScheduler(error: unknown): void {
    if (!(error instanceof LlmRequestFailure)) return;
    for (let index = error.requestMetrics.length - 1; index >= 0; index -= 1) {
      const metric = error.requestMetrics[index];
      if (metric && metric.httpStatus === 429) {
        this.scheduler.noteRateLimited({ retryAfterMs: metric.retryAfterMs ?? null });
        return;
      }
    }
  }
}
