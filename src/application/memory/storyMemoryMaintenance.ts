/**
 * Story-memory maintenance orchestrator (infrastructure plan §29, §68).
 *
 * Return-first: the play loop enqueues this AFTER the turn commits; memory
 * LLM latency never blocks the player, and a maintenance failure marks the
 * branch memory failed WITHOUT throwing into the turn path (no-stall). A
 * hard gap in committed history fails closed for memory too - the worker
 * never summarizes turns it cannot read.
 */

import type { LlmProvider } from '../llm/types';
import { parseStructuredOutput } from '../llm/structuredOutput';
import type { SqliteStoryMemoryStore } from './storyMemoryRepository';
import type { CommittedTurnHistoryEntry } from '../../infra/sqlite/sqliteTurnStore';
import { emptyStoryMemoryState, type StoryMemoryState } from './storyMemoryTypes';
import { validateStoryMemoryPatch } from './storyMemoryValidator';
import { mergeStoryMemoryPatch } from './storyMemoryMerger';
import { compileMemoryCheckpointRequest, compilePreviousMemoryView } from './storyMemoryCompiler';
import {
  evaluateMemoryCadence,
  extractMemorySignals,
  MEMORY_MAX_ATTEMPTS_PER_RUN,
  MEMORY_MAX_BATCH_TURNS,
} from './storyMemoryPolicy';

export interface MemoryCheckpointRunInput {
  provider: LlmProvider;
  store: SqliteStoryMemoryStore;
  turnStore: { listCommittedTurns(branchId: string): Promise<CommittedTurnHistoryEntry[]> };
  branchId: string;
  currentStateVersion: number;
  /** id/name table for actor disambiguation (cards + known actors). */
  actors: ReadonlyArray<{ actorId: string; name: string }>;
  now?: () => string;
  maxBatchTurns?: number;
  maxAttempts?: number;
}

export interface MemoryCheckpointRunResult {
  status: 'clean' | 'skipped' | 'failed' | 'hard_gap';
  throughStateVersion: number;
  appliedPatchIds: string[];
  error?: string;
}

/**
 * Runs at most `maxAttempts` checkpoint batches (default 3 physical LLM
 * requests per run, plan §11.3). Each batch folds <= maxBatchTurns turns.
 */
export async function runStoryMemoryMaintenance(
  input: MemoryCheckpointRunInput,
): Promise<MemoryCheckpointRunResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const maxAttempts = input.maxAttempts ?? MEMORY_MAX_ATTEMPTS_PER_RUN;
  const maxBatchTurns = input.maxBatchTurns ?? MEMORY_MAX_BATCH_TURNS;

  let state = await input.store.getState(input.branchId);
  if (!state) {
    state = emptyStoryMemoryState(input.branchId, now());
    await input.store.saveState(state);
  }

  const result: MemoryCheckpointRunResult = {
    status: 'skipped',
    throughStateVersion: state.throughStateVersion,
    appliedPatchIds: [],
  };

  const allTurns = await input.turnStore.listCommittedTurns(input.branchId);
  const knownActors = new Set<string>([
    ...input.actors.map(actor => actor.actorId),
    ...Object.keys(state.characters),
  ]);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const base = state;
    const pending = allTurns.filter(turn =>
      turn.stateVersion > base.throughStateVersion && turn.stateVersion <= input.currentStateVersion);
    if (pending.length === 0) {
      result.status = 'clean';
      result.throughStateVersion = base.throughStateVersion;
      return result;
    }

    // Hard-gap check: every version after memory coverage must exist.
    const covered = new Set(pending.map(turn => turn.stateVersion));
    const lastPending = pending[pending.length - 1];
    if (!lastPending) break;
    let gap = false;
    for (let v = base.throughStateVersion + 1; v <= lastPending.stateVersion; v += 1) {
      if (!covered.has(v) && v <= input.currentStateVersion) { gap = true; break; }
    }
    if (gap) {
      result.status = 'hard_gap';
      result.error = `Committed history is missing versions after v${base.throughStateVersion}; refusing to summarize an incomplete timeline.`;
      await input.store.markStatus(input.branchId, 'failed', {
        dirtyFromStateVersion: base.throughStateVersion + 1,
        updatedAt: now(),
      });
      return result;
    }

    const batch = pending.slice(0, maxBatchTurns);
    const lastBatchTurn = batch[batch.length - 1];
    if (!lastBatchTurn) break;
    const from = base.throughStateVersion;
    const to = lastBatchTurn.stateVersion;
    const batchTurnIds = new Set(batch.map(turn => turn.turnId));

    const checkpoint = await runSingleCheckpoint({
      provider: input.provider,
      state: base,
      actors: input.actors,
      batch,
      fromStateVersion: from,
      toStateVersion: to,
      allowedActorIds: knownActors,
      branchId: input.branchId,
      store: input.store,
      batchTurnIds,
      now,
      repairRounds: 1,
    });
    if (checkpoint.status !== 'applied') {
      result.status = 'failed';
      result.error = checkpoint.error;
      result.throughStateVersion = base.throughStateVersion;
      await input.store.markStatus(input.branchId, 'failed', {
        dirtyFromStateVersion: from + 1,
        updatedAt: now(),
      });
      return result;
    }
    state = checkpoint.state;
    result.appliedPatchIds.push(checkpoint.patchId);
    result.throughStateVersion = state.throughStateVersion;
    result.status = 'clean';
  }
  return result;
}

interface SingleCheckpointInput {
  provider: LlmProvider;
  state: StoryMemoryState;
  actors: ReadonlyArray<{ actorId: string; name: string }>;
  batch: readonly CommittedTurnHistoryEntry[];
  fromStateVersion: number;
  toStateVersion: number;
  allowedActorIds: ReadonlySet<string>;
  branchId: string;
  store: SqliteStoryMemoryStore;
  batchTurnIds: ReadonlySet<string>;
  now: () => string;
  repairRounds: number;
}

type SingleCheckpointResult =
  | { status: 'applied'; patchId: string; state: StoryMemoryState }
  | { status: 'rejected'; error: string };

async function runSingleCheckpoint(input: SingleCheckpointInput): Promise<SingleCheckpointResult> {
  const patchId = `smp:${input.branchId}:${input.fromStateVersion}-${input.toStateVersion}`;
  const compiled = compileMemoryCheckpointRequest({
    fromStateVersion: input.fromStateVersion,
    toStateVersion: input.toStateVersion,
    actors: input.actors,
    previousMemory: compilePreviousMemoryView(input.state),
    turns: input.batch.map(turn => ({
      turnId: turn.turnId,
      stateVersion: turn.stateVersion,
      publicSummary: turn.publicSummary,
      narrativeText: turn.narrativeText,
      outcomeGrade: turn.outcomeGrade,
      effects: turn.effects ?? [],
    })),
  });

  let repairErrors: string[] | undefined;
  for (let round = 0; round <= input.repairRounds; round += 1) {
    const response = await input.provider.complete({
      role: 'Summarizer',
      system: compiled.system,
      user: repairErrors
        ? compiled.user + `\nYour previous patch was rejected: ${repairErrors.join('; ')}. Return the corrected complete patch only.`
        : compiled.user,
      maxOutputTokens: 1_600,
      jsonMode: true,
      ledger: {
        logicalRequestId: `memory:${input.branchId}:v${input.fromStateVersion}-${input.toStateVersion}`,
        requestKind: 'memory_checkpoint',
        branchId: input.branchId,
        stateVersion: input.toStateVersion,
      },
    });

    let parsed: unknown;
    try {
      parsed = parseStructuredOutput<unknown>(response.text, { label: 'Story memory patch' }).value;
    } catch (error) {
      repairErrors = [error instanceof Error ? error.message : String(error)];
      continue;
    }
    try {
      const patch = validateStoryMemoryPatch(parsed, {
        allowedActorIds: input.allowedActorIds,
        batchTurnIds: input.batchTurnIds,
        expectedFromVersion: input.fromStateVersion,
        expectedToVersion: input.toStateVersion,
      });
      const turnVersions = new Map(input.batch.map(turn => [turn.turnId, turn.stateVersion]));
      const next = mergeStoryMemoryPatch(input.state, {
        patch,
        patchId,
        baseFingerprint: input.state.metadata.fingerprint,
        turnVersions,
        now: input.now(),
      });
      await input.store.insertPatch({
        patchId,
        branchId: input.branchId,
        fromStateVersion: input.fromStateVersion,
        toStateVersion: input.toStateVersion,
        baseFingerprint: input.state.metadata.fingerprint,
        patch,
        createdAt: input.now(),
      });
      await input.store.saveState(next);
      await input.store.markPatchApplied(patchId, next.metadata.fingerprint, input.now());
      return { status: 'applied', patchId, state: next };
    } catch (error) {
      repairErrors = [error instanceof Error ? error.message : String(error)];
    }
  }
  return { status: 'rejected', error: repairErrors?.join('; ') ?? 'unknown' };
}

/**
 * Cadence gate for the play loop: cheap check (no LLM) deciding whether a
 * maintenance run should be enqueued after a committed turn.
 */
export async function shouldRunMaintenance(input: {
  store: SqliteStoryMemoryStore;
  turnStore: { listCommittedTurns(branchId: string): Promise<CommittedTurnHistoryEntry[]> };
  branchId: string;
  currentStateVersion: number;
}): Promise<{ should: boolean; reasons: string[] }> {
  const state = await input.store.getState(input.branchId);
  const turns = await input.turnStore.listCommittedTurns(input.branchId);
  const through = state?.throughStateVersion ?? 0;
  const signals = turns
    .filter(turn => turn.stateVersion > through && turn.stateVersion <= input.currentStateVersion)
    .flatMap(turn => extractMemorySignals({
      stateVersion: turn.stateVersion,
      outcomeGrade: turn.outcomeGrade,
      effects: turn.effects ?? [],
    }));
  const decision = evaluateMemoryCadence({
    currentStateVersion: input.currentStateVersion,
    memoryThroughVersion: through,
    memoryStatus: state?.metadata.status ?? 'empty',
    signals,
  });
  return { should: decision.shouldCheckpoint, reasons: decision.reasons };
}
