/** Shared phase-9 campaign fixture (world build → plan compile → adopt → session). */
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../../dist/infra/sqlite/builtinMigrations');

const { NodeSqliteAdapter, sha } = require('./mobileHarness.cjs');
const { SqliteWorldStore } = require('../../dist/infra/sqlite/sqliteWorldStore');
const { SqliteSourceStore } = require('../../dist/infra/sqlite/sqliteSourceStore');
const { SqliteTurnStore } = require('../../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../../dist/infra/sqlite/sqliteGameStore');
const { SqliteNarrativeStore } = require('../../dist/infra/sqlite/sqliteNarrativeStore');
const { SqliteCampaignPlanStore } = require('../../dist/infra/sqlite/sqliteCampaignPlanStore');
const { publishWorldPackage } = require('../../dist/application/worldPackage/publish');
const { createCampaign } = require('../../dist/application/campaign/createCampaign');
const { CampaignSession } = require('../../dist/application/campaign/session');
const { adoptOpeningPlan } = require('../../dist/application/campaignPlan/adoption');
const { compileCampaignPlan, firstSituationEntryId } = require('../../dist/application/campaignPlan/localCompile');
const { requireCompiledRules } = require('../../dist/application/content/runtimeRules');
const { compileProposal } = require('../../dist/application/game/v2Compile');


const NOW = '2026-10-06T00:00:00.000Z';
const SITUATION_ID = require('../../dist/application/campaignPlan/localCompile').firstSituationEntryId();
function entry(entryId, kind, definition, options = {}) {
  return {
    entryId, kind, revision: 0,
    provenance: options.provenance ?? { kind: 'explicit', sourceFactIds: [], rationale: 'fixture' },
    fieldProvenance: {},
    visibility: options.visibility ?? 'public',
    dependencyIds: options.dependencyIds ?? [],
    definition,
  };
}

function baseEntries() {
  return [
    entry('skill-observation', 'skill', { name: '观察', description: '观察环境', attribute: 'insight', allowUntrained: true, powerTier: 'ordinary', usage: 'knowledge' }),
    entry('tpl-lin', 'actor_template', {
      name: '林凡', category: 'human', description: '巷子里的知情人',
      attributes: { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 2, social: 2 },
      skills: {}, hp: 8, stamina: 6, defense: 2, attacks: [], abilities: [], startingItems: [],
      behavior: { goal: '守着巷子', retreatThreshold: 0.2, morale: 'steady' }, lootPolicy: '无',
      threat: { damage: 0, durability: 1, actions: 1, control: 0, environment: 0 },
    }),
    entry('scene-alley', 'scene', {
      name: '青石巷口', description: '入夜前的青石巷', locationId: '青石巷',
      zones: [{ zoneId: 'z', name: '巷口', cover: false, exits: [] }],
      actors: ['tpl-lin'], visibleItems: [], hazards: [], clues: [],
    }, { dependencyIds: ['tpl-lin'] }),
    entry('lore-crates', 'lore', { name: '可疑的货箱', text: '巷尾堆着不属于这里的货箱。' }, {
      visibility: 'public',
      provenance: { kind: 'explicit', sourceFactIds: ['fact-crates'], rationale: '现场线索' },
    }),
  ];
}

function candidateModel() {
  return {
    modelVersion: 'campaign-plan-model-1',
    proposal: {
      title: '青石巷的威胁', longTermGoal: '查明并解除青石巷的隐患',
      publicPitch: '一条以调查和保护为核心的短冒险：入夜禁行之下，巷子里的平静正在被打破。',
      gmPremise: '幕后是私运团伙，只有在证据面前才会暴露。',
      tone: '写实',
    },
    stages: [
      {
        nodeId: 'stage-1', role: 'main', title: '查明隐患', publicObjective: '弄清青石巷里发生了什么',
        gmPurpose: '让玩家在现场取得第一批证据。',
        coverage: 'concrete', activation: null,
        completion: { kind: 'all', of: [{ kind: 'situation_resolved', situationId: 'self' },
          { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 1 }] },
        failure: null, cancellation: null, dependsOn: [], alternatives: [], next: ['stage-2'],
        provenance: { kind: 'design_fill', rationale: 'opening stage' },
      },
      {
        nodeId: 'stage-2', role: 'main', title: '解除威胁', publicObjective: '在事情失控前解决隐患',
        gmPurpose: 'gm purpose stage two',
        coverage: 'provisional',
        activation: { kind: 'node_succeeded', nodeId: 'stage-1' },
        completion: { kind: 'committed_event', eventType: 'quest_succeeded' },
        failure: null, cancellation: null, dependsOn: ['stage-1'], alternatives: [], next: [],
        provenance: { kind: 'design_fill', rationale: 'later' },
      },
    ],
    endings: [
      { endingId: 'end-safe', title: '巷子重归平静', publicDescription: '威胁解除。', outcomeKind: 'success',
        condition: { kind: 'node_succeeded', nodeId: 'stage-2' } },
    ],
    firstSituation: {
      situationTitle: '入夜前的青石巷', summary: '入夜禁行将近，青石巷里的动静不太对劲。',
      gmBrief: '证据藏在货箱与脚印里。', pressureDescription: '夜幕降临前局势会变化。',
      deadlineClockSeconds: 3600,
      signs: [{ text: '现场留有尚未查明的细节' }],
      methods: [
        {
          methodId: 'sweep', title: '查看现场', goal: '弄清巷子里的异常',
          firstStep: { intent: '仔细查看青石巷现场，寻找值得注意的细节与线索', actionKind: 'skill_check', skillId: 'skill-observation' },
          requires: { skillId: 'skill-observation', minRank: 'untrained' },
          tradeoffs: '花费时间', preparation: '无',
          outcomes: {
            full_success: { resultFact: '你把现场看得一清二楚，确认了货箱的可疑。', effects: [
              { template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 2 },
              { template: 'record_event', eventType: 'scene_swept', summary: '现场被彻底检查' }] },
            success: { resultFact: '你确认了异常的大致来源。', effects: [
              { template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 }] },
            failure: { resultFact: '你没有看出额外的线索。', effects: [] },
            severe_failure: { resultFact: '你打翻了货箱，惊动了旁人。', effects: [
              { template: 'record_event', eventType: 'alert_raised', summary: '动静引起了注意' }] },
          },
        },
        {
          methodId: 'ask-lin', title: '找林凡打听', goal: '从知情人处了解情况',
          firstStep: { intent: '向林凡打听青石巷最近的情况', actionKind: 'talk', targetEntryId: 'tpl-lin' },
          requires: {}, tradeoffs: '对方不一定愿意多说', preparation: '无',
          outcomes: {
            full_success: { resultFact: '林凡把知道的全告诉了你，并愿意作证。', effects: [
              { template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 },
              { template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '威胁来源被林凡指认' },
              { template: 'schedule_consequence', consequenceId: 'lin-favor' }] },
            success: { resultFact: '林凡透露了关键信息，愿意作证。', effects: [
              { template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 },
              { template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '威胁来源被林凡指认' },
              { template: 'schedule_consequence', consequenceId: 'lin-favor' }] },
            failure: { resultFact: '林凡摇了摇头，不愿多说。', effects: [] },
            severe_failure: { resultFact: '你的追问让林凡起了疑心。', effects: [] },
          },
        },
      ],
    },
    consequences: [
      { consequenceId: 'lin-favor', description: '林凡稍后会请你帮他一个小忙', visibility: 'public',
        trigger: { kind: 'situation_resolved', situationId: 'self' },
        effects: [{ template: 'record_event', eventType: 'lin_called_in_favor', summary: '林凡提出了请求' }] },
    ],
    rewards: [
      { policyId: 'rp-1', nodeId: 'stage-1', description: '调查经验与货箱线索',
        rewards: [{ kind: 'knowledge', targetId: 'lore-crates' }] },
    ],
  };
}

async function fixture(options = {}) {
  const entries = options.entries ?? baseEntries();
  const db = new DatabaseSync(':memory:');
  for (const sql of BUILTIN_MIGRATIONS[0].sql.split(';').map(part => part.trim()).filter(Boolean)) db.exec(sql);
  const adapter = new NodeSqliteAdapter(db);
  const worlds = new SqliteWorldStore(adapter);
  const sources = new SqliteSourceStore(adapter);
  const turns = new SqliteTurnStore(adapter);
  const game = new SqliteGameStore(adapter);
  const narratives = new SqliteNarrativeStore(adapter);
  const planStore = new SqliteCampaignPlanStore(adapter);

  await worlds.createWorld({ worldId: 'w', title: 'P9', sourceSha256: 'a'.repeat(64), sourceBytes: 100,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: NOW, updatedAt: NOW });
  const srcText = '林凡站在青石巷，巷尾堆着不属于这里的货箱。'.repeat(10);
  const srcHash = await sha.sha256Hex(srcText);
  await sources.beginStaging({
    sourceId: 'src', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: srcHash, normalizeTreeHashVersion: 'n',
    byteLength: srcText.length, codePointCount: Array.from(srcText).length, encoding: 'utf-8',
    normalizeVersion: 'n', chapterSplitVersion: 'c', normalizeShardScheme: 'test', splitStrategy: 'standard',
    fileName: 'p9.txt', title: 'p9', status: 'staging', createdAt: NOW, updatedAt: NOW,
  });
  await sources.saveShard({ sourceId: 'src', shardIndex: 0, startCp: 0, endCp: Array.from(srcText).length, text: srcText });
  await sources.activateSource({
    manifest: { sourceId: 'src', rawSha256Hex: 'a'.repeat(64), normalizedTreeHash: srcHash, normalizeTreeHashVersion: 'n',
      byteLength: srcText.length, codePointCount: Array.from(srcText).length, encoding: 'utf-8',
      normalizeVersion: 'n', chapterSplitVersion: 'c', normalizeShardScheme: 'test', splitStrategy: 'standard',
      fileName: 'p9.txt', title: 'p9', status: 'active', createdAt: NOW, updatedAt: NOW },
    chapters: [{ chapterId: 'ch', index: 0, title: '开篇', startOffset: 0, endOffset: Array.from(srcText).length,
      charCount: Array.from(srcText).length, contentHash: srcHash }],
    chunks: [],
  });
  await worlds.addWorldSource({ worldId: 'w', sourceId: 'src', sourceOrdinal: 1, rawSha256: 'a'.repeat(64), createdAt: NOW });
  await worlds.saveImportedSource('w', {
    encoding: 'utf-8', sourceSha256Hex: 'a'.repeat(64), sourceByteLength: srcText.length,
    normalizeVersion: 'n', chapterSplitVersion: 'c', splitStrategy: 'standard', text: '',
    codePointCount: Array.from(srcText).length,
    chapters: [{ chapterId: 'ch', index: 0, title: '开篇', startOffset: 0, endOffset: Array.from(srcText).length,
      charCount: Array.from(srcText).length, contentHash: srcHash }],
    chunks: [],
  }, NOW);
  const published = await publishWorldPackage({
    worldStore: worlds, sha256Hex: sha.sha256Hex, worldId: 'w', sourceSha256: 'a'.repeat(64),
    mappingVersion: 'p9-test', entries, sections: [], createdAt: NOW,
  });
  await worlds.upsertEntity({ worldId: 'w', entityId: 'ent-lin', type: 'character', name: '林凡', aliases: [], firstSeenChapterId: 'ch' }, NOW);
  await worlds.saveFact({
    worldId: 'w', factId: 'fact-crates', subjectEntityId: 'ent-lin',
    predicate: 'named', value: { text: '林凡看守货箱' }, status: 'explicit', confidence: 1,
    validFrom: null, validTo: null, revealAt: null, scope: 'world',
    sources: [{ chapterId: 'ch', startOffset: 0, endOffset: 8, quote: '林凡站在青石巷', quoteSha256: await sha.sha256Hex('林凡站在青石巷') }],
  }, NOW);

  // Compile + adopt the campaign plan through the production adoption path.
  const intent = {
    schemaVersion: 'campaign-intent-1', setupId: 'setup-t', intentRevision: 1,
    rawIntent: '查明青石巷的隐患', normalizedIntent: '查明并解除青石巷的隐患', goalMode: 'declared',
    protagonistBinding: { actorId: 'pc', kind: 'original', name: '旅人' },
    openingAnchor: { worldTimeOrder: 1, locationId: '青石巷' },
    companionBindings: options.companions ?? [], lengthPreference: 'short', userConstraints: [], requestedCanonTargets: [],
    knowledgePolicy: 'anchor_projection',
    sourceCoverageBinding: { worldId: 'w', packageRevision: published.manifest.revision, coverageWorldTimeOrder: 1, packageContentHash: published.manifest.contentHash },
    createdAt: NOW,
  };
  const rules = requireCompiledRules((await worlds.getWorldPackage('w', published.manifest.revision)).manifest.ruleConfiguration);
  const { canonicalJsonOf, sha256HexOf } = require('../../dist/application/campaignPlan/hashing');
  const compiled = compileCampaignPlan({
    model: options.model ?? candidateModel(), intent,
    ctx: {
      worldId: 'w', packageRevision: published.manifest.revision, packageContentHash: published.manifest.contentHash,
      coverageWorldTimeOrder: 1,
      ruleBindingHash: sha256HexOf(canonicalJsonOf(rules.binding)),
      visibleEntries: entries,
      openingActorIds: new Set(['pc', ...(options.companions ?? []).map(c => c.actorId)]), openingTemplateIds: new Set(['tpl-lin']),
      openingLocationId: '青石巷', protagonistSkills: new Set(['skill-observation']),
      availableFactIds: new Set(['fact-crates']),
    },
    planId: 'plan-t', revision: 1, parentRevision: null, createdAt: NOW,
  });
  assert.deepEqual(compiled.errors, [], JSON.stringify(compiled.errors));
  await planStore.upsertSetup({ setupId: 'setup-t', worldId: 'w', packageRevision: published.manifest.revision,
    intent, intentHistory: [intent], currentCandidateId: null, status: 'planning', createdAt: NOW, updatedAt: NOW });
  await planStore.insertJob({
    jobId: 'job-t', setupId: 'setup-t', campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: ['fixture'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: 'i'.repeat(64), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'candidate_ready', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 1,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null, createdAt: NOW, updatedAt: NOW,
  });
    const candidateHash = sha256HexOf(canonicalJsonOf({ plan: compiled.plan, artifact: compiled.artifact }));
  await planStore.upsertCandidate({
    candidateId: 'cand-t', jobId: 'job-t', setupId: 'setup-t', attemptGroup: 'a1', attemptNo: 1,
    stage: 'ready', rawResponseRef: null, rawResponseText: 'fixture', parseResultJson: null,
    validationErrors: [], repairUsed: false, candidateHash,
    plan: compiled.plan, artifact: compiled.artifact, createdAt: NOW, updatedAt: NOW,
  });
await adapter.execute("UPDATE campaign_setups SET status='proposal_ready', current_candidate_id='cand-t' WHERE setup_id='setup-t'");
  const adopted = await adoptOpeningPlan({
    db: adapter, planStore, setupId: 'setup-t', candidateId: 'cand-t',
    create: {
      db: adapter, worldStore: worlds, campaignId: 'c-t', title: '青石巷的威胁', worldId: 'w',
      packageRevision: published.manifest.revision,
      anchor: { worldTimeOrder: 1, locationId: '青石巷' },
      protagonist: { actorId: 'pc', kind: 'original', name: '旅人',
        attributes: { physique: 1, agility: 1, insight: 3, knowledge: 1, willpower: 1, social: 1 },
        initialSkills: ['skill-observation'] },
      companions: options.companions ?? [],
      goal: '查明并解除青石巷的隐患', createdAt: NOW,
    },
  });
  const branchId = adopted.campaign.branchId;

  // Scripted provider: planner echoes the matching campaign method shape and
  // its stable candidateRef; narrator returns faithful text.
  const provider = {
    async complete(request) {
      options.onRequest?.(request);
      const value = JSON.parse(request.user);
      if (request.role === 'Planner') {
        const intentText = String(value.playerIntent ?? '');
        if (intentText.includes('查看') || intentText.includes('搜') || intentText.includes('现场')) {
          return { text: JSON.stringify({
            proposalVersion: '2.0', turnId: value.turnId, expectedStateVersion: value.expectedStateVersion,
            actorId: 'pc', actionKind: 'skill_check', skillId: 'skill-observation', difficultyBand: 'normal',
            evidenceIds: [], intent: intentText, candidateRef: `method:${SITUATION_ID}:sweep`,
          }) };
        }
        if (intentText.includes('打听') || intentText.includes('林凡')) {
          return { text: JSON.stringify({
            proposalVersion: '2.0', turnId: value.turnId, expectedStateVersion: value.expectedStateVersion,
            actorId: 'pc', actionKind: 'talk', evidenceIds: [], intent: intentText,
            candidateRef: `method:${SITUATION_ID}:ask-lin`,
          }) };
        }
        return { text: JSON.stringify({
          proposalVersion: '2.0', turnId: value.turnId, expectedStateVersion: value.expectedStateVersion,
          actorId: 'pc', actionKind: 'observe', evidenceIds: [], intent: intentText,
        }) };
      }
      return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: `叙事：${value.turnId}` }) };
    },
  };
  const session = new CampaignSession(
    { db: adapter, turns, game, worldStore: worlds, narratives, hashProvider: sha,
      random: { nextIntInclusive: () => 6 } },
    options.provider ?? provider,
    { endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
      capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } },
  );
  return { db, adapter, worlds, turns, planStore, session, branchId, campaignId: 'c-t' };
}

module.exports = { fixture, candidateModel, baseEntries, SITUATION_ID, NOW };
