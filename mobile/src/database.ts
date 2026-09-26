import SQLite from 'react-native-sqlite-storage';
import { BUILTIN_MIGRATIONS } from '../../src/infra/sqlite/builtinMigrations';
import { applySqliteMigrations } from '../../src/infra/sqlite/migrations';
import { ReactNativeSqliteAdapter } from '../../src/infra/sqlite/reactNativeSqliteAdapter';
import { SqliteNarrativeStore } from '../../src/infra/sqlite/sqliteNarrativeStore';
import { SqliteTurnStore } from '../../src/infra/sqlite/sqliteTurnStore';

SQLite.enablePromise(true);

export interface MobileDatabaseRuntime {
  db: ReactNativeSqliteAdapter;
  turns: SqliteTurnStore;
  narratives: SqliteNarrativeStore;
}

let singleton: Promise<MobileDatabaseRuntime> | null = null;

async function createRuntime(): Promise<MobileDatabaseRuntime> {
  const nativeDb = await SQLite.openDatabase({
    name: 'shineword.db',
    location: 'default',
  });
  const db = new ReactNativeSqliteAdapter(nativeDb as unknown as {
    executeSql(sql: string, params?: readonly unknown[]): Promise<[unknown]>;
  });
  await applySqliteMigrations(db, BUILTIN_MIGRATIONS);

  const branch = await db.queryOne<{ branch_id: string }>(
    'SELECT branch_id FROM branches WHERE branch_id = ?',
    ['demo-main'],
  );
  if (!branch) {
    await db.transaction(async tx => {
      const createdAt = new Date().toISOString();
      await tx.execute(
        `INSERT INTO branches
          (branch_id, campaign_id, parent_branch_id, fork_turn_id, state_version, created_at)
         VALUES (?, ?, NULL, NULL, 0, ?)`,
        ['demo-main', 'demo-campaign', createdAt],
      );
      await tx.execute(
        `INSERT INTO actor_states
          (branch_id, actor_id, state_version, location_id, resources_json, conditions_json)
         VALUES (?, ?, 0, ?, ?, '[]')`,
        ['demo-main', 'actor-player', 'rainy-courtyard', JSON.stringify({ stamina: 10, hp: 10 })],
      );
      await tx.execute(
        `INSERT INTO snapshots
          (branch_id, state_version, snapshot_json, state_hash, created_at)
         VALUES (?, 0, ?, NULL, ?)`,
        [
          'demo-main',
          JSON.stringify({
            branchId: 'demo-main',
            stateVersion: 0,
            clockMinutes: 0,
            actors: {
              'actor-player': {
                actorId: 'actor-player',
                locationId: 'rainy-courtyard',
                resources: { stamina: 10, hp: 10 },
                conditions: [],
              },
            },
            itemOwners: {},
          }),
          createdAt,
        ],
      );
    });
  }

  return {
    db,
    turns: new SqliteTurnStore(db),
    narratives: new SqliteNarrativeStore(db),
  };
}

export function getDatabaseRuntime(): Promise<MobileDatabaseRuntime> {
  if (!singleton) singleton = createRuntime();
  return singleton;
}
