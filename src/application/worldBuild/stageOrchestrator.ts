/**
 * Stage build orchestration (unified build P3): persistent 30/30/40 plans,
 * trigger claiming with dedupe, scope-restricted extraction runs, and
 * cumulative stage package publication. Both build modes share the same
 * extraction -> evidence -> mapping -> three-books publish pipeline (P2);
 * only the SCHEDULE differs: full builds every stage up front, progressive
 * builds S1 first and later stages only on narrative triggers.
 */
import type { SqliteDatabase } from '../ports/sqlite';
import type { SourceStore } from '../ports/sourceStore';
import type { WorldStore } from '../ports/worldStore';
import type { BuildRunStore, BuildRunRecord } from '../ports/worldBuildStore';
import type { SqliteStagePlanStore } from '../../infra/sqlite/sqliteStagePlanStore';
import {
  computeStagePlan,
  evaluateStageTriggers,
  type StagePlan,
  type StageStatus,
} from './stagePlan';
import { createExtractionRun } from './coordinator';
import type { FrozenRunConfig } from './runConfig';
import type { ModelBudget } from './groupPlanner';

export interface StageOrchestratorDeps {
  db: SqliteDatabase;
  stageStore: SqliteStagePlanStore;
  runStore: BuildRunStore;
  sourceStore: SourceStore;
  worldStore: WorldStore;
  sha256Hex(input: string): Promise<string> | string;
  now?: () => string;
}

export interface StageRunTemplate {
  extractorVersion: string;
  modelFingerprint: string;
  budget?: ModelBudget;
  config?: FrozenRunConfig;
  mode?: 'chunk' | 'group' | 'resident';
  routes?: 'single' | 'dual';
}

/** Creates (once per world) the persistent stage plan for a source. */
export async function ensureStagePlan(
  deps: StageOrchestratorDeps,
  input: {
    worldId: string;
    sourceId: string;
    strategy: 'full' | 'progressive';
    configFingerprint: string;
  },
): Promise<{ planId: string; plan: StagePlan }> {
  const existing = await deps.stageStore.getStagePlanByWorld(input.worldId);
  if (existing && existing.sourceId === input.sourceId) {
    return { planId: existing.planId, plan: rehydratePlan(existing.stages, existing.strategy) };
  }
  const manifest = await deps.sourceStore.getManifest(input.sourceId);
  if (!manifest || manifest.status !== 'active') {
    throw new Error(`Source ${input.sourceId} is not active.`);
  }
  const chapters = await deps.sourceStore.getChapters(input.sourceId);
  const plan = computeStagePlan(chapters, manifest.codePointCount, { strategy: input.strategy });
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const planId = `stage-${input.worldId}`;
  await deps.stageStore.createStagePlan({
    planId, worldId: input.worldId, sourceId: input.sourceId,
    sourceHash: manifest.rawSha256Hex, plan,
    configFingerprint: input.configFingerprint, now,
  });
  return { planId, plan };
}

function rehydratePlan(stages: StagePlan['stages'], strategy: 'full' | 'progressive'): StagePlan {
  return {
    planVersion: 'stage-plan-1' as const,
    strategy,
    codePointCount: stages[stages.length - 1]?.endCp ?? 0,
    stages,
  };
}

/**
 * Queues stage S1 (progressive) or every stage (full) without waiting for
 * triggers. Returns the created run ids per stage.
 */
export async function queueInitialStages(
  deps: StageOrchestratorDeps,
  input: {
    worldId: string;
    title: string;
    template: StageRunTemplate;
  },
): Promise<Array<{ stageIndex: number; runId: string }>> {
  const existing = await deps.stageStore.getStagePlanByWorld(input.worldId);
  if (!existing) throw new Error(`No stage plan for world ${input.worldId}.`);
  const queued: Array<{ stageIndex: number; runId: string }> = [];
  const now = (deps.now ?? (() => new Date().toISOString()))();
  for (const stage of existing.stages) {
    const strategyWants = existing.strategy === 'full' || stage.index === 0;
    if (!strategyWants) continue;
    const claimed = await deps.stageStore.claimStageTrigger({
      planId: existing.planId,
      stageIndex: stage.index,
      reason: existing.strategy === 'full' ? 'full_build' : 'initial_stage',
      dedupeKey: existing.strategy === 'full' ? `full:${stage.index}` : `initial:${stage.index}`,
      now,
    });
    if (!claimed) continue;
    const runId = await createStageRun(deps, {
      worldId: input.worldId, title: input.title, stageIndex: stage.index, template: input.template,
    });
    queued.push({ stageIndex: stage.index, runId });
  }
  return queued;
}

async function createStageRun(
  deps: StageOrchestratorDeps,
  input: {
    worldId: string;
    title: string;
    stageIndex: number;
    template: StageRunTemplate;
  },
): Promise<string> {
  const existing = await deps.stageStore.getStagePlanByWorld(input.worldId);
  if (!existing) throw new Error(`No stage plan for world ${input.worldId}.`);
  const stage = existing.stages.find(slice => slice.index === input.stageIndex);
  if (!stage) throw new Error(`Stage ${input.stageIndex} missing from plan.`);
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const runId = `run-${input.worldId}-s${input.stageIndex + 1}-${now.replace(/[^0-9]/g, '').slice(0, 14)}`;
  const run: BuildRunRecord = await createExtractionRun(
    {
      sourceStore: deps.sourceStore, runStore: deps.runStore, worldStore: deps.worldStore,
      sha256Hex: deps.sha256Hex, now: deps.now,
    },
    {
      runId, worldId: input.worldId, sourceId: existing.sourceId,
      modelFingerprint: input.template.modelFingerprint,
      title: input.title,
      extractorVersion: input.template.extractorVersion,
      mode: input.template.mode ?? 'group',
      budget: input.template.budget,
      config: input.template.config,
      routes: input.template.routes,
      scope: { startCp: stage.startCp, endCp: stage.endCp },
    },
  );
  await deps.stageStore.setStageStatus({
    planId: existing.planId, stageIndex: input.stageIndex,
    status: 'queued', runId: run.runId, now,
  });
  return runId;
}

export interface TriggerOutcome {
  stageIndex: number;
  reason: string;
  runId: string | null;
  /** True when the trigger was absorbed by an already-queued/building stage. */
  deduped: boolean;
}

/**
 * Narrative-triggered stage build (unified P3 §3): evaluates boundary
 * proximity / dependency demand, claims each trigger AT MOST ONCE, and
 * creates the scoped run for newly claimed stages. Without a trigger no
 * un-built stage's prose is ever requested.
 */
export async function evaluateAndClaimTriggers(
  deps: StageOrchestratorDeps,
  input: {
    worldId: string;
    title: string;
    template: StageRunTemplate;
    anchorCp?: number | null;
    neededRanges?: ReadonlyArray<{ startCp: number; endCp: number }>;
    boundaryRatio?: number;
  },
): Promise<TriggerOutcome[]> {
  const stored = await deps.stageStore.getStagePlanByWorld(input.worldId);
  if (!stored) return [];
  const plan = rehydratePlan(stored.stages, stored.strategy);
  const states = new Map(
    (await deps.stageStore.listStageStates(stored.planId))
      .map(state => [state.stageIndex, state]),
  );
  const decisions = evaluateStageTriggers({
    plan, states,
    anchorCp: input.anchorCp,
    neededRanges: input.neededRanges,
    boundaryRatio: input.boundaryRatio,
  });
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const outcomes: TriggerOutcome[] = [];
  for (const decision of decisions) {
    const claimed = await deps.stageStore.claimStageTrigger({
      planId: stored.planId, stageIndex: decision.stageIndex,
      reason: decision.reason, dedupeKey: decision.dedupeKey, now,
    });
    if (!claimed) {
      const state = states.get(decision.stageIndex);
      outcomes.push({
        stageIndex: decision.stageIndex, reason: decision.reason,
        runId: state?.runId ?? null, deduped: true,
      });
      continue;
    }
    const runId = await createStageRun(deps, {
      worldId: input.worldId, title: input.title,
      stageIndex: decision.stageIndex, template: input.template,
    });
    outcomes.push({ stageIndex: decision.stageIndex, reason: decision.reason, runId, deduped: false });
  }
  return outcomes;
}

/**
 * Marks the stage lifecycle around its run: call with 'building' when the
 * run starts executing and with 'built'/'pending_activation' once the stage
 * package published.
 */
export async function markStageRunStatus(
  deps: StageOrchestratorDeps,
  input: { worldId: string; stageIndex: number; status: StageStatus; packageRevision?: number },
): Promise<void> {
  const stored = await deps.stageStore.getStagePlanByWorld(input.worldId);
  if (!stored) return;
  await deps.stageStore.setStageStatus({
    planId: stored.planId,
    stageIndex: input.stageIndex,
    status: input.status,
    packageRevision: input.packageRevision ?? undefined,
    now: (deps.now ?? (() => new Date().toISOString()))(),
  });
}

/** Stage index for a run id created by this orchestrator (or null). */
export async function stageIndexForRun(
  deps: StageOrchestratorDeps,
  worldId: string,
  runId: string,
): Promise<number | null> {
  const stored = await deps.stageStore.getStagePlanByWorld(worldId);
  if (!stored) return null;
  const states = await deps.stageStore.listStageStates(stored.planId);
  return states.find(state => state.runId === runId)?.stageIndex ?? null;
}

/**
 * Cumulative covered ranges of all BUILT stages (prefix of the book), for
 * stage package publication.
 */
export async function builtStageRanges(
  deps: StageOrchestratorDeps,
  worldId: string,
): Promise<{ ranges: Array<{ startCp: number; endCp: number }>; allBuilt: boolean } | null> {
  const stored = await deps.stageStore.getStagePlanByWorld(worldId);
  if (!stored) return null;
  const states = await deps.stageStore.listStageStates(stored.planId);
  const builtStages = stored.stages.filter(stage => {
    const state = states.find(candidate => candidate.stageIndex === stage.index);
    return !!state && ['built', 'pending_activation', 'activated'].includes(state.status);
  });
  if (builtStages.length === 0) return { ranges: [], allBuilt: false };
  const coveredEnd = Math.max(...builtStages.map(stage => stage.endCp));
  const coveredStart = Math.min(...builtStages.map(stage => stage.startCp));
  const allBuilt = builtStages.length === stored.stages.length;
  return { ranges: [{ startCp: coveredStart, endCp: coveredEnd }], allBuilt };
}
