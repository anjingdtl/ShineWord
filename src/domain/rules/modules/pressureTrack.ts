/**
 * pressure_track module (P8-7, plan §6.3): the one NEW optional mechanism of
 * this phase. A bounded local tension/pressure track with explicit raise,
 * relief and threshold triggers — proving a module can plug into the shared
 * reducer, snapshot persistence, fork and save without any special path.
 *
 * Owns exclusively: `pressureTracks` on GameStateSnapshot. World
 * configurations without `pressure_track` enabled get NO pressure entry
 * points (the capability closure refuses any definition that references it).
 */

import type { GameStateSnapshot } from '../../state/types';

export const PRESSURE_TRACK_STATE_SCHEMA_VERSION = 1;

export interface PressureTrackState {
  level: number;
  maxLevel: number;
  /** Version at which the track last changed (audit only). */
  lastChangedStateVersion?: number;
}

export function ensurePressureTrack(
  state: GameStateSnapshot,
  trackId: string,
  maxLevel: number,
): PressureTrackState {
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 10) {
    throw new Error(`pressure_track: maxLevel must be an integer in [1, 10], got ${maxLevel}.`);
  }
  state.pressureTracks = state.pressureTracks ?? {};
  const existing = state.pressureTracks[trackId];
  if (existing) {
    existing.maxLevel = maxLevel;
    return existing;
  }
  const created: PressureTrackState = { level: 0, maxLevel };
  state.pressureTracks[trackId] = created;
  return created;
}

export function pressureLevel(state: GameStateSnapshot, trackId: string): number {
  return state.pressureTracks?.[trackId]?.level ?? 0;
}

/** True exactly when this raise crosses the threshold (not while above it). */
export function pressureThresholdReached(
  state: GameStateSnapshot,
  trackId: string,
  threshold: number,
): boolean {
  const track = state.pressureTracks?.[trackId];
  if (!track) return false;
  return track.level >= threshold;
}

/**
 * Shared-reducer contribution: raise/relief clamp into [0, maxLevel]. The
 * module never writes outside its owned field and never draws randomness.
 */
export function applyPressureChange(
  state: GameStateSnapshot,
  trackId: string,
  delta: number,
  stateVersion: number,
): { applied: number; crossedMax: boolean } {
  const track = state.pressureTracks?.[trackId];
  if (!track) {
    throw new Error(`pressure_track: unknown track '${trackId}'; the world configuration must enable pressure_track.`);
  }
  const before = track.level;
  const applied = Math.max(0, Math.min(track.maxLevel, before + delta)) - before;
  track.level = before + applied;
  track.lastChangedStateVersion = stateVersion;
  return { applied, crossedMax: track.level === track.maxLevel };
}
