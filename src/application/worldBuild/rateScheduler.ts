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
  /** Consecutive 429s observed since the last successful response. */
  rateLimitStreak: number;
  /** Current adaptive minimum spacing between acquire grants (ms). */
  adaptiveSpacingMs: number;
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
/**
 * Adaptive rate-limit governance (2026-10-01): a 429 storm must back the
 * WHOLE process off, not just the failing unit. Consecutive 429s grow both a
 * penalty floor (no acquire at all) and a minimum spacing between grants
 * (requests trickle out one by one once the floor clears); any successful
 * response resets the streak and decays the spacing.
 */
const RATE_LIMIT_PENALTY_BASE_MS = 15_000;
const RATE_LIMIT_PENALTY_MAX_MS = 180_000;
const ADAPTIVE_SPACING_MAX_MS = 30_000;
const ADAPTIVE_SPACING_STEP_MS = 2_000;
const ADAPTIVE_SPACING_DECAY = 0.6;

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
  private rateLimitStreak = 0;
  private adaptiveSpacingMs = 0;
  private nextGrantAt: number | null = null;

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
      const spacingOk = this.nextGrantAt === null || now >= this.nextGrantAt;
      const rpmOk = this.rpm === undefined || this.window.length < this.rpm;
      const tpmOk = this.tpm === undefined
        || this.windowTokens() + Math.max(0, estimatedTokens) <= this.tpm;
      const concOk = this.inFlight < this.maxConcurrent;
      if (floorOk && spacingOk && rpmOk && tpmOk && concOk) {
        this.window.push({ t: now, tokens: Math.max(0, estimatedTokens) });
        this.inFlight += 1;
        this.totalAcquired += 1;
        if (this.adaptiveSpacingMs > 0) this.nextGrantAt = now + this.adaptiveSpacingMs;
        let released = false;
        return {
          release: () => {
            if (released) return;
            released = true;
            this.inFlight = Math.max(0, this.inFlight - 1);
          },
        };
      }
      const candidates = [
        this.retryAfterUntil !== null && this.retryAfterUntil > now ? this.retryAfterUntil - now : 0,
        this.nextGrantAt !== null && this.nextGrantAt > now ? this.nextGrantAt - now : 0,
        this.tickMs,
      ];
      const wait = Math.max(...candidates);
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

  /**
   * Adaptive 429 governance: every observed rate limit grows a penalty floor
   * (exponential, capped) and doubles the minimum spacing between grants, so
   * waiting workers trickle out one at a time instead of stampeding the
   * moment the floor clears. A provider Retry-After hint extends the floor
   * when it asks for even longer than the streak penalty.
   */
  noteRateLimited(hint?: { retryAfterMs?: number | null }): void {
    this.rateLimitStreak += 1;
    const penaltyMs = Math.min(
      RATE_LIMIT_PENALTY_BASE_MS * 2 ** Math.min(this.rateLimitStreak - 1, 16),
      RATE_LIMIT_PENALTY_MAX_MS,
    );
    const hintedMs = typeof hint?.retryAfterMs === 'number' && hint.retryAfterMs > 0
      ? Math.ceil(hint.retryAfterMs)
      : 0;
    this.noteRetryAfter(Math.max(penaltyMs, hintedMs));
    this.adaptiveSpacingMs = Math.min(
      this.adaptiveSpacingMs * 2 + ADAPTIVE_SPACING_STEP_MS,
      ADAPTIVE_SPACING_MAX_MS,
    );
  }

  /** Any successful response: reset the streak and slowly relax the spacing. */
  noteSuccess(): void {
    this.rateLimitStreak = 0;
    this.adaptiveSpacingMs = this.adaptiveSpacingMs > ADAPTIVE_SPACING_STEP_MS
      ? Math.floor(this.adaptiveSpacingMs * ADAPTIVE_SPACING_DECAY)
      : 0;
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
      rateLimitStreak: this.rateLimitStreak,
      adaptiveSpacingMs: this.adaptiveSpacingMs,
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
