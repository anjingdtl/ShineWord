import { nativeSha256 } from './nativeCrypto';
import { SourceCatalogAdapter } from '../../src/application/sourceIndex/sourceCatalog';
import { PersistentSourceSearchService } from '../../src/application/sourceIndex/persistentSourceSearch';
import { SqliteSourceIndexStore } from '../../src/infra/sqlite/sqliteSourceIndexStore';
import { ProjectStyleService } from '../../src/application/writerStyle/projectStyleService';
import { SqliteWriterStyleStore } from '../../src/infra/sqlite/sqliteWriterStyleStore';
import { SqliteSchedulerResourceStore } from '../../src/infra/sqlite/sqliteSchedulerResourceStore';
import { configureSchedulerPersistence } from './llmScheduler';
import { SqliteSegmentPlanStore } from '../../src/infra/sqlite/sqliteSegmentPlanStore';
import { SqliteSegmentExecutionConfigStore } from '../../src/infra/sqlite/sqliteSegmentExecutionConfigStore';
import { SqliteSegmentArtifactStore } from '../../src/infra/sqlite/sqliteSegmentArtifactStore';
import { SegmentPublicationService } from '../../src/application/segmentPublication/service';
import { SqliteBuildRunStore } from '../../src/infra/sqlite/sqliteBuildRunStore';
import { ExistingBuildExecutor } from '../../src/application/segmentBuild/existingBuildExecutor';
import { SegmentBuildService } from '../../src/application/segmentBuild/segmentBuildService';
import { SqliteOpeningSurveyStore } from '../../src/infra/sqlite/sqliteOpeningSurveyStore';
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
import { SqliteEpisodicStore } from '../../src/application/memory/episodicStore';
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
  episodic: SqliteEpisodicStore;
  sqliteCapabilities: { fts5: boolean };
  progressiveTurnContext: ProgressiveTurnContextService;
  sourceCatalog: SourceCatalogAdapter;
  sourceIndex: PersistentSourceSearchService;
  sourceIndexStore: SqliteSourceIndexStore;
  writerStyleStore: SqliteWriterStyleStore;
  projectStyle: ProjectStyleService;
  segmentPlans: SqliteSegmentPlanStore;
  segmentConfigs: SqliteSegmentExecutionConfigStore;
  segmentArtifacts: SqliteSegmentArtifactStore;
  segmentPublication: SegmentPublicationService;
  segments: SegmentBuildService;
  openingSurveys: SqliteOpeningSurveyStore;
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
  const sourceCatalog = new SourceCatalogAdapter(sourceStore, worldStore, nativeSha256);
  const sourceIndexStore = new SqliteSourceIndexStore(db, { maxPages: 4096 });
  const sourceIndex = new PersistentSourceSearchService(sourceCatalog, sourceStore, worldStore, sourceIndexStore, nativeSha256);
  const sourceSearch = new LocalSourceSearchService(sourceStore, worldStore, sourceIndex);
  const writerStyleStore = new SqliteWriterStyleStore(db);
  const projectStyle = new ProjectStyleService({ store: writerStyleStore, hash: nativeSha256 });
  const segmentPlans = new SqliteSegmentPlanStore(db);
  const segmentConfigs = new SqliteSegmentExecutionConfigStore(db, nativeSha256);
  const segmentArtifacts = new SqliteSegmentArtifactStore(db, nativeSha256.sha256Hex);
  const segmentPublication = new SegmentPublicationService({ store: segmentArtifacts, worldStore, sourceCatalog, sha256Hex: nativeSha256.sha256Hex });
  const runs = new SqliteBuildRunStore(db);
  const llmLedger = new SqliteLlmLedgerStore(db);
  const executor = new ExistingBuildExecutor({ sources: sourceStore, worlds: worldStore, runs, catalog: sourceCatalog, ledger: llmLedger,
    config: (worldId, fingerprint) => segmentConfigs.get(worldId, fingerprint), sha256Hex: async input => nativeSha256.sha256Hex(input),
    control: async (runId, command) => { await runs.requestRunControl(runId, command, new Date().toISOString()); } });
  const segments = new SegmentBuildService({ store: segmentPlans, catalog: sourceCatalog, executor,
    artifacts: segmentPublication, branchContent: segmentPublication, sha256Hex: nativeSha256.sha256Hex });
  configureSchedulerPersistence(new SqliteSchedulerResourceStore(db));
  const progressiveTurnContext = new ProgressiveTurnContextService(
    sourceStore,
    sourceSearch,
    new ProgressiveBuildQueue(),
  );
  // Cold-start recovery (infrastructure plan §53): attempts still marked
  // prepared/sent from a previous process become outcome_unknown; the
  // LedgeredProvider then refuses automatic replays of those requests.
  const recovered = await recoverInterruptedAttempts(llmLedger);
  if (recovered.recoveredAttemptIds.length > 0) {
    console.warn(
      `[llm-ledger] ${recovered.recoveredAttemptIds.length} interrupted attempt(s) marked outcome_unknown on cold start.`,
    );
  }

  await projectStyle.recoverAllInterruptedAnalyses();

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
    episodic: new SqliteEpisodicStore(db),
    sqliteCapabilities: { fts5 },
    progressiveTurnContext,
    sourceCatalog, sourceIndex, sourceIndexStore, writerStyleStore, projectStyle,
    segmentPlans, segmentConfigs, segmentArtifacts, segmentPublication, segments,
    openingSurveys: new SqliteOpeningSurveyStore(db),
  };
}

export function getDatabaseRuntime(): Promise<MobileDatabaseRuntime> {
  if (!singleton) singleton = createRuntime();
  return singleton;
}
