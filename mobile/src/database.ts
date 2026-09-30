import SQLite from 'react-native-sqlite-storage';
import { BUILTIN_MIGRATIONS } from '../../src/infra/sqlite/builtinMigrations';
import { applySqliteMigrations } from '../../src/infra/sqlite/migrations';
import { ReactNativeSqliteAdapter, type ReactNativeSqliteDatabase } from '../../src/infra/sqlite/reactNativeSqliteAdapter';
import { SqliteNarrativeStore } from '../../src/infra/sqlite/sqliteNarrativeStore';
import { SqliteTurnStore } from '../../src/infra/sqlite/sqliteTurnStore';
import { SqliteGameStore } from '../../src/infra/sqlite/sqliteGameStore';
import { SqliteWorldStore } from '../../src/infra/sqlite/sqliteWorldStore';
import { SqliteLlmLedgerStore } from '../../src/infra/sqlite/sqliteLlmLedgerStore';
import { SqliteStoryMemoryStore } from '../../src/application/memory/storyMemoryRepository';
import { recoverInterruptedAttempts } from '../../src/application/llm/requestLedger';
import { probeFts5 } from '../../src/infra/sqlite/ftsCapability';
import { SqliteSourceStore } from '../../src/infra/sqlite/sqliteSourceStore';
import { LocalSourceSearchService } from '../../src/application/search/localSourceSearch';
import { ProgressiveBuildQueue } from '../../src/application/progressiveBuild/progressiveBuildQueue';
import { ProgressiveTurnContextService } from '../../src/application/progressiveBuild/progressiveTurnContext';

SQLite.enablePromise(true);

export interface MobileDatabaseRuntime {
  db: ReactNativeSqliteAdapter;
  turns: SqliteTurnStore;
  narratives: SqliteNarrativeStore;
  game: SqliteGameStore;
  worldStore: SqliteWorldStore;
  sourceStore: SqliteSourceStore;
  llmLedger: SqliteLlmLedgerStore;
  storyMemory: SqliteStoryMemoryStore;
  sqliteCapabilities: { fts5: boolean };
  progressiveTurnContext: ProgressiveTurnContextService;
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
  const worldStore = new SqliteWorldStore(db);
  const sourceStore = new SqliteSourceStore(db);
  const sourceSearch = new LocalSourceSearchService(sourceStore, worldStore);
  const progressiveTurnContext = new ProgressiveTurnContextService(
    sourceStore,
    sourceSearch,
    new ProgressiveBuildQueue(),
  );
  const llmLedger = new SqliteLlmLedgerStore(db);
  // Cold-start recovery (infrastructure plan §53): attempts still marked
  // prepared/sent from a previous process become outcome_unknown; the
  // LedgeredProvider then refuses automatic replays of those requests.
  const recovered = await recoverInterruptedAttempts(llmLedger);
  if (recovered.recoveredAttemptIds.length > 0) {
    console.warn(
      `[llm-ledger] ${recovered.recoveredAttemptIds.length} interrupted attempt(s) marked outcome_unknown on cold start.`,
    );
  }

  // Phase 2: no implicit demo campaign. Every game is an explicit campaign
  // with a locked world package; existing demo-main data stays readable
  // through its campaign but is never auto-created or auto-selected.
  return {
    db,
    turns: new SqliteTurnStore(db),
    narratives: new SqliteNarrativeStore(db),
    game: new SqliteGameStore(db),
    worldStore,
    sourceStore,
    llmLedger,
    storyMemory: new SqliteStoryMemoryStore(db),
    sqliteCapabilities: { fts5 },
    progressiveTurnContext,
  };
}

export function getDatabaseRuntime(): Promise<MobileDatabaseRuntime> {
  if (!singleton) singleton = createRuntime();
  return singleton;
}
