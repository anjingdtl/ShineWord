/**
 * Stage package activation at safe boundaries (unified build P3 §4).
 *
 * A built stage package is WORLD-level immutable content; ACTIVATION is a
 * branch/anchor-level operation. A package finished after the current turn
 * contract froze can only be adopted at the NEXT safe boundary (no running
 * interaction operation, branch state version confirmed). Activation never
 * rewrites existing character state - cards, skills, resources, relationships
 * and campaign history stay exactly as the snapshot recorded them; the new
 * revision only widens the catalog/facts visible to FUTURE turns (still
 * anchor-filtered, so future-stage secrets cannot leak).
 *
 * Forks and rewinds invalidate old activation intents by construction:
 * advances are bound to (campaign, branch, state_version), a fork gets a new
 * branch id (no advances) and a rewind lowers the state version below the
 * advance's boundary.
 */
import type { SqliteDatabase } from '../ports/sqlite';
import type { SqliteStagePlanStore } from '../../infra/sqlite/sqliteStagePlanStore';

export interface ActivationDeps {
  db: SqliteDatabase;
  stageStore: SqliteStagePlanStore;
}

export interface SafeBoundaryCheck {
  campaignId: string;
  branchId: string;
  stateVersion: number;
}

/**
 * A branch is at a SAFE BOUNDARY when no interaction operation is running
 * for it (a frozen/running turn contract means content must not swap) and
 * the observed state version still matches the branch row.
 */
export async function isAtSafeBoundary(
  db: SqliteDatabase,
  input: SafeBoundaryCheck,
): Promise<boolean> {
  const running = await db.queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM interaction_operations
      WHERE branch_id = ? AND status = 'running'`,
    [input.branchId],
  );
  if (running && Number(running.n) > 0) return false;
  const branch = await db.queryOne<{ state_version: number }>(
    'SELECT state_version FROM branches WHERE branch_id = ?', [input.branchId],
  );
  if (!branch) return false;
  return Number(branch.state_version) === input.stateVersion;
}

export interface ActivateStageResult {
  activated: boolean;
  reason:
    | 'ok'
    | 'not_safe_boundary'
    | 'nothing_pending'
    | 'revision_not_forward'
    | 'no_base_revision';
}

/**
 * Activates every pending stage of the world's plan for one campaign branch.
 * Each advance is recorded at the branch's current state version; the branch
 * then plays with the highest activated revision (resolveEffectiveRevision).
 */
export async function activatePendingStages(deps: ActivationDeps, input: {
  campaignId: string;
  branchId: string;
  stateVersion: number;
  worldId: string;
  now: string;
}): Promise<ActivateStageResult> {
  const { db, stageStore } = deps;
  if (!(await isAtSafeBoundary(db, input))) {
    return { activated: false, reason: 'not_safe_boundary' };
  }
  const base = await db.queryOne<{ package_revision: number }>(
    'SELECT package_revision FROM campaigns WHERE campaign_id = ?',
    [input.campaignId],
  );
  if (!base || base.package_revision === null) {
    return { activated: false, reason: 'no_base_revision' };
  }
  const baseRevision = Number(base.package_revision);
  const plan = await stageStore.getStagePlanByWorld(input.worldId);
  if (!plan) return { activated: false, reason: 'nothing_pending' };
  const states = await stageStore.listStageStates(plan.planId);
  const effective = await stageStore.resolveEffectiveRevision({
    campaignId: input.campaignId, branchId: input.branchId, stateVersion: input.stateVersion,
  });
  let current = effective ?? baseRevision;

  let anyActivated = false;
  let sawPending = false;
  for (const state of states) {
    if (state.status !== 'pending_activation') continue;
    sawPending = true;
    if (state.packageRevision === null || state.packageRevision <= current) {
      // Not a forward move (or duplicate) - mark activated without advancing.
      await stageStore.setStageStatus({
        planId: plan.planId, stageIndex: state.stageIndex, status: 'activated', now: input.now,
      });
      continue;
    }
    await stageStore.recordPackageAdvance({
      campaignId: input.campaignId,
      branchId: input.branchId,
      stateVersion: input.stateVersion,
      fromRevision: current,
      toRevision: state.packageRevision,
      reason: state.triggerReason ?? 'stage_build_complete',
      now: input.now,
    });
    await stageStore.setStageStatus({
      planId: plan.planId, stageIndex: state.stageIndex, status: 'activated', now: input.now,
    });
    current = state.packageRevision;
    anyActivated = true;
  }
  if (!anyActivated) {
    return { activated: false, reason: sawPending ? 'revision_not_forward' : 'nothing_pending' };
  }
  return { activated: true, reason: 'ok' };
}

/**
 * The revision this branch currently plays with: the base lock advanced by
 * all recorded advances at or below the branch state version. Old saves
 * without advances resolve to their original lock (no forced upgrade).
 */
export async function resolvePlayableRevision(
  stageStore: SqliteStagePlanStore,
  input: { campaignId: string; branchId: string; stateVersion: number; baseRevision: number },
): Promise<number> {
  const advanced = await stageStore.resolveEffectiveRevision({
    campaignId: input.campaignId, branchId: input.branchId, stateVersion: input.stateVersion,
  });
  if (advanced === null || advanced <= input.baseRevision) return input.baseRevision;
  return advanced;
}
