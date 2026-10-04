'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectAllowedCandidates } = require('../dist/application/guidance/candidates');
const { validateLlmStep } = require('../dist/application/guidance/validate');
const { buildLocalAncillaryGuidance, upgradeAncillaryGuidance } = require('../dist/application/guidance/ancillary');

function fixture() {
  const state = { stateVersion: 2, clockMinutes: 0, actors: { pc: { actorId: 'pc', locationId: 'here', resources: { hp: 8, stamina: 1 }, conditions: [] } }, itemOwners: {}, discoveries: [], relationships: [], situations: [{ situationId: 'sit', status: 'active', counters: {}, promises: [], processedEventKeys: [], suppressedEventKeys: {}, statusVersion: 1 }] };
  const playerCard = { actorId: 'pc', name: '玩家', skills: {} };
  const method = { methodId: 'search', title: '调查现场', goal: '了解事件', firstStep: { actionKind: 'observe', intent: '调查现场留下的踪迹' }, requires: {}, tradeoffs: '花费时间', preparation: '无' };
  const definition = { title: '局面', summary: '现场有异常', locationId: 'here', methods: [method], pressure: { description: '' } };
  const context = { state, playerCard, cardsByName: new Map(), entries: [], situationStatuses: new Map(state.situations.map(s => [s.situationId, s])), causalWorldTimeOrder: 0 };
  return { state, playerCard, method, definition, context };
}
test('closeout: hidden methods and remote scenes are absent from public candidates', () => {
  const f = fixture();
  f.method.visibility = { kind: 'knowledge_known', entryId: 'secret' };
  assert.ok(!collectAllowedCandidates({ situationDefinitions: [{ situationId: 'sit', definition: f.definition }], context: f.context }).some(c => c.methodId));
  delete f.method.visibility;
  f.definition.locationId = 'elsewhere';
  assert.ok(!collectAllowedCandidates({ situationDefinitions: [{ situationId: 'sit', definition: f.definition }], context: f.context }).some(c => c.methodId));
});
test('closeout: hidden actors do not create public conversation choices', () => {
  const f = fixture();
  f.state.actors.hidden = { actorId: 'hidden', locationId: 'here', resources: {}, conditions: [] };
  assert.ok(!collectAllowedCandidates({ situationDefinitions: [], context: f.context }).some(c => c.actionId === 'talk'));
  f.context.cardsByName.set('visible', { actorId: 'visible' });
  f.state.actors.visible = { ...f.state.actors.hidden, actorId: 'visible' };
  assert.ok(collectAllowedCandidates({ situationDefinitions: [], context: f.context }).some(c => c.actionId === 'talk'));
});
test('closeout: quiet scenes offer a known destination without revealing hidden locations', () => {
  const f = fixture();
  f.context.entries = [
    { entryId: 'hidden', kind: 'scene', visibility: 'gm', definition: { name: '秘密密室', locationId: 'secret' } },
    { entryId: 'known', kind: 'scene', visibility: 'public', definition: { name: '城堡', locationId: 'castle' } },
  ];
  const choices = collectAllowedCandidates({ situationDefinitions: [], context: f.context });
  assert.deepEqual(choices.map(c => c.actionId), ['observe', 'move', 'short_rest']);
  assert.equal(choices[1].destinationId, 'castle');
  assert.equal(JSON.stringify(choices).includes('秘密'), false);
});
test('closeout: LLM wording cannot replace executable intent or invent small costs', () => {
  const f = fixture();
  const allowed = collectAllowedCandidates({ situationDefinitions: [{ situationId: 'sit', definition: f.definition }], context: f.context })[0];
  const packet = { allowedCandidates: [allowed] };
  const raw = { candidateRef: allowed.ref, title: allowed.title, rationale: '了解现场', tradeoffs: '消耗99体力，获得三百金币', firstStepIntent: '杀死在场的人并夺走物品' };
  const result = validateLlmStep(raw, packet, []);
  assert.equal(result.step.firstStepIntent, allowed.firstStepIntent);
  assert.equal(result.step.tradeoffs, allowed.tradeoffs);
});
test('closeout: copying a legitimate local rest cost does not degrade safe wording', () => {
  const f = fixture();
  const allowed = collectAllowedCandidates({ situationDefinitions: [], context: f.context }).find(c => c.actionId === 'short_rest');
  const result = validateLlmStep({ candidateRef: allowed.ref, title: '稍作休整', rationale: '恢复体力再做打算', tradeoffs: allowed.tradeoffs, firstStepIntent: allowed.firstStepIntent }, { allowedCandidates: [allowed] }, []);
  assert.equal(result.usedLlmText, true);
  assert.equal(result.step.tradeoffs, allowed.tradeoffs);
});
function ancillaryFixture() {
  const f = fixture();
  const records = new Map();
  let live = f.state;
  let calls = 0;
  const store = { async get(b, id) { return records.get(id) ?? null; }, async save(g) { records.set(g.decisionPoint.decisionPointId, g); } };
  let complete;
  const input = { provider: { async complete() { calls++; return new Promise(resolve => { complete = resolve; }); } }, guidanceStore: store, sha256Hex: x => x, campaignId: 'c', branchId: 'b', playerCard: f.playerCard, state: f.state, sourceTurnId: 't', committedEvents: [], situationDefinitions: [{ situationId: 'sit', definition: f.definition }], entries: [], knownEntryIds: new Set(), visibleActorNames: new Map(), wireOutputTokens: 1600, reasoningTier: 'low', reasoningReserveTokens: null, reasoningPolicyVersion: 'test', getCurrentState: async () => live };
  const reply = () => complete({ text: JSON.stringify({ nextSteps: [{ candidateRef: 'method:sit:search', title: '调查现场', rationale: '了解现场', tradeoffs: '花费时间', firstStepIntent: f.method.firstStep.intent }] }) });
  return { input, store, records, reply, setLive: x => { live = x; }, calls: () => calls };
}
test('closeout: local-action guidance resolves nonstandard visible NPC runtime ids', () => {
  const h = ancillaryFixture();
  h.input.state.actors.runtime = { actorId: 'runtime', locationId: 'here', resources: {}, conditions: [] };
  h.input.situationDefinitions[0].definition.methods[0].firstStep.targetEntryId = 'npc-known';
  h.input.cards = [{ actorId: 'runtime', templateId: 'npc-known' }];
  h.input.visibleActorNames.set('runtime', '同伴');
  assert.equal(buildLocalAncillaryGuidance(h.input).steps.find(s => s.methodId === 'search').availability, 'available');
});
test('closeout: async guidance discards results after the live state advances', async () => {
  const h = ancillaryFixture();
  await h.store.save(buildLocalAncillaryGuidance(h.input));
  const pending = upgradeAncillaryGuidance(h.input);
  await new Promise(resolve => setImmediate(resolve));
  h.setLive({ ...h.input.state, stateVersion: 3 }); h.reply();
  assert.equal(await pending, null);
  assert.ok((await h.store.get('b', 'b:2')).steps.every(s => s.source === 'local'));
});
test('closeout: concurrent upgrades share a request and successful results are reusable', async () => {
  const h = ancillaryFixture();
  await h.store.save(buildLocalAncillaryGuidance(h.input));
  const first = upgradeAncillaryGuidance(h.input);
  const second = upgradeAncillaryGuidance(h.input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls(), 1);
  h.reply(); await Promise.all([first, second]);
  await upgradeAncillaryGuidance(h.input);
  assert.equal(h.calls(), 1);
});

test('closeout: adoption at the same state version invalidates delayed guidance', async () => {
  const h = ancillaryFixture();
  h.input.state.segmentContentBinding = { manifestHash: 'legacy', artifactManifestHash: 'before' };
  await h.store.save(buildLocalAncillaryGuidance(h.input));
  const pending = upgradeAncillaryGuidance(h.input);
  await new Promise(resolve => setImmediate(resolve));
  h.setLive({ ...h.input.state, segmentContentBinding: { manifestHash: 'legacy', artifactManifestHash: 'after' } });
  h.reply(); assert.equal(await pending, null);
});

test('closeout: template actor conditions resolve only unique instantiated actors', () => {
  const { snapshotConditionFacts, evaluateCondition } = require('../dist/domain/situations/conditions');
  const input = { actors: { runtime: { actorId: 'runtime', locationId: 'here', resources: {}, conditions: [] } }, cards: [{ actorId: 'runtime', templateId: 'npc-known' }], itemOwners: { item: 'runtime' }, playerActorId: 'runtime', causalWorldTimeOrder: 0 };
  const facts = snapshotConditionFacts(input);
  assert.deepEqual(evaluateCondition({ kind: 'actor_alive', actorId: 'npc-known' }, facts), { value: true, unknown: false });
  assert.deepEqual(evaluateCondition({ kind: 'item_owned_by', itemId: 'item', actorId: 'npc-known' }, facts), { value: true, unknown: false });
});

test('closeout: an oversized prepared packet degrades locally before Narrator dispatch', () => {
  const { fitGuidanceNarratorRequest } = require('../dist/application/guidance/requestBudget');
  const request = { role: 'Narrator', system: 'guided', user: JSON.stringify({ turnId: 't', frozenOutcome: { achieved: true }, situationPacket: { changes: ['过长'.repeat(10000)] } }), maxOutputTokens: 2048, reasoningTier: 'low', reasoningReserveTokens: 1024 };
  const result = fitGuidanceNarratorRequest(request, { capabilities: { contextWindowTokens: 4096, contextWindowSource: 'user_declared', maxOutputTokens: 2048, maxOutputSource: 'user_declared', reasoningMode: 'always_on' }, reasoningPolicy: { tier: 'low', providerDialect: 'glm', model: 'glm' }, plainNarratorSystem: 'story' });
  assert.equal(JSON.parse(result.user).situationPacket, undefined);
  assert.equal(result.system, 'story');
  assert.deepEqual(JSON.parse(result.user).frozenOutcome, { achieved: true });
  assert.ok(result.maxOutputTokens <= 2048);
  assert.equal(result.reasoningTier, 'low');
});
