/**
 * Project library projection (task §18-§19).
 *
 * A Project == a World; worldId is the stable projectId. This module is the
 * SINGLE projection the library UI consumes: it aggregates world row, source
 * shape, per-project build tasks, campaigns and review state so no screen
 * re-derives status from raw tables. No novel_projects table exists - the
 * projection covers the product need without schema churn.
 */
import { getDatabaseRuntime } from './database';
import { listWorlds, type WorldLibraryEntry } from './worldImport';
import { listOpenBuildTasksForWorld, type BuildTaskView } from './buildTasks';
import type { CampaignListItem } from './runtime';

export interface ProjectStatusProjection {
  projectId: string;
  worldId: string;
  title: string;
  sourceType: 'txt' | 'world-package';
  chapterCount: number;
  updatedAt: string;
  buildStatus: string;
  /** The world's open build task, if any (paused/stopped/review keep cards). */
  activeRun: {
    runId: string;
    status: BuildTaskView['status'];
    phase: BuildTaskView['phase'];
    done: number;
    total: number;
    failed: number;
    dynamic: boolean;
  } | null;
  /** True when a published package revision has a playable opening. */
  playable: boolean;
  campaign: { campaignId: string; branchId: string } | null;
  /** Open review issues (blocking subset feeds the playability gate). */
  openReviewIssues: number;
}

function buildStatusOf(entry: WorldLibraryEntry, task: BuildTaskView | null): string {
  if (task && (task.status === 'running' || task.status === 'queued')) return 'building';
  if (task && task.status === 'paused_user') return 'paused';
  if (task && (task.status === 'needs_review' || task.status === 'failed_retryable'
    || task.status === 'failed_terminal' || task.status === 'stopped_user'
    || task.status === 'waiting_network' || task.status === 'waiting_unlock')) return 'attention';
  if (entry.packageRevision > 0 && entry.openingReady) return 'playable';
  if (entry.packageRevision > 0) return 'review';
  return 'preparing';
}

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  building: '构建中',
  paused: '已暂停',
  attention: '待处理',
  playable: '可游玩',
  review: '待审核',
  preparing: '构建准备中',
};

/** Campaign ref for one world from the already-fetched campaign list. */
function campaignForWorld(
  campaigns: readonly CampaignListItem[],
  worldId: string,
): { campaignId: string; branchId: string } | null {
  const found = campaigns.find(campaign => campaign.worldId === worldId && campaign.branchId);
  return found?.branchId ? { campaignId: found.campaignId, branchId: found.branchId } : null;
}

async function chapterCountForWorld(worldId: string): Promise<number> {
  const runtime = await getDatabaseRuntime();
  const row = await runtime.db.queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM source_chapters WHERE world_id = ?', [worldId],
  );
  return row?.count ?? 0;
}

/**
 * Lists every project sorted by updatedAt DESC. `campaigns` is passed in by
 * callers that already maintain the session campaign list.
 */
export async function listProjects(input: {
  campaigns?: readonly CampaignListItem[];
}): Promise<ProjectStatusProjection[]> {
  const worlds = await listWorlds();
  const projects: ProjectStatusProjection[] = [];
  for (const entry of worlds) {
    const task = (await listOpenBuildTasksForWorld(entry.worldId))[0] ?? null;
    const sourceType: ProjectStatusProjection['sourceType'] = entry.sourceSha256 ? 'txt' : 'world-package';
    projects.push({
      projectId: entry.worldId,
      worldId: entry.worldId,
      title: entry.title,
      sourceType,
      chapterCount: await chapterCountForWorld(entry.worldId),
      updatedAt: task?.updatedAt && task.updatedAt > entry.updatedAt ? task.updatedAt : entry.updatedAt,
      buildStatus: buildStatusOf(entry, task),
      activeRun: task ? {
        runId: task.runId,
        status: task.status,
        phase: task.phase,
        done: task.unitsDone,
        total: task.unitsTotal,
        failed: task.unitsFailed,
        dynamic: task.status === 'running' || task.status === 'queued' || task.pauseRequested || task.cancelRequested,
      } : null,
      playable: entry.packageRevision > 0 && entry.openingReady === true,
      campaign: input.campaigns ? campaignForWorld(input.campaigns, entry.worldId) : null,
      openReviewIssues: entry.openReviewIssues,
    });
  }
  projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return projects;
}

/** Case-insensitive title search over the projection (task §22). */
export function filterProjects(
  projects: readonly ProjectStatusProjection[],
  query: string,
): ProjectStatusProjection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...projects];
  return projects.filter(project => project.title.toLowerCase().includes(needle));
}
