import type {
  SqliteDatabase,
  SqliteRow,
  SqliteTransaction,
} from '../../application/ports/sqlite';

export interface ReactNativeSqlResultSet {
  rows: {
    length: number;
    item(index: number): SqliteRow;
  };
}

export interface ReactNativeSqlTransaction {
  executeSql(
    sql: string,
    params?: readonly unknown[],
  ): Promise<[ReactNativeSqlTransaction, ReactNativeSqlResultSet]>;
}

export interface ReactNativeSqliteDatabase {
  executeSql(
    sql: string,
    params?: readonly unknown[],
  ): Promise<[ReactNativeSqlResultSet] | [ReactNativeSqlTransaction, ReactNativeSqlResultSet]>;
  transaction<T>(
    work: (tx: ReactNativeSqlTransaction) => Promise<T>,
  ): Promise<T>;
}

function rowsToArray<T extends SqliteRow>(result: ReactNativeSqlResultSet): T[] {
  const rows: T[] = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    rows.push(result.rows.item(i) as T);
  }
  return rows;
}

function unwrapResult(
  tuple:
    | [ReactNativeSqlResultSet]
    | [ReactNativeSqlTransaction, ReactNativeSqlResultSet],
): ReactNativeSqlResultSet {
  return tuple.length === 1 ? tuple[0] : tuple[1];
}

export class ReactNativeSqliteAdapter implements SqliteDatabase {
  constructor(private readonly db: ReactNativeSqliteDatabase) {}

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    await this.db.executeSql(sql, params);
  }

  async queryOne<T extends SqliteRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const result = unwrapResult(await this.db.executeSql(sql, params));
    return result.rows.length > 0 ? (result.rows.item(0) as T) : null;
  }

  async queryAll<T extends SqliteRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = unwrapResult(await this.db.executeSql(sql, params));
    return rowsToArray<T>(result);
  }

  async transaction<T>(
    work: (tx: SqliteTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async nativeTx =>
      work({
        execute: async (sql, params = []) => {
          await nativeTx.executeSql(sql, params);
        },
        queryOne: async <R extends SqliteRow>(
          sql: string,
          params: readonly unknown[] = [],
        ): Promise<R | null> => {
          const [, result] = await nativeTx.executeSql(sql, params);
          return result.rows.length > 0 ? (result.rows.item(0) as R) : null;
        },
        queryAll: async <R extends SqliteRow>(
          sql: string,
          params: readonly unknown[] = [],
        ): Promise<R[]> => {
          const [, result] = await nativeTx.executeSql(sql, params);
          return rowsToArray<R>(result);
        },
      }),
    );
  }
}
