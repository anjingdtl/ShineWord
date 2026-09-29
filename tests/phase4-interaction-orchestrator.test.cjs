const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteInteractionOperationJournal } = require('../dist/application/campaign/interactionOrchestrator');
const { projectStoryEntry } = require('../dist/application/campaign/storyEntry');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { proposeEncounterIntent } = require('../dist/application/campaign/encounterIntent');
const { recommendOpeningLoadout } = require('../dist/application/campaign/openingRecommendation');

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params) ?? []; }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = await work(this);
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(value => value.trim()).filter(Boolean)) db.exec(statement);
  }
  db.prepare(`INSERT INTO worlds
    (world_id, title, source_sha256, source_bytes, normalize_version, chapter_split_version,
     build_status, created_at, updated_at)
    VALUES ('w','w',?,1,'n','c','ready','t','t')`).run('a'.repeat(64));
  db.prepare(`INSERT INTO campaigns
    (campaign_id, world_id, title, ruleset_id, ruleset_version, world_mapping_version, opening_json, created_at)
    VALUES ('c','w','c','r','1','1','{}','t')`).run();
  db.prepare("INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES ('b1','c',0,'t'),('b2','c',0,'t')").run();
  return { db, adapter: new NodeSqliteAdapter(db), journal: new SqliteInteractionOperationJournal(new NodeSqliteAdapter(db), () => 't') };
}

function runInput(overrides = {}) {
  return {
    operationId: 'auto-enc-1', campaignId: 'c', branchId: 'b1', kind: 'encounter_auto',
    expectedStateVersion: 0,
    nextAction: async () => ({ encounterId: 'enc-1' }),
    actionKind: () => 'npc_turn',
    executeAction: async () => ({ stateVersion: 0, continue: false }),
    ...overrides,
  };
}

test('interaction operation replays a committed child request across commit/checkpoint crash without duplicating it', async () => {
  const { db, adapter, journal } = setup();
  const effects = new Map();
  let calls = 0;
  try {
    await assert.rejects(journal.run(runInput({
      executeAction: async (_action, requestId) => {
        calls += 1;
        if (!effects.has(requestId)) {
          effects.set(requestId, true);
          await adapter.execute("UPDATE branches SET state_version = state_version + 1 WHERE branch_id = 'b1'");
        }
        return { stateVersion: 1, continue: true };
      },
      afterActionBeforeCheckpoint: async () => { throw new Error('simulated process death after commit'); },
    })), /simulated process death/);

    const paused = await journal.getOperation('auto-enc-1');
    assert.equal(paused.status, 'paused_system');
    assert.equal(paused.expectedStateVersion, 0);
    assert.equal(db.prepare('SELECT state_version FROM branches WHERE branch_id = ?').get('b1').state_version, 1);

    const resumed = await journal.run(runInput({
      expectedStateVersion: 1,
      nextAction: async (_stepIndex, _stateVersion, replayPreparedStep) => {
        assert.equal(replayPreparedStep, true);
        // The encounter has already advanced to a player decision. The same
        // request must be replayed once so the coordinator can checkpoint it.
        return { encounterId: 'enc-1' };
      },
      executeAction: async (_action, requestId) => {
        calls += 1;
        assert.equal(effects.has(requestId), true);
        return { stateVersion: 1, continue: false };
      },
    }));

    assert.equal(resumed.operation.status, 'completed');
    assert.equal(resumed.stepsThisRun, 1);
    assert.equal(calls, 2, 'service replay is invoked with the same child request id');
    assert.equal(effects.size, 1, 'game effect committed once');
    assert.deepEqual(await journal.listSteps('auto-enc-1').then(rows => rows.map(row => ({
      requestId: row.requestId, status: row.status, committedStateVersion: row.committedStateVersion,
    }))), [{ requestId: 'auto-enc-1:s0', status: 'committed', committedStateVersion: 1 }]);
  } finally { db.close(); }
});

test('interaction operation applies the 32-action cap and yields after each four committed steps', async () => {
  const { db, adapter, journal } = setup();
  let yields = 0;
  let actionCount = 0;
  try {
    const result = await journal.run(runInput({
      operationId: 'auto-enc-2',
      nextAction: async () => ({ encounterId: 'enc-1' }),
      executeAction: async () => {
        actionCount += 1;
        await adapter.execute("UPDATE branches SET state_version = state_version + 1 WHERE branch_id = 'b1'");
        return { stateVersion: actionCount, continue: true };
      },
      yieldToUi: async () => { yields += 1; },
    }));
    assert.equal(actionCount, 32);
    assert.equal(yields, 8);
    assert.equal(result.operation.status, 'paused_system');
    assert.equal(result.pauseReason, 'step_limit');
    assert.equal(result.operation.nextStep, 32);
    assert.equal(result.operation.expectedStateVersion, 32);
  } finally { db.close(); }
});

test('a newer operation on a sibling branch fences an older operation before its next child commit', async () => {
  const { db, journal } = setup();
  let staleCalls = 0;
  try {
    await assert.rejects(journal.run(runInput({
      operationId: 'auto-stale',
      nextAction: async () => {
        const newer = await journal.run(runInput({
          operationId: 'auto-newer', branchId: 'b2',
          nextAction: async () => null,
        }));
        assert.equal(newer.operation.status, 'completed');
        return { encounterId: 'enc-1' };
      },
      executeAction: async () => { staleCalls += 1; return { stateVersion: 0, continue: false }; },
    })), /租约|接管/);
    assert.equal(staleCalls, 0);
  } finally { db.close(); }
});

test('the SQLite atomic game commit rejects a stale cross-branch fence inside its transaction', async () => {
  const { db, adapter } = setup();
  try {
    await adapter.execute("INSERT INTO interaction_campaign_fences (campaign_id, fence_token, updated_at) VALUES ('c', 2, 't')");
    const store = new SqliteTurnStore(adapter);
    await assert.rejects(store.commitAtomic({
      branchId: 'b1',
      turnId: 'stale-npc-step',
      expectedStateVersion: 0,
      nextState: { branchId: 'b1', stateVersion: 1, clockMinutes: 0, actors: {}, itemOwners: {} },
      actionContractJson: '{}',
      actionContractHash: 'hash',
      committedTurn: {
        branchId: 'b1', turnId: 'stale-npc-step', previousStateVersion: 0, stateVersion: 1,
        outcomeGrade: 'success', publicSummary: 'x', effects: [], committedAt: 't',
      },
      coordinationFence: { campaignId: 'c', fenceToken: 1 },
    }), /fence expired/);
    assert.equal(db.prepare("SELECT state_version FROM branches WHERE branch_id = 'b1'").get().state_version, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM turns WHERE branch_id = 'b1' AND turn_id = 'stale-npc-step'").get().n, 0);
  } finally { db.close(); }
});

test('story projection keeps committed prose and uses a safe mechanical fallback instead of public summary or effects', () => {
  assert.deepEqual(projectStoryEntry({
    turnId: 'internal-turn-key', narrativeText: '雨声渐停，门后的人终于回应。',
    narrativeStatus: 'Committed', outcomeGrade: 'success',
  }), {
    turnId: 'internal-turn-key', text: '雨声渐停，门后的人终于回应。', grade: 'success', mechanicalOnly: false,
  });
  assert.deepEqual(projectStoryEntry({
    turnId: 'enc:secret:decision-basis', narrativeText: null,
    narrativeStatus: null, outcomeGrade: 'failure',
  }), {
    turnId: 'enc:secret:decision-basis', text: '本地规则已完成这一步行动。', grade: 'failure', mechanicalOnly: true,
  });
  assert.equal(projectStoryEntry({
    turnId: 'pending', narrativeText: '未提交的叙事草稿',
    narrativeStatus: 'Candidate', outcomeGrade: 'partial',
  }).text, '本地规则已完成这一步行动。');
});

test('active-encounter text intent accepts only explicit public targets and never invents combat parameters', () => {
  const encounter = {
    status: 'active', currentActorIsPlayer: true,
    actors: [
      { actorId: 'hostile-1', name: '守门人', side: 'hostile', hp: 5, conditions: [] },
      { actorId: 'party-1', name: '阿芷', side: 'party', hp: 0, conditions: ['disabled'] },
      { actorId: 'hostile-2', name: '远处的伏兵', side: 'hostile', hp: 8, conditions: [] },
    ],
  };
  assert.deepEqual(proposeEncounterIntent('攻击 守门人', encounter), { kind: 'attack', targetActorId: 'hostile-1' });
  assert.deepEqual(proposeEncounterIntent('攻击守门人，造成 999 点伤害', encounter), {
    kind: 'clarify', explanation: '没有找到同名的公开敌对目标；请从列出的目标中选择，不会创建新目标。',
  });
  assert.deepEqual(proposeEncounterIntent('援救阿芷', encounter), { kind: 'rescue', targetActorId: 'party-1' });
  assert.equal(proposeEncounterIntent('攻击远方的龙', encounter).kind, 'clarify');
  assert.equal(proposeEncounterIntent('去仓库埋伏', encounter).kind, 'clarify');
  assert.deepEqual(proposeEncounterIntent('撤退', encounter), { kind: 'retreat' });
  assert.deepEqual(proposeEncounterIntent('戒备', encounter), { kind: 'pass' });
});

test('quick-opening recommendation uses only visible skills and stays within the rules budget', () => {
  const recommendation = recommendOpeningLoadout([
    { entryId: 'observe', attribute: 'insight' },
    { entryId: 'track', attribute: 'insight' },
    { entryId: 'negotiate', attribute: 'social' },
    { entryId: 'not-visible-extra', attribute: 'knowledge' },
    { entryId: 'invalid-attribute', attribute: 'hidden_power' },
  ]);
  assert.deepEqual(recommendation.initialSkills, ['observe', 'track', 'negotiate']);
  assert.equal(Object.values(recommendation.attributes).reduce((sum, value) => sum + value - 1, 0), 4);
  assert.ok(Object.values(recommendation.attributes).every(value => value >= 1 && value <= 3));
  assert.equal(recommendation.attributes.insight, 3);

  const noSkillRecommendation = recommendOpeningLoadout([]);
  assert.deepEqual(noSkillRecommendation.initialSkills, []);
  assert.equal(Object.values(noSkillRecommendation.attributes).reduce((sum, value) => sum + value - 1, 0), 4);
});
