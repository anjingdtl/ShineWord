/** Foreground and Headless consumers share an endpoint bucket, including across models. */
import { GlobalRateScheduler, endpointBucketId } from '../../src/application/worldBuild/rateScheduler';
import type { SchedulerActivity, SchedulerResourceStore } from '../../src/application/worldBuild/rateScheduler';
import type { ApiProfile } from '../../src/application/llm/types';

const registry = new Map<string, GlobalRateScheduler>();
let resourceStore: SchedulerResourceStore | undefined;
let activity: SchedulerActivity = { playing: false };

/** No endpoint query, user info, credential, model, or profile name enters persisted metrics. */
export { endpointBucketId };
/** M0 calls this after database migration and before constructing billable providers. */
export function configureSchedulerPersistence(store: SchedulerResourceStore): void {
  resourceStore = store;
  for (const scheduler of registry.values()) scheduler.setResourceStore(store);
}
export function setSchedulerActivity(next: SchedulerActivity): void {
  activity = { ...next };
  for (const scheduler of registry.values()) scheduler.setActivity(activity);
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
    scheduler.setActivity(activity);
    registry.set(key, scheduler);
  } else scheduler.constrain(limits);
  return scheduler;
}
