/**
 * M6b: real 10-turn campaign loop on 《白篱梦》 with real GLM.
 *
 * TXT import -> progressive opening dossier (verbatim-quote gated) ->
 * local package compile/publish -> campaign -> 10 real planner/narrator
 * turns -> background story-memory checkpoint + episodic recall checks.
 *
 * Bounded at MAX_PHYSICAL_REQUESTS. Writes only REDACTED metrics (no novel
 * text, no prompts, no narrative bodies, no credentials) to the artifacts
 * directory.
 *
 * Usage: node tools/real-glm-bailimeng.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const D = relative => require(path.join(ROOT, 'dist', relative));

const { importTxtSource } = D('application/import/txtImport');
const { OpenAICompatibleProvider } = D('application/llm/openAICompatible');
const { MemorySecretStore } = D('application/llm/memorySecretStore');
const { SqliteLlmLedgerStore } = D('infra/sqlite/sqliteLlmLedgerStore');
const { SqliteStoryMemoryStore } = D('application/memory/storyMemoryRepository');
const { SqliteEpisodicStore } = D('application/memory/episodicStore');
const { applySqliteMigrations } = D('infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = D('infra/sqlite/builtinMigrations');
const { SqliteTurnStore } = D('infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = D('infra/sqlite/sqliteGameStore');
const { SqliteWorldStore } = D('infra/sqlite/sqliteWorldStore');
const { SqliteNarrativeStore } = D('infra/sqlite/sqliteNarrativeStore');
const { extractOpeningDossier, compileProgressiveOpeningPackage, openingSourceBudgetForProfile } = D('application/worldPackage/progressiveOpening');
const { publishWorldPackage } = D('application/worldPackage/publish');
const { createCampaign } = D('application/campaign/createCampaign');
const { CampaignSession } = D('application/campaign/session');
const { DatabaseSync } = require('node:sqlite');

const NOVEL_PATH = 'C:/Users/anjin/Desktop/Ai工作坊/《白篱梦》.TXT';
const KEY_FILE = 'C:/Users/anjin/Desktop/Ai工作坊/Test-API/GLM-TEST-KEY.TXT';
const MAX_PHYSICAL_REQUESTS = 30;
const MEMORY_WAIT_MS = 240_000;

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await work(this); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

class FetchTransport {
  async post(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally { clearTimeout(timer); }
  }
}

const sha = {
  sha256Hex: value => crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
  sha256BytesHex: bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
};

const TURN_INTENTS = [
  '与院中那位自称白氏的女子搭话，询问此地与她的来历',                                  // 1 对话
  '郑重地把随身的素银玉簪交给白氏作为信物，与她约定三日后的月圆之夜在临水亭再见',        // 2 约定事件（recall 目标）
  '安静地观察院中陈设、门户与四周动静',                                                // 3 观察
  '用观察的本领仔细检视屏风后面是否有暗格或夹层',                                      // 4 技能检定（倾向成功）
  '不顾疲累强行翻越院墙，直接跳到墙外的小巷',                                          // 5 高难检定（倾向失败）
  '穿过月洞门，前往宅子的正厅',                                                        // 6 移动
  '把玉簪信物与三日之约告诉身边的同伴，商议届时该做什么准备',                            // 7 人物互动
  '向白氏请缨：接下替她寻回失落于旧宅的那只妆匣的请求',                                // 8 Quest
  '当着白氏的面提起三日之约与那支素银玉簪，确认她仍记得临水亭的月圆之会',              // 9 历史事件再次提及（T2 recall）
  '整理这几日的见闻，向白氏辞行并为月圆之夜做打算',                                    // 10 收束
];

const report = {
  generatedAt: new Date().toISOString(),
  novel: null,
  importMs: null,
  opening: null,
  turns: [],
  memory: null,
  episodic: null,
  ledger: null,
  recallCheck: null,
};

function parseKeyFile() {
  const raw = fs.readFileSync(KEY_FILE, 'utf8');
  const info = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (m) info[m[1].trim()] = m[2].trim();
  }
  return { key: info['api key'], endpoint: info['端点'], model: info['模型'] };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const { key, endpoint, model } = parseKeyFile();
  console.log(`credentialLoaded=true model=${model}`);

  // ------------------------------------------------------------------ import
  const bytes = fs.readFileSync(NOVEL_PATH);
  const importStart = Date.now();
  const parsed = await importTxtSource(new Uint8Array(bytes), sha, {
    decode(raw, encoding) { return new TextDecoder(encoding).decode(raw); },
  });
  report.importMs = Date.now() - importStart;
  report.novel = {
    file: path.basename(NOVEL_PATH),
    sha256: parsed.sourceSha256Hex,
    bytes: bytes.length,
    codePoints: parsed.codePointCount,
    chapters: parsed.chapters.length,
    chunks: parsed.chunks.length,
    splitStrategy: parsed.splitStrategy,
  };
  console.log(`[import] ${report.importMs}ms chapters=${parsed.chapters.length} codePoints=${parsed.codePointCount}`);

  // ------------------------------------------------------------------- world
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const worldStore = new SqliteWorldStore(adapter);
  const worldId = 'world-m6b';
  await worldStore.createWorld({
    worldId, title: '白篱梦-M6b', sourceSha256: parsed.sourceSha256Hex, sourceBytes: bytes.length,
    normalizeVersion: parsed.normalizeVersion, chapterSplitVersion: parsed.chapterSplitVersion,
    buildStatus: 'ready', createdAt: 't', updatedAt: 't',
  });
  // Chapter/chunk rows back the evidence-span foreign keys.
  await worldStore.saveImportedSource(worldId, parsed, 't');

  const secrets = new MemorySecretStore();
  await secrets.set('glm.test', key);
  const profile = {
    id: 'glm-test', name: 'GLM test', endpoint, model, keyRef: 'glm.test',
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 1_048_576, maxOutputTokens: 32_768 },
    reasoningEffort: 'low', reasoningReserveTokens: 2_048,
  };

  let physical = 0;
  const rawProvider = new OpenAICompatibleProvider(profile, secrets, new FetchTransport(), 240_000);
  const ledgerStore = new SqliteLlmLedgerStore(adapter);
  const counting = {
    async complete(request) {
      physical += 1;
      if (physical > MAX_PHYSICAL_REQUESTS) throw new Error(`physical budget exceeded: ${physical}`);
      const response = await rawProvider.complete(request);
      if (request.ledger) {
        // Record into the durable ledger just like the session would.
        const attempt = await ledgerStore.beginAttempt({
          logicalRequestId: request.ledger.logicalRequestId,
          requestKind: request.ledger.requestKind,
          branchId: request.ledger.branchId,
          stateVersion: request.ledger.stateVersion,
          modelProfileFingerprint: 'glm-m6b',
        }, Date.now());
        await ledgerStore.updateAttempt(attempt.attemptId, { status: 'sent' });
        await ledgerStore.updateAttempt(attempt.attemptId, {
          status: 'succeeded',
          inputTokens: response.usage?.inputTokens ?? null,
          outputTokens: response.usage?.outputTokens ?? null,
          reasoningTokens: response.usage?.reasoningTokens ?? null,
          cachedInputTokens: response.usage?.cachedInputTokens ?? null,
          estimatedUsage: response.usage?.estimated ? 1 : 0,
          finishedAt: Date.now(),
        });
      }
      return response;
    },
  };

  // ------------------------------------------------------- progressive opening
  const budget = openingSourceBudgetForProfile(profile, parsed.codePointCount);
  const sourceExcerpt = Array.from(parsed.text).slice(0, budget.sourceCodePoints).join('');
  const dossierStart = Date.now();
  const dossierResult = await extractOpeningDossier({
    provider: counting, sourceExcerpt, maxOutputTokens: budget.maxOutputTokens,
  });
  const compileResult = await compileProgressiveOpeningPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId,
    sourceSha256: parsed.sourceSha256Hex, sourceExcerpt,
    sourceEndCodePoint: budget.sourceCodePoints,
    chapters: await worldStore.getChapters(worldId),
    dossier: dossierResult.dossier,
    requestMetrics: dossierResult.requestMetrics, usage: dossierResult.usage,
    extractionMs: Date.now() - dossierStart, createdAt: new Date().toISOString(),
  });
  const published = await publishWorldPackage({
    worldStore, sha256Hex: sha.sha256Hex, worldId,
    sourceSha256: parsed.sourceSha256Hex, mappingVersion: 'm6b-1',
    entries: compileResult.entries, sections: compileResult.sections,
    createdAt: new Date().toISOString(),
  });
  report.opening = {
    ms: Date.now() - dossierStart,
    physicalRequests: dossierResult.physicalRequests,
    repairUsed: dossierResult.repairUsed,
    revision: published.manifest.revision,
    entries: compileResult.entries.length,
  };
  console.log(`[opening] ${report.opening.ms}ms revision=${published.manifest.revision} entries=${compileResult.entries.length}`);

  // ---------------------------------------------------------------- campaign
  const campaignId = 'camp-m6b';
  const created = await createCampaign({
    db: adapter, worldStore, campaignId, title: '白篱梦十回合', worldId,
    packageRevision: published.manifest.revision,
    anchor: { worldTimeOrder: 0, locationId: `${worldId}-opening-location` },
    protagonist: {
      actorId: 'actor-mei', kind: 'original', name: '梅映雪',
      attributes: { physique: 2, agility: 3, insight: 3, knowledge: 2, willpower: 2, social: 2 },
      initialSkills: ['stealth', 'observation', 'diplomacy', 'medicine', 'athletics'],
    },
    goal: '弄清白篱院隐藏的秘密', createdAt: new Date().toISOString(),
  });
  console.log(`[campaign] ${campaignId} branch=${created.branchId}`);

  // ------------------------------------------------------------- 10 turns
  const turns = new SqliteTurnStore(adapter);
  const session = new CampaignSession({
    db: adapter, turns, game: new SqliteGameStore(adapter), worldStore,
    narratives: new SqliteNarrativeStore(adapter),
    llmLedger: ledgerStore,
    storyMemory: { store: new SqliteStoryMemoryStore(adapter) },
    episodic: { store: new SqliteEpisodicStore(adapter) },
    hashProvider: sha,
    random: { nextIntInclusive: (min, max) => min + Math.floor(Math.random() * (max - min + 1)) },
  }, counting, profile);

  for (let i = 0; i < TURN_INTENTS.length; i += 1) {
    const intent = TURN_INTENTS[i];
    const turnStart = Date.now();
    try {
      const result = await session.playTurn({
        campaignId, branchId: created.branchId, intent,
      });
      const contexts = session.lastTurnContexts;
      const recallCandidate = contexts.planner?.included.find(item => item.id === 'episodic-recall');
      report.turns.push({
        n: i + 1, turnId: result.turnId, stateVersion: result.stateVersion,
        grade: result.grade, dice: result.dice ?? null, resumed: result.resumed,
        narrativeChars: result.text.length, ms: Date.now() - turnStart,
        plannerBoards: [...new Set((contexts.planner?.included ?? []).map(item => item.board))],
        narratorBoards: [...new Set((contexts.narrator?.included ?? []).map(item => item.board))],
        recall: recallCandidate
          ? { included: true, chars: recallCandidate.text.length, mentionsTurn2: /t-0002|turn-0002/.test(recallCandidate.text) }
          : { included: false },
      });
      console.log(`[turn ${i + 1}] grade=${result.grade} ${Date.now() - turnStart}ms narrative=${result.text.length}ch recall=${report.turns[i].recall.included}`);
    } catch (error) {
      report.turns.push({ n: i + 1, failed: true, error: error.message.slice(0, 200), ms: Date.now() - turnStart });
      console.error(`[turn ${i + 1}] FAILED: ${error.message.slice(0, 160)}`);
    }
    // Give the background memory maintenance a beat between turns.
    await sleep(1_500);
  }

  // -------------------------------------------------- wait for memory checkpoint
  const memoryStore = new SqliteStoryMemoryStore(adapter);
  const memoryDeadline = Date.now() + MEMORY_WAIT_MS;
  let memoryState = await memoryStore.getState(created.branchId);
  while (Date.now() < memoryDeadline) {
    memoryState = await memoryStore.getState(created.branchId);
    if (memoryState && memoryState.metadata.status !== 'rebuilding'
      && (memoryState.throughStateVersion >= 8 || memoryState.metadata.status === 'clean')
      && memoryState.throughStateVersion >= 8) break;
    await sleep(3_000);
  }
  memoryState = await memoryStore.getState(created.branchId);
  report.memory = memoryState ? {
    status: memoryState.metadata.status,
    through: memoryState.throughStateVersion,
    fingerprintPrefix: memoryState.metadata.fingerprint.slice(0, 8),
    characters: Object.keys(memoryState.characters).length,
    relationships: Object.keys(memoryState.relationships).length,
    conflicts: Object.keys(memoryState.narrative.activeConflicts).length,
    threads: Object.keys(memoryState.narrative.openThreads).length,
    beats: memoryState.narrative.recentCompletedBeats.length,
    lastPatch: memoryState.metadata.lastAppliedPatchId,
  } : null;
  console.log(`[memory] ${JSON.stringify(report.memory)}`);

  // ---------------------------------------------------------------- episodic
  const episodicStore = new SqliteEpisodicStore(adapter);
  const records = await episodicStore.listRecords(created.branchId);
  report.episodic = { rows: records.length, versions: records.map(r => r.stateVersion) };
  console.log(`[episodic] rows=${records.length}`);

  // ------------------------------------------------------------------ ledger
  const ledgerRows = await adapter.queryAll(
    'SELECT request_kind, status, COUNT(*) AS n FROM llm_request_attempts GROUP BY request_kind, status',
  );
  const ledgerUsage = await adapter.queryOne(
    'SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(reasoning_tokens) AS reasoning, SUM(cached_input_tokens) AS cached FROM llm_request_attempts',
  );
  report.ledger = { byKind: ledgerRows, usage: ledgerUsage, physicalRequests: physical };
  console.log(`[ledger] ${JSON.stringify(ledgerRows)} usage=${JSON.stringify(ledgerUsage)}`);

  // -------------------------------------------------------------- recall check
  const turn9 = report.turns.find(turn => turn.n === 9);
  report.recallCheck = {
    earlyEventTurn: 2,
    mentionTurn: 9,
    recallCandidatePresentAt9: Boolean(turn9?.recall?.included),
    recallMentionsTurn2: Boolean(turn9?.recall?.mentionsTurn2),
  };
  console.log(`[recall] ${JSON.stringify(report.recallCheck)}`);

  const artifactsDir = path.join(ROOT, 'docs/reviews/llm-memory/artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const outPath = path.join(artifactsDir, 'm6b-bailimeng-10turns.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`report -> ${path.relative(ROOT, outPath)}`);
}

main().catch(error => {
  console.error('m6b harness error:', error.message);
  fs.writeFileSync(path.join(ROOT, 'docs/reviews/llm-memory/artifacts/m6b-bailimeng-10turns.json'),
    JSON.stringify({ ...report, error: error.message.slice(0, 300) }, null, 2));
  process.exitCode = 1;
});
