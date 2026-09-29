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
  /** Web SQL standard field; the affected-row count for UPDATE/DELETE. */
  rowsAffected?: number;
}

export interface ReactNativeSqliteDatabase {
  executeSql(
    sql: string,
    params?: readonly unknown[],
  ): Promise<
    | [ReactNativeSqlResultSet]
    | [unknown, ReactNativeSqlResultSet]
  >;
}

function unwrapResult(
  tuple:
    | [ReactNativeSqlResultSet]
    | [unknown, ReactNativeSqlResultSet],
): ReactNativeSqlResultSet {
  return tuple.length === 1 ? tuple[0] : tuple[1];
}

function rowsToArray<T extends SqliteRow>(result: ReactNativeSqlResultSet): T[] {
  const rows: T[] = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    rows.push(result.rows.item(i) as T);
  }
  return rows;
}

/**
 * react-native-sqlite-storage's callback transaction requires every executeSql
 * call to be scheduled synchronously inside the native callback. ShineWord's
 * domain transaction is intentionally async because it performs read/validate/
 * write steps. To preserve that semantic without escaping the native callback,
 * this adapter uses explicit BEGIN IMMEDIATE / COMMIT / ROLLBACK statements on
 * one database handle and serializes all logical transactions through a queue.
 *
 * Do not replace this with db.transaction(async tx => ...) unless the native
 * driver explicitly guarantees awaiting the returned Promise.
 */
export class ReactNativeSqliteAdapter implements SqliteDatabase {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly db: ReactNativeSqliteDatabase) {}

  async execute(sql: string, params: readonly unknown[] = []): Promise<number> {
    const result = unwrapResult(await this.db.executeSql(sql, params));
    return typeof result.rowsAffected === 'number' ? result.rowsAffected : 0;
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
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;
    try {
      await this.db.executeSql('BEGIN IMMEDIATE');
      const tx: SqliteTransaction = {
        execute: async (sql, params = []) => {
          const result = unwrapResult(await this.db.executeSql(sql, params));
          return typeof result.rowsAffected === 'number' ? result.rowsAffected : 0;
        },
        queryOne: async <R extends SqliteRow>(
          sql: string,
          params: readonly unknown[] = [],
        ): Promise<R | null> => {
          const result = unwrapResult(await this.db.executeSql(sql, params));
          return result.rows.length > 0 ? (result.rows.item(0) as R) : null;
        },
        queryAll: async <R extends SqliteRow>(
          sql: string,
          params: readonly unknown[] = [],
        ): Promise<R[]> => {
          const result = unwrapResult(await this.db.executeSql(sql, params));
          return rowsToArray<R>(result);
        },
      };

      const value = await work(tx);
      await this.db.executeSql('COMMIT');
      return value;
    } catch (error) {
      try {
        await this.db.executeSql('ROLLBACK');
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    } finally {
      release();
    }
  }
}
