export interface SqliteRow {
  [key: string]: string | number | null;
}

export interface SqliteTransaction {
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  queryOne<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  queryAll<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface SqliteDatabase {
  /**
   * Runs a statement and resolves with the number of affected rows (0 for
   * readers/DDL). The count powers atomic compare-and-set claims under the
   * concurrent workers of the 1M resident build (plan §6): a conditional
   * UPDATE either matches or not, with no read/write race window.
   */
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  queryOne<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  queryAll<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(work: (tx: SqliteTransaction) => Promise<T>): Promise<T>;
}
