const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { FaultInjectionTransport, postWithRetry, withCancellation, CancellationToken, DEFAULT_RETRY_POLICY } = require('../dist/application/llm/resilient');
const { probeCapabilities } = require('../dist/application/llm/capabilities');
const { summarizeRange } = require('../dist/application/memory/summarizer');
const { settleTurnProgress, settleRelationships } = require('../dist/application/game/turnSettlement');
const { trainSkill, isTrainable } = require('../dist/domain/progression/growth');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');

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
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params) ?? []; }
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

const sha = { async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); } };

function goodTransport() {
  return {
    async post(request) {
      const body = JSON.parse(request.body);
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
    },
  };
}

test('fault injection: network errors retry with backoff then succeed', async () => {
  const transport = new FaultInjectionTransport(goodTransport(), [
    { faults: ['network', 'http_500'] },
  ]);
  const response = await postWithRetry(transport, {
    url: 'https://x', headers: {}, body: '{}', timeoutMs: 1000,
  }, { maxAttempts: 3, backoffMs: () => 1 });
  assert.equal(response.status, 200);
  assert.equal(transport.remainingFaults(), 0);
});

test('fault injection: non-retryable errors fail fast, budget preserved', async () => {
  const transport = new FaultInjectionTransport(goodTransport(), [
    { faults: ['timeout'] },
  ]);
  await assert.rejects(
    postWithRetry(transport, { url: 'https://x', headers: {}, body: '{}', timeoutMs: 50 }),
    /timed out/,
  );
  // A timeout is never retried (server may have billed the request).
  assert.equal(transport.remainingFaults(), 0);
});

test('fault injection: 5xx retries up to policy then surfaces HTTP error', async () => {
  let calls = 0;
  const always500 = {
    async post() {
      calls += 1;
      return { status: 500, body: JSON.stringify({ error: { message: 'boom' } }) };
    },
  };
  // 5xx retries up to policy; the final response is returned raw and the
  // provider layer turns it into the surfaced error.
  const response = await postWithRetry(
    always500, { url: 'https://x', headers: {}, body: '{}', timeoutMs: 100 },
    { maxAttempts: 3, backoffMs: () => 1 },
  );
  assert.equal(response.status, 500);
  assert.equal(calls, 3);
});

test('cancellation token abandons long calls', async () => {
  const token = new CancellationToken();
  const slow = new Promise(resolve => setTimeout(() => resolve('late'), 200));
  await assert.rejects(withCancellation(slow, token, 20), /cancelled by timeout/);

  const token2 = new CancellationToken();
  token2.cancel();
  await assert.rejects(withCancellation(Promise.resolve('x'), token2), /Operation cancelled/);
});

test('capability probe detects JSON mode and usage from a tiny real request', async () => {
  const probeTransport = {
    async post(request) {
      const body = JSON.parse(request.body);
      const wantsJson = Boolean(body.response_format);
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: wantsJson ? '{"ok":true}' : 'plain' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        }),
      };
    },
  };
  const probed = await probeCapabilities({
    transport: probeTransport,
    endpoint: 'https://api.example.com/v1',
    model: 'test-model',
    apiKey: 'sk-test',
  });
  assert.equal(probed.capabilities.supportsJson, true);
  assert.equal(probed.capabilities.reportsUsage, true);
});

test('capability probe records provider errors without throwing', async () => {
  const failing = {
    async post() {
      return { status: 400, body: JSON.stringify({ error: { message: 'response_format unsupported' } }) };
    },
  };
  const probed = await probeCapabilities({
    transport: failing,
    endpoint: 'https://api.example.com/v1',
    model: 'm',
    apiKey: 'k',
  });
  assert.equal(probed.capabilities.supportsJson, false);
  assert.ok(probed.probes.errorMessages[0].includes('response_format'));
});

test('summarizer builds range memory and rejects empty summaries', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const migration of BUILTIN_MIGRATIONS) {
      for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
    }
    const adapter = new NodeSqliteAdapter(db);
    const gameStore = new SqliteGameStore(adapter);
    const turnStore = new SqliteTurnStore(adapter);

    db.prepare("INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES ('b-sum', 'c', 8, '2026-09-27T00:00:00.000Z')").run();
    for (let i = 1; i <= 8; i += 1) {
      db.prepare(`INSERT INTO turns (branch_id, turn_id, status, expected_state_version, committed_state_version,
        action_contract_json, action_contract_hash, outcome_grade, public_summary, effects_json, created_at, committed_at)
        VALUES ('b-sum', ?, 'Committed', ?, ?, '{}', 'h', 'success', ?, '[]', '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z')`)
        .run(`turn-${String(i).padStart(4, '0')}`, i - 1, i, `回合 ${i} 摘要`);
      db.prepare(`INSERT INTO turn_narratives (branch_id, turn_id, outcome_grade, text, status, created_at)
        VALUES ('b-sum', ?, 'success', '正文', 'Committed', '2026-09-27T00:00:00.000Z')`)
        .run(`turn-${String(i).padStart(4, '0')}`);
    }

    const provider = {
      async complete(request) {
        const payload = JSON.parse(request.user);
        assert.equal(payload.role, 'Summarizer');
        assert.equal(payload.turnSummaries.length, 8);
        return { text: JSON.stringify({ summary: '玩家潜入藏书阁并与守卫周旋，最终拿到线索。' }), usage: { inputTokens: 100, outputTokens: 20, estimated: false } };
      },
    };

    const result = await summarizeRange({
      provider, gameStore, turnStore, branchId: 'b-sum',
      fromStateVersion: 1, toStateVersion: 8,
    });
    assert.equal(result.memory.kind, 'turn_range_summary');
    const memories = await gameStore.listMemories('b-sum');
    assert.equal(memories.length, 1);
    assert.ok(memories[0].summary.includes('藏书阁'));

    await assert.rejects(summarizeRange({
      provider, gameStore, turnStore, branchId: 'b-sum',
      fromStateVersion: 1, toStateVersion: 4,
    }), /at least 8/);
  } finally {
    db.close();
  }
});

test('turn settlement awards practice for honest failures too, advances ranks locally', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const migration of BUILTIN_MIGRATIONS) {
      for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
    }
    const adapter = new NodeSqliteAdapter(db);
    const gameStore = new SqliteGameStore(adapter);
    db.prepare("INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES ('b-set', 'c', 0, 't')").run();

    // Five honest failures across five independent encounters. Thresholds
    // no longer auto-advance: the skill becomes trainable instead.
    for (let i = 1; i <= 5; i += 1) {
      const outcome = await settleTurnProgress({
        gameStore, branchId: 'b-set', turnId: `turn-${i}`, encounterId: `enc-${i}`, stateVersion: i,
        outcomeGrade: 'failure', skillId: 'stealth', actorId: 'actor-player',
      });
      assert.equal(outcome.practiceAwarded, true);
      assert.equal(outcome.practiceReason, 'honest_failure');
    }
    const afterFive = await gameStore.getSkillProgress('b-set', 'actor-player', 'stealth');
    assert.equal(afterFive.rank, 'untrained');
    assert.equal(afterFive.practicePoints, 5);
    assert.equal(afterFive.trainable ?? isTrainable(afterFive), true, 'trainable via explicit training');
    assert.equal(isTrainable(afterFive), true);

    // Training consumes the threshold; a turn replay inside the SAME
    // encounter adds nothing (double submit / rewind replay).
    const replay = await settleTurnProgress({
      gameStore, branchId: 'b-set', turnId: 'turn-5', encounterId: 'enc-5', stateVersion: 5,
      outcomeGrade: 'failure', skillId: 'stealth', actorId: 'actor-player',
    });
    assert.equal(replay.practiceAwarded, false);

    const trained = trainSkill(afterFive, { hasSource: true, hasResources: true, meetsPrerequisites: true });
    assert.equal(trained.advanced, true);
    assert.equal(trained.nextRank, 'novice');
    await gameStore.upsertSkillProgress('b-set', 'actor-player', {
      ...afterFive, rank: trained.nextRank, practicePoints: trained.pointsRemaining,
    }, 5);

    const progress = await gameStore.getSkillProgress('b-set', 'actor-player', 'stealth');
    assert.equal(progress.rank, 'novice');
    assert.equal(progress.practicePoints, 0);

    // Non-risk turn (no skillId): no practice.
    const none = await settleTurnProgress({
      gameStore, branchId: 'b-set', turnId: 'turn-9', encounterId: 'enc-9', stateVersion: 9,
      outcomeGrade: 'success', skillId: undefined, actorId: 'actor-player',
    });
    assert.equal(none.practiceAwarded, false);
  } finally {
    db.close();
  }
});

test('relationship deltas are clamped per turn and persist', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const migration of BUILTIN_MIGRATIONS) {
      for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
    }
    const adapter = new NodeSqliteAdapter(db);
    const gameStore = new SqliteGameStore(adapter);
    db.prepare("INSERT INTO branches (branch_id, campaign_id, state_version, created_at) VALUES ('b-rel', 'c', 0, 't')").run();

    await settleRelationships(gameStore, 'b-rel', 'actor-player',
      [{ toActorId: 'npc-guard', stance: 'wary', closenessDelta: -3 }], 'turn-1', 1);
    let rels = await gameStore.listRelationships('b-rel', 'actor-player');
    assert.equal(rels[0].closeness, -3);
    assert.equal(rels[0].stance, 'wary');

    // Update accumulates; absurd delta clamps to -5..5.
    await settleRelationships(gameStore, 'b-rel', 'actor-player',
      [{ toActorId: 'npc-guard', stance: 'hostile', closenessDelta: -99 }], 'turn-2', 2);
    rels = await gameStore.listRelationships('b-rel', 'actor-player');
    assert.equal(rels[0].closeness, -8);
    assert.equal(rels[0].stance, 'hostile');
    assert.equal(rels[0].updatedTurnId, 'turn-2');
  } finally {
    db.close();
  }
});

test('profile-level thinkingDisabled is applied to request bodies for GLM', async () => {
  const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
  const { MemorySecretStore } = require('../dist/application/llm/memorySecretStore');
  const secrets = new MemorySecretStore();
  await secrets.set('glm', 'test-key');
  const bodies = [];
  const capturingTransport = {
    async post(request) {
      bodies.push(JSON.parse(request.body));
      return { status: 200, body: JSON.stringify({ id: 'r1', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
    },
  };
  const profile = {
    id: 'glm', name: 'GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'GLM-5.3-Flash',
    keyRef: 'glm', thinkingDisabled: true,
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 128000, maxOutputTokens: 8192 },
  };
  const provider = new OpenAICompatibleProvider(profile, secrets, capturingTransport, 1000);
  await provider.complete({ system: 's', user: 'u', maxOutputTokens: 100, jsonMode: false });
  assert.equal(bodies[0].thinking?.type, 'disabled');

  // Non-GLM profile: no thinking field.
  const plainProfile = { ...profile, thinkingDisabled: undefined };
  bodies.length = 0;
  const plainProvider = new OpenAICompatibleProvider(plainProfile, secrets, capturingTransport, 1000);
  await plainProvider.complete({ system: 's', user: 'u', maxOutputTokens: 100, jsonMode: false });
  assert.equal('thinking' in bodies[0], false);
});

test('malformed planner contracts are rejected cleanly, not with TypeErrors', async () => {
  const { assertValidActionContract, validateActionContract } = require('../dist/domain/turns/contracts');
  const base = {
    protocolVersion: '1.0', turnId: 'turn-001', expectedStateVersion: 0,
    actorId: 'actor-player', actionType: 'observe', intent: '观察',
    evidenceIds: [], requiresRoll: false, timeCostMinutes: 5,
    resourcePreconditions: [],
  };
  const outcomes = () => ({
    full_success: { achieved: true, publicSummary: '成功', effects: [] },
    success: { achieved: true, publicSummary: '成功', effects: [] },
    failure: { achieved: false, publicSummary: '失败', effects: [] },
    severe_failure: { achieved: false, publicSummary: '严重失败', effects: [] },
  });

  // Effect with missing op (real GLM failure observed in the 100-turn run):
  // must produce a validation error, never an undefined reaching SQLite.
  const missingOp = { ...base, outcomes: outcomes() };
  missingOp.outcomes.success.effects.push({ actorId: 'actor-player', locationId: '回廊' });
  assert.throws(() => assertValidActionContract(missingOp), /op must be one of/);

  // Unknown op rejected.
  const unknownOp = { ...base, outcomes: outcomes() };
  unknownOp.outcomes.success.effects.push({ op: 'grantLevel', actorId: 'actor-player' });
  assert.throws(() => assertValidActionContract(unknownOp), /op must be one of/);

  // Missing publicSummary / non-boolean achieved produce validation errors, not TypeError.
  const noSummary = { ...base, outcomes: outcomes() };
  delete noSummary.outcomes.failure.publicSummary;
  const errors1 = validateActionContract(noSummary);
  assert.ok(errors1.some(e => /publicSummary is required/.test(e)), errors1.join(';'));

  const badAchieved = { ...base, outcomes: outcomes() };
  badAchieved.outcomes.failure.achieved = 'yes';
  const errors2 = validateActionContract(badAchieved);
  assert.ok(errors2.some(e => /achieved must be a boolean/.test(e)), errors2.join(';'));

  // Null effect element and malformed resourcePreconditions are rejected cleanly.
  const nullEffect = { ...base, outcomes: outcomes() };
  nullEffect.outcomes.success.effects.push(null);
  assert.throws(() => assertValidActionContract(nullEffect), /effect must be an object/);

  const badPrecond = { ...base, resourcePreconditions: [null] };
  const errors3 = validateActionContract(badPrecond);
  assert.ok(errors3.some(e => /precondition must be an object/.test(e)), errors3.join(';'));
});

test('normalizePlannerEffects maps observed GLM effect dialects onto canonical names', async () => {
  const { normalizePlannerEffects } = require('../dist/application/game/llmTurn');
  const { assertValidActionContract } = require('../dist/domain/turns/contracts');
  // Shape captured verbatim from a real GLM planner response (2026-09-27 probe).
  const glmStyle = {
    protocolVersion: '1.0', turnId: 'turn-001', expectedStateVersion: 0,
    actorId: 'actor-player', actionType: 'move', evidenceIds: ['worldContext'],
    requiresRoll: false, intent: '走向藏书阁', timeCostMinutes: 10,
    resourcePreconditions: [],
    outcomes: {
      full_success: { achieved: true, publicSummary: '抵达', effects: [
        { effectType: 'changeLocation', from: '前院', to: '藏书阁' },
        { effectType: 'advanceClock', minutes: 10 },
      ] },
      success: { achieved: true, publicSummary: '抵达', effects: [
        { type: 'changeLocation', to: '回廊' },
        { type: 'consumeResource', resource: 'stamina', amount: 1 },
        { type: 'recordEvent', text: '第2回合：移动' },
      ] },
      failure: { achieved: false, publicSummary: '受阻', effects: [
        { type: 'applyCondition', condition: '滑倒受惊' },
        { type: 'recordEvent', note: '未抵达' },
      ] },
      severe_failure: { achieved: false, publicSummary: '受阻', effects: [] },
    },
  };
  const normalized = normalizePlannerEffects(glmStyle);
  // Must now pass the strict validator without any mutation of authority fields.
  assertValidActionContract(normalized);
  const fx = normalized.outcomes.full_success.effects;
  assert.equal(fx[0].op, 'changeLocation');
  assert.equal(fx[0].actorId, 'actor-player');
  assert.equal(fx[0].locationId, '藏书阁');
  assert.equal(fx[1].op, 'advanceClock');
  const sx = normalized.outcomes.success.effects;
  assert.equal(sx[0].locationId, '回廊');
  assert.equal(sx[1].resourceId, 'stamina');
  assert.equal(sx[2].eventType, 'note');
  assert.equal(sx[2].summary, '第2回合：移动');
  const ffx = normalized.outcomes.failure.effects;
  assert.equal(ffx[0].conditionId, '滑倒受惊');
  assert.equal(ffx[0].actorId, 'actor-player');
  assert.equal(ffx[1].summary, '未抵达');

  // Unknown ops are untouched by normalization and still rejected by the validator.
  const hostile = normalizePlannerEffects({
    ...glmStyle,
    outcomes: {
      ...glmStyle.outcomes,
      full_success: { achieved: true, publicSummary: 'x', effects: [{ type: 'grantLevel', level: 99 }] },
    },
  });
  assert.throws(() => assertValidActionContract(hostile), /op must be one of/);
});

test('normalizePlannerEffects fills resourcePreconditions from observed GLM shape', async () => {
  const { normalizePlannerEffects } = require('../dist/application/game/llmTurn');
  const { assertValidActionContract } = require('../dist/domain/turns/contracts');
  const base = {
    protocolVersion: '1.0', turnId: 'turn-001', expectedStateVersion: 0,
    actorId: 'actor-player', actionType: 'fight', evidenceIds: [],
    requiresRoll: true, skillId: 'combat', difficultyBand: 'normal', intent: '搏斗', timeCostMinutes: 5,
    resourcePreconditions: [{ resource: 'stamina', minimum: 3 }],
    outcomes: {
      full_success: { achieved: true, publicSummary: '胜', effects: [] },
      success: { achieved: true, publicSummary: '胜', effects: [] },
      failure: { achieved: false, publicSummary: '败', effects: [] },
      severe_failure: { achieved: false, publicSummary: '败', effects: [] },
    },
  };
  const normalized = normalizePlannerEffects(base);
  assertValidActionContract(normalized);
  assert.equal(normalized.resourcePreconditions[0].actorId, 'actor-player');
  assert.equal(normalized.resourcePreconditions[0].resourceId, 'stamina');
});
