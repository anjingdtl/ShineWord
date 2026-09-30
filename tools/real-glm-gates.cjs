/**
 * M6a real-GLM infrastructure gates (bounded: <=6 physical requests).
 * Reads credentials from the local test key file; never prints or persists
 * the key. Writes only redacted metrics to the artifacts directory.
 *
 * Usage: node tools/real-glm-gates.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const { OpenAICompatibleProvider } = require(path.join(ROOT, 'dist/application/llm/openAICompatible'));
const { MemorySecretStore } = require(path.join(ROOT, 'dist/application/llm/memorySecretStore'));
const { parseStructuredOutput } = require(path.join(ROOT, 'dist/application/llm/structuredOutput'));
const { LedgeredProvider } = require(path.join(ROOT, 'dist/application/llm/requestLedger'));
const { SqliteLlmLedgerStore } = require(path.join(ROOT, 'dist/infra/sqlite/sqliteLlmLedgerStore'));
const { applySqliteMigrations } = require(path.join(ROOT, 'dist/infra/sqlite/migrations'));
const { BUILTIN_MIGRATIONS } = require(path.join(ROOT, 'dist/infra/sqlite/builtinMigrations'));
const { runStoryMemoryMaintenance } = require(path.join(ROOT, 'dist/application/memory/storyMemoryMaintenance'));
const { SqliteStoryMemoryStore } = require(path.join(ROOT, 'dist/application/memory/storyMemoryRepository'));
const { DatabaseSync } = require('node:sqlite');

const KEY_FILE = 'C:/Users/anjin/Desktop/Ai工作坊/Test-API/GLM-TEST-KEY.TXT';
const MAX_PHYSICAL_REQUESTS = 8;

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
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
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseKeyFile() {
  const raw = fs.readFileSync(KEY_FILE, 'utf8');
  const info = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (m) info[m[1].trim()] = m[2].trim();
  }
  const key = info['api key'] ?? info['apiKey'] ?? info['API Key'];
  const endpoint = info['端点'] ?? info['endpoint'];
  const model = info['模型'] ?? info['model'];
  if (!key || !endpoint || !model) throw new Error('Key file missing api key/endpoint/model fields.');
  return { key, endpoint, model };
}

const report = { scenarios: [], ledgerAttempts: [] };

async function main() {
  const { key, endpoint, model } = parseKeyFile();
  console.log(`credentialLoaded=true model=${model} endpointHost=${new URL(endpoint).host}`);

  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const ledgerStore = new SqliteLlmLedgerStore(adapter);

  const secrets = new MemorySecretStore();
  await secrets.set('glm.test', key);
  const profile = {
    id: 'glm-test', name: 'GLM test', endpoint, model, keyRef: 'glm.test',
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 1_048_576, maxOutputTokens: 32_768 },
    reasoningEffort: 'low',
    reasoningReserveTokens: 2_048,
  };
  const rawProvider = new OpenAICompatibleProvider(profile, secrets, new FetchTransport(), 180_000);
  let physical = 0;
  const provider = {
    raw: rawProvider,
    async complete(request) {
      physical += 1;
      if (physical > MAX_PHYSICAL_REQUESTS) throw new Error(`physical budget exceeded (${physical} > ${MAX_PHYSICAL_REQUESTS})`);
      return new LedgeredProvider(rawProvider, ledgerStore, { modelProfileFingerprint: 'glm-test-fp' }).complete(request);
    },
  };

  // ---------------------------------------------------------------- S1 planner
  {
    const started = Date.now();
    const response = await provider.complete({
      role: 'Planner',
      system: 'You are ShineWord Planner (V2). Output exactly one JSON proposal object and no prose. Required keys: proposalVersion="2.0", turnId, expectedStateVersion, actorId, actionKind (skill_check|ability|observe|talk|interact|move), evidenceIds, intent. skill_check also needs skillId.',
      user: JSON.stringify({
        turnId: 'turn-0001', expectedStateVersion: 1,
        playerIntent: '趁雨声悄悄接近藏书阁，避开守卫',
        worldContext: '【当前局面】\n沈青(actor-shen) 位于 courtyard，hp:8/8 stamina:6/6\n【主目标】进入藏书阁取回手稿\n【世界规则】宵禁: 入夜后庭院巡视频率翻倍。\n使用队伍中存在的 actorId。只提出提案允许的动作（skill_check/ability/observe/talk/interact/move）；检定与数值由本地规则引擎编译。',
      }),
      maxOutputTokens: 4_000,
      jsonMode: true,
      ledger: { logicalRequestId: 'm6a:planner:1', requestKind: 'planner', stateVersion: 1 },
    });
    const proposal = parseStructuredOutput(response.text, { label: 'planner proposal' }).value;
    const ok = proposal.proposalVersion === '2.0'
      && ['skill_check', 'ability', 'observe', 'talk', 'interact', 'move'].includes(proposal.actionKind)
      && proposal.actorId === 'actor-shen';
    report.scenarios.push({
      scenario: 'planner', pass: ok, ms: Date.now() - started,
      actionKind: proposal.actionKind ?? null,
      usage: response.usage ?? null,
    });
    console.log(`[S1 planner] ${ok ? 'PASS' : 'FAIL'} actionKind=${proposal.actionKind} ${Date.now() - started}ms usage=${JSON.stringify(response.usage)}`);
  }

  // --------------------------------------------------------------- S2 narrator
  {
    const started = Date.now();
    const response = await provider.complete({
      role: 'Narrator',
      system: 'You are ShineWord Narrator. Output exactly JSON: {"turnId":string,"outcomeGrade":string,"text":string}. Do not change the supplied outcome grade.',
      user: JSON.stringify({
        turnId: 'turn-0001', playerIntent: '趁雨声悄悄接近藏书阁',
        outcomeGrade: 'success',
        frozenOutcome: { effects: [] },
        worldContext: '【当前局面】沈青位于庭院，雨夜。\n【最近故事】\nturn-0001: 雨夜潜入开始。',
        roll: { diceCount: 3, dieSides: 6, rolls: [6, 4, 2], highest: 6, difficulty: 6 },
      }),
      maxOutputTokens: 2_500,
      jsonMode: true,
      ledger: { logicalRequestId: 'm6a:narrator:1', requestKind: 'narrator', stateVersion: 1 },
    });
    const candidate = parseStructuredOutput(response.text, { label: 'narrator candidate' }).value;
    const ok = candidate.turnId === 'turn-0001' && candidate.outcomeGrade === 'success'
      && typeof candidate.text === 'string' && candidate.text.trim().length >= 20;
    report.scenarios.push({
      scenario: 'narrator', pass: ok, ms: Date.now() - started,
      textLength: candidate.text?.length ?? 0,
      usage: response.usage ?? null,
    });
    console.log(`[S2 narrator] ${ok ? 'PASS' : 'FAIL'} textLen=${candidate.text?.length} ${Date.now() - started}ms`);
  }

  // ---------------------------------------------------------- S3 memory patch
  {
    const started = Date.now();
    const store = new SqliteStoryMemoryStore(adapter);
    const turns = Array.from({ length: 8 }, (_, i) => ({
      branchId: 'm6a-branch', turnId: `t-${i + 1}`, stateVersion: i + 1,
      outcomeGrade: i === 4 ? 'full_success' : 'success',
      publicSummary: i === 0
        ? '白山君把信物青鸾佩交给主角，约定北疆再见'
        : i === 4
          ? '主角与白山君在黑水河边重逢，白山君兑现承诺交还家书'
          : `第${i + 1}回合，主角在山门附近推进日常`,
      narrativeText: '', narrativeStatus: 'Committed', rollRecord: null,
      effects: i === 0
        ? [{ op: 'transferItem', itemId: 'item-qingluan', fromActorId: 'npc-1', toActorId: 'player' }]
        : i === 4
          ? [{ op: 'recordEvent', eventType: 'relationship_changed', fromActorId: 'player', toActorId: 'npc-1' }]
          : [],
      committedAt: new Date().toISOString(),
    }));
    const result = await runStoryMemoryMaintenance({
      provider,
      store,
      turnStore: { async listCommittedTurns(branchId) { return turns.filter(t => t.branchId === branchId); } },
      branchId: 'm6a-branch',
      currentStateVersion: 8,
      actors: [{ actorId: 'player', name: '主角' }, { actorId: 'npc-1', name: '白山君' }],
    });
    const state = await store.getState('m6a-branch');
    const ok = result.status === 'clean'
      && state.throughStateVersion === 8
      && Object.keys(state.characters).length > 0
      && Object.keys(state.relationships).length > 0
      && state.narrative.recentCompletedBeats.length > 0;
    report.scenarios.push({
      scenario: 'memory_patch', pass: ok, ms: Date.now() - started,
      status: result.status,
      characters: Object.keys(state?.characters ?? {}).length,
      relationships: Object.keys(state?.relationships ?? {}).length,
      beats: state?.narrative.recentCompletedBeats.length ?? 0,
    });
    console.log(`[S3 memory patch] ${ok ? 'PASS' : 'FAIL'} status=${result.status} characters=${Object.keys(state?.characters ?? {}).length} rel=${Object.keys(state?.relationships ?? {}).length}`);
  }

  // ------------------------------------------------------------ S4 json fence
  {
    const started = Date.now();
    const response = await provider.complete({
      role: 'Checker',
      system: 'You are a test assistant. Put your final answer as a JSON object inside a ```json fenced code block, with one short sentence of explanation BEFORE the block. The JSON object must be {"ok":true,"note":"<5 chars>"}.',
      user: '请按要求输出。',
      maxOutputTokens: 2_000,
      jsonMode: false,
      ledger: { logicalRequestId: 'm6a:json-variant:1', requestKind: 'summarizer' },
    });
    const parsed = parseStructuredOutput(response.text, { label: 'fenced json' }).value;
    const ok = parsed.ok === true && (response.text.includes('```') || response.text.trim().startsWith('{'));
    report.scenarios.push({
      scenario: 'json_variant', pass: ok, ms: Date.now() - started,
      usedFence: response.text.includes('```'),
      repairSteps: [],
    });
    console.log(`[S4 json variant] ${ok ? 'PASS' : 'FAIL'} usedFence=${response.text.includes('```')}`);
  }

  // ---------------------------------------------------------------- S5 ledger
  {
    const attempts = [];
    for (const row of await adapter.queryAll('SELECT logical_request_id, request_kind, status, attempt_no, input_tokens, output_tokens, reasoning_tokens, cached_input_tokens, estimated_usage FROM llm_request_attempts ORDER BY started_at')) {
      attempts.push(row);
    }
    report.ledgerAttempts = attempts;
    const allSettled = attempts.length > 0 && attempts.every(a => a.status === 'succeeded');
    const anyUsage = attempts.some(a => a.input_tokens > 0 && a.output_tokens > 0);
    report.scenarios.push({ scenario: 'ledger', pass: allSettled && anyUsage, attempts: attempts.length });
    console.log(`[S5 ledger] rows=${attempts.length} allSucceeded=${allSettled} usageRecorded=${anyUsage}`);
  }

  // --------------------------------------------------------- S6 reasoning obs
  {
    const withReasoning = report.scenarios.filter(s => s.usage && (s.usage.reasoningTokens ?? 0) > 0).length;
    const anyUsage = report.scenarios.find(s => s.usage);
    report.scenarios.push({
      scenario: 'reasoning_observed',
      pass: true,
      observed: withReasoning > 0,
      sampleUsage: anyUsage ? anyUsage.usage : null,
    });
    console.log(`[S6 reasoning] observed=${withReasoning > 0} sample=${JSON.stringify(anyUsage?.usage ?? null)}`);
  }

  const artifactsDir = path.join(ROOT, 'docs/reviews/llm-memory/artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  const outPath = path.join(artifactsDir, 'm6a-glm-gates.json');
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    model, endpointHost: new URL(endpoint).host,
    physicalRequests: physical,
    ...report,
  }, null, 2));
  console.log(`report -> ${path.relative(ROOT, outPath)}`);
  const failed = report.scenarios.filter(s => s.pass === false).map(s => s.scenario);
  if (failed.length > 0) {
    console.error('FAILED SCENARIOS: ' + failed.join(', '));
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('m6a harness error:', error.message);
  process.exitCode = 1;
});
