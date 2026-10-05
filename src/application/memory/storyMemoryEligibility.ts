/**
 * Checkpoint eligibility (P8-1, plan §14.2): a discriminating verdict —
 * either a usable checkpoint with its coverage manifest, or a rejection code
 * with diagnostics. A rejected verdict never exposes a memory body, so a
 * caller cannot accidentally consume an unusable checkpoint (plan B03/B04).
 */

import type { StoryMemoryState } from './storyMemoryTypes';
import { STORY_MEMORY_SCHEMA_VERSION, storyMemoryContentHash } from './storyMemoryTypes';

export type CheckpointRejectionCode =
  | 'no_checkpoint'
  | 'schema_mismatch'
  | 'status_not_consumable'
  | 'branch_mismatch'
  | 'future_evidence'
  | 'fingerprint_invalid'
  | 'dirty_state'
  | 'coverage_gap';

export interface CoverageManifestEntry {
  stateVersion: number;
  turnId: string | null;
  status: 'checkpoint' | 'pending_bridge' | 'gap';
}

export interface CoverageManifest {
  /** Highest committed version the checkpoint itself covers. */
  throughStateVersion: number;
  /** Current branch head the eligibility was evaluated against. */
  currentStateVersion: number;
  /** Per-commit coverage of (through, current]. */
  entries: readonly CoverageManifestEntry[];
  /** True when every version in (through, current] maps to a real commit. */
  contiguous: boolean;
}

export type CheckpointEligibility =
  | { usable: true; checkpoint: StoryMemoryState; coverage: CoverageManifest }
  | { usable: false; code: CheckpointRejectionCode; diagnostics: string[] };

export interface EvaluateCheckpointEligibilityInput {
  memoryState: StoryMemoryState | null;
  branchId: string;
  currentStateVersion: number;
  /** schemaVersion the runtime currently registers (story-memory contract). */
  expectedSchemaVersion?: number;
  /** Committed turn ids by state version, used to prove (through, current] coverage. */
  committedTurnVersions?: ReadonlyArray<{ turnId: string; stateVersion: number }>;
}

const CONSUMABLE_STATUSES: ReadonlyArray<StoryMemoryState['metadata']['status']> = ['clean'];

export function buildCoverageManifest(input: {
  throughStateVersion: number;
  currentStateVersion: number;
  committedTurnVersions: ReadonlyArray<{ turnId: string; stateVersion: number }>;
}): CoverageManifest {
  const byVersion = new Map<number, string>();
  for (const commit of input.committedTurnVersions) {
    if (!byVersion.has(commit.stateVersion)) byVersion.set(commit.stateVersion, commit.turnId);
  }
  const entries: CoverageManifestEntry[] = [];
  let contiguous = true;
  for (let version = input.throughStateVersion + 1; version <= input.currentStateVersion; version += 1) {
    const turnId = byVersion.get(version) ?? null;
    if (turnId === null) contiguous = false;
    entries.push({ stateVersion: version, turnId, status: turnId === null ? 'gap' : 'pending_bridge' });
  }
  return {
    throughStateVersion: input.throughStateVersion,
    currentStateVersion: input.currentStateVersion,
    entries,
    contiguous,
  };
}

export function evaluateCheckpointEligibility(
  input: EvaluateCheckpointEligibilityInput,
): CheckpointEligibility {
  const { memoryState, branchId, currentStateVersion } = input;
  if (!Number.isSafeInteger(currentStateVersion) || currentStateVersion < 0) {
    return { usable: false, code: 'coverage_gap', diagnostics: ['invalid current state version'] };
  }
  if (!memoryState) {
    return { usable: false, code: 'no_checkpoint', diagnostics: ['branch has no story memory checkpoint yet'] };
  }
  if (!Number.isSafeInteger(memoryState.throughStateVersion) || memoryState.throughStateVersion < 0) {
    return { usable: false, code: 'coverage_gap', diagnostics: ['invalid checkpoint coverage version'] };
  }
  const expectedSchema = input.expectedSchemaVersion ?? STORY_MEMORY_SCHEMA_VERSION;
  if (memoryState.schemaVersion !== expectedSchema) {
    return {
      usable: false,
      code: 'schema_mismatch',
      diagnostics: [`checkpoint schemaVersion ${memoryState.schemaVersion} != registered ${expectedSchema}`],
    };
  }
  if (memoryState.branchId !== branchId) {
    return {
      usable: false,
      code: 'branch_mismatch',
      diagnostics: [`checkpoint branch ${memoryState.branchId} != requested ${branchId}`],
    };
  }
  if (!CONSUMABLE_STATUSES.includes(memoryState.metadata.status)) {
    return {
      usable: false,
      code: 'status_not_consumable',
      diagnostics: [`checkpoint status ${memoryState.metadata.status} is not consumable`],
    };
  }
  if (memoryState.throughStateVersion > currentStateVersion) {
    return {
      usable: false,
      code: 'future_evidence',
      diagnostics: [
        `checkpoint throughStateVersion ${memoryState.throughStateVersion} is ahead of branch state ${currentStateVersion}; future evidence must not enter the current request`,
      ],
    };
  }
  if (memoryState.metadata.status === 'clean' && memoryState.metadata.dirtyFromStateVersion !== null) {
    return { usable: false, code: 'dirty_state', diagnostics: ['clean checkpoint still carries dirtyFromStateVersion'] };
  }
  const fingerprint = memoryState.metadata.fingerprint;
  if (!fingerprint || fingerprint === 'seed') {
    return { usable: false, code: 'fingerprint_invalid', diagnostics: ['clean checkpoint lacks a chained fingerprint'] };
  }
  if (memoryState.metadata.contentHash
    && memoryState.metadata.contentHash !== storyMemoryContentHash(memoryState)) {
    return { usable: false, code: 'fingerprint_invalid', diagnostics: ['checkpoint content hash mismatch'] };
  }
  const coverage = buildCoverageManifest({
    throughStateVersion: memoryState.throughStateVersion,
    currentStateVersion,
    committedTurnVersions: input.committedTurnVersions ?? [],
  });
  if (input.committedTurnVersions && !coverage.contiguous) {
    return {
      usable: false,
      code: 'coverage_gap',
      diagnostics: ['uncovered commits are missing from the committed-turn history'],
    };
  }
  return { usable: true, checkpoint: memoryState, coverage };
}
