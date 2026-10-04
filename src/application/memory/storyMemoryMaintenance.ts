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
import {
  REASONING_ONLY_RESERVE_MULTIPLIER,
  type ReasoningPolicySelection,
} from '../llm/reasoningPolicy';
import type { FrozenModelCapabilities } from '../llm/requestPlan';
import { BudgetInfeasibleError } from '../llm/requestPlan';
import { DEFAULT_OUTPUT_DEMANDS, planLlmRequest } from '../llm/requestBudgetKernel';
import { classifyLlmFailure } from '../llm/requestLedger';
import { parseStructuredOutput } from '../llm/structuredOutput';
import { estimateTokens } from '../context/tokenEstimate';
import type { SqliteStoryMemoryStore } from './storyMemoryRepository';
import type { CommittedTurnHistoryEntry } from '../../infra/sqlite/sqliteTurnStore';
import { emptyStoryMemoryState, type StoryMemoryState } from './storyMemoryTypes';
import { validateStoryMemoryPatch } from './storyMemoryValidator';
import { mergeStoryMemoryPatch } from './storyMemoryMerger';
import { compileObservations, type ObservationEvidence } from './storyMemoryObservationCompiler';
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
  capabilities: FrozenModelCapabilities;
  reasoningPolicy: ReasoningPolicySelection;
}

export interface MemoryCheckpointRunResult {
  status: 'clean' | 'partial' | 'skipped' | 'failed' | 'hard_gap';
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

    let batchSize = Math.min(maxBatchTurns, pending.length);
    let batch: CommittedTurnHistoryEntry[] = [];
    let checkpoint: SingleCheckpointResult | undefined;
    while (batchSize > 0) {
      batch = pending.slice(0, batchSize);
      const lastBatchTurn = batch[batch.length - 1];
      if (!lastBatchTurn) break;
      const from = base.throughStateVersion;
      const to = lastBatchTurn.stateVersion;
      checkpoint = await runSingleCheckpoint({
        provider: input.provider,
        state: base,
        actors: input.actors,
        batch,
        fromStateVersion: from,
        toStateVersion: to,
        allowedActorIds: knownActors,
        branchId: input.branchId,
        store: input.store,
        batchTurnIds: new Set(batch.map(turn => turn.turnId)),
        now,
        repairRounds: 1,
        capabilities: input.capabilities,
        reasoningPolicy: input.reasoningPolicy,
      });
      if (checkpoint.status !== 'too_large' || batchSize === 1) break;
      batchSize = Math.max(1, Math.floor(batchSize / 2));
    }
    if (!checkpoint || checkpoint.status === 'too_large') {
      result.status = 'failed';
      result.error = checkpoint?.error ?? 'Story memory batch could not be planned.';
      result.throughStateVersion = base.throughStateVersion;
      await input.store.markStatus(input.branchId, 'failed', {
        dirtyFromStateVersion: base.throughStateVersion + 1,
        updatedAt: now(),
      });
      return result;
    }
    if (checkpoint.status !== 'applied') {
      result.status = 'failed';
      result.error = checkpoint.error;
      result.throughStateVersion = base.throughStateVersion;
      await input.store.markStatus(input.branchId, 'failed', {
        dirtyFromStateVersion: base.throughStateVersion + 1,
        updatedAt: now(),
      });
      return result;
    }
    state = checkpoint.state;
    result.appliedPatchIds.push(checkpoint.patchId);
    result.throughStateVersion = state.throughStateVersion;
    result.status = 'clean';
  }
  if (result.status === 'clean' && allTurns.some(turn =>
    turn.stateVersion > state.throughStateVersion && turn.stateVersion <= input.currentStateVersion)) {
    result.status = 'partial';
    result.error = `Memory checkpoint request cap reached; coverage is current through v${state.throughStateVersion}.`;
  }
  result.throughStateVersion = state.throughStateVersion;
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
  capabilities: FrozenModelCapabilities;
  reasoningPolicy: ReasoningPolicySelection;
}

type SingleCheckpointResult =
  | { status: 'applied'; patchId: string; state: StoryMemoryState }
  | { status: 'too_large'; error: string }
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
    const requestKind = repairErrors ? 'memory_repair' as const : 'memory_checkpoint' as const;
    const user = repairErrors
      ? compiled.user + `\nYour previous patch was rejected: ${repairErrors.join('; ')}. Return the corrected complete patch only.`
      : compiled.user;
    const planRequest = (reasoningPolicy: ReasoningPolicySelection) => planLlmRequest({
        capabilities: input.capabilities,
        requestKind,
        estimatedMandatoryInputTokens: estimateTokens(compiled.system) + 96,
        businessOutputDemand: DEFAULT_OUTPUT_DEMANDS[requestKind],
        contextDemands: [{
          id: 'story-memory-request', board: 'storyMemory', requirement: 'mandatory',
          priority: 100, relevance: 1,
          estimatedTokens: estimateTokens(user), minTokens: estimateTokens(user),
          targetTokens: estimateTokens(user), clipMode: 'whole_item',
        }],
        reasoningPolicy,
      });
    let plan;
    try {
      plan = planRequest(input.reasoningPolicy);
    } catch (error) {
      if (round === 0 && error instanceof BudgetInfeasibleError) {
        return { status: 'too_large', error: error.message };
      }
      return { status: 'rejected', error: error instanceof Error ? error.message : String(error) };
    }

    const makeRequest = (outputPlan: typeof plan) => ({
      role: 'Summarizer' as const,
      system: compiled.system,
      user,
      maxOutputTokens: outputPlan.wireOutputTokens,
      maxPhysicalRequests: 1,
      jsonMode: true,
      reasoningTier: outputPlan.reasoningPolicy?.tier,
      reasoningReserveTokens: outputPlan.reasoningPolicy?.reserveTokens,
      reasoningPolicyVersion: outputPlan.reasoningPolicy?.policyVersion,
      requestKind,
      ledger: {
        logicalRequestId: `memory:${input.branchId}:v${input.fromStateVersion}-${input.toStateVersion}`,
        requestKind,
        branchId: input.branchId,
        stateVersion: input.toStateVersion,
      },
    });

    let response;
    try {
      response = await input.provider.complete(makeRequest(plan));
    } catch (error) {
      if (classifyLlmFailure(error) !== 'reasoning_only') {
        return { status: 'rejected', error: error instanceof Error ? error.message : String(error) };
      }
      let boostedPlan;
      try {
        boostedPlan = planRequest({
          ...input.reasoningPolicy,
          reserveMultiplier: REASONING_ONLY_RESERVE_MULTIPLIER,
        });
      } catch (retryError) {
        if (round === 0 && retryError instanceof BudgetInfeasibleError) {
          return { status: 'too_large', error: retryError.message };
        }
        return { status: 'rejected', error: retryError instanceof Error ? retryError.message : String(retryError) };
      }
      if ((boostedPlan.reasoningPolicy?.reserveTokens ?? 0) <= (plan.reasoningPolicy?.reserveTokens ?? 0)) {
        return { status: 'rejected', error: 'Reasoning-only retry cannot increase the reserve within the declared capability ceiling.' };
      }
      try {
        response = await input.provider.complete(makeRequest(boostedPlan));
      } catch (retryError) {
        return { status: 'rejected', error: retryError instanceof Error ? retryError.message : String(retryError) };
      }
    }

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
      // P8-5 observation gate (plan §15.2): the raw model output is compiled
      // against the exact committed batch evidence. Empty observations on a
      // batch with deterministic known changes, unknown evidence refs and
      // invalid actions all route into the SAME bounded repair round instead
      // of advancing a clean checkpoint on a fake success (T11/A23).
      const evidence: ObservationEvidence[] = [];
      for (const turn of input.batch) {
        // The committed turn itself is evidence (plan §15.1) even when the
        // turn carried no structured effects.
        evidence.push({
          eventId: `${turn.turnId}:turn`,
          turnId: turn.turnId,
          stateVersion: turn.stateVersion,
          eventType: 'committed_turn',
          payload: { outcomeGrade: turn.outcomeGrade ?? null },
          publicSummary: turn.publicSummary ?? '',
        });
        const effects = turn.effects ?? [];
        effects.forEach((effect, index) => {
          evidence.push({
            eventId: `${turn.turnId}:e${index}`,
            turnId: turn.turnId,
            stateVersion: turn.stateVersion,
            eventType: String((effect as { op?: string }).op ?? ''),
            payload: effect as Record<string, unknown>,
            publicSummary: turn.publicSummary ?? '',
          });
        });
      }
      const compiled = compileObservations({
        branchId: input.branchId,
        evidence,
        rawObservationText: response.text,
        knownChangePolicy: { requireKnownChangeCoverage: true },
      });
      if (!compiled.accepted) {
        repairErrors = compiled.diagnostics.map(d => `${d.code}: ${d.detail}`)
          .concat(compiled.rejected.flatMap(item => item.diagnostics.map(d => `${d.code}: ${d.detail}`)));
        continue;
      }
      const turnVersions = new Map(input.batch.map(turn => [turn.turnId, turn.stateVersion]));
      const next = mergeStoryMemoryPatch(input.state, {
        patch,
        patchId,
        baseFingerprint: input.state.metadata.fingerprint,
        turnVersions,
        now: input.now(),
      });
      // P8-5 atomic application (B09): patch row + CAS state write + applied
      // marker in ONE transaction — no three-step non-atomic persistence.
      await input.store.applyCheckpointAtomically({
        patchRow: {
          patchId,
          fromStateVersion: input.fromStateVersion,
          toStateVersion: input.toStateVersion,
          baseFingerprint: input.state.metadata.fingerprint,
          patch,
        },
        nextState: next,
      });
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
