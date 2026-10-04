'use strict';
// Regression for the device-observed mapping checkpoint drift: projection
// facts are appended in memory on the first finalize after an extraction
// commit, then reload at their ORDER BY fact_id positions - the serialized
// mapper prompt (and the batchHash over it) must not depend on which order
// the pipeline saw (b6794184 -> 167cfa06, one full remap re-paid on resume).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMapperUserPrompt } = require('../dist/application/worldPackage/buildPackageFromCanon');

const fact = (factId, subjectEntityId, predicate, value) => ({
  factId, subjectEntityId, predicate, value,
  status: 'explicit', confidence: 1, validFrom: null, validTo: null, revealAt: null,
  scope: 'world', sources: [],
});
const entity = (entityId, name) => ({ worldId: 'w', entityId, type: 'character', name, firstSeenChapterId: null, aliases: [name] });
const event = (eventId, title) => ({ worldId: 'w', eventId, title, summary: title + '摘要', worldTimeOrder: null, narrativeChapterId: null, validFrom: null, validTo: null, status: 'canon', dependsOnEventIds: [] });

const entities = [entity('ent-w-b', '夜莺'), entity('ent-w-a', '安娜')];
const events = [event('evt-w-2', '第二事件'), event('evt-w-1', '第一事件')];
const entry = entryId => ({ entryId, kind: 'skill', revision: 1, provenance: { kind: 'explicit', sourceFactIds: [], rationale: 'r' },
  fieldProvenance: {}, visibility: 'public', dependencyIds: [], definition: { name: 'n' } });
const existingEntries = [entry('skill-b'), entry('skill-a')];
const dbOrderFacts = [
  fact('fact-w-0001', 'ent-w-a', 'role', { role: '民兵' }),
  fact('fact-w-0003', 'ent-w-b', 'skill', { skill: '迷雾步行' }),
  fact('fact-ent-w-b-named-mention', 'ent-w-b', 'mentioned_as', { mention: '夜莺' }),
  fact('fact-ent-w-a-named-mention', 'ent-w-a', 'mentioned_as', { mention: '安娜' }),
];
// First-finalize order: the sorted listFacts result with the two projections
// APPENDED at the end (in-memory materialization order).
const firstFinalizeFacts = [
  dbOrderFacts[0], dbOrderFacts[1],
  dbOrderFacts[3], dbOrderFacts[2],
];

test('mapper prompt is byte-identical for appended vs sorted fact orders', () => {
  const appended = buildMapperUserPrompt(firstFinalizeFacts, entities, events, existingEntries);
  const reloaded = buildMapperUserPrompt(dbOrderFacts, entities, events, existingEntries);
  assert.equal(appended, reloaded);
  const parsed = JSON.parse(reloaded);
  // Facts serialize in factId order regardless of caller order.
  const sortedIds = [...dbOrderFacts].map(f => f.factId).sort();
  assert.deepEqual(parsed.facts.map(f => f.factId), sortedIds);
  // Entities/events/existingEntries keep caller order (reload-stable; sorting
  // them would invalidate already-paid mapping checkpoints).
  assert.deepEqual(parsed.entities.map(e => e.name), ['夜莺', '安娜']);
  assert.deepEqual(parsed.events.map(e => e.eventId), ['evt-w-2', 'evt-w-1']);
  assert.deepEqual(parsed.existingEntries.map(e => e.entryId), ['skill-b', 'skill-a']);
});
