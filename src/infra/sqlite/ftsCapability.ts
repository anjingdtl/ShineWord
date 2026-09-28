import type { SqliteDatabase } from '../../application/ports/sqlite';

/** Runtime capability check. Callers still choose their own language tokenizer. */
export async function probeFts5(db: SqliteDatabase): Promise<boolean> {
  const table = 'temp.__shineword_fts5_probe';
  try {
    await db.execute(`CREATE VIRTUAL TABLE ${table} USING fts5(body)`);
    await db.execute(`DROP TABLE ${table}`);
    return true;
  } catch {
    try { await db.execute(`DROP TABLE IF EXISTS ${table}`); } catch { /* unsupported temp DDL */ }
    return false;
  }
}
