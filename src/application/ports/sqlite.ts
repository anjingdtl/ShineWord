export interface SqliteRow {
  [key: string]: string | number | null;
}

export interface SqliteTransaction {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  queryOne<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  queryAll<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface SqliteDatabase {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  queryOne<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  queryAll<T extends SqliteRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(work: (tx: SqliteTransaction) => Promise<T>): Promise<T>;
}
