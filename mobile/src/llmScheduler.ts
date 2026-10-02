/** Foreground and Headless consumers share an endpoint bucket, including across models. */
import { GlobalRateScheduler, endpointBucketId } from '../../src/application/worldBuild/rateScheduler';
import type { SchedulerActivity, SchedulerResourceState, SchedulerResourceStore } from '../../src/application/worldBuild/rateScheduler';
import type { ApiProfile } from '../../src/application/llm/types';

const registry = new Map<string, GlobalRateScheduler>();
let resourceStore: SchedulerResourceStore | undefined;
let activity: SchedulerActivity = { playing: false };
let playScreenCount = 0;
export function setPlayScreenActivity(active: boolean): void {
  playScreenCount = Math.max(0, playScreenCount + (active ? 1 : -1));
  for (const scheduler of registry.values()) scheduler.setActivity({ ...activity, playing: activity.playing || playScreenCount > 0 });
}

/** No endpoint query, user info, credential, model, or profile name enters persisted metrics. */
export { endpointBucketId };
/** M0 calls this after database migration and before constructing billable providers. */
export function configureSchedulerPersistence(store: SchedulerResourceStore): void {
  resourceStore = store;
  for (const scheduler of registry.values()) scheduler.setResourceStore(store);
}
export function setSchedulerActivity(next: SchedulerActivity): void {
  activity = { ...next };
  for (const scheduler of registry.values()) scheduler.setActivity({ ...activity, playing: activity.playing || playScreenCount > 0 });
}
export function cancelQueuedWorldRequests(worldId: string): void {
  for (const scheduler of registry.values()) scheduler.cancelWorld(worldId);
}
export function schedulerForProfile(profile: ApiProfile): GlobalRateScheduler {
  const key = endpointBucketId(profile.endpoint);
  const limits = { rpm: profile.rpm, tpm: profile.tpm,
    maxConcurrent: Math.max(1, Math.min(4, profile.concurrency ?? 2)) };
  let scheduler = registry.get(key);
  if (!scheduler) {
    scheduler = new GlobalRateScheduler({ ...limits, endpointBucketId: key, resourceStore });
    scheduler.setActivity({ ...activity, playing: activity.playing || playScreenCount > 0 });
    registry.set(key, scheduler);
  } else scheduler.constrain(limits);
  return scheduler;
}

export interface SegmentSchedulingAdmission {
  /** Hard quota feasibility, even after the current window clears. */
  requestFeasible: boolean;
  /** Advisory only; physical requests still acquire the unified queue lease. */
  backgroundBudgetAvailable: boolean;
  higherPriorityPending: boolean;
  retryAfterUntil: number | null;
}

/** Reads the same endpoint bucket used by foreground and Headless requests. */
export async function readSegmentSchedulingAdmission(
  profile: ApiProfile, estimatedRequestTokens: number, now = Date.now(),
): Promise<SegmentSchedulingAdmission> {
  if (!Number.isFinite(estimatedRequestTokens) || estimatedRequestTokens < 0) throw new Error('invalid_segment_request_estimate');
  const scheduler = schedulerForProfile(profile);
  await scheduler.flush();
  const stats = scheduler.stats();
  let state: SchedulerResourceState | null = null;
  if (resourceStore) {
    const initial: SchedulerResourceState = { version: 1, rpm: stats.rpm ?? null, tpm: stats.tpm ?? null,
      maxConcurrent: stats.maxConcurrent, reservations: [], queue: [], retryAfterUntil: null,
      rateLimitStreak: 0, adaptiveSpacingMs: 0, nextGrantAt: null, playingUntil: 0,
      interactiveTokenReserve: 0, cancelledWorldIds: [], activities: [] };
    // M6's resource-store transaction is the only resource metadata writer.
    // This snapshot grants no slot and creates no second budget/ledger.
    state = (await resourceStore.transact(scheduler.endpointBucketId, initial, () => undefined)).state;
  }
  const active = state?.reservations.filter(r => r.active && r.activeUntil > now) ?? [];
  const windowRequests = state ? state.reservations.filter(r => r.t > now - 60_000).length : stats.windowRequests;
  const windowTokens = state ? state.reservations.reduce((sum, r) => sum
    + (r.active && r.activeUntil > now || r.t > now - 60_000 ? r.tokens : 0), 0) : stats.windowTokens;
  const queued = state?.queue.filter(q => q.heartbeatAt > now - 90_000
    && (q.deadlineAt === null || q.deadlineAt > now)) ?? [];
  const higherPriorityPending = stats.queuedByPriority.P0 > 0 || stats.queuedByPriority.P1 > 0
    || queued.some(q => q.priority === 'P0' || q.priority === 'P1')
    || (state ? active.some(r => !r.background) : stats.inFlight > stats.backgroundInFlight);
  const playing = stats.playing || Boolean(state && state.playingUntil > now);
  const rpm = state?.rpm ?? stats.rpm;
  const tpm = state?.tpm ?? stats.tpm;
  const concurrency = state?.maxConcurrent ?? stats.maxConcurrent;
  const tokenReserve = playing && tpm != null
    ? Math.max(Math.ceil(tpm * 0.25), state?.interactiveTokenReserve ?? stats.interactiveTokenReserve) : 0;
  const requestReserve = playing && rpm != null ? Math.max(1, Math.ceil(rpm * 0.25)) : 0;
  const retryAfterUntil = state?.retryAfterUntil ?? stats.retryAfterUntil;
  const requestFeasible = tpm == null || estimatedRequestTokens <= tpm;
  return { requestFeasible, higherPriorityPending, retryAfterUntil,
    backgroundBudgetAvailable: requestFeasible && !higherPriorityPending
      && (retryAfterUntil === null || retryAfterUntil <= now)
      && (!state?.nextGrantAt || state.nextGrantAt <= now)
      && (state ? active.length : stats.inFlight) < concurrency
      && !(playing && concurrency === 1)
      && (!playing || !active.some(r => r.background))
      && (rpm == null || windowRequests + 1 <= rpm - requestReserve)
      && (tpm == null || windowTokens + Math.ceil(estimatedRequestTokens) <= tpm - tokenReserve) };
}
