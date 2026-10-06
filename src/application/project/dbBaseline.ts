import { BUILTIN_MIGRATIONS } from '../../infra/sqlite/builtinMigrations';
import { splitSqlStatements } from '../../infra/sqlite/migrations';
import type { SqliteDatabase } from '../ports/sqlite';

export const DB_BASELINE_VERSION = 'shineword-db-baseline-2';
export const PHASE9_BASELINE_FIRST_VERSION = 101;
/** Historical: phase-8 databases (version 100 / baseline-1) are legacy now. */
export const PHASE8_BASELINE_FIRST_VERSION = 100;
export interface LegacyDatabaseCheck { legacy: boolean; reason: string }
export class LegacyDevelopmentDatabaseError extends Error {
  constructor(message: string) { super(message); this.name = 'LegacyDevelopmentDatabaseError'; }
}

/** Refuse historical schemas before executing DDL or touching data. */
export async function detectLegacyDevelopmentDatabase(db: SqliteDatabase): Promise<LegacyDatabaseCheck> {
  const tables = await db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'android_metadata'");
  if (tables.length === 0) return { legacy: false, reason: 'empty database' };
  if (tables.some(t => t.name === 'shineword_baseline')) {
    const marker = await db.queryOne<{ baseline_version: string }>('SELECT baseline_version FROM shineword_baseline');
    const history = await db.queryAll<{ version: number }>('SELECT version FROM schema_migrations').catch(() => []);
    if (marker?.baseline_version === DB_BASELINE_VERSION && history.length === 1 && history[0]?.version === PHASE9_BASELINE_FIRST_VERSION) {
      // A marker alone does not prove that the fresh baseline finished installing.
      // Verify every declared table and column without modifying the database.
      const installed = new Set(tables.map(table => table.name));
      let complete = true;
      for (const statement of splitSqlStatements(BUILTIN_MIGRATIONS[0]!.sql)) {
        const declaration = /^CREATE TABLE (\w+)\s*\(([\s\S]*)\)$/i.exec(statement.trim());
        if (!declaration) continue;
        const name = declaration[1]!;
        if (!installed.has(name)) { complete = false; break; }
        const columns = await db.queryAll<{ name: string }>(`PRAGMA table_info(${name})`);
        const names = new Set(columns.map(column => column.name));
        const expected = [...declaration[2]!.matchAll(/(?:^|,)\s*(\w+)\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/gi)].map(match => match[1]!);
        if (expected.some(column => !names.has(column))) { complete = false; break; }
      }
      if (complete) return { legacy: false, reason: 'current protocol' };
    }
  }
  return { legacy: true, reason: '这是旧版或不完整的开发数据库。当前版本只接受新的第九阶段数据基线；请创建新的开发数据库。原数据库、API 配置和安全密钥保留。' };
}

export interface BaselineInstallResult { appliedVersions: number[]; baselineVersion: string }
export async function installBaselineSchema(db: SqliteDatabase): Promise<BaselineInstallResult> {
  const check = await detectLegacyDevelopmentDatabase(db);
  if (check.legacy) throw new LegacyDevelopmentDatabaseError(check.reason);
  if (check.reason === 'current protocol') return { appliedVersions: [], baselineVersion: DB_BASELINE_VERSION };
  await db.execute('PRAGMA foreign_keys = ON');
  await db.transaction(async tx => {
    await tx.execute('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const baseline = BUILTIN_MIGRATIONS[0]!;
    for (const sql of splitSqlStatements(baseline.sql)) await tx.execute(sql);
    const now = new Date().toISOString();
    await tx.execute('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)', [baseline.version, baseline.name, now]);
    await tx.execute('INSERT INTO shineword_baseline(baseline_version,installed_at) VALUES (?,?)', [DB_BASELINE_VERSION, now]);
  });
  return { appliedVersions: [PHASE9_BASELINE_FIRST_VERSION], baselineVersion: DB_BASELINE_VERSION };
}
