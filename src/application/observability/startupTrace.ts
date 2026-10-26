/**
 * Startup/turn trace ring buffer (startup convergence plan W0).
 *
 * Purpose: turn "feels slow" into data for the convergence acceptance matrix
 * (K1/K3/C-02/C-08/C-14). This module is an in-process, fixed-capacity ring
 * buffer — every write is O(1) with no allocation beyond the entry object, so
 * instrumentation cannot change the timing it measures.
 *
 * Privacy contract (plan §8.8): events carry ONLY enumerated names plus short
 * scalar fields (counts, durations, enum tokens like source:'local'). Never
 * API keys, novel text, prompts, or verbatim player input.
 *
 * Nothing is persisted: not written to saves, backups, or the database. A
 * development build may attach a sink (mobile/src/startupTraceSink) that
 * prints one JSON line per event to the console (logcat).
 */

export type StartupTraceEventName =
  | 'app_boot_begin'
  | 'app_boot_end'
  | 'db_runtime_ready'
  | 'profile_loaded'
  | 'wizard_mounted'
  | 'wizard_goal_ready'
  | 'start_pressed'
  | 'plan_ready'
  | 'adopt_done'
  | 'play_first_render'
  | 'first_action_enabled'
  | 'turn_planner_start'
  | 'turn_planner_end'
  | 'turn_narrator_start'
  | 'turn_narrator_end';

export type StartupTraceFieldValue = number | boolean | string | null;

export interface StartupTraceEntry {
  /** Monotonic sequence; gaps mean the ring wrapped. */
  seq: number;
  /** Wall-clock ms since process start (first record call). */
  t: number;
  name: StartupTraceEventName;
  fields: Readonly<Record<string, StartupTraceFieldValue>>;
}

const CAPACITY = 128;
const MAX_FIELD_STRING = 64;

const ring: StartupTraceEntry[] = new Array(CAPACITY);
let writeIndex = 0;
let seq = 0;
const epochMs = { value: null as number | null };

type StartupTraceSink = (entry: StartupTraceEntry) => void;
let sink: StartupTraceSink | null = null;

function clampString(value: string): string {
  return value.length <= MAX_FIELD_STRING ? value : `${value.slice(0, MAX_FIELD_STRING)}…`;
}

/** Records one event. O(1); never throws; ignores non-scalar field values. */
export function recordStartupEvent(
  name: StartupTraceEventName,
  fields?: Record<string, StartupTraceFieldValue>,
): void {
  if (epochMs.value === null) epochMs.value = Date.now();
  const safeFields: Record<string, StartupTraceFieldValue> = {};
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'number' && Number.isFinite(value)) safeFields[key] = value;
      else if (typeof value === 'boolean' || value === null) safeFields[key] = value;
      else if (typeof value === 'string') safeFields[key] = clampString(value);
    }
  }
  seq += 1;
  const entry: StartupTraceEntry = { seq, t: Date.now() - epochMs.value, name, fields: safeFields };
  ring[writeIndex] = entry;
  writeIndex = (writeIndex + 1) % CAPACITY;
  if (sink) {
    try { sink(entry); } catch { /* a broken sink must never affect timing */ }
  }
}

/** Reads the retained entries in sequence order (oldest retained first). */
export function readStartupTrace(): readonly StartupTraceEntry[] {
  const entries = ring.filter(entry => entry !== undefined) as StartupTraceEntry[];
  entries.sort((a, b) => a.seq - b.seq);
  return entries;
}

/** Clears the ring and restarts the time epoch (test/dev only). */
export function resetStartupTrace(): void {
  ring.fill(undefined as unknown as StartupTraceEntry);
  writeIndex = 0;
  seq = 0;
  epochMs.value = null;
}

/** Attaches a development sink (single-line JSON to logcat in dev builds). */
export function setStartupTraceSink(next: StartupTraceSink | null): void {
  sink = next;
}
