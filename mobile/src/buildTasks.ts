/**
 * DB-backed build task views for the library and notifications (closeout C4).
 *
 * The world_build_runs tables are the single source of truth: the task card,
 * the in-page progress and (from C5 on) the system notification all render
 * from these snapshots, so re-entering the page or restarting the process
 * shows the REAL persisted state - never a reset-to-zero or a synthetic
 * percentage.
 *
 * Real-device stability: the card's live counters (running / queued /
 * retryable) are DERIVED from world_build_units row states on every query.
 * run.units_failed stays what it always was - a cumulative failed-attempt
 * counter - and is exposed as `failureAttempts`, never as "pending retries"
 * (a 69-unit run with 176 historical failures must not render "176 待重试").
 */
import { getDatabaseRuntime } from './database';
import type { BuildRunRecord, BuildUnitRecord } from '../../src/application/ports/worldBuildStore';
import type { SqliteRow } from '../../src/application/ports/sqlite';
export { taskOverallProgress } from '../../src/application/worldBuild/buildProgress';

export interface BuildTaskView {
  runId: string;
  worldId: string;
  title: string;
  fileName: string | null;
  phase: BuildRunRecord['phase'];
  status: BuildRunRecord['status'];
  unitsDone: number;
  unitsTotal: number;
  /** Cumulative failed attempts (historical counter; NOT pending retries). */
  unitsFailed: number;
  unitsRunning: number;
  unitsQueued: number;
  /** Currently blocked-on-retry units, derived live from unit rows. */
  unitsRetryable: number;
  unitsNeedsReview: number;
  openReviewIssues: number;
  blockingReviewIssues: number;
  unitsFailedTerminal: number;
  /** Max attempt among units still being worked on. */
  currentAttempt: number;
  /** Newest activity across run row and unit rows. */
  lastActivityAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
  /** True while another executor holds a live lease. */
  leaseHeld: boolean;
  pauseRequested: boolean;
  cancelRequested: boolean;
}

interface TaskRow extends SqliteRow {
  run_id: string;
  world_id: string;
  phase: string;
  status: string;
  units_done: number;
  units_total: number;
  units_failed: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
  title: string | null;
  file_name: string | null;
  pause_requested: number | null;
  cancel_requested: number | null;
  units_running: number | null;
  units_queued: number | null;
  units_retryable: number | null;
  units_needs_review: number | null;
  units_failed_terminal: number | null;
  current_attempt: number | null;
  last_activity_at: string | null;
  open_review_issues: number;
  blocking_review_issues: number;
}

/** Runs that are not finished - what the task card list shows. */
export async function listOpenBuildTasks(): Promise<BuildTaskView[]> {
  return queryOpenBuildTasks(undefined);
}

/** Open tasks of ONE project only (project hub / project cards). */
export async function listOpenBuildTasksForWorld(worldId: string): Promise<BuildTaskView[]> {
  return queryOpenBuildTasks(worldId);
}

/** The hub retains the latest successful task so its real 100% is visible. */
export async function listBuildTasksForWorld(worldId: string): Promise<BuildTaskView[]> {
  return queryOpenBuildTasks(worldId, true);
}

async function queryOpenBuildTasks(worldId?: string, includeCompleted = false): Promise<BuildTaskView[]> {
  const runtime = await getDatabaseRuntime();
  const rows = await runtime.db.queryAll<TaskRow>(
    `SELECT r.run_id, r.world_id, r.phase, r.status, r.units_done, r.units_total,
            r.units_failed, r.lease_owner, r.lease_expires_at,
            r.last_error_code, r.last_error_message, r.updated_at,
            r.pause_requested, r.cancel_requested,
            s.title, s.file_name,
            agg.units_running, agg.units_queued, agg.units_retryable,
            agg.units_needs_review, agg.units_failed_terminal,
            agg.current_attempt, agg.last_activity_at,
            (SELECT COUNT(*) FROM review_issues i WHERE i.world_id = r.world_id AND i.status = 'open') AS open_review_issues,
            (SELECT COUNT(*) FROM review_issues i WHERE i.world_id = r.world_id AND i.status = 'open' AND i.severity = 'blocking') AS blocking_review_issues
       FROM world_build_runs r
       LEFT JOIN imported_sources s ON s.source_id = r.source_id
       LEFT JOIN (
         SELECT run_id,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS units_running,
           SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS units_queued,
           SUM(CASE WHEN status IN ('failed_retryable', 'waiting_network') THEN 1 ELSE 0 END) AS units_retryable,
           SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS units_needs_review,
           SUM(CASE WHEN status = 'failed_terminal' THEN 1 ELSE 0 END) AS units_failed_terminal,
           MAX(CASE WHEN status IN ('running', 'failed_retryable', 'needs_review') THEN attempt END) AS current_attempt,
           MAX(updated_at) AS last_activity_at
         FROM world_build_units GROUP BY run_id
       ) agg ON agg.run_id = r.run_id
      WHERE (r.status NOT IN ('completed', 'failed_terminal', 'canceled')
        ${includeCompleted ? `OR r.run_id = (SELECT finished.run_id FROM world_build_runs finished
          WHERE finished.world_id = r.world_id AND finished.status = 'completed' ORDER BY finished.updated_at DESC LIMIT 1)` : ''})
        ${worldId ? 'AND r.world_id = ?' : ''}
      ORDER BY r.updated_at DESC`,
    worldId ? [worldId] : [],
  );
  const now = Date.now();
  return rows.map(row => {
    const unitsTotal = row.units_total;
    // Live counters can never exceed the effective total: they are per-unit
    // states of exactly the units this run tracks.
    const clamp = (value: number): number => Math.max(0, Math.min(value, unitsTotal));
    return {
      runId: row.run_id,
      worldId: row.world_id,
      title: row.title ?? row.file_name ?? row.run_id,
      fileName: row.file_name,
      phase: row.phase as BuildRunRecord['phase'],
      status: row.status as BuildRunRecord['status'],
      unitsDone: row.units_done,
      unitsTotal,
      unitsFailed: row.units_failed,
      unitsRunning: clamp(row.units_running ?? 0),
      unitsQueued: clamp(row.units_queued ?? 0),
      unitsRetryable: clamp(row.units_retryable ?? 0),
      unitsNeedsReview: clamp(row.units_needs_review ?? 0),
      openReviewIssues: row.open_review_issues ?? 0,
      blockingReviewIssues: row.blocking_review_issues ?? 0,
      unitsFailedTerminal: clamp(row.units_failed_terminal ?? 0),
      currentAttempt: row.current_attempt ?? 0,
      lastActivityAt: row.last_activity_at && row.last_activity_at > row.updated_at
        ? row.last_activity_at
        : row.updated_at,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      updatedAt: row.updated_at,
      leaseHeld: Boolean(row.lease_owner) && Boolean(row.lease_expires_at)
        && Date.parse(row.lease_expires_at as string) > now,
      pauseRequested: (row.pause_requested ?? 0) !== 0,
      cancelRequested: (row.cancel_requested ?? 0) !== 0,
    };
  });
}

/** Failed/blocked units for one run - locating exactly what to retry. */
export async function listFailedUnits(runId: string): Promise<Array<
  Pick<BuildUnitRecord, 'unitId' | 'status' | 'errorCode' | 'errorMessage' | 'attempt'>
>> {
  const runtime = await getDatabaseRuntime();
  const rows = await runtime.db.queryAll<SqliteRow & {
    unit_id: string;
    status: string;
    error_code: string | null;
    error_message: string | null;
    attempt: number;
  }>(
    `SELECT unit_id, status, error_code, error_message, attempt
       FROM world_build_units
      WHERE run_id = ? AND status IN ('failed_retryable', 'needs_review', 'failed_terminal')
      ORDER BY updated_at DESC, ord LIMIT 3`,
    [runId],
  );
  return rows.map(row => ({
    unitId: row.unit_id,
    status: row.status as BuildUnitRecord['status'],
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attempt: row.attempt,
  }));
}

export const PHASE_LABEL: Record<BuildRunRecord['phase'], string> = {
  reading: '读取原文',
  normalizing: '规范化',
  indexing: '建立索引',
  extracting: '抽取事实',
  merging: '整合归并',
  mapping: '映射三宝书',
  validating: '审查与校验',
  publishing: '发布',
};

export const RUN_STATUS_LABEL: Record<BuildRunRecord['status'], string> = {
  queued: '排队中',
  running: '进行中',
  waiting_network: '等待网络',
  waiting_unlock: '等待解锁',
  paused_system: '系统限制暂停',
  paused_user: '已暂停',
  stopped_user: '已停止',
  failed_retryable: '待重试',
  needs_review: '需要处理',
  failed_terminal: '失败',
  canceled: '已取消',
  completed: '已完成',
};

/** Task-card headline status: control flags say more than the status column. */
export function taskStatusLabel(task: BuildTaskView): string {
  const automatic = task.status === 'failed_retryable' && task.lastErrorCode === 'mapping_auto_retry';
  if ((task.status === 'running' || automatic) && task.cancelRequested) return '停止请求中';
  if ((task.status === 'running' || automatic) && task.pauseRequested) return '暂停请求中';
  if (automatic) return '自动恢复中';
  return RUN_STATUS_LABEL[task.status] ?? task.status;
}

/** Real measured progress line - counts only, no synthetic percentage.
 * Units ARE LLM batches for planner-v2 runs; the wording says 批 so users
 * stop reading storage-chunk counts as request counts (task §14). */
export function taskProgressLine(task: BuildTaskView): string {
  if (task.status === 'completed') return '已完成';
  const label = PHASE_LABEL[task.phase] ?? task.phase;
  if (task.unitsTotal > 0) {
    const parts: string[] = [`抽取 ${task.unitsDone}/${task.unitsTotal} 批`, `当前：${label}`];
    const live: string[] = [];
    if (task.unitsRunning > 0) live.push(`正在分析第 ${task.unitsDone + 1} 批`);
    if (task.unitsQueued > 0) live.push(`排队 ${task.unitsQueued}`);
    if (task.unitsRetryable > 0) live.push(`待重试 ${task.unitsRetryable}`);
    if (task.openReviewIssues > 0) live.push(`待审查 ${task.openReviewIssues} 项`);
    if (task.unitsNeedsReview > 0) live.push(`需处理 ${task.unitsNeedsReview} 批`);
    if (live.length > 0) parts.push(live.join(' · '));
    return parts.join(' · ');
  }
  return label;
}

/** Secondary line: what the executor is doing right now (no fake ETA). */
export function taskActivityLine(task: BuildTaskView): string | null {
  if (task.status === 'failed_retryable' && task.lastErrorCode === 'mapping_auto_retry'
    && !task.pauseRequested && !task.cancelRequested) return '后台正在自动调整预算、拆批与退避续试';
  if (task.status !== 'running' || task.pauseRequested || task.cancelRequested) return null;
  if (task.unitsRunning > 0) {
    const attempt = task.currentAttempt > 1 ? `（第 ${task.currentAttempt} 次尝试）` : '';
    return `正在等待模型响应${attempt}`;
  }
  if (task.phase === 'mapping') return '正在等待模型映射三宝书；抽取已完成，构建仍在运行';
  if (task.phase === 'validating') return '正在审查问题与校验世界包';
  if (task.phase === 'publishing') return '正在保存并发布世界包';
  return '正在整合资料与准备后续构建步骤';
}

/** 最近活动时间 as HH:MM:SS (local); empty when unparsable. */
export function formatActivityClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Poll policy (library refresh): poll ONLY while at least one task is in a
 * dynamic state - running, requested control flag, waiting or retryable.
 * All-static lists (paused/stopped/completed leftovers) stop the timer, and
 * the poll itself reads local SQLite only, never the provider.
 */
export function isTaskListDynamic(tasks: readonly BuildTaskView[]): boolean {
  return tasks.some(task =>
    task.status === 'queued'
    || task.status === 'running'
    || task.status === 'waiting_network'
    || task.status === 'waiting_unlock'
    || task.status === 'failed_retryable'
    || task.pauseRequested
    || task.cancelRequested);
}

// ---------------------------------------------------------------------------
// Advanced build diagnostics (task §15) - high-level detail only, never the
// primary card surface. Aggregated from persisted unit usage ledgers.
// ---------------------------------------------------------------------------

export interface BuildTaskPerfStats {
  runId: string;
  /** Distinct chapters covered by the run's planned ranges. */
  chapterCount: number;
  /** Storage chunks covered (advanced detail; differs from batch count). */
  chunkCount: number;
  /** LLM batches planned (== unitsTotal). */
  batchCount: number;
  /** Chapter range of the batch currently running or next queued. */
  currentBatchChapterRange: string | null;
  /** Measured LLM usage summed over completed units (null = none yet). */
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    avgResponseMs: number;
  } | null;
  /** Frozen concurrency of the run, when the config is readable. */
  concurrency: number | null;
}

interface UsageMetric {
  durationMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
}

export async function listBuildTaskPerfStats(runId: string): Promise<BuildTaskPerfStats | null> {
  const runtime = await getDatabaseRuntime();
  const run = await runtime.db.queryOne<SqliteRow & {
    world_id: string;
    units_total: number;
    config_json: string | null;
  }>(
    'SELECT world_id, units_total, config_json FROM world_build_runs WHERE run_id = ?',
    [runId],
  );
  if (!run) return null;
  const units = await runtime.db.queryAll<SqliteRow & {
    status: string;
    source_ranges_json: string;
    usage_json: string | null;
  }>(
    'SELECT status, source_ranges_json, usage_json FROM world_build_units WHERE run_id = ? ORDER BY ord',
    [runId],
  );
  const chapterIds = new Set<string>();
  let currentBatchChapterRange: string | null = null;
  const titleRows = await runtime.db.queryAll<SqliteRow & { chapter_id: string; title: string | null }>(
    'SELECT chapter_id, title FROM source_chapters WHERE world_id = ?', [run.world_id],
  );
  const titleByChapter = new Map(titleRows.map(row => [row.chapter_id as string, row.title ?? '']));
  const chapterOrder: string[] = [];
  for (const unit of units) {
    let ranges: Array<{ chapterId?: string }> = [];
    try {
      const parsed = JSON.parse(unit.source_ranges_json) as {
        ranges?: Array<{ chapterId?: string }>;
      } | Array<{ chapterId?: string }>;
      ranges = Array.isArray(parsed) ? parsed : (parsed.ranges ?? []);
    } catch {
      ranges = [];
    }
    const unitChapters: string[] = [];
    for (const range of ranges) {
      const chapterId = typeof range.chapterId === 'string' ? range.chapterId : '';
      if (!chapterId) continue;
      if (!chapterIds.has(chapterId)) {
        chapterIds.add(chapterId);
        chapterOrder.push(chapterId);
      }
      if (!unitChapters.includes(chapterId)) unitChapters.push(chapterId);
    }
    if (!currentBatchChapterRange
      && (unit.status === 'running' || unit.status === 'queued')
      && unitChapters.length > 0) {
      const first = titleByChapter.get(unitChapters[0] ?? '') ?? unitChapters[0];
      const last = titleByChapter.get(unitChapters[unitChapters.length - 1] ?? '') ?? unitChapters[unitChapters.length - 1];
      currentBatchChapterRange = unitChapters.length === 1 ? first : `${first} ~ ${last}`;
    }
  }
  let usage: BuildTaskPerfStats['usage'] = null;
  let chunkCount = 0;
  const requests: Array<UsageMetric | undefined> = [];
  for (const unit of units) {
    if (!unit.usage_json) continue;
    try {
      const parsed = JSON.parse(unit.usage_json) as { requestMetrics?: UsageMetric[] };
      for (const metric of parsed.requestMetrics ?? []) requests.push(metric);
    } catch { /* malformed ledger rows are skipped, never fatal */ }
  }
  for (const unit of units) {
    try {
      const parsed = JSON.parse(unit.source_ranges_json) as {
        ranges?: Array<{ chunkId: string }>;
      } | Array<{ chunkId: string }>;
      const ranges = Array.isArray(parsed) ? parsed : (parsed.ranges ?? []);
      chunkCount += ranges.length;
    } catch { /* ignore */ }
  }
  const completed = requests.filter(Boolean) as UsageMetric[];
  if (completed.length > 0) {
    const sum = (pick: (usage: NonNullable<UsageMetric['usage']>) => number): number =>
      completed.reduce((total, metric) => total + (metric.usage ? pick(metric.usage) : 0), 0);
    usage = {
      requests: completed.length,
      inputTokens: sum(u => u.inputTokens ?? 0),
      outputTokens: sum(u => u.outputTokens ?? 0),
      reasoningTokens: sum(u => u.reasoningTokens ?? 0),
      cachedInputTokens: sum(u => u.cachedInputTokens ?? 0),
      avgResponseMs: Math.round(completed.reduce((total, metric) => total + (metric.durationMs ?? 0), 0) / completed.length),
    };
  }
  let concurrency: number | null = null;
  if (run.config_json) {
    try {
      const config = JSON.parse(run.config_json) as { concurrency?: number };
      concurrency = typeof config.concurrency === 'number' ? config.concurrency : null;
    } catch { concurrency = null; }
  }
  return {
    runId,
    chapterCount: chapterIds.size,
    chunkCount,
    batchCount: run.units_total,
    currentBatchChapterRange,
    usage,
    concurrency,
  };
}
