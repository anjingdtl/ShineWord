const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { buildPlanningContext } = require('../dist/application/campaignPlan/planningService');

test('campaign planning excludes facts sourced after the selected canon anchor chapter', async () => {
  const h = await fixture();
  try {
    const setup = await h.planStore.getSetup('setup-t');
    const laterText = '后续章节中的事实';
    const laterHash = await h.worlds.getWorld('w').then(() => require('./helpers/mobileHarness.cjs').sha.sha256Hex(laterText));
    await h.worlds.saveImportedSource('w', {
      encoding: 'utf-8', sourceSha256Hex: 'a'.repeat(64), sourceByteLength: laterText.length,
      normalizeVersion: 'n', chapterSplitVersion: 'c', splitStrategy: 'test', text: laterText,
      codePointCount: Array.from(laterText).length,
      chapters: [{ chapterId: 'ch-later', index: 1, title: '后续章节', startOffset: 100,
        endOffset: 100 + laterText.length, charCount: laterText.length, contentHash: laterHash }],
      chunks: [],
    }, NOW);
    await h.worlds.saveFact({
      worldId: 'w', factId: 'fact-from-later-chapter', subjectEntityId: 'ent-lin',
      predicate: 'later_revelation', value: { text: '后续章节中的事实' }, status: 'explicit', confidence: 1,
      validFrom: null, validTo: null, revealAt: null, scope: 'world',
      sources: [{ chapterId: 'ch-later', startOffset: 100, endOffset: 104,
        quote: '后续事实', quoteSha256: await require('./helpers/mobileHarness.cjs').sha.sha256Hex('后续事实') }],
    }, NOW);
    await h.adapter.execute(
      `INSERT INTO world_event_proposals
        (world_id,chunk_id,event_id,title,summary,world_time_order,narrative_chapter_id,depends_on_event_keys_json,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['w', 'anchor-chunk', 'event-anchor', '开局锚点', '选定的开局事件', 1, 'ch', '[]', 'proposed', NOW, NOW],
    );
    const intent = { ...setup.intent, openingAnchor: { ...setup.intent.openingAnchor,
      worldTimeOrder: 1, anchorEventId: 'event-anchor' } };
    const pkg = await h.worlds.getWorldPackage('w', setup.intent.sourceCoverageBinding.packageRevision);
    const futureEntry = { entryId: 'scene-from-later-chapter', kind: 'scene', visibility: 'public',
      provenance: { sourceFactIds: ['fact-from-later-chapter'] }, definition: { locationId: 'loc-town', actors: [] } };
    const planning = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'],
      effectiveEntries: [...pkg.entries, futureEntry] });
    assert.ok(planning.ctx.availableFactIds.has('fact-crates'));
    assert.ok(!planning.ctx.availableFactIds.has('fact-from-later-chapter'));
    assert.ok(!planning.ctx.openingFacts.some(fact => fact.factId === 'fact-from-later-chapter'));
    assert.ok(!planning.visibleEntries.some(entry => entry.entryId === 'scene-from-later-chapter'));
  } finally { h.db.close(); }
});

test('planning fails closed when a bound opening event has no source chapter', async () => {
  const h = await fixture();
  try {
    const setup = await h.planStore.getSetup('setup-t');
    const intent = { ...setup.intent, openingAnchor: { ...setup.intent.openingAnchor, anchorEventId: 'missing-anchor' } };
    await assert.rejects(
      buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'] }),
      /campaign_anchor_source_chapter_unresolved/,
    );
  } finally { h.db.close(); }
});
