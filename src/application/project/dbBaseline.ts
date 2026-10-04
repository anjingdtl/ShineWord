/**
 * Development database baseline (P8-8, plan §18.3): new empty databases
 * install the full current schema in ONE pass — no upgrade-chain replay —
 * and legacy dev schemas are detected and refused with an explicit reset
 * hint (A34). API/keychain configuration is a separate scope and is never
 * touched by a world/campaign reset (plan §18.3.4).
 */

import { BUILTIN_MIGRATIONS } from '../../infra/sqlite/builtinMigrations';
import type { SqliteDatabase } from '../ports/sqlite';

export const DB_BASELINE_VERSION = 'shineword-db-baseline-1';
/** First migration version of the phase-8 baseline (frozen-turn tables). */
export const PHASE8_BASELINE_FIRST_VERSION = 33;

export interface LegacyDatabaseCheck {
  legacy: boolean;
  reason: string;
}

/**
 * Detects a legacy development database: a populated pre-phase-8 schema (any
 * migration history below the phase-8 baseline while old tables exist).
 * Fresh empty databases (no tables at all) are NOT legacy — they install the
 * baseline directly.
 */
export async function detectLegacyDevelopmentDatabase(db: SqliteDatabase): Promise<LegacyDatabaseCheck> {
  const migrationRow = await db.queryOne<{ max_version: number }>(
    'SELECT MAX(version) AS max_version FROM schema_migrations',
  ).catch(() => null);
  if (!migrationRow) {
    // No migration bookkeeping at all — could be an empty file or a foreign
    // database. Distinguish by looking for a known old table.
    const oldTable = await db.queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('memories', 'llm_requests')",
    ).catch(() => null);
    if (oldTable && oldTable.n > 0) {
      return {
        legacy: true,
        reason: '数据库包含旧开发协议的表但没有当前协议的迁移记录；它不适用于当前协议（无转换路径）。请在开发设置中执行开发重置或创建新项目。',
      };
    }
    return { legacy: false, reason: 'empty or unknown database' };
  }
  const maxVersion = migrationRow.max_version ?? 0;
  if (maxVersion < PHASE8_BASELINE_FIRST_VERSION) {
    return {
      legacy: true,
      reason: `数据库迁移历史停留在 v${maxVersion}（低于第八阶段基线 v${PHASE8_BASELINE_FIRST_VERSION}）；旧开发数据不转换（plan §18.3.2）。请执行开发重置或创建新项目；API 配置与安全密钥链不受影响。`,
    };
  }
  return { legacy: false, reason: 'current protocol' };
}

export interface BaselineInstallResult {
  appliedVersions: number[];
  baselineVersion: string;
}

/**
 * Installs the full current schema on a NEW database. Implementation-wise it
 * replays the builtin migration list once (each migration is idempotent DDL
 * guarded by IF NOT EXISTS / recorded versions), then stamps the baseline
 * marker so future runs can distinguish baseline installs from upgrades.
 */
export async function installBaselineSchema(db: SqliteDatabase): Promise<BaselineInstallResult> {
  const { applySqliteMigrations } = await import('../../infra/sqlite/migrations');
  const appliedVersions = await applySqliteMigrations(db, BUILTIN_MIGRATIONS);
  const existing = await db.queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sqlite_master WHERE type = \'table\' AND name = \'shineword_baseline\'',
  );
  if (existing && existing.n > 0) {
    await db.execute(
      'INSERT OR REPLACE INTO shineword_baseline (baseline_version, installed_at) VALUES (?, ?)',
      [DB_BASELINE_VERSION, new Date().toISOString()],
    );
  }
  return { appliedVersions, baselineVersion: DB_BASELINE_VERSION };
}
