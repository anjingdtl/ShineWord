'use strict';
/**
 * P7-2 targeted verification: situation proposal cleaning (whitelist gate,
 * no invented skills/people/fates), local opening-situation compilation,
 * gm-guide sections and the world-package-4 schema declaration.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSituation } = require('../dist/application/worldPackage/buildPackageFromCanon');
const { compileOpeningSituation, OPENING_SITUATION_ENTRY_ID } = require('../dist/application/worldPackage/compileOpeningSituation');
const { createProgressiveBaselineEntries, buildSections } = require('../dist/application/worldPackage/buildPackageFromCanon');

function cleanContext(overrides = {}) {
  const rejected = [];
  return {
    ctx: { knownFactIds: new Set(overrides.factIds ?? ['f1', 'f2', 'f3']), rejected },
    knownEntryIds: new Set(overrides.knownEntryIds ?? ['skill-medicine', 'skill-tracking', 'npc-companion', 'lore-north-trail', 'skill-observation', 'skill-diplomacy']),
    knownEvents: new Map(overrides.knownEvents ?? [['evt-death', { worldTimeOrder: 30 }]]),
    factSubjects: new Map(overrides.factSubjects ?? [['f1', 'ent-companion'], ['f2', 'ent-pursuer'], ['f3', 'ent-sect']]),
    knowledgeEntryIds: new Set(overrides.knowledgeEntryIds ?? ['lore-north-trail']),
    rejected,
  };
}

function validRaw(overrides = {}) {
  return {
    id: 'sect-aftermath',
    title: '观毁人伤',
    summary: '道观遭袭，同伴重伤。',
    gmBrief: '灰衣人背后有主使（GM-only）。',
    locationId: 'scene-sect',
    participantIds: ['npc-companion'],
    activation: { kind: 'world_time_at_least', order: 18 },
    knowledgeCondition: { kind: 'knowledge_known', entryId: 'lore-north-trail' },
    signs: [{ text: '院外有向北的脚印' }],
    pressure: { description: '踪迹会消失' },
    provenanceKind: 'design_fill',
    evidenceFactIds: ['f1', 'f3'],
    rationale: '局面组织',
    methods: [
      {
        id: 'heal', title: '先救同伴', goal: '稳住伤势',
        firstStep: { intent: '检查伤势并止血', actionKind: 'skill_check', skillId: 'skill-medicine', targetId: 'npc-companion' },
        requires: { skillId: 'skill-medicine', minRank: 'trained' },
        tradeoffs: '花费时间', preparation: '需要医术',
      },
      {
        id: 'pursue', title: '追赶夺物者', goal: '追回信物',
        firstStep: { intent: '查看向北的脚印', actionKind: 'skill_check', skillId: 'skill-tracking' },
        requires: { knowledgeEntryId: 'lore-north-trail' },
        tradeoffs: '同伴暂无人照料', preparation: '需要先看到线索',
      },
    ],
    ...overrides,
  };
}

test('cleanSituation accepts a well-formed proposal and freezes provenance', () => {
  const context = cleanContext();
  const entry = cleanSituation(validRaw(), context);
  assert.ok(entry);
  assert.equal(entry.entryId, 'situation-sect-aftermath');
  assert.equal(entry.visibility, 'gm');
  assert.equal(entry.definition.methods.length, 2);
  assert.equal(entry.definition.methods[0].firstStep.skillId, 'skill-medicine');
  assert.equal(context.rejected.length, 0);
});

test('cleanSituation rejects dangling references, unknown conditions and thin methods', () => {
  // Dangling skill reference.
  let context = cleanContext();
  let raw = validRaw();
  raw.methods[1].firstStep.skillId = 'skill-unknown';
  assert.equal(cleanSituation(raw, context), null);
  assert.ok(context.rejected[0].reasons.some(r => r.includes('unknown skill')));

  // Non-whitelisted condition node.
  context = cleanContext();
  raw = validRaw({ activation: { kind: 'javascript', code: 'true' } });
  assert.equal(cleanSituation(raw, context), null);

  // Fewer than two distinct methods.
  context = cleanContext();
  raw = validRaw({ methods: [validRaw().methods[0]] });
  assert.equal(cleanSituation(raw, context), null);
  assert.ok(context.rejected[0].reasons.some(r => r.includes('at least 2')));

  // Synonym duplicates (same action shape) do not count as distinct methods.
  context = cleanContext();
  raw = validRaw();
  raw.methods = [raw.methods[0], { ...raw.methods[0], id: 'heal-again', title: '再救一次' }];
  assert.equal(cleanSituation(raw, context), null);
  assert.ok(context.rejected[0].reasons.some(r => r.includes('at least 2')));
});

test('cleanSituation binds reference events only to real canon events with evidenced fates', () => {
  const context = cleanContext();
  const raw = validRaw({
    referenceEvents: [
      {
        eventKey: 'evt-death', worldTimeOrder: 30,
        condition: { kind: 'all', of: [
          { kind: 'actor_alive', actorId: 'ent-companion' },
          { kind: 'actor_condition', actorId: 'ent-companion', conditionId: 'bleeding' },
        ] },
        actorFate: { actorId: 'ent-companion', lifeStatus: 'dead' },
      },
      { eventKey: 'evt-not-in-canon', worldTimeOrder: 99 },
    ],
  });
  const entry = cleanSituation(raw, context);
  assert.ok(entry);
  const events = entry.definition.referenceEvents;
  assert.equal(events.length, 1, 'the fabricated event key is rejected');
  assert.equal(events[0].eventKey, 'evt-death');
  assert.equal(events[0].actorFate.actorId, 'ent-companion');
  // A fate with no supporting subject evidence is dropped; the reference
  // event itself survives as a branch-conditional future without a fate.
  const context2 = cleanContext({ factSubjects: new Map([['f1', 'ent-other']]) });
  const entry2 = cleanSituation(validRaw({
    referenceEvents: [{ eventKey: 'evt-death', worldTimeOrder: 30, actorFate: { actorId: 'ent-companion', lifeStatus: 'dead' } }],
  }), context2);
  assert.ok(entry2);
  assert.equal(entry2.definition.referenceEvents.length, 1);
  assert.equal(entry2.definition.referenceEvents[0].actorFate, undefined);
});

test('compileOpeningSituation yields a valid situation from baseline entries only', () => {
  const entries = createProgressiveBaselineEntries();
  entries.push({
    entryId: 'scene-open', kind: 'scene', revision: 0,
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: 'x' }, fieldProvenance: {},
    visibility: 'public', dependencyIds: [],
    definition: {
      name: '镇口', description: '开局', locationId: 'opening-location',
      zones: [{ zoneId: 'z', name: '镇口', cover: false, exits: [] }],
      actors: [], visibleItems: [], hazards: [], clues: [],
    },
  });
  const situation = compileOpeningSituation({ entries, situationText: '镇口有骚动', goalText: '查明骚动' });
  assert.ok(situation);
  assert.equal(situation.entryId, OPENING_SITUATION_ENTRY_ID);
  assert.ok(situation.definition.methods.length >= 2);
  assert.ok(situation.dependencyIds.includes('scene-open'));
  // Sections route situations into the GM guide.
  const sections = buildSections([...entries, situation]);
  const gmSituations = sections.find(s => s.book === 'gm_guide' && s.sectionKey === 'situations');
  assert.ok(gmSituations);
  assert.ok(gmSituations.entryIds.includes(OPENING_SITUATION_ENTRY_ID));
  // No situation section leaks into the player handbook.
  assert.equal(sections.find(s => s.book === 'player_handbook' && s.sectionKey === 'situations'), undefined);
  // No scene → no situation (never invented).
  assert.equal(compileOpeningSituation({ entries: createProgressiveBaselineEntries() }), null);
});
