'use strict';
/**
 * P7-3/P7-4 end-to-end verification through the REAL session pipeline
 * (SQLite stores, prepared reduction, situation runtime, guidance assembly).
 *
 * A04/A07 method binding through playTurn; A08 eligibility differences;
 * A09 secret filtering; A10/A11 good-narrative-bad-paths single commit with
 * local degradation and no Narrator re-send; A13 two business calls;
 * A01/A02 fate suppression once the causal order reaches the reference.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { NodeSqliteAdapter } = (() => ({
  NodeSqliteAdapter: class {
    constructor(db) { this.db = db; }
    async execute(sql, params = []) {
      if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
      return this.db.prepare(sql).run(...params).changes;
    }
    async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
    async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
    async transaction(work) {
      this.db.exec('BEGIN IMMEDIATE');
      try { const result = await work(this); this.db.exec('COMMIT'); return result; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  },
}))();
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
const { SqliteGuidanceStore } = require('../dist/infra/sqlite/sqliteGuidanceStore');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { CampaignSession } = require('../dist/application/campaign/session');
const { forkBranch } = require('../dist/application/branch/fork');

const sha = { sha256Hex: async s => crypto.createHash('sha256').update(s).digest('hex') };
const now = '2026-10-04T00:00:00.000Z';

function entry(entryId, kind, definition, extra = {}) {
  return {
    entryId, kind, revision: 0,
    provenance: extra.provenance ?? { kind: 'design_fill', sourceFactIds: [], rationale: 'p7 测试' },
    fieldProvenance: {}, visibility: extra.visibility ?? 'public',
    dependencyIds: extra.dependencyIds ?? [], definition,
  };
}

function situationEntry() {
  return entry('situation-sect', 'situation', {
    title: '观毁人伤',
    summary: '同伴重伤倒地，急需救治。',
    gmBrief: '袭击者背后有主使（GM-only 秘密）。',
    locationId: 'bridge',
    participantEntryIds: ['npc-companion'],
    activation: { kind: 'world_time_at_least', order: 0 },
    signs: [],
    pressure: { description: '伤势在恶化' },
    methods: [
      {
        methodId: 'heal',
        title: '先救同伴',
        goal: '稳住同伴的伤势',
        firstStep: { intent: '检查同伴伤势并止血救治', actionKind: 'skill_check', skillId: 'skill-medicine', targetEntryId: 'npc-companion' },
        requires: { skillId: 'skill-medicine', minRank: 'trained' },
        tradeoffs: '花费时间',
        preparation: '需要医术（受训）',
        successEffects: [
          { op: 'removeCondition', actorId: 'actor-companion', conditionId: 'bleeding' },
        ],
        onSuccess: [{ kind: 'situation_counter', situationId: 'situation-sect', counterId: 'stabilized', delta: 1 }],
      },
      {
        methodId: 'survey',
        title: '查看现场',
        goal: '弄清袭击的来龙去脉',
        firstStep: { intent: '查看现场留下的痕迹', actionKind: 'skill_check', skillId: 'skill-observation' },
        requires: {},
        tradeoffs: '救治暂缓',
        preparation: '无',
      },
    ],
    transitions: {},
    referenceEvents: [{
      eventKey: 'evt-companion-death',
      worldTimeOrder: 2,
      situationId: 'situation-sect',
      condition: {
        kind: 'all',
        of: [
          { kind: 'actor_alive', actorId: 'actor-companion' },
          { kind: 'actor_condition', actorId: 'actor-companion', conditionId: 'bleeding' },
        ],
      },
      onDue: [{ kind: 'set_situation_status', situationId: 'situation-sect', status: 'resolved', resolution: '同伴伤重不治' }],
      actorFate: { actorId: 'actor-companion', lifeStatus: 'dead' },
    }],
  }, { visibility: 'gm' });
}

function baseEntries() {
  return [
    entry('skill-medicine', 'skill', { name: '医术', description: '救治', attribute: 'knowledge', allowUntrained: false, powerTier: 'ordinary', usage: 'utility' }),
    entry('skill-observation', 'skill', { name: '观察', description: '观察', attribute: 'insight', allowUntrained: true, powerTier: 'ordinary', usage: 'knowledge' }),
    entry('npc-companion', 'actor_template', {
      name: '岳轻', category: 'human', description: '同伴',
      attributes: { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 2, social: 2 },
      skills: {}, hp: 8, stamina: 6, defense: 2, attacks: [], abilities: [], startingItems: [],
      behavior: { goal: '养伤', retreatThreshold: 0.2, morale: 3 }, lootPolicy: '无',
      threat: { damage: 0, durability: 1, actions: 1, control: 0, environment: 0 },
    }),
    entry('scene-bridge', 'scene', {
      name: '桥头', description: '测试地点', locationId: 'bridge',
      zones: [{ zoneId: 'z', name: '石阶', cover: false, exits: [] }],
      actors: ['npc-companion'], visibleItems: [], hazards: [], clues: ['lore-north'],
    }, { dependencyIds: ['npc-companion'] }),
    // GM-only secret: its NAME is blocked from all player-visible guidance.
    entry('lore-secret-employer', 'lore', { name: '北镇抚司密令', text: '袭击者的幕后主使' }, { visibility: 'gm' }),
    // Later-journey clue: discoverable scene clue whose provenance cites the
    // validFrom=30 canon fact; DISCOVERING it (honest in-game progress) lifts
    // the causal order into the reference window.
    entry('lore-north', 'lore', { name: '北上的路', text: '北去的路线' }, {
      visibility: 'discoverable',
      provenance: { kind: 'explicit', sourceFactIds: ['fact-later-journey'], rationale: '后段事实投影' },
    }),
    situationEntry(),
  ];
}

async function fixture(options = {}) {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const sql of migration.sql.split(';').map(p => p.trim()).filter(Boolean)) db.exec(sql);
  }
  const adapter = new NodeSqliteAdapter(db);
  const worlds = new SqliteWorldStore(adapter);
  const sources = new SqliteSourceStore(adapter);
  const turns = new SqliteTurnStore(adapter);
  const game = new SqliteGameStore(adapter);
  const narratives = new SqliteNarrativeStore(adapter);
  const guidance = new SqliteGuidanceStore(adapter);
  await worlds.createWorld({ worldId: 'w', title: 'P7', sourceSha256: 'a'.repeat(64), sourceBytes: 100,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: now, updatedAt: now });
  // Real chapter rows so canon fact source spans satisfy their FKs.
  const srcText = '岳轻重伤。北上。'.repeat(10);
  const srcHash = await sha.sha256Hex(srcText);
  await sources.beginStaging({
    sourceId: 'src', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: srcHash, normalizeTreeHashVersion: 'n',
    byteLength: srcText.length, codePointCount: Array.from(srcText).length, encoding: 'utf-8',
    normalizeVersion: 'n', chapterSplitVersion: 'c', normalizeShardScheme: 'test', splitStrategy: 'standard',
    fileName: 'p7.txt', title: 'p7', status: 'staging', createdAt: now, updatedAt: now,
  });
  await sources.saveShard({ sourceId: 'src', shardIndex: 0, startCp: 0, endCp: Array.from(srcText).length, text: srcText });
  await sources.activateSource({
    manifest: { sourceId: 'src', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: srcHash, normalizeTreeHashVersion: 'n',
      byteLength: srcText.length, codePointCount: Array.from(srcText).length, encoding: 'utf-8',
      normalizeVersion: 'n', chapterSplitVersion: 'c', normalizeShardScheme: 'test', splitStrategy: 'standard',
      fileName: 'p7.txt', title: 'p7', status: 'active', createdAt: now, updatedAt: now },
    chapters: [{ chapterId: 'ch', index: 0, title: '开篇', startOffset: 0, endOffset: Array.from(srcText).length,
      charCount: Array.from(srcText).length, contentHash: srcHash }],
    chunks: [],
  });
  await worlds.addWorldSource({ worldId: 'w', sourceId: 'src', sourceOrdinal: 1, rawSha256: 'a'.repeat(64), createdAt: now });
  await worlds.saveImportedSource('w', {
    encoding: 'utf-8', sourceSha256Hex: 'a'.repeat(64), sourceByteLength: srcText.length,
    normalizeVersion: 'n', chapterSplitVersion: 'c', splitStrategy: 'standard', text: '',
    codePointCount: Array.from(srcText).length,
    chapters: [{ chapterId: 'ch', index: 0, title: '开篇', startOffset: 0, endOffset: Array.from(srcText).length,
      charCount: Array.from(srcText).length, contentHash: srcHash }],
    chunks: [],
  }, now);
  const entries = baseEntries();
  const published = await publishWorldPackage({
    worldStore: worlds, sha256Hex: sha.sha256Hex, worldId: 'w', sourceSha256: 'a'.repeat(64),
    mappingVersion: 'p7-test', entries, sections: [], createdAt: now,
  });
  assert.equal(published.manifest.schemaVersion, 'world-package-4');
  const campaign = await createCampaign({
    db: adapter, worldStore: worlds, campaignId: 'c', title: 'P7 战役', worldId: 'w',
    packageRevision: published.manifest.revision, anchor: { worldTimeOrder: 1, locationId: 'bridge' },
    protagonist: {
      actorId: 'pc', kind: 'original', name: '玩家',
      attributes: { physique: 1, agility: 1, insight: 3, knowledge: 3, willpower: 1, social: 1 },
      initialSkills: options.noMedicine ? ['skill-observation'] : ['skill-medicine', 'skill-observation'],
    },
    goal: '救下同伴', createdAt: now,
  });
  // Seed the wounded companion actor + a later canon fact for causal order.
  await worlds.upsertEntity({ worldId: 'w', entityId: 'ent-companion', type: 'character', name: '岳轻', aliases: [], firstSeenChapterId: 'ch' }, now);
  await worlds.saveFact({
    worldId: 'w', factId: 'fact-companion-wounded', subjectEntityId: 'ent-companion',
    predicate: 'wounded', value: { text: '岳轻重伤' }, status: 'explicit', confidence: 1,
    validFrom: null, validTo: null, revealAt: null, scope: 'world',
    sources: [{ chapterId: 'ch', startOffset: 0, endOffset: 5, quote: '岳轻重伤', quoteSha256: await sha.sha256Hex('岳轻重伤') }],
  }, now);
  await worlds.saveFact({
    worldId: 'w', factId: 'fact-later-journey', subjectEntityId: 'ent-companion',
    predicate: 'journey', value: { text: '北上' }, status: 'explicit', confidence: 1,
    validFrom: '2', validTo: null, revealAt: null, scope: 'world',
    sources: [{ chapterId: 'ch', startOffset: 0, endOffset: 4, quote: '北上', quoteSha256: await sha.sha256Hex('北上') }],
  }, now);
  const seedState = await turns.getState(campaign.branchId);
  const next = { ...seedState, stateVersion: seedState.stateVersion + 1 };
  next.actors['actor-companion'] = {
    actorId: 'actor-companion', locationId: 'bridge',
    resources: { hp: 1, stamina: 2 }, conditions: ['bleeding'], lifeStatus: 'critical',
  };
  await turns.commitAtomic({
    branchId: campaign.branchId, turnId: 'turn-0000-seed', expectedStateVersion: seedState.stateVersion,
    nextState: next, actionContractJson: '{}', actionContractHash: 'seed',
    committedTurn: { branchId: campaign.branchId, turnId: 'turn-0000-seed',
      previousStateVersion: seedState.stateVersion, stateVersion: next.stateVersion,
      outcomeGrade: 'success', publicSummary: '开局', effects: [], committedAt: now },
  });

  /** Configurable fake provider: planner fixed; narrator scripted per call. */
  const provider = {
    requests: [],
    narratorScript: [],
    async complete(request) {
      this.requests.push(request);
      const value = JSON.parse(request.user);
      if (request.role === 'Planner') {
        return {
          text: JSON.stringify({
            proposalVersion: '2.0', turnId: value.turnId, expectedStateVersion: value.expectedStateVersion,
            actorId: 'pc', actionKind: 'skill_check', skillId: value.playerIntent.includes('伤势') ? 'skill-medicine' : 'skill-observation',
            difficultyBand: 'normal', evidenceIds: value.playerIntent.includes('北上') ? ['lore-north'] : [],
            intent: value.playerIntent,
          }),
          usage: { inputTokens: 100, outputTokens: 60, estimated: false },
        };
      }
      const scripted = this.narratorScript.shift() ?? {
        turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '叙事正文。',
      };
      return { text: JSON.stringify({ turnId: value.turnId, ...scripted, outcomeGrade: value.outcomeGrade }),
        usage: { inputTokens: 100, outputTokens: 80, estimated: false } };
    },
  };
  const session = new CampaignSession(
    { db: adapter, turns, game, worldStore: worlds, narratives, guidance, hashProvider: sha, random: { nextIntInclusive: () => 6 } },
    provider,
    { endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
      capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } },
  );
  return { db, adapter, worlds, turns, narratives, guidance, provider, session, campaign, published };
}

test('A13/A11: two business calls; good narrative with bad paths commits once and degrades locally', async () => {
  const h = await fixture(); try {
    h.provider.narratorScript = [
      // Turn 1: no guidance fields at all (old-style narrator output).
      { text: '你环顾四周，血迹通向北方。' },
      // Turn 2: valid text + MALFORMED paths (unknown ref, oversized field,
      // GM-secret leak). The narrative must survive; paths degrade locally.
      {
        text: '你俯身检查岳轻的伤势，用随身药物止住了血。',
        situationSummary: { changes: ['岳轻的伤势稳定了'], opportunities: [], pressures: [] },
        nextSteps: [
          { candidateRef: 'method:situation-sect:not-a-method', title: '幽灵路径', rationale: 'r', tradeoffs: 't', firstStepIntent: 'i' },
          { candidateRef: 'method:situation-sect:heal', title: '超'.repeat(30) + '长标题', rationale: 'r', tradeoffs: 't', firstStepIntent: '检查伤势并救治同伴' },
          { candidateRef: 'method:situation-sect:survey', title: '查看现场', rationale: '北镇抚司密令指使了袭击', tradeoffs: 't', firstStepIntent: '查看现场痕迹' },
        ],
      },
    ];
    const first = await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '查看周围' });
    // Turn 1: old-style narrative (no guidance fields) — the packet activates
    // the situation DURING the prepared reduction, so LOCAL guidance still
    // appears for the new decision point (degraded, no LLM steps).
    assert.ok(first.guidance);
    assert.equal(first.guidance.degraded, true);
    assert.ok(first.guidance.steps.every(step => step.source === 'local'));
    const stateAfterFirst = await h.turns.getState(h.campaign.branchId);
    assert.equal(stateAfterFirst.situations.find(s => s.situationId === 'situation-sect').status, 'active', 'knowledge-free situation activates on first commit');

    const second = await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '检查同伴伤势并止血救治' });
    // Exactly Planner+Narrator per turn — no re-sends for path repair.
    assert.equal(h.provider.requests.length, 4);
    assert.equal(h.provider.requests.filter(r => r.role === 'Narrator').length, 2);
    assert.ok(second.guidance, 'guidance present for the committed decision point');
    // The heal averted the canon death reference in the same commit — a
    // major turning point with the wider guidance budget.
    assert.equal(second.guidance.severity, 'major');
    assert.ok(second.guidance.steps.length <= 4, 'major display cap');
    assert.ok(second.guidance.degraded, 'bad paths forced degradation');
    const refs = second.guidance.steps.map(s => s.candidateRef);
    assert.ok(!refs.includes('method:situation-sect:not-a-method'), 'unknown ref dropped');
    for (const step of second.guidance.steps) {
      for (const text of [step.title, step.rationale, step.tradeoffs, step.firstStepIntent]) {
        assert.equal(text.includes('北镇抚司'), false, 'GM-only secret never surfaces');
      }
    }
    assert.ok(second.guidance.steps.some(s => s.candidateRef === 'method:situation-sect:heal' && s.source === 'local'), 'leaking/oversized LLM wording falls back to published method text');
    // Guidance persisted after commit, bound to the decision point.
    const stored = await h.guidance.latestForVersion(h.campaign.branchId, second.stateVersion);
    assert.equal(stored.decisionPoint.decisionPointId, `${h.campaign.branchId}:${second.stateVersion}`);
    assert.equal(stored.decisionPoint.sourceTurnId, second.turnId);
  } finally { h.db.close(); }
});

test('A04/A07: method binding applies engine effects and situation transitions once', async () => {
  const h = await fixture(); try {
    h.provider.narratorScript = [{ text: '你查看四周。' }, { text: '你止住了岳轻的血。' }];
    await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '查看周围' });
    const result = await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '检查同伴伤势并止血救治' });
    const staged = await h.turns.getStagedTurn(h.campaign.branchId, result.turnId);
    const contract = JSON.parse(staged.actionContractJson);
    assert.deepEqual(contract.methodRef, { situationId: 'situation-sect', methodId: 'heal' }, 'local compiler bound the heal method');
    assert.ok(contract.outcomes.success.effects.some(e => e.op === 'removeCondition' && e.actorId === 'actor-companion'),
      'method success effects injected into the frozen contract');
    const state = await h.turns.getState(h.campaign.branchId);
    assert.equal(state.actors['actor-companion'].conditions.includes('bleeding'), false, 'bleeding removed by the engine, not the narrative');
    assert.equal(state.situations.find(s => s.situationId === 'situation-sect').counters.stabilized, 1);
    assert.equal(state.actors['actor-companion'].lifeStatus, 'critical', 'life status transitions stay rule-driven');
  } finally { h.db.close(); }
});

test('A08/A18: eligibility follows the real card — missing skill yields needs_preparation', async () => {
  const h = await fixture({ noMedicine: true }); try {
    h.provider.narratorScript = [{ text: '你查看四周。' }];
    const first = await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '查看周围' });
    const heal = first.guidance.steps.find(s => s.methodId === 'heal');
    assert.ok(heal, 'the heal path is still SHOWN');
    assert.equal(heal.availability, 'needs_preparation');
    assert.ok((heal.blockers ?? []).some(b => b.includes('skill-medicine')), 'blocker names the missing skill');
    const survey = first.guidance.steps.find(s => s.methodId === 'survey');
    assert.equal(survey?.availability, 'available', 'a skill the player HAS stays available');
    const state = await h.turns.getState(h.campaign.branchId);
    assert.equal(state.actors['actor-companion'].conditions.includes('bleeding'), true, 'no skill, no cure — state is not narrated away');
    // And the untrained heal attempt is refused cleanly by the local rules.
    await assert.rejects(
      h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '检查同伴伤势并止血救治' }),
      /尚未掌握技能/,
    );
  } finally { h.db.close(); }
});

test('A01/A02: fate suppression once the causal order reaches the reference', async () => {
  const h = await fixture(); try {
    h.provider.narratorScript = [{ text: '你查看四周。' }, { text: '你止住了血。' }, { text: '你们北上。' }];
    await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '查看周围' });
    await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '检查同伴伤势并止血救治' });
    // Third turn cites the later canon fact, lifting causal order to 30.
    await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '观察四周，寻找北上的路线线索' });
    const state = await h.turns.getState(h.campaign.branchId);
    const situation = state.situations.find(s => s.situationId === 'situation-sect');
    assert.ok(situation.suppressedEventKeys['evt-companion-death'], 'death reference suppressed with audit');
    assert.equal(state.actors['actor-companion'].lifeStatus, 'critical', 'the saved companion stays alive');
    // Control: without the heal, the reference fires on the branch.
    const h2 = await fixture(); try {
      h2.provider.narratorScript = [{ text: '你查看四周。' }, { text: '你查看四周。' }, { text: '你们北上。' }];
      await h2.session.playTurn({ campaignId: 'c', branchId: h2.campaign.branchId, intent: '查看周围' });
      await h2.session.playTurn({ campaignId: 'c', branchId: h2.campaign.branchId, intent: '查看现场痕迹' });
      await h2.session.playTurn({ campaignId: 'c', branchId: h2.campaign.branchId, intent: '观察四周，寻找北上的路线线索' });
      const control = await h2.turns.getState(h2.campaign.branchId);
      const controlSituation = control.situations.find(s => s.situationId === 'situation-sect');
      assert.equal(controlSituation.suppressedEventKeys['evt-companion-death'], undefined, 'no suppression without the rescue');
      assert.equal(control.actors['actor-companion'].lifeStatus, 'dead', 'the unaverted fate applies on this branch');
      assert.equal(controlSituation.status, 'resolved');
      assert.equal(controlSituation.resolution, '同伴伤重不治');
      // Canon itself is untouched: the world event row still exists as-is.
      const events = await h2.worlds.listEvents('w');
      assert.equal(events.length, 0, 'no canon rows were rewritten by branch play');
    } finally { h2.db.close(); }
  } finally { h.db.close(); }
});

test('A14: replaying a committed turn resumes without new requests or double settlement', async () => {
  const h = await fixture(); try {
    h.provider.narratorScript = [{ text: '你查看四周。' }];
    const first = await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '查看周围' });
    const requests = h.provider.requests.length;
    // Process died after commit but before returning: the same turn replays
    // through the committed-resume path — zero new LLM requests, same version.
    const replay = await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '查看周围', turnIdOverride: first.turnId });
    assert.equal(replay.resumed, true);
    assert.equal(replay.stateVersion, first.stateVersion);
    assert.equal(h.provider.requests.length, requests, 'no additional business calls');
    const state = await h.turns.getState(h.campaign.branchId);
    assert.equal(state.situations.find(x => x.situationId === 'situation-sect').statusVersion, 1, 'situation tick applied exactly once');
  } finally { h.db.close(); }
});

test('A15: fork carries situation state independently per branch', async () => {
  const h = await fixture(); try {
    h.provider.narratorScript = [{ text: '你查看四周。' }];
    await h.session.playTurn({ campaignId: 'c', branchId: h.campaign.branchId, intent: '查看周围' });
    const fork = await forkBranch({ db: h.adapter, turnStore: h.turns, gameStore: h.game,
      sourceBranchId: h.campaign.branchId, targetBranchId: 'p7-fork', campaignId: 'c',
      forkTurnId: null, atStateVersion: 2, createdAt: now });
    const forkState = await h.turns.getState('p7-fork');
    assert.ok(fork.snapshot.situations?.some(x => x.situationId === 'situation-sect'), 'fork snapshot carries situation history');
    assert.equal(forkState?.situations?.[0]?.situationId, 'situation-sect', 'forked branch reads its own situation state');
    // Old guidance never crosses into the fork's decision points.
    assert.equal((await h.guidance.get('p7-fork', `${h.campaign.branchId}:1`)), null);
  } finally { h.db.close(); }
});
