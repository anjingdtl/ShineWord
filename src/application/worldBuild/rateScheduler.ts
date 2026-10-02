/** One explicit FIFO/priority queue per endpoint. No caller competes in an acquire loop. */
import { estimateTokens } from './groupPlanner';
import type { RequestPriority } from '../../domain/build/phase6';
import { stableFingerprint } from '../llm/requestPlan';

/** Stable quota identity across models/profiles; URL user info and query are excluded. */
export function endpointBucketId(endpoint: string): string {
  const parsed = new URL(endpoint.trim());
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return `endpoint:${stableFingerprint(parsed.origin.toLowerCase() + path)}`;
}

export interface SchedulerQueueOptions {
  priority?: RequestPriority;
  logicalTaskId?: string;
  requestPlanHash?: string;
  worldId?: string;
  queueDeadlineAt?: string;
  expectedDurationMs?: number;
  signal?: AbortSignal;
}
export interface SchedulerActivity {
  playing: boolean;
  /** At least one frozen current-turn request must fit in this headroom. */
  interactiveTokenReserve?: number;
  /** Concurrency-one: opt in only when a measured short background batch is safe. */
  allowShortBackground?: boolean;
}
export interface RateSchedulerOptions {
  rpm?: number;
  tpm?: number;
  maxConcurrent?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  tickMs?: number;
  agingMs?: number;
  endpointBucketId?: string;
  resourceStore?: SchedulerResourceStore;
}
export interface RateSchedulerStats {
  rpm: number | undefined; tpm: number | undefined; maxConcurrent: number;
  inFlight: number; windowRequests: number; windowTokens: number;
  retryAfterUntil: number | null; totalAcquired: number; totalWaitedMs: number;
  rateLimitStreak: number; adaptiveSpacingMs: number;
  queued: number; backgroundInFlight: number;
  queuedByPriority: Record<RequestPriority, number>;
  playing: boolean; interactiveTokenReserve: number;
}
export interface ResourceReservation {
  id: string; logicalTaskId: string; t: number; tokens: number;
  active: boolean; background: boolean;
  /** Unknown remote outcomes retain their slot through the conservative transport horizon. */
  activeUntil: number;
}
export interface ResourceQueueEntry {
  id: string; logicalTaskId: string; requestPlanHash: string; worldId: string | null;
  priority: RequestPriority; queuedAt: number; heartbeatAt: number;
  deadlineAt: number | null; tokens: number; expectedDurationMs: number | null;
}
/** Resource metadata only: the existing llm_request_attempts remains the billing/outcome owner. */
export interface SchedulerResourceState {
  version: 1;
  rpm: number | null; tpm: number | null; maxConcurrent: number;
  reservations: ResourceReservation[];
  queue: ResourceQueueEntry[];
  retryAfterUntil: number | null; rateLimitStreak: number;
  adaptiveSpacingMs: number; nextGrantAt: number | null;
  playingUntil: number; interactiveTokenReserve: number;
  cancelledWorldIds: string[];
  activities: { owner: string; playingUntil: number; tokenReserve: number }[];
}
export interface SchedulerResourceStore {
  /** Atomic read/modify/write, including admission; implementations must serialize writers. */
  transact<T>(bucketId: string, initial: SchedulerResourceState,
    update: (state: SchedulerResourceState) => T): Promise<{ state: SchedulerResourceState; value: T }>;
}
export interface SchedulerLease {
  readonly reservationId: string;
  /** Idempotent; old callers may ignore the returned persistence completion. */
  release(): Promise<void>;
  /** Settles this specific reservation, independent of response completion order. */
  settle(usage: SchedulerUsage | undefined): Promise<void>;
}
export interface SchedulerUsage { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; estimated?: boolean }
export class SchedulerQueueError extends Error {
  constructor(readonly code: 'cancelled' | 'deadline' | 'quota_infeasible' | 'invalid_metadata', message: string) {
    super(message); this.name = 'SchedulerQueueError';
  }
}
interface Pending {
  entry: ResourceQueueEntry;
  options: SchedulerQueueOptions;
  resolve: (lease: SchedulerLease) => void;
  reject: (error: unknown) => void;
  abort?: () => void;
}
const WINDOW_MS = 60_000;
const QUEUE_HEARTBEAT_MS = 90_000;
const REMOTE_HORIZON_MS = 600_000;
const PRIORITY: Record<RequestPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
let schedulerSerial = 0;
function positive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}
function minLimit(left: number | null, right: number | null): number | null {
  return left === null ? right : right === null ? left : Math.min(left, right);
}
function actualTokens(usage: SchedulerUsage | undefined): number | null {
  if (!usage || usage.estimated || !Number.isFinite(usage.inputTokens) || usage.inputTokens! < 0
    || !Number.isFinite(usage.outputTokens) || usage.outputTokens! < 0) return null;
  // Supported wire adapters report thinking inside output_tokens. Never double count it.
  return Math.ceil(usage.inputTokens!) + Math.ceil(usage.outputTokens!);
}
export class GlobalRateScheduler {
  readonly endpointBucketId: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tickMs: number;
  private readonly agingMs: number;
  private readonly owner = `${Date.now().toString(36)}-${++schedulerSerial}-${Math.random().toString(36).slice(2)}`;
  private serial = 0;
  private state: SchedulerResourceState;
  private readonly pending = new Map<string, Pending>();
  private activity: SchedulerActivity = { playing: false };
  private pumping = false;
  private wake: (() => void) | null = null;
  private mutation: Promise<void> = Promise.resolve();
  private totalAcquired = 0;
  private totalWaitedMs = 0;
  private lastReservationId: string | null = null;
  private persistenceError: unknown = null;

  constructor(private readonly options: RateSchedulerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    this.tickMs = Math.max(10, options.tickMs ?? 100);
    this.agingMs = Math.max(1_000, options.agingMs ?? 120_000);
    this.endpointBucketId = options.endpointBucketId ?? 'local';
    this.state = { version: 1, rpm: positive(options.rpm), tpm: positive(options.tpm),
      maxConcurrent: Math.max(1, Math.min(8, Math.floor(options.maxConcurrent ?? 2))),
      reservations: [], queue: [], retryAfterUntil: null, rateLimitStreak: 0,
      adaptiveSpacingMs: 0, nextGrantAt: null, playingUntil: 0, interactiveTokenReserve: 0,
      cancelledWorldIds: [], activities: [] };
  }
  setResourceStore(store: SchedulerResourceStore): void {
    if (this.options.resourceStore && this.options.resourceStore !== store && this.pending.size > 0) {
      throw new Error('Cannot replace the resource store while requests are queued.');
    }
    this.options.resourceStore = store;
  }
  /** Profiles sharing an endpoint may only tighten limits, never multiply quota. */
  constrain(options: Pick<RateSchedulerOptions, 'rpm' | 'tpm' | 'maxConcurrent'>): void {
    const apply = (state: SchedulerResourceState): void => {
      state.rpm = minLimit(state.rpm, positive(options.rpm));
      state.tpm = minLimit(state.tpm, positive(options.tpm));
      if (options.maxConcurrent !== undefined) state.maxConcurrent = Math.min(state.maxConcurrent,
        Math.max(1, Math.min(8, Math.floor(options.maxConcurrent))));
    };
    apply(this.state); this.backgroundMutation(apply); this.kick();
  }
  setActivity(activity: SchedulerActivity): void {
    if (activity.interactiveTokenReserve !== undefined && (!Number.isFinite(activity.interactiveTokenReserve)
      || activity.interactiveTokenReserve < 0)) throw new SchedulerQueueError('invalid_metadata', 'Invalid interactive token reserve.');
    this.activity = { ...activity };
    const apply = (state: SchedulerResourceState): void => { this.updateActivity(state, this.now()); };
    apply(this.state); this.backgroundMutation(apply); this.kick();
  }
  /** Once a frozen turn request is known, percentage-only headroom is insufficient. */
  reserveInteraction(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens < 0) throw new SchedulerQueueError('invalid_metadata', 'Invalid turn reservation.');
    this.activity.interactiveTokenReserve = Math.max(this.activity.interactiveTokenReserve ?? 0, Math.ceil(tokens));
    const apply = (state: SchedulerResourceState): void => { this.updateActivity(state, this.now()); };
    apply(this.state); this.backgroundMutation(apply); this.kick();
  }
  acquire(estimatedTokens: number, options: SchedulerQueueOptions = {}): Promise<SchedulerLease> {
    if (!Number.isFinite(estimatedTokens) || estimatedTokens < 0 || (options.priority !== undefined && !(options.priority in PRIORITY))) {
      return Promise.reject(new SchedulerQueueError('invalid_metadata', 'Invalid request resource estimate or priority.'));
    }
    const deadlineAt = options.queueDeadlineAt === undefined ? null : Date.parse(options.queueDeadlineAt);
    if (deadlineAt !== null && !Number.isFinite(deadlineAt)) return Promise.reject(new SchedulerQueueError('invalid_metadata', 'Invalid queue deadline.'));
    if (options.signal?.aborted) return Promise.reject(new SchedulerQueueError('cancelled', 'Queued request cancelled before dispatch.'));
    const id = `${this.owner}:${++this.serial}`;
    const entry: ResourceQueueEntry = { id, logicalTaskId: options.logicalTaskId ?? id,
      requestPlanHash: options.requestPlanHash ?? 'legacy', worldId: options.worldId ?? null,
      priority: options.priority ?? 'P1', queuedAt: this.now(), heartbeatAt: this.now(),
      deadlineAt, tokens: Math.ceil(estimatedTokens), expectedDurationMs: options.expectedDurationMs ?? null };
    return new Promise<SchedulerLease>((resolve, reject) => {
      const pending: Pending = { entry, options, resolve, reject };
      if (options.signal) {
        pending.abort = () => { this.cancelId(id); };
        options.signal.addEventListener('abort', pending.abort, { once: true });
      }
      this.pending.set(id, pending); this.kick();
    });
  }
  cancel(logicalTaskId: string): number {
    const matches = [...this.pending.values()].filter(pending => pending.entry.logicalTaskId === logicalTaskId);
    for (const pending of matches) this.cancelId(pending.entry.id);
    return matches.length;
  }
  cancelWorld(worldId: string): number {
    const matches = [...this.pending.values()].filter(pending => pending.entry.worldId === worldId);
    for (const pending of matches) this.cancelId(pending.entry.id);
    // A second JS host sees cancellation in the same resource transaction before dispatch.
    this.backgroundMutation(state => {
      state.queue = state.queue.filter(entry => entry.worldId !== worldId);
      if (!state.cancelledWorldIds.includes(worldId)) state.cancelledWorldIds.push(worldId);
    });
    return matches.length;
  }
  promote(logicalTaskId: string, priority: RequestPriority): number {
    let count = 0;
    for (const pending of this.pending.values()) if (pending.entry.logicalTaskId === logicalTaskId
      && PRIORITY[priority] < PRIORITY[pending.entry.priority]) { pending.entry.priority = priority; count += 1; }
    this.backgroundMutation(state => {
      for (const entry of state.queue) if (entry.logicalTaskId === logicalTaskId && PRIORITY[priority] < PRIORITY[entry.priority]) entry.priority = priority;
    });
    this.kick(); return count;
  }
  /** @deprecated Single-request legacy helper. Concurrent callers must settle their lease. */
  settle(usage: SchedulerUsage | undefined): void {
    const id = this.lastReservationId;
    const actual = actualTokens(usage);
    if (!id || actual === null) return;
    const apply = (state: SchedulerResourceState): void => {
      const entry = state.reservations.find(value => value.id === id); if (entry) entry.tokens = actual;
    };
    apply(this.state); this.backgroundMutation(apply); this.kick();
  }
  noteRetryAfter(ms: number): void {
    const until = this.now() + Math.max(0, Number.isFinite(ms) ? ms : 0);
    const apply = (state: SchedulerResourceState): void => { state.retryAfterUntil = Math.max(state.retryAfterUntil ?? 0, until); };
    apply(this.state); this.backgroundMutation(apply); this.kick();
  }
  noteRateLimited(hint?: { retryAfterMs?: number | null }): void {
    const apply = (state: SchedulerResourceState): void => {
      state.rateLimitStreak += 1;
      const penalty = Math.min(15_000 * 2 ** Math.min(state.rateLimitStreak - 1, 16), 180_000);
      state.retryAfterUntil = Math.max(state.retryAfterUntil ?? 0, this.now() + Math.max(penalty, hint?.retryAfterMs ?? 0));
      state.adaptiveSpacingMs = Math.min(state.adaptiveSpacingMs * 2 + 2_000, 30_000);
    };
    if (this.options.resourceStore) this.backgroundMutation(apply); else apply(this.state);
    this.kick();
  }
  noteSuccess(): void {
    const apply = (state: SchedulerResourceState): void => {
      state.rateLimitStreak = 0;
      state.adaptiveSpacingMs = state.adaptiveSpacingMs > 2_000 ? Math.floor(state.adaptiveSpacingMs * 0.6) : 0;
    };
    if (this.options.resourceStore) this.backgroundMutation(apply); else apply(this.state);
    this.kick();
  }
  /** Lifecycle code can await durable backoff/release; failure closes admission. */
  async flush(): Promise<void> { await this.mutation; if (this.persistenceError) throw this.persistenceError; }
  stats(): RateSchedulerStats {
    this.prune(this.state, this.now());
    const queuedByPriority: Record<RequestPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const pending of this.pending.values()) queuedByPriority[pending.entry.priority] += 1;
    const active = this.state.reservations.filter(entry => entry.active);
    return { rpm: this.state.rpm ?? undefined, tpm: this.state.tpm ?? undefined,
      maxConcurrent: this.state.maxConcurrent, inFlight: active.length,
      windowRequests: this.state.reservations.filter(entry => entry.t > this.now() - WINDOW_MS).length,
      windowTokens: this.tokens(this.state, this.now()), retryAfterUntil: this.state.retryAfterUntil,
      totalAcquired: this.totalAcquired, totalWaitedMs: this.totalWaitedMs,
      rateLimitStreak: this.state.rateLimitStreak, adaptiveSpacingMs: this.state.adaptiveSpacingMs,
      queued: this.pending.size, queuedByPriority, backgroundInFlight: active.filter(entry => entry.background).length,
      playing: this.activity.playing || this.state.playingUntil > this.now(),
      interactiveTokenReserve: this.state.interactiveTokenReserve };
  }
  private cancelId(id: string): void {
    const pending = this.pending.get(id); if (!pending) return;
    this.removePending(pending); pending.reject(new SchedulerQueueError('cancelled', 'Queued request cancelled before dispatch.'));
    this.backgroundMutation(state => { state.queue = state.queue.filter(entry => entry.id !== id); }); this.kick();
  }
  private removePending(pending: Pending): void {
    this.pending.delete(pending.entry.id);
    if (pending.abort) pending.options.signal?.removeEventListener('abort', pending.abort);
  }
  private kick(): void {
    this.wake?.();
    if (this.pumping || this.pending.size === 0) return;
    this.pumping = true;
    // A microtask collects simultaneous enqueue calls before stable arbitration.
    void Promise.resolve().then(() => this.pump()).catch(error => {
      for (const pending of this.pending.values()) { this.removePending(pending); pending.reject(error); }
    }).finally(() => { this.pumping = false; if (this.pending.size > 0) this.kick(); });
  }
  private async mutate<T>(update: (state: SchedulerResourceState) => T): Promise<T> {
    let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    this.mutation = this.mutation.then(async () => {
      if (this.persistenceError) throw this.persistenceError;
      if (this.options.resourceStore) {
        const changed = await this.options.resourceStore.transact(this.endpointBucketId, this.state, update);
        this.state = changed.state; resolve(changed.value);
      } else resolve(update(this.state));
    }).catch(error => { this.persistenceError = error; reject(error); });
    return result;
  }
  private backgroundMutation(update: (state: SchedulerResourceState) => void): void {
    if (!this.options.resourceStore) { update(this.state); return; }
    void this.mutate(update).catch(error => { this.persistenceError = error; this.kick(); });
  }
  private async pump(): Promise<void> {
    while (this.pending.size > 0) {
      const now = this.now();
      for (const pending of [...this.pending.values()]) {
        if (pending.options.signal?.aborted) { this.cancelId(pending.entry.id); continue; }
        if (pending.entry.deadlineAt !== null && pending.entry.deadlineAt <= now) {
          this.removePending(pending); pending.reject(new SchedulerQueueError('deadline', 'Queue deadline elapsed before dispatch.'));
        }
      }
      if (this.pending.size === 0) break;
      const granted = await this.mutate(state => {
        this.prune(state, now);
        state.queue = state.queue.filter(entry => entry.heartbeatAt > now - QUEUE_HEARTBEAT_MS
          && (entry.deadlineAt === null || entry.deadlineAt > now));
        for (const pending of this.pending.values()) {
          if (pending.entry.worldId && state.cancelledWorldIds.includes(pending.entry.worldId)) {
            state.queue = state.queue.filter(entry => entry.id !== pending.entry.id);
            return { rejected: pending.entry.id, granted: null, cancelled: true };
          }
          const prior = state.queue.find(entry => entry.id === pending.entry.id);
          if (prior) { pending.entry.priority = PRIORITY[prior.priority] < PRIORITY[pending.entry.priority] ? prior.priority : pending.entry.priority; }
          pending.entry.heartbeatAt = now;
          state.queue = state.queue.filter(entry => entry.id !== pending.entry.id);
          state.queue.push({ ...pending.entry });
        }
        this.updateActivity(state, now);
        const rank = (entry: ResourceQueueEntry): number => Math.max(entry.priority === 'P0' ? 0 : 1,
          PRIORITY[entry.priority] - Math.floor(Math.max(0, now - entry.queuedAt) / this.agingMs));
        state.queue.sort((left, right) => rank(left) - rank(right) || left.queuedAt - right.queuedAt
          || left.id.localeCompare(right.id, 'en', { numeric: true }));
        // Aging can never turn remote work into P0 or block runnable interaction
        // behind a background request that is waiting for reserved headroom.
        let candidate = state.queue[0];
        if (candidate && PRIORITY[candidate.priority] >= 2 && !this.canGrant(state, candidate, now)) {
          candidate = state.queue.find(entry => PRIORITY[entry.priority] < 2) ?? candidate;
        }
        if (!candidate || !this.pending.has(candidate.id)) return null;
        if (state.tpm !== null && candidate.tokens > state.tpm) {
          state.queue = state.queue.filter(entry => entry.id !== candidate.id);
          return { rejected: candidate.id, granted: null, cancelled: false };
        }
        if (!this.canGrant(state, candidate, now)) return null;
        state.queue = state.queue.filter(entry => entry.id !== candidate.id);
        const reservation: ResourceReservation = { id: candidate.id, logicalTaskId: candidate.logicalTaskId,
          t: now, tokens: candidate.tokens, active: true, background: PRIORITY[candidate.priority] >= 2,
          activeUntil: now + REMOTE_HORIZON_MS };
        state.reservations.push(reservation);
        if (state.adaptiveSpacingMs > 0) state.nextGrantAt = now + state.adaptiveSpacingMs;
        return { rejected: null, granted: reservation, cancelled: false };
      });
      if (granted?.rejected) {
        const pending = this.pending.get(granted.rejected);
        if (pending) {
          this.removePending(pending);
          pending.reject(new SchedulerQueueError(granted.cancelled ? 'cancelled' : 'quota_infeasible',
            granted.cancelled ? 'Project deleted; queued request cancelled.' : 'Request exceeds endpoint TPM; change budget or quota before retry.'));
        }
        continue;
      }
      if (granted?.granted) {
        const pending = this.pending.get(granted.granted.id);
        // Abort during the async admission transaction releases resources and never dispatches.
        if (!pending || pending.options.signal?.aborted) {
          await this.releaseReservation(granted.granted.id); continue;
        }
        this.removePending(pending); this.totalAcquired += 1; this.lastReservationId = granted.granted.id;
        this.totalWaitedMs += Math.max(0, now - pending.entry.queuedAt);
        pending.resolve(this.lease(granted.granted.id)); continue;
      }
      let wake!: () => void;
      const wakePromise = new Promise<void>(resolve => { wake = resolve; }); this.wake = wake;
      const active = this.state.reservations.filter(entry => entry.active).length;
      const candidate = [...this.pending.values()][0]?.entry;
      const hasDeadline = [...this.pending.values()].some(value => value.entry.deadlineAt !== null);
      const activityBlocked = candidate && PRIORITY[candidate.priority] >= 2
        && this.activity.playing && this.state.maxConcurrent === 1
        && (!this.activity.allowShortBackground || candidate.expectedDurationMs === null || candidate.expectedDurationMs > 5_000);
      if (!this.options.resourceStore && !hasDeadline && (active >= this.state.maxConcurrent || activityBlocked)) {
        await wakePromise;
      } else {
        const floor = Math.max(this.state.retryAfterUntil ?? 0, this.state.nextGrantAt ?? 0);
        const waits = [this.tickMs];
        if (floor > now) waits.push(Math.min(floor - now, 30_000));
        const earliest = this.state.reservations.filter(entry => entry.t > now - WINDOW_MS).map(entry => entry.t + WINDOW_MS - now);
        // Other JS hosts cannot signal this queue directly. A single coordinator checks
        // shared admission at tickMs; never sleep a minute merely because a sent row exists.
        const rateBlocked = !this.options.resourceStore && active < this.state.maxConcurrent
          && ((this.state.rpm !== null && earliest.length >= this.state.rpm)
            || (this.state.tpm !== null && this.tokens(this.state, now) + (candidate?.tokens ?? 0) > this.state.tpm));
        if (earliest.length > 0 && rateBlocked) waits.push(Math.min(...earliest, 30_000));
        const deadlines = [...this.pending.values()].map(value => value.entry.deadlineAt).filter((value): value is number => value !== null);
        let wait = Math.max(...waits);
        if (deadlines.length > 0) wait = Math.min(wait, Math.max(1, Math.min(...deadlines) - now));
        if (this.options.sleep) await Promise.race([wakePromise, this.sleep(wait)]);
        else {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([wakePromise, new Promise<void>(resolve => { timer = setTimeout(resolve, wait); })]); }
          finally { if (timer !== undefined) clearTimeout(timer); }
        }
      }
      if (this.wake === wake) this.wake = null;
    }
  }
  private canGrant(state: SchedulerResourceState, candidate: ResourceQueueEntry, now: number): boolean {
    if ((state.retryAfterUntil ?? 0) > now || (state.nextGrantAt ?? 0) > now) return false;
    const active = state.reservations.filter(entry => entry.active);
    if (active.length >= state.maxConcurrent) return false;
    const playing = this.activity.playing || state.playingUntil > now;
    const background = PRIORITY[candidate.priority] >= 2;
    if (playing && background) {
      if (state.maxConcurrent === 1 && (!this.activity.allowShortBackground || candidate.expectedDurationMs === null
        || candidate.expectedDurationMs > 5_000 || state.queue.some(entry => PRIORITY[entry.priority] < 2))) return false;
      if (state.maxConcurrent >= 2 && active.some(entry => entry.background)) return false;
    }
    const count = state.reservations.filter(entry => entry.t > now - WINDOW_MS).length;
    const rpmReserve = playing && background && state.rpm !== null ? Math.max(1, Math.ceil(state.rpm * 0.25)) : 0;
    const tpmReserve = playing && background && state.tpm !== null
      ? Math.max(Math.ceil(state.tpm * 0.25), state.interactiveTokenReserve) : 0;
    return (state.rpm === null || count + 1 <= state.rpm - rpmReserve)
      && (state.tpm === null || this.tokens(state, now) + candidate.tokens <= state.tpm - tpmReserve);
  }
  private lease(id: string): SchedulerLease {
    let released = false;
    return { reservationId: id,
      release: async () => { if (released) return; released = true; await this.releaseReservation(id); },
      settle: async usage => {
        const actual = actualTokens(usage); if (actual === null) return;
        await this.mutate(state => { const entry = state.reservations.find(value => value.id === id); if (entry) entry.tokens = actual; });
        this.kick();
      } };
  }
  private async releaseReservation(id: string): Promise<void> {
    const entry = this.state.reservations.find(value => value.id === id); if (entry) entry.active = false;
    await this.mutate(state => { const value = state.reservations.find(candidate => candidate.id === id); if (value) value.active = false; });
    this.kick();
  }
  private tokens(state: SchedulerResourceState, now: number): number {
    // Sent requests whose response is unknown keep their estimate even after their initial minute.
    return state.reservations.reduce((sum, entry) => sum + (entry.active || entry.t > now - WINDOW_MS ? entry.tokens : 0), 0);
  }
  private updateActivity(state: SchedulerResourceState, now: number): void {
    state.activities = state.activities.filter(value => value.owner !== this.owner && value.playingUntil > now);
    if (this.activity.playing) state.activities.push({ owner: this.owner,
      playingUntil: now + QUEUE_HEARTBEAT_MS, tokenReserve: Math.ceil(this.activity.interactiveTokenReserve ?? 0) });
    state.playingUntil = state.activities.reduce((until, value) => Math.max(until, value.playingUntil), 0);
    state.interactiveTokenReserve = state.activities.reduce((tokens, value) => Math.max(tokens, value.tokenReserve), 0);
  }
  private prune(state: SchedulerResourceState, now: number): void {
    for (const entry of state.reservations) if (entry.activeUntil <= now) entry.active = false;
    state.reservations = state.reservations.filter(entry => entry.active || entry.t > now - WINDOW_MS);
    if (state.retryAfterUntil !== null && state.retryAfterUntil <= now) state.retryAfterUntil = null;
  }
}
/** maxOutputTokens already includes the reasoning reserve; do not add it twice. */
export function estimateRequestTokens(input: { system: string; user: string;
  followUpUserMessages?: readonly string[]; maxOutputTokens: number }): number {
  return estimateTokens(input.system + input.user + (input.followUpUserMessages ?? []).join('')) + input.maxOutputTokens;
}
