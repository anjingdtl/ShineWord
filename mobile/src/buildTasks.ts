/**
 * DB-backed build task views for the library and notifications (closeout C4).
 *
 * The world_build_runs tables are the single source of truth: the task card,
 * the in-page progress and (from C5 on) the system notification all render
 * from these snapshots, so re-entering the page or restarting the process
 * shows the REAL persisted state - never a reset-to-zero or a synthetic
 * percentage.
 */
import { getDatabaseRuntime } from './database';
import type { BuildRunRecord, BuildUnitRecord } from '../../src/application/ports/worldBuildStore';
import type { SqliteRow } from '../../src/application/ports/sqlite';

export interface BuildTaskView {
  runId: string;
  worldId: string;
  title: string;
  fileName: string | null;
  phase: BuildRunRecord['phase'];
  status: BuildRunRecord['status'];
  unitsDone: number;
  unitsTotal: number;
  unitsFailed: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
  /** True while another executor holds a live lease. */
  leaseHeld: boolean;
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
}

/** Runs that are not finished - what the task card list shows. */
export async function listOpenBuildTasks(): Promise<BuildTaskView[]> {
  const runtime = await getDatabaseRuntime();
  const rows = await runtime.db.queryAll<TaskRow>(
    `SELECT r.run_id, r.world_id, r.phase, r.status, r.units_done, r.units_total,
            r.units_failed, r.lease_owner, r.lease_expires_at,
            r.last_error_code, r.last_error_message, r.updated_at,
            s.title, s.file_name
       FROM world_build_runs r
       LEFT JOIN imported_sources s ON s.source_id = r.source_id
      WHERE r.status NOT IN ('completed', 'failed_terminal', 'canceled')
      ORDER BY r.updated_at DESC`,
  );
  const now = Date.now();
  return rows.map(row => ({
    runId: row.run_id,
    worldId: row.world_id,
    title: row.title ?? row.file_name ?? row.run_id,
    fileName: row.file_name,
    phase: row.phase as BuildRunRecord['phase'],
    status: row.status as BuildRunRecord['status'],
    unitsDone: row.units_done,
    unitsTotal: row.units_total,
    unitsFailed: row.units_failed,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    updatedAt: row.updated_at,
    leaseHeld: Boolean(row.lease_owner) && Boolean(row.lease_expires_at)
      && Date.parse(row.lease_expires_at as string) > now,
  }));
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
      ORDER BY ord LIMIT 10`,
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
  validating: '发布校验',
  publishing: '发布',
};

export const RUN_STATUS_LABEL: Record<BuildRunRecord['status'], string> = {
  queued: '排队中',
  running: '进行中',
  waiting_network: '等待网络',
  waiting_unlock: '等待解锁',
  paused_system: '系统限制暂停',
  paused_user: '已暂停',
  failed_retryable: '待重试',
  needs_review: '需要处理',
  failed_terminal: '失败',
  canceled: '已取消',
  completed: '已完成',
};

/** Real measured progress line - counts only, no synthetic percentage. */
export function taskProgressLine(task: BuildTaskView): string {
  if (task.status === 'completed') return '已完成';
  const label = PHASE_LABEL[task.phase] ?? task.phase;
  if (task.unitsTotal > 0) {
    const failed = task.unitsFailed > 0 ? ` · ${task.unitsFailed} 待重试` : '';
    return `${label} ${task.unitsDone}/${task.unitsTotal} 组${failed}`;
  }
  return label;
}
