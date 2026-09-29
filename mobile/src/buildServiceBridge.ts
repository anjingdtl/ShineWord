/**
 * Bridge to the world-build foreground service (closeout C5).
 */
import { NativeModules } from 'react-native';

interface WorldBuildServiceNative {
  startService(runId: string): Promise<boolean>;
  stopService(): Promise<boolean>;
  notifyBuildProgress(runId: string, done: number, total: number): Promise<boolean>;
  requestRunControl(runId: string, kind: 'pause' | 'cancel' | 'resume'): Promise<boolean>;
}

function native(): WorldBuildServiceNative | null {
  return (NativeModules.WorldBuildService as WorldBuildServiceNative | undefined) ?? null;
}

/** Enters foreground + wakes the headless runner for this run. */
export async function startBuildService(runId: string): Promise<boolean> {
  const module = native();
  if (!module) return false;
  try {
    return await module.startService(runId);
  } catch {
    return false;
  }
}

export async function stopBuildService(): Promise<void> {
  try {
    await native()?.stopService();
  } catch {
    // Stopping is best-effort; the lease gates correctness, not the service.
  }
}

/** Refreshes the persistent notification's real counters. */
export async function notifyBuildProgress(runId: string, done: number, total: number): Promise<boolean> {
  const module = native();
  if (!module) return false;
  try {
    return await module.notifyBuildProgress(runId, done, total);
  } catch {
    return false;
  }
}

/**
 * Native control channel (unified P4): notification actions and the UI share
 * one persisted pause/cancel flag that the coordinator polls between units.
 */
export async function requestRunControl(runId: string, kind: 'pause' | 'cancel' | 'resume'): Promise<boolean> {
  const module = native();
  if (!module?.requestRunControl) return false;
  try {
    return await module.requestRunControl(runId, kind);
  } catch {
    return false;
  }
}
