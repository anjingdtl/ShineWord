/**
 * Safe cascading project deletion (task §23-§31).
 *
 * A Project == a World (worldId is the stable projectId). Deleting one must
 * remove EVERY dependent row of that world - and nothing else:
 *
 *   - worlds            → canon trees (entities/facts/events/proposals/
 *                         mappings/knowledge), packages + sections + drafts,
 *                         world_jobs, mirrored chapters/chunks (all FK CASCADE)
 *   - branches subtree  → branches.campaign_id has NO FK, so the whole graph
 *                         (turns, snapshots, encounters, memories, manifests)
 *                         must be deleted explicitly, THEN the 11 branch-
 *                         scoped no-FK tables
 *   - campaigns         → interaction fences/operations/steps cascade
 *   - build             → world_build_runs (units cascade), stage plans+states
 *                         (no FKs at all), review_issues (no FK)
 *   - progressive       → progressive_world_deltas, campaign_package_advances
 *   - ledgers           → llm_request_attempts (no FK), legacy llm_requests
 *
 * SHARED SOURCES: an imported_sources row is only deleted when NO other
 * world, build run or stage plan still references it (same TXT re-imported as
 * another project must keep working). The check runs INSIDE the transaction.
 *
 * Running builds block deletion (the executor could be mid-paid-request);
 * callers must first stop them safely and wait for the lease to clear.
 *
 * Filesystem: all durable source text lives in SQLite shards; the transient
 * staged copies under filesDir/sources are import-scratch, never project
 * state, so there is nothing to sweep here (task §29 by construction).
 */
import type { SqliteDatabase } from '../ports/sqlite';

export class ProjectDeletionBlockedError extends Error {
  readonly activeRunIds: string[];

  constructor(activeRunIds: string[], now: string) {
    super(`项目正在构建（${activeRunIds.length} 个活跃任务）。需要先安全停止构建再删除。`);
    this.name = 'ProjectDeletionBlockedError';
    this.activeRunIds = activeRunIds;
    void now;
  }
}

export interface ProjectDeletionResult {
  worldId: string;
  deleted: boolean;
  /** True when the world was already gone (idempotent re-delete). */
  alreadyGone: boolean;
  /** Source manifests removed because this was their last reference. */
  removedSourceIds: string[];
  /** Rows flagged by PRAGMA foreign_key_check after commit (must be empty). */
  foreignKeyViolations: number;
}

export interface ProjectDeletionDeps {
  db: SqliteDatabase;
  now?: () => string;
}

const ACTIVE_RUN_STATUSES = [
  'queued', 'running', 'waiting_network', 'waiting_unlock', 'waiting_system',
] as const;

/** Branch-scoped tables WITHOUT foreign keys - deleted explicitly per branch. */
const BRANCH_SCOPED_NO_FK_TABLES = [
  'llm_requests',
  'reward_ledger',
  'party_members',
  'actor_cards',
  'quest_states',
  'quest_reward_ledger',
  'branch_knowledge',
  'outbox',
  'story_memory_states',
  'story_memory_patches',
  'episodic_turn_index',
] as const;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/**
 * Deletion pre-check (task §26): a run that is queued/executing/waiting, or
 * holds a live lease, must be stopped safely before any row is removed.
 */
export async function findBlockingRuns(
  db: SqliteDatabase,
  worldId: string,
  now: string,
): Promise<string[]> {
  const rows = await db.queryAll<{ run_id: string }>(
    `SELECT run_id FROM world_build_runs
      WHERE world_id = ?
        AND (status IN (${placeholders(ACTIVE_RUN_STATUSES.length)})
             OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > ?))`,
    [worldId, ...ACTIVE_RUN_STATUSES, now],
  );
  return rows.map(row => row.run_id);
}

/**
 * Deletes one project (world) with every dependent row, in one transaction.
 * Idempotent: deleting an already-deleted project succeeds without touching
 * anything. Throws ProjectDeletionBlockedError while a build is active.
 */
export async function deleteProject(
  deps: ProjectDeletionDeps,
  input: { worldId: string },
): Promise<ProjectDeletionResult> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const db = deps.db;
  const world = await db.queryOne<{ world_id: string; source_sha256: string | null }>(
    'SELECT world_id, source_sha256 FROM worlds WHERE world_id = ?', [input.worldId],
  );
  if (!world) {
    return { worldId: input.worldId, deleted: false, alreadyGone: true, removedSourceIds: [], foreignKeyViolations: 0 };
  }
  const blocking = await findBlockingRuns(db, input.worldId, now);
  if (blocking.length > 0) {
    throw new ProjectDeletionBlockedError(blocking, now);
  }

  const removedSourceIds: string[] = [];
  await db.transaction(async tx => {
    // ---- Collect scopes BEFORE deleting their parents. ----
    const campaignRows = await tx.queryAll<{ campaign_id: string }>(
      'SELECT campaign_id FROM campaigns WHERE world_id = ?', [input.worldId],
    );
    const campaignIds = campaignRows.map(row => row.campaign_id);
    const branchIds = campaignIds.length > 0
      ? (await tx.queryAll<{ branch_id: string }>(
        `SELECT branch_id FROM branches WHERE campaign_id IN (${placeholders(campaignIds.length)})`,
        campaignIds,
      )).map(row => row.branch_id)
      : [];
    const runSourceRows = await tx.queryAll<{ source_id: string }>(
      'SELECT DISTINCT source_id FROM world_build_runs WHERE world_id = ?', [input.worldId],
    );
    const candidateSourceIds = runSourceRows.map(row => row.source_id);
    const members = await tx.queryAll<{ source_id: string }>('SELECT source_id FROM world_sources WHERE world_id = ?', [input.worldId]);
    for (const member of members) if (!candidateSourceIds.includes(member.source_id)) candidateSourceIds.push(member.source_id);
    const stageSourceRows = await tx.queryAll<{ source_id: string }>(
      'SELECT DISTINCT source_id FROM world_stage_plans WHERE world_id = ?', [input.worldId],
    );
    for (const row of stageSourceRows) {
      if (!candidateSourceIds.includes(row.source_id)) candidateSourceIds.push(row.source_id);
    }
    // Legacy projects may have lost their historical runs/plans. Discover
    // their source via the surviving world hash, inside the same transaction.
    const sourceWorld = await tx.queryOne<{ source_sha256: string | null }>(
      'SELECT source_sha256 FROM worlds WHERE world_id = ?', [input.worldId],
    );
    if (sourceWorld?.source_sha256) {
      const legacySources = await tx.queryAll<{ source_id: string }>(
        'SELECT source_id FROM imported_sources WHERE raw_sha256 = ?', [sourceWorld.source_sha256],
      );
      for (const row of legacySources) {
        if (!candidateSourceIds.includes(row.source_id)) candidateSourceIds.push(row.source_id);
      }
    }

    // ---- 1. Branch-scoped no-FK tables, then the branches graph itself. ----
    if (branchIds.length > 0) {
      for (const table of BRANCH_SCOPED_NO_FK_TABLES) {
        // Chunked IN lists stay far below SQLite's parameter limit.
        for (let offset = 0; offset < branchIds.length; offset += 200) {
          const slice = branchIds.slice(offset, offset + 200);
          await tx.execute(`DELETE FROM ${table} WHERE branch_id IN (${placeholders(slice.length)})`, slice);
        }
      }
      // Attempt-ledger rows may carry ONLY a branch reference.
      for (let offset = 0; offset < branchIds.length; offset += 200) {
        const slice = branchIds.slice(offset, offset + 200);
        await tx.execute(
          `DELETE FROM llm_request_attempts WHERE branch_id IN (${placeholders(slice.length)})`,
          slice,
        );
      }
      for (let offset = 0; offset < branchIds.length; offset += 200) {
        const slice = branchIds.slice(offset, offset + 200);
        await tx.execute(`DELETE FROM branches WHERE branch_id IN (${placeholders(slice.length)})`, slice);
      }
    }

    // ---- 2. Campaign-scoped no-FK rows (fk tables cascade with campaigns). ----
    if (campaignIds.length > 0) {
      await tx.execute(
        `DELETE FROM campaign_package_advances WHERE campaign_id IN (${placeholders(campaignIds.length)})`,
        campaignIds,
      );
      for (let offset = 0; offset < campaignIds.length; offset += 200) {
        const slice = campaignIds.slice(offset, offset + 200);
        await tx.execute(
          `DELETE FROM llm_request_attempts WHERE campaign_id IN (${placeholders(slice.length)})`,
          slice,
        );
      }
    }

    // ---- 3. Build state: runs (units cascade), stage plans + states. ----
    await tx.execute('DELETE FROM world_build_runs WHERE world_id = ?', [input.worldId]);
    const planRows = await tx.queryAll<{ plan_id: string }>(
      'SELECT plan_id FROM world_stage_plans WHERE world_id = ?', [input.worldId],
    );
    if (planRows.length > 0) {
      for (const row of planRows) {
        await tx.execute('DELETE FROM world_stage_states WHERE plan_id = ?', [row.plan_id]);
      }
      await tx.execute('DELETE FROM world_stage_plans WHERE world_id = ?', [input.worldId]);
    }

    // ---- 4. World-scoped no-FK tables (canon/packages cascade later). ----
    await tx.execute('DELETE FROM review_issues WHERE world_id = ?', [input.worldId]);
    await tx.execute('DELETE FROM progressive_world_deltas WHERE world_id = ?', [input.worldId]);
    await tx.execute('DELETE FROM llm_request_attempts WHERE world_id = ?', [input.worldId]);

    // ---- 5. Campaigns (fences/operations/steps cascade), then the world ----
    // (canon, packages, drafts, proposals, jobs, mirrored source rows).
    if (campaignIds.length > 0) {
      await tx.execute(
        `DELETE FROM campaigns WHERE campaign_id IN (${placeholders(campaignIds.length)})`,
        campaignIds,
      );
    }
    await tx.execute('DELETE FROM worlds WHERE world_id = ?', [input.worldId]);

    // ---- 6. Shared-source reference counting (task §28). ----
    for (const sourceId of candidateSourceIds) {
      const manifest = await tx.queryOne<{ raw_sha256: string }>(
        'SELECT raw_sha256 FROM imported_sources WHERE source_id = ?', [sourceId],
      );
      if (!manifest) continue;
      const runRefs = await tx.queryOne<{ count: number }>(
        'SELECT COUNT(*) AS count FROM world_build_runs WHERE source_id = ?', [sourceId],
      );
      const planRefs = await tx.queryOne<{ count: number }>(
        'SELECT COUNT(*) AS count FROM world_stage_plans WHERE source_id = ?', [sourceId],
      );
      const worldRefs = await tx.queryOne<{ count: number }>(
        'SELECT COUNT(*) AS count FROM worlds WHERE source_sha256 = ? AND world_id != ?',
        [manifest.raw_sha256, input.worldId],
      );
      const refs = (runRefs?.count ?? 0) + (planRefs?.count ?? 0) + (worldRefs?.count ?? 0);
      if (refs === 0) {
        // Segments/chapters/chunks cascade; runs referencing it are gone
        // (this world's) so the NO ACTION FK no longer blocks.
        await tx.execute('DELETE FROM imported_sources WHERE source_id = ?', [sourceId]);
        removedSourceIds.push(sourceId);
      }
    }
  });

  const violations = await db.queryAll<Record<string, string | number | null>>('PRAGMA foreign_key_check');
  return {
    worldId: input.worldId,
    deleted: true,
    alreadyGone: false,
    removedSourceIds,
    foreignKeyViolations: violations.length,
  };
}
