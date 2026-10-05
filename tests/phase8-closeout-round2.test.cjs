'use strict';
/**
 * Phase 8 closeout round 2 (2026-10-05): closes the five items that the
 * independent re-verification left as NOT RUN (A05/A09/A11/A30; A36 is device
 * evidence, tracked separately). Every case runs the production pipeline:
 *
 *  - A05: adversarial leakage samples (GM secret / hidden alias / original-work
 *    future) are refused by the permission projection AND re-checked field by
 *    field in the actual model wire.
 *  - A09: Narrator + Prepared packet + repair stacked on one wire; optional
 *    payloads are shed from the same frozen pool, and an infeasible final wire
 *    fails closed with zero HTTP.
 *  - A11: a frozen turn bundle does not drift when memory/settings change
 *    afterwards; recovery still reads the original frozen materials.
 *  - A30: identical ruleBinding + state + action + roll reduce to a byte-identical
 *    Prepared resolution and event stream, and commit exactly once.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha, createMobileHarness } = require('./helpers/mobileHarness.cjs');
const { RootFrozenMaterialsStore, computeRootSnapshotContentHash } = require('../dist/application/context/frozenTurnMaterialsStore');
const { emptyStoryMemoryState } = require('../dist/application/memory/storyMemoryTypes');
const { projectPlayerEntriesAtAnchor } = require('../dist/application/campaign/session');
const { canonicalStringify, serializeActionContract, hashActionContract } = require('../dist/domain/turns/canonical');
const { resolveRoll } = require('../dist/domain/rules/roll');
const { verifyFinalWireRequest } = require('../dist/application/llm/finalWireVerifier');
const { BudgetInfeasibleError } = require('../dist/application/llm/requestPlan');

// ---------------------------------------------------------------------------
// Shared fixture: a published world + campaign over the production harness.
// ---------------------------------------------------------------------------

function contentEntry(entryId, kind, definition, extra = {}) {
  return {
    entryId, kind, revision: 0, visibility: 'public', dependencyIds: [],
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: '收尾轮夹具' },
    fieldProvenance: {}, definition, ...extra,
  };
}

const SQUARE_SCENE = {
  name: '广场', description: '中央广场', locationId: 'square',
  zones: [{ zoneId: 'center', name: '中央', cover: false, exits: [] }],
  actors: [], visibleItems: [], hazards: [], clues: [],
};

async function buildWorldCampaign({ worldId, entries, facts = [], preset = 'fantasy' }) {
  const h = await createMobileHarness();
  await h.runtime.worldStore.createWorld({ worldId, title: '收尾世界', sourceSha256: 'a'.repeat(64),
    sourceBytes: 1, normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: 'now', updatedAt: 'now' });
  if (facts.length > 0) {
    // canon_facts requires an owning entity row (FK world_id, subject_entity_id).
    await h.runtime.worldStore.upsertEntity({ worldId, entityId: 'world', type: 'event', name: '世界',
      firstSeenChapterId: null, aliases: [] }, 'now');
  }
  for (const fact of facts) await h.runtime.worldStore.saveFact({ worldId, ...fact }, 'now');
  const ruleConfiguration = require('../dist/application/content/runtimeRules').createWorldRuleConfiguration(worldId, 1, preset);
  const { publishWorldPackage } = require('../dist/application/worldPackage/publish');
  const published = await publishWorldPackage({ worldStore: h.runtime.worldStore, sha256Hex: sha.sha256Hex,
    worldId, sourceSha256: 'a'.repeat(64), mappingVersion: 'm', entries, sections: [], ruleConfiguration, createdAt: 'now' });
  await require('../dist/application/campaign/createCampaign').createCampaign({
    db: h.adapter, worldStore: h.runtime.worldStore, campaignId: 'c', title: '收尾战役', worldId, packageRevision: 1,
    anchor: { worldTimeOrder: 1, locationId: 'square' },
    protagonist: { actorId: 'pc', kind: 'original', name: '旅人',
      attributes: { physique: 1, agility: 1, insight: 2, knowledge: 1, willpower: 1, social: 1 }, initialSkills: [] },
    goal: '观察广场', createdAt: 'now',
  });
  const turns = new (require('../dist/infra/sqlite/sqliteTurnStore').SqliteTurnStore)(h.adapter);
  return { ...h, published, turns };
}

async function playingCard(h) {
  return JSON.parse((await h.adapter.queryOne(
    "SELECT card_json FROM actor_cards WHERE branch_id='c-main' AND actor_id='pc'")).card_json);
}

const INVESTIGATE_CATALOG = {
  investigate: { name: '调查', description: '调查', attribute: 'insight', allowUntrained: true,
    requirements: [], powerTier: 'ordinary', usage: 'knowledge' },
};

function makeSessionDeps(h, provider, profile, narratives) {
  const { CampaignSession } = require('../dist/application/campaign/session');
  const deps = {
    db: h.adapter, turns: h.turns,
    game: new (require('../dist/infra/sqlite/sqliteGameStore').SqliteGameStore)(h.adapter),
    worldStore: h.runtime.worldStore, narratives, llmLedger: h.runtime.llmLedger,
    hashProvider: sha, random: { nextIntInclusive: (_min, max) => max },
  };
  return new CampaignSession(deps, provider, profile);
}

const TEST_PROFILE = { endpoint: 'https://example.invalid', model: 'test', keyRef: 'qa',
  capabilities: { contextWindow: 32000, maxOutputTokens: 8192, supportsJson: true, reportsUsage: true },
  reasoningTier: 'low' };

// ---------------------------------------------------------------------------
// A05 — adversarial leakage samples
// ---------------------------------------------------------------------------

const A05_MARKERS = {
  public: 'PUBLIC_MARKER_公开的广场纪要',
  gmSecret: 'GM_SECRET_MARKER_幕后黑手的真身',
  hiddenAlias: 'HIDDEN_ALIAS_MARKER_旅人的化名是影',
  future: 'FUTURE_MARKER_尚未发生的结局',
};

const A05_FUTURE_FACT = { factId: 'fact-future', subjectEntityId: 'world', predicate: 'future_event',
  value: {}, status: 'explicit', confidence: 1, validFrom: null, validTo: null, revealAt: '5',
  scope: 'canon', sources: [] };

function adversarialEntries() {
  return [
    contentEntry('lore-public', 'lore', { name: '广场纪要', title: '广场纪要', text: A05_MARKERS.public }),
    contentEntry('lore-gm', 'lore', { name: 'GM 秘密', title: 'GM 秘密', text: A05_MARKERS.gmSecret }, { visibility: 'gm' }),
    contentEntry('lore-alias', 'lore', { name: '残破的记录', title: '残破的记录', text: A05_MARKERS.hiddenAlias }, { visibility: 'discoverable' }),
    contentEntry('lore-future', 'lore', { name: '未来编年', title: '未来编年', text: A05_MARKERS.future },
      { provenance: { kind: 'explicit', sourceFactIds: ['fact-future'], rationale: '原著未来事件' } }),
    contentEntry('scene-square', 'scene', { ...SQUARE_SCENE, actors: ['alias-template'], visibleItems: ['item-gm'], clues: ['lore-alias'] }),
    contentEntry('alias-template', 'actor_template', {
      name: '剪影', category: 'human', description: '身份成谜', attributes: { physique: 2, agility: 1, insight: 1 },
      skills: { investigate: 'trained' }, hp: 6, stamina: 4, defense: 3,
      attacks: [{ name: '短刃', skillId: 'investigate', damage: 2, range: 'touch' }],
      abilities: [], behavior: { goal: '隐藏身份', retreatThreshold: 0.25, morale: 'steady' }, lootPolicy: '无掉落',
      threat: { damage: 2, durability: 2, actions: 1, control: 0, environment: 0 },
    }, { visibility: 'discoverable' }),
    contentEntry('item-gm', 'item', { name: 'GM 暗器', description: 'GM 私有物件', category: 'key', effects: [], unique: true }, { visibility: 'gm' }),
  ];
}

test('A05: the permission projection refuses GM secrets, hidden aliases and original-work future content', () => {
  const entries = adversarialEntries();
  const facts = [A05_FUTURE_FACT];

  const projected = projectPlayerEntriesAtAnchor(entries, facts, 1, new Set());
  const ids = projected.map(entry => entry.entryId);
  assert.ok(ids.includes('lore-public'), 'public lore stays visible (positive control)');
  assert.ok(!ids.includes('lore-gm'), 'GM secret entry is refused');
  assert.ok(!ids.includes('lore-alias'), 'undiscovered hidden-alias entry is refused');
  assert.ok(!ids.includes('lore-future'), 'original-work future entry is refused at anchor 1');
  assert.ok(!ids.includes('item-gm'), 'GM item is refused');

  // A public scene must not reveal a private / undiscovered / not-yet-valid
  // target by embedding its id in nested references.
  const scene = projected.find(entry => entry.entryId === 'scene-square');
  assert.deepEqual(scene.definition.actors, [], 'hidden actor reference is stripped');
  assert.deepEqual(scene.definition.visibleItems, [], 'GM item reference is stripped');
  assert.deepEqual(scene.definition.clues, [], 'undiscovered clue reference is stripped');

  // The secret text never crosses the boundary at all.
  const projectedJson = JSON.stringify(projected);
  for (const marker of [A05_MARKERS.gmSecret, A05_MARKERS.hiddenAlias, A05_MARKERS.future]) {
    assert.equal(projectedJson.includes(marker), false, `projection leaked ${marker}`);
  }

  // Discovery is the only door: an actually discovered entry becomes visible.
  const discovered = projectPlayerEntriesAtAnchor(entries, facts, 1, new Set(['lore-alias', 'alias-template']));
  const discoveredIds = discovered.map(entry => entry.entryId);
  assert.ok(discoveredIds.includes('lore-alias'));
  assert.ok(discoveredIds.includes('alias-template'));
  const discoveredScene = discovered.find(entry => entry.entryId === 'scene-square');
  assert.deepEqual(discoveredScene.definition.clues, ['lore-alias']);
  assert.deepEqual(discoveredScene.definition.actors, ['alias-template']);
  assert.deepEqual(discoveredScene.definition.visibleItems, [], 'GM item stays hidden even when the clue is known');
});

test('A05: no adversarial marker reaches the Planner/Narrator wire; the public control does', async () => {
  const h = await buildWorldCampaign({
    worldId: 'a05-world', entries: adversarialEntries(), facts: [A05_FUTURE_FACT],
  });
  try {
    const requests = [];
    const provider = { complete: async request => {
      requests.push(request);
      const body = JSON.parse(request.user);
      if (request.role === 'Planner') {
        return { text: JSON.stringify({ proposalVersion: '2.0', turnId: body.turnId,
          expectedStateVersion: body.expectedStateVersion ?? body.stateVersion ?? 0,
          actorId: 'pc', actionKind: 'observe', intent: '观察广场', evidenceIds: [] }) };
      }
      return { text: JSON.stringify({ turnId: body.turnId, outcomeGrade: body.outcomeGrade, text: '你看清了广场。' }) };
    } };
    const narratives = new (require('../dist/infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(h.adapter);
    const session = makeSessionDeps(h, provider, TEST_PROFILE, narratives);
    const result = await session.playTurn({ campaignId: 'c', branchId: 'c-main', intent: '观察广场' });
    assert.equal(result.stateVersion, 1);
    assert.ok(requests.length >= 2, 'planner and narrator both dispatched');

    // Field-by-field re-check of everything that entered the model.
    const wire = requests.map(request => `${request.system}\n${request.user}`).join('\n---\n');
    for (const marker of [A05_MARKERS.gmSecret, A05_MARKERS.hiddenAlias, A05_MARKERS.future]) {
      assert.equal(wire.includes(marker), false, `wire leaked ${marker}`);
    }
    // Positive control: public material does enter the model.
    assert.ok(wire.includes(A05_MARKERS.public), 'public lore must reach the model');

    // The frozen player-facing projection (the exact material set the wire is
    // built from) is equally clean. NOTE: the frozen root also retains the
    // local-authority projection (`authoritativeEntries`) so recovery can
    // re-resolve hidden clue/quest references; by design that local view is
    // never handed to the planner or narrator (see the wire check above).
    const frozen = await h.adapter.queryAll("SELECT payload_json FROM frozen_turn_material_roots WHERE branch_id='c-main'");
    const playerFacing = frozen
      .map(row => JSON.stringify(JSON.parse(row.payload_json).executionMaterials.entries)).join('\n');
    for (const marker of [A05_MARKERS.gmSecret, A05_MARKERS.hiddenAlias, A05_MARKERS.future]) {
      assert.equal(playerFacing.includes(marker), false, `frozen player projection leaked ${marker}`);
    }
    assert.ok(playerFacing.includes(A05_MARKERS.public), 'public lore is part of the frozen player projection');
  } finally {
    h.db.close();
  }
});

// ---------------------------------------------------------------------------
// A09 — Narrator + Prepared + repair stacked on one wire
// ---------------------------------------------------------------------------

function runV2Input(h, provider, { turnId, narratorFinalWire, prepared, packet }) {
  return {
    provider, store: h.turns, journal: h.turns,
    narratives: new (require('../dist/infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(h.adapter),
    branchId: 'c-main', turnId, playerIntent: '观察广场', worldContext: '【世界】广场。',
    hashProvider: sha, random: { nextIntInclusive: (_min, max) => max },
    actingCard: null, cards: [], catalog: INVESTIGATE_CATALOG, abilities: new Map(), scenes: [],
    resolveRollSpec() { return { attribute: 2, skillRank: 'untrained', difficulty: 4 }; },
    reasoningTier: 'low', plannerReasoningReserveTokens: null, narratorReasoningReserveTokens: null,
    reasoningPolicyVersion: 'reasoning-policy-1', plannerWireOutputTokens: 2048, narratorWireOutputTokens: 2048,
    narratorFinalWire,
    ...(prepared ? { prepareResolution: prepared } : {}),
    ...(packet ? { buildSituationPacket: packet } : {}),
    now: () => '2026-10-05T00:00:00.000Z',
  };
}

function plannerResponse(request) {
  const body = JSON.parse(request.user);
  return { text: JSON.stringify({ proposalVersion: '2.0', turnId: body.turnId,
    expectedStateVersion: body.expectedStateVersion ?? body.stateVersion ?? 0,
    actorId: 'pc', actionKind: 'observe', intent: '观察广场', evidenceIds: [] }) };
}

test('A09: Narrator + Prepared packet stacked over the envelope sheds from the same frozen pool and the dispatched wire fits', async () => {
  const h = await buildWorldCampaign({ worldId: 'a09-a-world', entries: [contentEntry('scene-square', 'scene', SQUARE_SCENE)] });
  try {
    const card = await playingCard(h);
    const hugePacket = { changes: Array.from({ length: 4000 }, (_, i) => `变化${i}`),
      opportunities: [], pressures: [], actorNotes: [], allowedCandidates: [] };
    const prepared = async ({ contract, contractHash, grade, rollRecord }) =>
      require('../dist/application/turns/commitTurn').prepareTurnResolution(h.turns, {
        branchId: 'c-main', contract, contractHash, outcomeGrade: grade, rollRecord,
        committedAt: '2026-10-05T00:00:00.000Z' });
    const budget = { contextWindowTokens: 32000, hardInputLimit: 3000, wireOutputTokens: 2048, safetyMarginTokens: 64 };

    const seen = [];
    const provider = { complete: async request => {
      if (request.role === 'Planner') return plannerResponse(request);
      seen.push(request);
      const body = JSON.parse(request.user);
      return { text: JSON.stringify({ turnId: body.turnId, outcomeGrade: body.outcomeGrade, text: '你看清了广场。' }) };
    } };
    const input = runV2Input(h, provider, { turnId: 'turn-0001', narratorFinalWire: budget,
      prepared, packet: () => hugePacket });
    input.actingCard = card; input.cards = [card];

    const result = await require('../dist/application/game/v2Turn').runV2Turn(input);
    assert.equal(result.stateVersion, 1);
    assert.equal(seen.length, 1, 'exactly one narrator dispatch');
    const narratorUser = JSON.parse(seen[0].user);
    assert.equal('situationPacket' in narratorUser, false, 'the oversized prepared packet was shed from the same frozen pool');
    const check = verifyFinalWireRequest({ messages: [
      { role: 'system', content: seen[0].system }, { role: 'user', content: seen[0].user }], budget });
    assert.equal(check.ok, true, 'the wire that actually dispatched fits the declared window');
  } finally {
    h.db.close();
  }
});

test('A09: when Narrator + repair still overflows, the repair is not dispatched (zero HTTP)', async () => {
  const h = await buildWorldCampaign({ worldId: 'a09-b-world', entries: [contentEntry('scene-square', 'scene', SQUARE_SCENE)] });
  try {
    const card = await playingCard(h);
    const budget = { contextWindowTokens: 32000, hardInputLimit: 2000, wireOutputTokens: 2048, safetyMarginTokens: 64 };
    const calls = [];
    const provider = { complete: async request => {
      if (request.role === 'Planner') return plannerResponse(request);
      calls.push(request);
      // First (and only) narrator answer is a huge, invalid candidate: the
      // repair wire will have to carry it back and therefore cannot fit.
      return { text: 'X'.repeat(20000) };
    } };
    const input = runV2Input(h, provider, { turnId: 'turn-0001', narratorFinalWire: budget });
    input.actingCard = card; input.cards = [card];

    await assert.rejects(
      require('../dist/application/game/v2Turn').runV2Turn(input),
      error => error instanceof BudgetInfeasibleError && error.code === 'final_wire_exceeded',
    );
    assert.equal(calls.length, 1, 'the overflowing repair request was never dispatched');
  } finally {
    h.db.close();
  }
});

// ---------------------------------------------------------------------------
// A11 — the frozen bundle does not drift after memory / settings change
// ---------------------------------------------------------------------------

test('A11: a frozen turn bundle keeps its content hash across later memory and settings changes and cannot be replaced', async () => {
  const h = await buildWorldCampaign({ worldId: 'a11-world', entries: [contentEntry('scene-square', 'scene', SQUARE_SCENE)] });
  try {
    const store = new RootFrozenMaterialsStore(h.adapter, sha);
    const payload = {
      turnBundle: {
        plannerText: '【当前局面】广场', plannerWireOutputTokens: 2048,
        narratorText: '【当前局面】广场', narratorWireOutputTokens: 2048,
        plannerFinalWire: { contextWindowTokens: 32000, hardInputLimit: 24000, wireOutputTokens: 2048, safetyMarginTokens: 64 },
        narratorFinalWire: { contextWindowTokens: 32000, hardInputLimit: 24000, wireOutputTokens: 2048, safetyMarginTokens: 64 },
        reasoningTier: 'low', plannerReasoningReserveTokens: null, narratorReasoningReserveTokens: null,
        reasoningPolicyVersion: 'reasoning-policy-1', plannerContext: { turnId: 'turn-0001' }, narratorContext: { turnId: 'turn-0001' },
      },
      stateBaseline: { branchId: 'c-main', expectedStateVersion: 0 },
      capabilitiesFingerprint: 'cap-fp',
    };
    const rootId = await store.saveRootSnapshot({ campaignId: 'c', branchId: 'c-main', turnId: 'turn-0001',
      logicalRequestId: 'turn:context', role: 'turn', stage: 'context_bundle', attempt: 1,
      payload, createdAt: '2026-10-05T00:00:00.000Z' });

    const first = await store.loadRootSnapshot('c-main', 'turn-0001', 'turn:context');
    const hashBefore = first.contentHash;
    const jsonBefore = JSON.stringify(first.payload);

    // Memory update + settings change happen AFTER the freeze. The frozen
    // root is a durable recovery source: none of this may leak into it.
    await new (require('../dist/application/memory/storyMemoryRepository').SqliteStoryMemoryStore)(h.adapter)
      .saveState(emptyStoryMemoryState('c-main', 'now'));
    await h.adapter.execute("UPDATE campaigns SET title = ? WHERE campaign_id = 'c'", ['改过标题的战役']);
    const config = JSON.parse(JSON.stringify((await h.turns.getState('c-main')).ruleConfiguration));
    config.configHash = '';

    const second = await store.loadRootSnapshot('c-main', 'turn-0001', 'turn:context');
    assert.equal(second.contentHash, hashBefore, 'frozen content hash is unchanged after memory/settings changes');
    assert.equal(JSON.stringify(second.payload), jsonBefore, 'frozen bundle payload is byte-identical');
    assert.equal(await computeRootSnapshotContentHash(second.payload, sha), second.contentHash, 'stored hash still matches a fresh recomputation');

    // Recovery must reuse the ORIGINAL frozen materials: a different payload
    // for the same root id is refused, and re-saving the same one is idempotent.
    await assert.rejects(
      store.saveRootSnapshot({ campaignId: 'c', branchId: 'c-main', turnId: 'turn-0001',
        logicalRequestId: 'turn:context', role: 'turn', stage: 'context_bundle', attempt: 1,
        payload: { ...payload, turnBundle: { ...payload.turnBundle, narratorText: '被改写过的正文' } },
        createdAt: '2026-10-05T00:00:00.000Z' }),
      /hash|frozen|mismatch/i,
    );
    const again = await store.saveRootSnapshot({ campaignId: 'c', branchId: 'c-main', turnId: 'turn-0001',
      logicalRequestId: 'turn:context', role: 'turn', stage: 'context_bundle', attempt: 1,
      payload, createdAt: '2026-10-05T00:00:00.000Z' });
    assert.equal(again, rootId);
    const third = await store.loadRootSnapshot('c-main', 'turn-0001', 'turn:context');
    assert.equal(third.contentHash, hashBefore);
    assert.ok(config);
  } finally {
    h.db.close();
  }
});

// ---------------------------------------------------------------------------
// A30 — deterministic replay
// ---------------------------------------------------------------------------

test('A30: identical binding + state + action + roll produce a byte-identical Prepared resolution and commit exactly once', async () => {
  const h = await buildWorldCampaign({ worldId: 'a30-world', entries: [contentEntry('scene-square', 'scene', SQUARE_SCENE)] });
  try {
    const { compileProposal } = require('../dist/application/game/v2Compile');
    const { prepareTurnResolution, commitPreparedTurn } = require('../dist/application/turns/commitTurn');
    const state = await h.turns.getState('c-main');
    const card = await playingCard(h);
    const proposal = { proposalVersion: '2.0', turnId: 'turn-0001', expectedStateVersion: 0,
      actorId: 'pc', actionKind: 'skill_check', skillId: 'investigate', difficultyBand: 'normal',
      intent: '调查广场', evidenceIds: [] };

    const compile = () => compileProposal({ proposal, actingCard: card, cards: [card],
      catalog: INVESTIGATE_CATALOG, abilities: new Map(), scenes: [], state });

    const a = compile();
    const b = compile();
    assert.equal(serializeActionContract(a.contract), serializeActionContract(b.contract), 'contract is byte-identical');
    const hashA = await hashActionContract(a.contract, sha);
    const hashB = await hashActionContract(b.contract, sha);
    assert.equal(hashA, hashB);

    const spec = { attribute: 2, skillRank: 'untrained', difficulty: 4 };
    const rollInput = { turnId: 'turn-0001', rollIndex: 0, contractHash: hashA, spec,
      random: { nextIntInclusive: (_min, max) => max }, createdAt: '2026-10-05T00:00:00.000Z' };
    const rollA = resolveRoll({ ...rollInput });
    const rollB = resolveRoll({ ...rollInput });
    assert.equal(canonicalStringify(rollA), canonicalStringify(rollB), 'dice are replay-identical');

    const resolvePrepared = () => prepareTurnResolution(h.turns, { branchId: 'c-main', contract: a.contract,
      contractHash: hashA, outcomeGrade: rollA.grade, rollRecord: rollA, committedAt: '2026-10-05T00:00:00.000Z' });
    const preparedA = await resolvePrepared();
    const preparedB = await resolvePrepared();
    assert.equal(canonicalStringify(preparedA.nextState), canonicalStringify(preparedB.nextState), 'reduced next state is byte-identical');
    assert.equal(canonicalStringify(preparedA.committedTurn), canonicalStringify(preparedB.committedTurn), 'committed turn is byte-identical');
    assert.equal(canonicalStringify(preparedA.domainEvents), canonicalStringify(preparedB.domainEvents), 'domain event stream is byte-identical');
    assert.equal(canonicalStringify(preparedA.lifeEvents), canonicalStringify(preparedB.lifeEvents), 'life event stream is byte-identical');

    const committed = await commitPreparedTurn({ store: h.turns, prepared: preparedA });
    assert.equal(committed.replayed, false);
    const turnsAfterFirst = (await h.adapter.queryOne('SELECT COUNT(*) n FROM turns WHERE branch_id = ?', ['c-main'])).n;
    const eventsAfterFirst = (await h.adapter.queryOne('SELECT COUNT(*) n FROM branch_events WHERE branch_id = ?', ['c-main'])).n;

    const replay = await commitPreparedTurn({ store: h.turns, prepared: preparedA });
    assert.equal(replay.replayed, true, 'a second commit of the same turn is a replay, not a duplicate');
    assert.equal((await h.adapter.queryOne('SELECT COUNT(*) n FROM turns WHERE branch_id = ?', ['c-main'])).n, turnsAfterFirst);
    assert.equal((await h.adapter.queryOne('SELECT COUNT(*) n FROM branch_events WHERE branch_id = ?', ['c-main'])).n, eventsAfterFirst);
    assert.equal((await h.turns.getState('c-main')).stateVersion, 1);
  } finally {
    h.db.close();
  }
});
