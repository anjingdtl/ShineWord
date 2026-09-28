// Closeout C7 dual-model long-run harness (>=100 committed actions).
//
// Waits for the full-novel build's published package, then for EACH of the
// two real models creates a campaign (1 player + 2 companions) and drives
// many committed turns across modes (explore/social/combat/rest/train),
// forking one branch midway. Records per-turn grades, retries, errors and
// usage-derived stats. Credentials never leave the process.
//
// Usage: node scripts/dual-model-longrun.cjs <fullBuildDir> <configFile> <outDir> [turnsPerModel]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { CampaignSession } = require('../dist/application/campaign/session');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const crypto = require('node:crypto');

function parseConfig(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const clean = lines.map(l => {
    if (/^https?:\/\//.test(l)) return l;
    const i = Math.max(l.indexOf('：'), l.indexOf(':'));
    return i > 0 && i < 12 ? l.slice(i + 1).trim() : l;
  });
  const endpoint = clean.find(l => /^https?:\/\//.test(l));
  const key = clean.find(l => l !== endpoint && l.length >= 30 && !/^https?:\/\//.test(l));
  const model = clean.find(l => l !== endpoint && l !== key && /^[\w.\-]+$/.test(l));
  return { endpoint, key, primaryModel: model };
}

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
    this.chain = Promise.resolve();
  }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return; }
    this.db.prepare(sql).run(...params);
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = () => {
      this.db.exec('BEGIN IMMEDIATE');
      return work(this).then(
        value => { this.db.exec('COMMIT'); return value; },
        error => { this.db.exec('ROLLBACK'); throw error; },
      );
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}

const INTENTS = [
  '观察四周，寻找有用的线索',
  '与身旁的人交谈，打听消息',
  '小心地潜行前进',
  '拔剑迎敌，攻击最近的敌人',
  '原地短暂休整，恢复体力',
  '练习剑术，打磨技艺',
  '翻阅随身携带的书籍',
  '帮助同伴脱离险境',
];

async function pickAnchorAndCompanions(adapter, worldId) {
  const revision = await adapter.queryOne(
    'SELECT MAX(revision) AS r FROM world_packages WHERE world_id = ? AND status = ?', [worldId, 'published'],
  );
  if (!revision || !revision.r) throw new Error('No published package yet.');
  // Earliest event order as the time anchor.
  const event = await adapter.queryOne(
    'SELECT world_time_order FROM canon_events WHERE world_id = ? AND world_time_order IS NOT NULL ORDER BY world_time_order LIMIT 1',
    [worldId],
  );
  const location = await adapter.queryOne(
    "SELECT entry_id FROM content_entries WHERE world_id = ? AND revision = ? AND kind = 'location' AND visibility = 'public' LIMIT 1",
    [worldId, revision.r],
  );
  const companions = (await adapter.queryAll(
    "SELECT entry_id FROM content_entries WHERE world_id = ? AND revision = ? AND kind = 'actor_template' AND visibility = 'public' LIMIT 2",
    [worldId, revision.r],
  )).map(row => row.entry_id);
  return {
    revision: revision.r,
    anchor: {
      worldTimeOrder: event?.world_time_order ?? 1,
      locationId: location?.entry_id ?? 'improvised',
    },
    companionTemplateIds: companions,
  };
}

async function runForModel(cfg, modelName, dbFile, outDir, turns, tag) {
  // Fresh working copy per model so the two runs never share campaign ids.
  const workDb = path.join(outDir, `longrun-${tag}.db`);
  fs.copyFileSync(dbFile, workDb);
  for (const suffix of ['-wal', '-shm']) { try { fs.unlinkSync(workDb + suffix); } catch {} }
  const db = new DatabaseSync(workDb);
  const adapter = new NodeSqliteAdapter(db);
  const worldStore = new SqliteWorldStore(adapter);

  const { revision, anchor, companionTemplateIds } = await pickAnchorAndCompanions(adapter, 'world-full');

  const secrets = { store: {}, async set(r, s) { this.store[r] = s; }, async get(r) { return this.store[r] ?? null; }, async delete(r) { delete this.store[r]; } };
  await secrets.set('lr-key', cfg.key);
  const profile = {
    id: 'longrun-' + tag, name: 'longrun', endpoint: cfg.endpoint, model: modelName, keyRef: 'lr-key',
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 120_000, maxOutputTokens: 12_000 },
  };
  const transport = {
    async post(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: controller.signal });
        const body = await response.text();
        return { status: response.status, body, headers: {} };
      } catch (error) {
        if (controller.signal.aborted) throw new Error('LLM request timed out.');
        throw error;
      } finally { clearTimeout(timer); }
    },
  };
  const provider = new OpenAICompatibleProvider(profile, secrets, transport, 600_000);

  const campaignId = 'camp-lr-' + tag;
  await createCampaign({
    db: adapter, worldStore, campaignId, title: '双模型长程 ' + modelName, worldId: 'world-full',
    packageRevision: revision,
    anchor,
    protagonist: {
      actorId: 'actor-lr-' + tag, kind: 'original', name: '临渊',
      attributes: { physique: 2, agility: 2, insight: 2, knowledge: 1, willpower: 2, social: 1 },
      initialSkills: ['sword'],
    },
    companions: companionTemplateIds.map((templateId, index) => ({ actorId: `actor-lr-${tag}-c${index + 1}`, templateId })),
    goal: '在这座城镇中查清失踪人口的真相', createdAt: new Date().toISOString(),
  });

  const session = new CampaignSession({
    db: adapter, turns: new SqliteTurnStore(adapter), game: new SqliteGameStore(adapter),
    worldStore, narratives: new SqliteNarrativeStore(adapter),
    hashProvider: { sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') },
    random: () => 0.97,
  }, provider, profile);

  const statsPath = path.join(outDir, `longrun-${tag}.jsonl`);
  const stats = { model: modelName, committed: 0, errors: 0, errorKinds: {}, grades: {}, forks: 0, turns: [] };
  const branch = campaignId + '-main';
  for (let i = 0; i < turns; i += 1) {
    const intent = INTENTS[i % INTENTS.length];
    const turnId = `lr-${tag}-${i + 1}`;
    try {
      const result = await session.submitTurn({ campaignId, branchId: branch, turnId, intent });
      stats.committed += 1;
      stats.grades[result.grade ?? 'n/a'] = (stats.grades[result.grade ?? 'n/a'] ?? 0) + 1;
      fs.appendFileSync(statsPath, JSON.stringify({ t: new Date().toISOString(), turn: i + 1, ok: true, grade: result.grade ?? null }) + '\n');
    } catch (error) {
      stats.errors += 1;
      const kind = (error.message || 'unknown').slice(0, 60);
      stats.errorKinds[kind] = (stats.errorKinds[kind] ?? 0) + 1;
      fs.appendFileSync(statsPath, JSON.stringify({ t: new Date().toISOString(), turn: i + 1, ok: false, error: kind }) + '\n');
    }
    // One fork midway (>=1 branch divergence across the run).
    if (i === Math.floor(turns / 2)) {
      try {
        await session.rewind({ campaignId, sourceBranchId: branch, atStateVersion: Math.max(1, i), newBranchId: branch + '-fork' });
        stats.forks += 1;
      } catch (error) {
        fs.appendFileSync(statsPath, JSON.stringify({ t: new Date().toISOString(), fork: 'failed', error: (error.message || '').slice(0, 80) }) + '\n');
      }
    }
  }
  fs.writeFileSync(path.join(outDir, `longrun-${tag}-summary.json`), JSON.stringify(stats, null, 2));
  db.close();
  return stats;
}

async function main() {
  const [buildDir, configFile, outDir, turnsArg] = process.argv.slice(2);
  const turns = parseInt(turnsArg ?? '60', 10);
  fs.mkdirSync(outDir, { recursive: true });
  const cfg = parseConfig(configFile);
  const dbFile = path.join(buildDir, 'shineword.db');

  // Wait for the full build to finish (summary.json appears).
  for (;;) {
    if (fs.existsSync(path.join(buildDir, 'summary.json'))) break;
    await new Promise(resolve => setTimeout(resolve, 30_000));
  }

  const models = [cfg.primaryModel, 'glm-5.3'].filter((m, i, arr) => arr.indexOf(m) === i);
  const combined = { models: [], totalCommitted: 0, totalErrors: 0 };
  for (const [index, model] of models.entries()) {
    const stats = await runForModel(cfg, model, dbFile, outDir, turns, 'm' + (index + 1));
    combined.models.push(stats);
    combined.totalCommitted += stats.committed;
    combined.totalErrors += stats.errors;
  }
  fs.writeFileSync(path.join(outDir, 'dual-model-summary.json'), JSON.stringify(combined, null, 2));
}

main().catch(error => {
  console.error('LONGRUN FAILED:', error.message);
  process.exit(1);
});
