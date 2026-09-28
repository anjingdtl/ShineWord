import SQLite from 'react-native-sqlite-storage';
import { BUILTIN_MIGRATIONS } from '../../src/infra/sqlite/builtinMigrations';
import { applySqliteMigrations } from '../../src/infra/sqlite/migrations';
import { ReactNativeSqliteAdapter, type ReactNativeSqliteDatabase } from '../../src/infra/sqlite/reactNativeSqliteAdapter';
import { SqliteNarrativeStore } from '../../src/infra/sqlite/sqliteNarrativeStore';
import { SqliteTurnStore } from '../../src/infra/sqlite/sqliteTurnStore';
import { SqliteGameStore } from '../../src/infra/sqlite/sqliteGameStore';
import { SqliteWorldStore } from '../../src/infra/sqlite/sqliteWorldStore';
import { probeFts5 } from '../../src/infra/sqlite/ftsCapability';

SQLite.enablePromise(true);

export interface MobileDatabaseRuntime {
  db: ReactNativeSqliteAdapter;
  turns: SqliteTurnStore;
  narratives: SqliteNarrativeStore;
  game: SqliteGameStore;
  worldStore: SqliteWorldStore;
  sqliteCapabilities: { fts5: boolean };
}

let singleton: Promise<MobileDatabaseRuntime> | null = null;

async function createRuntime(): Promise<MobileDatabaseRuntime> {
  const nativeDb = await SQLite.openDatabase({
    name: 'shineword.db',
    location: 'default',
  });
  const db = new ReactNativeSqliteAdapter(
    nativeDb as unknown as ReactNativeSqliteDatabase,
  );
  await applySqliteMigrations(db, BUILTIN_MIGRATIONS);
  const fts5 = await probeFts5(db);

  // Phase 2: no implicit demo campaign. Every game is an explicit campaign
  // with a locked world package; existing demo-main data stays readable
  // through its campaign but is never auto-created or auto-selected.
  return {
    db,
    turns: new SqliteTurnStore(db),
    narratives: new SqliteNarrativeStore(db),
    game: new SqliteGameStore(db),
    worldStore: new SqliteWorldStore(db),
    sqliteCapabilities: { fts5 },
  };
}

export function getDatabaseRuntime(): Promise<MobileDatabaseRuntime> {
  if (!singleton) singleton = createRuntime();
  return singleton;
}
