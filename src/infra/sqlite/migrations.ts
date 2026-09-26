import type { SqliteDatabase, SqliteRow } from '../../application/ports/sqlite';

export interface SqliteMigration {
  version: number;
  name: string;
  sql: string;
}

interface MigrationRow extends SqliteRow {
  version: number;
}

function assertMigrationSequence(migrations: readonly SqliteMigration[]): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Migration version must be a positive integer; received ${migration.version}.`);
    }
    if (migration.version <= previous) {
      throw new Error('Migrations must be supplied in strictly increasing version order.');
    }
    if (!migration.name.trim()) throw new Error(`Migration ${migration.version} requires a name.`);
    if (!migration.sql.trim()) throw new Error(`Migration ${migration.version} requires SQL.`);
    previous = migration.version;
  }
}

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

export async function applySqliteMigrations(
  db: SqliteDatabase,
  migrations: readonly SqliteMigration[],
  appliedAt: () => string = () => new Date().toISOString(),
): Promise<number[]> {
  assertMigrationSequence(migrations);

  await db.execute('PRAGMA foreign_keys = ON');
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );

  const rows = await db.queryAll<MigrationRow>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const applied = new Set(rows.map(row => row.version));
  const newlyApplied: number[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    await db.transaction(async tx => {
      for (const statement of splitSqlStatements(migration.sql)) {
        await tx.execute(statement);
      }
      await tx.execute(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.name, appliedAt()],
      );
    });
    newlyApplied.push(migration.version);
  }

  return newlyApplied;
}
