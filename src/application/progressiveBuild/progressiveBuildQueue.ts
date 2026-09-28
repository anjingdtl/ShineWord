import { codePointLength } from '../../domain/world/textOffsets';

export type ProgressiveBuildPriority = 'current_action' | 'near_domain' | 'active_book_lookup';

export const PROGRESSIVE_BUILD_LIMITS = {
  concurrency: 1,
  maxQueued: 24,
  maxPassages: 3,
  maxPassageCodePoints: 1_200,
  maxInputCodePoints: 3_600,
  maxOutputTokensPerRequest: 1_200,
  maxRequestsPerTask: 2,
  maxRequestsPerTenTurns: 3,
  maxOutputTokensPerTenTurns: 3_600,
} as const;

export class StaleProgressiveBuildError extends Error {
  constructor() {
    super('Progressive source preparation became stale before it could be used.');
    this.name = 'StaleProgressiveBuildError';
  }
}

export interface ProgressiveBuildRunContext {
  signal: AbortSignal;
  /** At most three passages, each at most 1,200 code points. */
  sourcePassages: readonly string[];
  /** Call once for each physical model request, including repair attempts. */
  consumeProviderRequest(maxOutputTokens: number): void;
}

export interface ProgressiveBuildTask<T> {
  campaignId: string;
  branchId: string;
  stateVersion: number;
  priority: ProgressiveBuildPriority;
  /** Stable content key; completed equivalent work is cached in this process. */
  dedupeKey: string;
  sourcePassages?: readonly string[];
  signal?: AbortSignal;
  /** Disable result caching when a downstream service owns versioned cache keys. */
  cacheResult?: boolean;
  isCurrent?: () => boolean | Promise<boolean>;
  run: (context: ProgressiveBuildRunContext) => Promise<T>;
}

interface QueueRecord {
  task: ProgressiveBuildTask<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  controller: AbortController;
  order: number;
  status: 'queued' | 'running' | 'settled';
  externalAbort?: () => void;
  requestsUsed: number;
  passageInput: string[];
}

interface WindowUsage {
  requests: number;
  outputTokens: number;
}

const PRIORITY: Record<ProgressiveBuildPriority, number> = {
  current_action: 0,
  near_domain: 1,
  active_book_lookup: 2,
};

/**
 * One serial queue for optional progressive world work. Current-turn lookups
 * preempt cancellable prefetches; lower-priority work pauses while the game is
 * making its foreground Planner/Narrator requests.
 */
export class ProgressiveBuildQueue {
  private readonly waiting: QueueRecord[] = [];
  private readonly deduped = new Map<string, QueueRecord>();
  private readonly resultCache = new Map<string, unknown>();
  private readonly windowUsage = new Map<string, WindowUsage>();
  private active: QueueRecord | null = null;
  private order = 0;
  private foregroundBusy = false;

  enqueue<T>(task: ProgressiveBuildTask<T>): Promise<T> {
    if (!task.campaignId || !task.branchId || !task.dedupeKey
      || !Number.isSafeInteger(task.stateVersion) || task.stateVersion < 0) {
      return Promise.reject(new Error('Progressive build task identity is invalid.'));
    }
    const cacheKey = this.recordKey(task);
    if (task.cacheResult !== false && this.resultCache.has(cacheKey)) {
      return Promise.resolve(this.resultCache.get(cacheKey) as T);
    }
    const existing = this.deduped.get(cacheKey);
    if (existing) return existing.promise as Promise<T>;
    if (task.signal?.aborted) return Promise.reject(abortError());
    if (this.waiting.length >= PROGRESSIVE_BUILD_LIMITS.maxQueued) {
      return Promise.reject(new Error('Progressive preparation queue is full.'));
    }

    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const record: QueueRecord = {
      task: task as ProgressiveBuildTask<unknown>,
      promise,
      resolve,
      reject,
      controller: new AbortController(),
      order: this.order++,
      status: 'queued',
      requestsUsed: 0,
      passageInput: boundedPassages(task.sourcePassages ?? []),
    };
    this.deduped.set(cacheKey, record);
    if (task.signal) {
      record.externalAbort = () => this.cancelRecord(record, abortError());
      task.signal.addEventListener('abort', record.externalAbort, { once: true });
    }
    this.waiting.push(record);
    this.sortWaiting();
    if (this.active && PRIORITY[task.priority] < PRIORITY[this.active.task.priority]) {
      this.active.controller.abort();
    }
    this.pump();
    return promise as Promise<T>;
  }

  setForegroundBusy(busy: boolean): void {
    this.foregroundBusy = busy;
    if (busy && this.active && this.active.task.priority !== 'current_action') {
      this.active.controller.abort();
    }
    if (!busy) this.pump();
  }

  cancel(dedupeKey: string, campaignId?: string, branchId?: string): boolean {
    const record = [...this.deduped.entries()].find(([key, candidate]) =>
      candidate.task.dedupeKey === dedupeKey
      && (!campaignId || candidate.task.campaignId === campaignId)
      && (!branchId || candidate.task.branchId === branchId))?.[1];
    if (!record) return false;
    this.cancelRecord(record, abortError());
    return true;
  }

  private pump(): void {
    if (this.active) return;
    const nextIndex = this.waiting.findIndex(record =>
      !this.foregroundBusy || record.task.priority === 'current_action');
    if (nextIndex < 0) return;
    const [record] = this.waiting.splice(nextIndex, 1);
    if (!record) return;
    this.active = record;
    record.status = 'running';
    void this.runRecord(record);
  }

  private async runRecord(record: QueueRecord): Promise<void> {
    const cacheKey = this.recordKey(record.task);
    try {
      await this.throwIfNotCurrent(record);
      const context: ProgressiveBuildRunContext = {
        signal: record.controller.signal,
        sourcePassages: record.passageInput,
        consumeProviderRequest: maxOutputTokens => {
          this.reserveProviderRequest(record, maxOutputTokens);
        },
      };
      const result = await record.task.run(context);
      this.throwIfAborted(record);
      await this.assertCurrent(record);
      if (record.task.cacheResult !== false) {
        this.resultCache.set(cacheKey, result);
        while (this.resultCache.size > 128) {
          const oldest = this.resultCache.keys().next().value as string | undefined;
          if (!oldest) break;
          this.resultCache.delete(oldest);
        }
      }
      record.resolve(result);
    } catch (error) {
      record.reject(error);
    } finally {
      this.finishRecord(record);
      if (this.active === record) this.active = null;
      this.pump();
    }
  }

  private reserveProviderRequest(record: QueueRecord, maxOutputTokens: number): void {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1
      || maxOutputTokens > PROGRESSIVE_BUILD_LIMITS.maxOutputTokensPerRequest) {
      throw new Error('Progressive build model output budget exceeds the per-request limit.');
    }
    if (record.requestsUsed >= PROGRESSIVE_BUILD_LIMITS.maxRequestsPerTask) {
      throw new Error('Progressive build task exhausted its physical-request budget.');
    }
    const window = Math.floor(Math.max(0, record.task.stateVersion - 1) / 10);
    const key = JSON.stringify([record.task.campaignId, record.task.branchId, window]);
    const usage = this.windowUsage.get(key) ?? { requests: 0, outputTokens: 0 };
    if (usage.requests >= PROGRESSIVE_BUILD_LIMITS.maxRequestsPerTenTurns
      || usage.outputTokens + maxOutputTokens > PROGRESSIVE_BUILD_LIMITS.maxOutputTokensPerTenTurns) {
      throw new Error('Progressive build ten-turn model budget is exhausted.');
    }
    usage.requests += 1;
    usage.outputTokens += maxOutputTokens;
    this.windowUsage.set(key, usage);
    while (this.windowUsage.size > 128) {
      const oldest = this.windowUsage.keys().next().value as string | undefined;
      if (!oldest) break;
      this.windowUsage.delete(oldest);
    }
    record.requestsUsed += 1;
  }

  private async throwIfNotCurrent(record: QueueRecord): Promise<void> {
    this.throwIfAborted(record);
    await this.assertCurrent(record);
  }

  private async assertCurrent(record: QueueRecord): Promise<void> {
    if (record.task.isCurrent && !await record.task.isCurrent()) throw new StaleProgressiveBuildError();
  }

  private throwIfAborted(record: QueueRecord): void {
    if (record.controller.signal.aborted || record.task.signal?.aborted) throw abortError();
  }

  private cancelRecord(record: QueueRecord, error: Error): void {
    if (record.status === 'settled') return;
    record.controller.abort();
    if (record.status === 'queued') {
      const index = this.waiting.indexOf(record);
      if (index >= 0) this.waiting.splice(index, 1);
      record.reject(error);
      this.finishRecord(record);
      this.pump();
    }
  }

  private finishRecord(record: QueueRecord): void {
    if (record.status === 'settled') return;
    record.status = 'settled';
    const cacheKey = this.recordKey(record.task);
    if (this.deduped.get(cacheKey) === record) this.deduped.delete(cacheKey);
    if (record.externalAbort && record.task.signal) {
      record.task.signal.removeEventListener('abort', record.externalAbort);
    }
  }

  private recordKey(task: ProgressiveBuildTask<unknown>): string {
    return JSON.stringify([task.campaignId, task.branchId, task.dedupeKey]);
  }

  private sortWaiting(): void {
    this.waiting.sort((a, b) => PRIORITY[a.task.priority] - PRIORITY[b.task.priority] || a.order - b.order);
  }
}

function boundedPassages(passages: readonly string[]): string[] {
  let remaining = PROGRESSIVE_BUILD_LIMITS.maxInputCodePoints;
  const result: string[] = [];
  for (const passage of passages.slice(0, PROGRESSIVE_BUILD_LIMITS.maxPassages)) {
    if (remaining <= 0) break;
    const allowed = Math.min(PROGRESSIVE_BUILD_LIMITS.maxPassageCodePoints, remaining);
    const chars = Array.from(passage);
    const bounded = chars.slice(0, allowed).join('');
    result.push(bounded);
    remaining -= codePointLength(bounded);
  }
  return result;
}

function abortError(): Error {
  const error = new Error('Progressive build task was canceled.');
  error.name = 'AbortError';
  return error;
}
