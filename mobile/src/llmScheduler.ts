/**
 * Process-wide rate scheduler registry (rate-limit governance 2026-10-01).
 *
 * One GlobalRateScheduler per endpoint+model survives individual build runs
 * and play sessions, so adaptive penalties learned during a build (429
 * streaks -> penalty floor + request spacing) still pace the game loop that
 * runs afterwards, and background stage builds share one budget with
 * foreground turns instead of hammering the account from two sides.
 */
import { GlobalRateScheduler } from '../../src/application/worldBuild/rateScheduler';
import type { ApiProfile } from '../../src/application/llm/types';

const registry = new Map<string, GlobalRateScheduler>();

export function schedulerForProfile(profile: ApiProfile): GlobalRateScheduler {
  const key = `${profile.endpoint}#${profile.model}`;
  let scheduler = registry.get(key);
  if (!scheduler) {
    scheduler = new GlobalRateScheduler({
      rpm: profile.rpm,
      tpm: profile.tpm,
      maxConcurrent: Math.max(1, Math.min(4, profile.concurrency ?? 2)),
    });
    registry.set(key, scheduler);
  }
  return scheduler;
}
