/** One World = one Project. Full projection and local build-only snapshots. */
import { getDatabaseRuntime } from './database';
import { listWorlds } from './worldImport';
import type { BuildTaskView } from './buildTasks';
import type { CampaignListItem } from './runtime';
import type { SqliteRow } from '../../src/application/ports/sqlite';

export type ProjectStatus = 'building' | 'paused' | 'stopped' | 'review' | 'retry'
  | 'failed' | 'waiting_network' | 'waiting_unlock' | 'playable' | 'completed' | 'preparing';

export interface ProjectRunStatus {
  runId: string;
  status: BuildTaskView['status'];
  phase: BuildTaskView['phase'];
  done: number;
  total: number;
  failed: number;
  dynamic: boolean;
  updatedAt: string;
}

export interface ProjectBuildSummary {
  runsTotal: number;
  dynamicRuns: number;
  completedRuns: number;
  doneBatches: number;
  totalBatches: number;
  status: ProjectStatus | null;
  latestUpdatedAt: string;
  runs: ProjectRunStatus[];
}

export interface ProjectStatusProjection {
  projectId: string;
  worldId: string;
  title: string;
  sourceType: 'txt' | 'world-package';
  chapterCount: number;
  updatedAt: string;
  buildStatus: ProjectStatus;
  activeRun: ProjectRunStatus | null;
  buildSummary: ProjectBuildSummary;
  packageRevision: number;
  playable: boolean;
  campaign: { campaignId: string; branchId: string } | null;
  openReviewIssues: number;
}

const RUN_PROJECT_STATUS: Record<BuildTaskView['status'], ProjectStatus> = {
  queued: 'building', running: 'building', needs_review: 'review',
  failed_retryable: 'retry', failed_terminal: 'failed',
  waiting_network: 'waiting_network', waiting_unlock: 'waiting_unlock',
  paused_system: 'paused', paused_user: 'paused', stopped_user: 'stopped',
  canceled: 'stopped', completed: 'completed',
};
const STATUS_PRIORITY: Record<ProjectStatus, number> = {
  review: 70, failed: 70, retry: 70, building: 60,
  waiting_network: 50, waiting_unlock: 50, paused: 40, stopped: 30,
  completed: 20, playable: 10, preparing: 0,
};

/** Canceled/superseded runs are history, not effective work or batch totals. */
export function summarizeProjectBuild(runs: readonly ProjectRunStatus[]): ProjectBuildSummary {
  const effective = runs.filter(run => run.status !== 'canceled');
  const ordered = [...effective].sort((a, b) =>
    STATUS_PRIORITY[RUN_PROJECT_STATUS[b.status]] - STATUS_PRIORITY[RUN_PROJECT_STATUS[a.status]]
    || b.updatedAt.localeCompare(a.updatedAt) || a.runId.localeCompare(b.runId));
  return {
    runsTotal: effective.length,
    dynamicRuns: effective.filter(run => run.dynamic).length,
    completedRuns: effective.filter(run => run.status === 'completed').length,
    doneBatches: effective.reduce((sum, run) => sum + run.done, 0),
    totalBatches: effective.reduce((sum, run) => sum + run.total, 0),
    status: ordered[0] ? RUN_PROJECT_STATUS[ordered[0].status] : null,
    latestUpdatedAt: effective.reduce((latest, run) => run.updatedAt > latest ? run.updatedAt : latest, ''),
    runs: ordered,
  };
}

/** Shared by Library and Hub; a playable opening stays available during later work. */
export function deriveProjectStatus(
  entry: { packageRevision: number; openingReady?: boolean },
  summary: ProjectBuildSummary,
): ProjectStatus {
  if (summary.status && summary.status !== 'completed') return summary.status;
  if (entry.packageRevision > 0 && entry.openingReady) return 'playable';
  if (entry.packageRevision > 0) return 'review';
  return summary.status ?? 'preparing';
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  building: '构建中', paused: '已暂停', stopped: '已停止 / 待继续',
  review: '待审核', retry: '待重试', failed: '构建失败',
  waiting_network: '等待网络', waiting_unlock: '等待解锁',
  playable: '可游玩', completed: '已完成', preparing: '构建准备中',
};

type BuildRow = SqliteRow & {
  world_id: string; run_id: string; status: BuildTaskView['status']; phase: BuildTaskView['phase'];
  units_done: number; units_total: number; units_failed: number; updated_at: string;
  pause_requested: number; cancel_requested: number; lease_owner: string | null; lease_expires_at: string | null;
};

/** One scoped local query; no task enrichment, providers, source text or sessions. */
export async function listProjectBuildSummaries(worldIds: readonly string[]): Promise<Map<string, ProjectBuildSummary>> {
  const grouped = new Map<string, ProjectRunStatus[]>();
  if (!worldIds.length) return new Map();
  const { db } = await getDatabaseRuntime();
  const now = new Date().toISOString();
  // Small IN batches also support old SQLite parameter limits.
  for (let offset = 0; offset < worldIds.length; offset += 200) {
    const ids = worldIds.slice(offset, offset + 200);
    const rows = await db.queryAll<BuildRow>(
      `SELECT r.world_id, r.run_id, r.status, r.phase, r.units_done, r.units_total,
              r.units_failed, MAX(r.updated_at, COALESCE(MAX(u.updated_at), r.updated_at)) AS updated_at,
              r.pause_requested, r.cancel_requested, r.lease_owner, r.lease_expires_at
         FROM world_build_runs r
         LEFT JOIN world_build_units u ON u.run_id = r.run_id
        WHERE r.world_id IN (${ids.map(() => '?').join(',')}) AND r.status != 'canceled'
        GROUP BY r.run_id`, ids,
    );
    for (const row of rows) {
      const liveLease = Boolean(row.lease_owner && row.lease_expires_at && row.lease_expires_at > now);
      const dynamic = ['running', 'queued', 'waiting_network', 'waiting_unlock', 'failed_retryable'].includes(row.status)
        || liveLease;
      const runs = grouped.get(row.world_id) ?? [];
      runs.push({ runId: row.run_id, status: row.status, phase: row.phase,
        done: row.units_done, total: row.units_total, failed: row.units_failed, dynamic, updatedAt: row.updated_at });
      grouped.set(row.world_id, runs);
    }
  }
  return new Map(worldIds.map(id => [id, summarizeProjectBuild(grouped.get(id) ?? [])]));
}

/** Low-frequency world/campaign/source projection. */
export async function listProjects(input: { campaigns?: readonly CampaignListItem[] }): Promise<ProjectStatusProjection[]> {
  const worlds = await listWorlds();
  const summaries = await listProjectBuildSummaries(worlds.map(world => world.worldId));
  const { db } = await getDatabaseRuntime();
  const projects: ProjectStatusProjection[] = [];
  for (const entry of worlds) {
    const summary = summaries.get(entry.worldId)!;
    const chapters = await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM source_chapters WHERE world_id = ?', [entry.worldId]);
    const campaign = input.campaigns?.find(c => c.worldId === entry.worldId && c.branchId);
    projects.push({ projectId: entry.worldId, worldId: entry.worldId, title: entry.title,
      sourceType: entry.sourceSha256 ? 'txt' : 'world-package', chapterCount: chapters?.count ?? 0,
      updatedAt: summary.latestUpdatedAt > entry.updatedAt ? summary.latestUpdatedAt : entry.updatedAt,
      buildStatus: deriveProjectStatus(entry, summary), buildSummary: summary,
      activeRun: summary.runs.find(run => run.status !== 'completed') ?? null,
      packageRevision: entry.packageRevision, playable: entry.packageRevision > 0 && entry.openingReady === true,
      campaign: campaign?.branchId ? { campaignId: campaign.campaignId, branchId: campaign.branchId } : null,
      openReviewIssues: entry.openReviewIssues });
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Pure local poll: merge dynamic fields only, retaining all stable projection data. */
export async function refreshProjectBuildStatusFast(projects: readonly ProjectStatusProjection[]): Promise<{
  projects: ProjectStatusProjection[]; needsFullRefresh: boolean;
}> {
  const dynamic = projects.filter(project => project.buildSummary.dynamicRuns > 0);
  if (!dynamic.length) return { projects: [...projects], needsFullRefresh: false };
  const ids = dynamic.map(project => project.worldId);
  const summaries = await listProjectBuildSummaries(ids);
  const { db } = await getDatabaseRuntime();
  const worlds = new Map<string, { updated_at: string; package_revision: number }>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const slice = ids.slice(offset, offset + 200);
    const rows = await db.queryAll<SqliteRow & { world_id: string; updated_at: string; package_revision: number }>(
      `SELECT w.world_id, w.updated_at,
              COALESCE((SELECT MAX(revision) FROM world_packages p WHERE p.world_id = w.world_id AND p.status = 'published'), 0) AS package_revision
         FROM worlds w WHERE w.world_id IN (${slice.map(() => '?').join(',')})`, slice);
    for (const row of rows) worlds.set(row.world_id, row);
  }
  let needsFullRefresh = false;
  const merged = projects.map(project => {
    const summary = summaries.get(project.worldId);
    if (!summary) return project;
    const world = worlds.get(project.worldId);
    if (!world || world.package_revision !== project.packageRevision
      || summary.completedRuns > project.buildSummary.completedRuns) needsFullRefresh = true;
    const updatedAt = [project.updatedAt, summary.latestUpdatedAt, world?.updated_at ?? ''].sort().at(-1)!;
    return { ...project, buildSummary: summary,
      activeRun: summary.runs.find(run => run.status !== 'completed') ?? null,
      buildStatus: deriveProjectStatus({ packageRevision: project.packageRevision, openingReady: project.playable }, summary), updatedAt };
  });
  return { projects: merged, needsFullRefresh };
}

export function filterProjects(projects: readonly ProjectStatusProjection[], query: string): ProjectStatusProjection[] {
  const needle = query.trim().toLowerCase();
  return needle ? projects.filter(project => project.title.toLowerCase().includes(needle)) : [...projects];
}
