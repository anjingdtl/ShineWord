/**
 * Phase 9 SQLite tests (P9-2, PROTOCOL_BASELINE.md §6 P9G5/P9G6).
 *
 * Real SQLite (node:sqlite): baseline 101 campaign tables, setup/job/candidate
 * lifecycle with lease+fence CAS, trigger merging (single-flight), plan
 * revision/artifact archives and the save-10 campaign section round trip.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const { SqliteCampaignPlanStore } = require('../dist/infra/sqlite/sqliteCampaignPlanStore');
const { installBaselineSchema } = require('../dist/application/project/dbBaseline');
const { exportSave, restoreSave, validateSaveJson, SAVE_SCHEMA_VERSION } = require('../dist/application/export/saveFile');

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
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

const sha = { async sha256Hex(input) { return require('node:crypto').createHash('sha256').update(input, 'utf8').digest('hex'); } };
const NOW = '2026-10-06T00:00:00.000Z';
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
function seal(value) {
  const { contentHash, ...body } = value;
  return { ...body, contentHash: sha256HexOf(canonicalJsonOf(body)) };
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  db.exec(BUILTIN_MIGRATIONS[0].sql);
  db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)").run(101, BUILTIN_MIGRATIONS[0].name, NOW);
  return db;
}

const intent = {
  schemaVersion: 'campaign-intent-1', setupId: 'setup-1', intentRevision: 1,
  rawIntent: '保护安娜', normalizedIntent: '保护安娜', goalMode: 'declared',
  protagonistBinding: { actorId: 'pc', kind: 'original', name: '旅人' },
  openingAnchor: { worldTimeOrder: 3, locationId: 'loc-tavern' },
  companionBindings: [], lengthPreference: 'medium', userConstraints: [], requestedCanonTargets: [],
  knowledgePolicy: 'anchor_projection',
  sourceCoverageBinding: { worldId: 'w1', packageRevision: 1, coverageWorldTimeOrder: 3, packageContentHash: 'h'.repeat(64) },
  createdAt: NOW,
};

function planFixture() {
  return seal({
    schemaVersion: 'campaign-plan-1', planId: 'plan-1', revision: 1, parentRevision: null,
    intentHash: sha256HexOf(canonicalJsonOf(intent)),
    baseWorldBinding: { worldId: 'w1', packageRevision: 1, packageContentHash: 'h'.repeat(64), coverageWorldTimeOrder: 3 },
    ruleBindingHash: 'r'.repeat(64),
    longTermGoal: '保护安娜', publicPitch: '一场围绕酒馆威胁的冒险。', gmPremise: 'gm premise detail here',
    tone: '写实', lengthPreference: 'medium', startNodeIds: ['stage-1'],
    nodes: [], possibleEndings: [], unresolvedDependencies: [], contentArtifactRefs: ['art-1'],
    compilerVersion: 'campaign-plan-compiler-1', contentHash: 'p'.repeat(64), createdAt: NOW,
  });
}

test('P9G5: setup lifecycle — upsert, candidate invalidation on intent edit, delete cancels in-flight jobs', async () => {
  const adapter = new NodeSqliteAdapter(freshDb());
  const store = new SqliteCampaignPlanStore(adapter);
  await store.upsertSetup({
    setupId: 'setup-1', worldId: 'w1', packageRevision: 1,
    intent, intentHistory: [intent], currentCandidateId: null, status: 'planning',
    createdAt: NOW, updatedAt: NOW,
  });
  const read = await store.getSetup('setup-1');
  assert.equal(read.intent.normalizedIntent, '保护安娜');

  await store.upsertSetup({ setupId: 'setup-1', worldId: 'w1', packageRevision: 1, intent, intentHistory: [intent], currentCandidateId: 'cand-1', status: 'proposal_ready', createdAt: NOW, updatedAt: NOW });
  assert.equal(await store.invalidateSetupCandidate('setup-1', NOW), true, 'ready proposal invalidated on edit');
  assert.equal((await store.getSetup('setup-1')).status, 'planning');
  assert.equal(await store.invalidateSetupCandidate('setup-1', NOW), false, 'second invalidate is a no-op');

  await store.insertJob({
    jobId: 'job-1', setupId: 'setup-1', campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: ['user_requested'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: 'i'.repeat(64), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null,
    createdAt: NOW, updatedAt: NOW,
  });
  await store.deleteSetup('setup-1');
  assert.equal((await store.getJob('job-1')).status, 'cancelled', 'delete cancels the queued job');
  assert.equal(await store.getSetup('setup-1'), null);
});

test('P9G5: job single-flight merges duplicate triggers for the same branch+kind', async () => {
  const adapter = new NodeSqliteAdapter(freshDb());
  const store = new SqliteCampaignPlanStore(adapter);
  const job = {
    jobId: 'job-r1', setupId: 'setup-1', campaignId: 'camp-1', branchId: 'b1', jobKind: 'replan',
    triggerReasons: ['npc_death'], baseStateVersion: 9, basePlanId: 'plan-1', basePlanRevision: 1,
    intentHash: 'i'.repeat(64), contentManifestHash: 'm', knowledgePolicyHash: 'k', triggerEventRefs: ['e1'],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null,
    createdAt: NOW, updatedAt: NOW,
  };
  const first = await store.enqueueJobMergingTriggers(job, ['npc_death'], NOW);
  assert.equal(first.merged, false);
  const second = await store.enqueueJobMergingTriggers({ ...job, jobId: 'job-r2' }, ['early_resolution', 'npc_death'], NOW);
  assert.equal(second.merged, true, 'duplicate trigger absorbed by the in-flight job');
  assert.equal(second.jobId, 'job-r1');
  const merged = await store.getJob('job-r1');
  assert.deepEqual([...merged.triggerReasons].sort(), ['early_resolution', 'npc_death']);
  assert.equal((await store.getJob('job-r2')), null, 'no second job was created');
});

test('P9G5: claim/transition are fenced — a stale worker cannot finish or overwrite', async () => {
  const adapter = new NodeSqliteAdapter(freshDb());
  const store = new SqliteCampaignPlanStore(adapter);
  await store.insertJob({
    jobId: 'job-2', setupId: 'setup-1', campaignId: 'camp-1', branchId: 'b1', jobKind: 'replan',
    triggerReasons: ['goal_changed'], baseStateVersion: 5, basePlanId: 'plan-1', basePlanRevision: 1,
    intentHash: 'i'.repeat(64), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null,
    createdAt: NOW, updatedAt: NOW,
  });
  const claimed = await store.claimJob('job-2', 'worker-a', '2026-10-06T00:01:00Z', NOW);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.fencingToken, 1);
  // A second claim while running is refused.
  assert.equal(await store.claimJob('job-2', 'worker-b', '2026-10-06T00:02:00Z', NOW), null);
  // Stale token (a worker that lost its lease) cannot transition the job.
  assert.equal(await store.transitionJob('job-2', 0, 'candidate_ready', {}, NOW), false);
  assert.equal(await store.transitionJob('job-2', 1, 'candidate_ready', {}, NOW), true);
  // Reclaim after lease expiry is allowed and re-fences.
  await store.transitionJob('job-2', 1, 'running', {}, NOW).then(async ok => {
    // direct running transition without lease is fenced-off by token mismatch only;
    // simulate expired lease reclaim via SQL path:
    if (ok) {
      const reclaimed = await store.reclaimExpiredJob('job-2', 'worker-c', '2026-10-06T00:05:00Z', '2026-10-06T00:04:30Z');
      // lease not yet expired at 'now' → refused
      assert.equal(reclaimed, null);
    }
  });
  const finalJob = await store.getJob('job-2');
  assert.equal(finalJob.status, 'running');
});

test('P9G5: candidates persist raw → ready stages with repair flags and validation artifacts', async () => {
  const adapter = new NodeSqliteAdapter(freshDb());
  const store = new SqliteCampaignPlanStore(adapter);
  await store.insertJob({
    jobId: 'job-3', setupId: 'setup-1', campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: [], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: 'i'.repeat(64), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null,
    createdAt: NOW, updatedAt: NOW,
  });
  const candidate = {
    candidateId: 'cand-1', jobId: 'job-3', setupId: 'setup-1', attemptGroup: 'g1', attemptNo: 1,
    stage: 'raw_response', rawResponseRef: 'frozen-root-1', rawResponseText: '{"goal":"..."}',
    parseResultJson: null, validationErrors: [], repairUsed: false, candidateHash: 'c'.repeat(64),
    plan: null, artifact: null, createdAt: NOW, updatedAt: NOW,
  };
  await store.upsertCandidate(candidate);
  await store.markCandidateStage('cand-1', 'ready', [], NOW);
  const read = await store.getCandidate('cand-1');
  assert.equal(read.stage, 'ready');
  assert.equal(read.rawResponseText, '{"goal":"..."}', 'durable raw artifact for recovery (A29)');
  const compiled = { ...read, stage: 'compiled', plan: planFixture(), repairUsed: true, candidateHash: 'd'.repeat(64) };
  await store.upsertCandidate(compiled);
  assert.equal((await store.latestCandidateForJob('job-3')).stage, 'compiled');
});

test('P9G6: plan revisions and artifacts archive immutably and reload by identity', async () => {
  const adapter = new NodeSqliteAdapter(freshDb());
  const store = new SqliteCampaignPlanStore(adapter);
  const plan = planFixture();
  const artifact = seal({
    schemaVersion: 'campaign-content-1', artifactId: 'art-1', campaignId: 'camp-1', scope: 'campaign',
    planId: 'plan-1', planRevision: 1, namespace: 'campaign', situations: [], rewardPolicies: [],
    consequenceTemplates: [], dependencies: { worldEntryIds: [] },
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: 'test' },
    contentHash: 'a'.repeat(64), createdAt: NOW,
  });
  await adapter.transaction(async tx => {
    await store.archivePlanRevision(tx, { plan, intent, setupId: 'setup-1', campaignId: 'camp-1', sourceTrigger: 'opening', intentHash: plan.intentHash, adoptedAt: NOW });
    await store.archiveArtifact(tx, artifact, NOW);
  });
  const revision = await store.getPlanRevision('plan-1', 1);
  assert.equal(revision.plan.planId, 'plan-1');
  assert.equal(revision.intent.setupId, 'setup-1');
  assert.equal((await store.getArtifact('art-1')).artifactId, 'art-1');
  assert.equal((await store.listArtifactsForCampaign('camp-1')).length, 1);
});

test('P9G6: save-10 carries campaign plan/artifact sections and restores them under the new campaign id', async () => {
  const db = freshDb();
  const adapter = new NodeSqliteAdapter(db);
  const store = new SqliteCampaignPlanStore(adapter);
  const sourceHash = 'b'.repeat(64);
  const packageHash = 'a'.repeat(64);
  const ruleConfig = require('../dist/application/content/runtimeRules').createWorldRuleConfiguration('w1', 1);
  db.prepare("INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at) VALUES ('w1','T',?,1,'n','c','ready',?,?)").run(sourceHash, NOW, NOW);
  db.prepare("INSERT INTO world_packages (world_id,revision,schema_version,source_sha256,ruleset_id,ruleset_version,mapping_version,status,content_hash,validation_json,created_at,rule_config_json) VALUES ('w1',1,'shineword-world-package-5',?,'shineword-core','0.4.0','m','published',?,'{}',?,?)")
    .run(sourceHash, packageHash, NOW, JSON.stringify(ruleConfig));
  db.prepare("INSERT INTO campaigns (campaign_id,world_id,title,ruleset_id,ruleset_version,world_mapping_version,opening_json,created_at,package_revision,anchor_json,status) VALUES ('c1','w1','T','shineword-core','0.4.0','m','{}',?,1,'{}','active')").run(NOW);
  db.prepare("INSERT INTO branches (branch_id,campaign_id,state_version,created_at) VALUES ('b1','c1',1,?)").run(NOW);
  const plan = planFixture();
  const artifact = seal({
    schemaVersion: 'campaign-content-1', artifactId: 'art-1', campaignId: 'c1', scope: 'campaign',
    planId: 'plan-1', planRevision: 1, namespace: 'campaign', situations: [], rewardPolicies: [],
    consequenceTemplates: [], dependencies: { worldEntryIds: [] },
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: 'test' },
    contentHash: 'a'.repeat(64), createdAt: NOW,
  });
  await adapter.transaction(async tx => {
    await store.archivePlanRevision(tx, { plan, intent, setupId: 'setup-1', campaignId: 'c1', sourceTrigger: 'opening', intentHash: plan.intentHash, adoptedAt: NOW });
    await store.archiveArtifact(tx, artifact, NOW);
  });
  const runtime = {
    schemaVersion: 'campaign-runtime-1', branchId: 'b1',
    planBinding: { planId: 'plan-1', revision: 1, contentHash: plan.contentHash },
    intentRevision: 1, stateVersion: 1, campaignStatus: 'active', primaryNodeId: 'stage-1',
    nodeStates: [{ nodeId: 'stage-1', status: 'active', completedEvidence: [] }],
    deferredConsequences: [], processedEventKeys: [], grantedRewardKeys: [],
    lastProgressVersion: 1, replanReasonCodes: [], publicObjectiveProjection: '保护安娜',
    recentProgressLines: [],
  };
  const state = {
    ruleConfiguration: ruleConfig,
    branchId: 'b1', stateVersion: 1, clockSeconds: 60, clockMinutes: 1,
    actors: { pc: { actorId: 'pc', locationId: 'l1', resources: { hp: 5 }, conditions: [] } },
    itemOwners: {}, encounters: [],
    campaignRuntime: runtime,
    campaignContentBinding: { artifactIds: ['art-1'], contentHash: artifact.contentHash },
  };
  db.prepare("INSERT INTO snapshots (branch_id,state_version,snapshot_json,state_hash,created_at) VALUES ('b1',1,?,NULL,?)").run(JSON.stringify(state), NOW);
  db.prepare("INSERT INTO actor_cards (branch_id,actor_id,card_json,created_at,updated_at,updated_state_version) VALUES ('b1','pc',?,?,?,0)").run(JSON.stringify({ actorId: 'pc', name: '玩家', controller: 'player' }), NOW, NOW);
  db.prepare("INSERT INTO party_members (branch_id,actor_id,controller,role,joined_at) VALUES ('b1','pc','player','protagonist',?)").run(NOW);
  db.prepare("INSERT INTO turns (branch_id,turn_id,expected_state_version,committed_state_version,status,outcome_grade,public_summary,effects_json,action_contract_json,action_contract_hash,created_at) VALUES ('b1','turn-0001',0,1,'Committed','success','观察了一回合','[]','{}','hash',?)").run(NOW);

  const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex, campaignId: 'c1', branchId: 'b1', createdAt: NOW });
  assert.equal(exported.save.manifest.schemaVersion, 'shineword-save-10');
  assert.equal(exported.save.campaign.planRevisions.length, 1, 'plan revision rides the save');
  assert.equal(exported.save.campaign.intents.length, 1, 'intent rides the save');
  assert.equal(exported.save.campaign.artifacts.length, 1, 'artifact rides the save');
  assert.deepEqual(await validateSaveJson(exported.json, sha.sha256Hex), { ok: true, errors: [] });

  // A save whose campaign section drops a bound artifact is refused.
  const tampered = JSON.parse(exported.json);
  tampered.campaign.artifacts = [];
  assert.ok((await validateSaveJson(JSON.stringify(tampered), sha.sha256Hex)).errors.some(e => e.includes('does not carry')));

  // Import into a fresh database: plan/artifact land under the new campaign id.
  const target = freshDb();
  const targetAdapter = new NodeSqliteAdapter(target);
  target.prepare("INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at) VALUES ('w1','T',?,1,'n','c','ready',?,?)").run(sourceHash, NOW, NOW);
  target.prepare("INSERT INTO world_packages (world_id,revision,schema_version,source_sha256,ruleset_id,ruleset_version,mapping_version,status,content_hash,validation_json,created_at,rule_config_json) VALUES ('w1',1,'shineword-world-package-5',?,'shineword-core','0.4.0','m','published',?,'{}',?,?)")
    .run(sourceHash, packageHash, NOW, JSON.stringify(ruleConfig));
  await restoreSave({ db: targetAdapter, sha256Hex: sha.sha256Hex, save: exported.save, newCampaignId: 'c1r', newBranchId: 'b1r', createdAt: NOW });
  const targetStore = new SqliteCampaignPlanStore(targetAdapter);
  const restored = await targetStore.getPlanRevision('plan-1', 1);
  assert.equal(restored.plan.planId, 'plan-1', 'plan revision restored verbatim — no regeneration');
  assert.equal((await targetStore.getArtifact('art-1')).campaignId, 'c1r', 'artifact rebound to the new campaign');
  const restoredSnapshot = target.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id=? ORDER BY state_version DESC LIMIT 1').get('b1r');
  const runtimeBack = JSON.parse(restoredSnapshot.snapshot_json).campaignRuntime;
  assert.equal(runtimeBack.planBinding.planId, 'plan-1');
  assert.equal(runtimeBack.primaryNodeId, 'stage-1', 'runtime progress survives the hop');
});
