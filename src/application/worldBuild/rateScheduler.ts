/**
 * Global RPM/TPM request scheduler (unified build P1 §5).
 *
 * One process-wide scheduler per provider endpoint gates EVERY billable
 * physical request - extraction, mapping, probes and foreground game turns
 * share the same budget. Sliding 60s windows track request count and token
 * count; in-flight requests reserve their estimated input tokens up front
 * (cached traffic counts FULL until a usage response proves otherwise) and
 * settle to the reported usage afterwards. Retry-After hints push a floor
 * time before the next acquire.
 *
 * Deterministic: tests inject `now` and `sleep`.
 */
import { estimateTokens } from './groupPlanner';

export interface RateSchedulerOptions {
  rpm?: number;
  tpm?: number;
  /** Max concurrently in-flight requests (default 2; 1-4 per plan P1 §4). */
  maxConcurrent?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Granularity for waiting loops (default 100ms). */
  tickMs?: number;
}

export interface RateSchedulerStats {
  rpm: number | undefined;
  tpm: number | undefined;
  maxConcurrent: number;
  inFlight: number;
  windowRequests: number;
  windowTokens: number;
  retryAfterUntil: number | null;
  totalAcquired: number;
  totalWaitedMs: number;
}

interface WindowEntry {
  t: number;
  tokens: number;
}

export interface SchedulerLease {
  /** Removes the in-flight reservation (call exactly once, even on error). */
  release(): void;
}

const WINDOW_MS = 60_000;

export class GlobalRateScheduler {
  private readonly rpm: number | undefined;
  private readonly tpm: number | undefined;
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tickMs: number;

  private window: WindowEntry[] = [];
  private inFlight = 0;
  private retryAfterUntil: number | null = null;
  private totalAcquired = 0;
  private totalWaitedMs = 0;

  constructor(options: RateSchedulerOptions = {}) {
    this.rpm = options.rpm && options.rpm > 0 ? options.rpm : undefined;
    this.tpm = options.tpm && options.tpm > 0 ? options.tpm : undefined;
    this.maxConcurrent = Math.max(1, Math.min(8, options.maxConcurrent ?? 2));
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    this.tickMs = options.tickMs ?? 100;
  }

  /**
   * Waits for a slot under RPM/TPM/concurrency limits, then reserves the
   * estimated request tokens (input estimate + output budget). The estimate
   * is deliberately conservative: cached input counts in full until settle.
   */
  async acquire(estimatedTokens: number): Promise<SchedulerLease> {
    for (;;) {
      const now = this.now();
      this.prune(now);
      const floorOk = this.retryAfterUntil === null || now >= this.retryAfterUntil;
      const rpmOk = this.rpm === undefined || this.window.length < this.rpm;
      const tpmOk = this.tpm === undefined
        || this.windowTokens() + Math.max(0, estimatedTokens) <= this.tpm;
      const concOk = this.inFlight < this.maxConcurrent;
      if (floorOk && rpmOk && tpmOk && concOk) {
        this.window.push({ t: now, tokens: Math.max(0, estimatedTokens) });
        this.inFlight += 1;
        this.totalAcquired += 1;
        let released = false;
        return {
          release: () => {
            if (released) return;
            released = true;
            this.inFlight = Math.max(0, this.inFlight - 1);
          },
        };
      }
      const wait = Math.max(this.tickMs, this.retryAfterUntil !== null && this.retryAfterUntil > now
        ? this.retryAfterUntil - now
        : this.tickMs);
      this.totalWaitedMs += wait;
      await this.sleep(wait);
    }
  }

  /**
   * Post-response true-up: replaces the reservation with the provider-reported
   * usage. Input tokens (cached included) count in full - cache discounts are
   * never assumed up front (plan P1 §5).
   */
  settle(usage: { inputTokens?: number; outputTokens?: number } | undefined): void {
    const last = this.window[this.window.length - 1];
    if (!last || usage?.inputTokens === undefined) return;
    const actual = Math.max(0, Math.ceil(usage.inputTokens) + Math.ceil(usage.outputTokens ?? 0));
    last.tokens = actual;
  }

  /** Honors a provider Retry-After / 429 hint: no acquire before `ms` elapse. */
  noteRetryAfter(ms: number): void {
    const until = this.now() + Math.max(0, ms);
    if (this.retryAfterUntil === null || until > this.retryAfterUntil) {
      this.retryAfterUntil = until;
    }
  }

  stats(): RateSchedulerStats {
    this.prune(this.now());
    return {
      rpm: this.rpm,
      tpm: this.tpm,
      maxConcurrent: this.maxConcurrent,
      inFlight: this.inFlight,
      windowRequests: this.window.length,
      windowTokens: this.windowTokens(),
      retryAfterUntil: this.retryAfterUntil,
      totalAcquired: this.totalAcquired,
      totalWaitedMs: this.totalWaitedMs,
    };
  }

  private windowTokens(): number {
    return this.window.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  private prune(now: number): void {
    if (this.window.length === 0) return;
    const cutoff = now - WINDOW_MS;
    let first = 0;
    while (first < this.window.length && this.window[first]!.t <= cutoff) first += 1;
    if (first > 0) this.window = this.window.slice(first);
    if (this.retryAfterUntil !== null && now >= this.retryAfterUntil) {
      this.retryAfterUntil = null;
    }
  }
}

/** Rough pre-request token estimate for one LlmRequest-shaped payload. */
export function estimateRequestTokens(input: {
  system: string;
  user: string;
  followUpUserMessages?: readonly string[];
  maxOutputTokens: number;
}): number {
  let text = input.system.length > 0 ? input.system : '';
  text += input.user;
  for (const message of input.followUpUserMessages ?? []) text += message;
  return estimateTokens(text) + input.maxOutputTokens;
}
