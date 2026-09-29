/**
 * Provider wrapper that funnels every physical request through the global
 * RPM/TPM scheduler (unified build P1 §5). Extraction, mapping, probes and
 * the foreground game loop share one scheduler instance per provider so the
 * budget is never multiplied by batch x route x worker.
 */
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
      return response;
    } finally {
      lease.release();
    }
  }
}
