/* Independent acceptance probes. Run after npm run build:core.
 * Uses existing synthetic fixtures, in-memory SQLite, no network or user data.
 * Reuses fixture helpers while suppressing registration of their existing tests.
 * Exit 1 means an acceptance expectation is violated, not an infrastructure error.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const fixturePath = path.join(root, 'tests/phase2-campaign.test.cjs');
const fixtureRequire = createRequire(fixturePath);
const context = vm.createContext({
  console,
  require: id => id === 'node:test' ? (() => {}) : fixtureRequire(id),
});
vm.runInContext(fs.readFileSync(fixturePath, 'utf8') + `
globalThis.fixtures = { setupDb, makeSession, sha, assembleBook, distanceBetweenZones };
`, context, { filename: fixturePath });
const f = context.fixtures;
const { exportSave, restoreSave } = fixtureRequire('../dist/application/export/saveFile');
let failures = 0;
function check(name, passed, evidence) {
  if (!passed) failures++;
  console.log(JSON.stringify({ name, result: passed ? 'PASS' : 'FAIL', evidence }));
}

async function main() {
  {
    const db = f.setupDb();
    const { session, adapter } = await f.makeSession(db);
    for (let i = 0; i < 10; i++) {
      await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'same unchanged goal' });
    }
    const before = await session.getSummary('camp-s', 'camp-s-main');
    await session.trainSkill({ campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen',
      skillId: 'stealth', conditions: { hasSource: true, hasResources: true, meetsPrerequisites: true } });
    const after = await session.getSummary('camp-s', 'camp-s-main');
    check('training creates a versioned timed action', after.state.stateVersion > before.state.stateVersion
      && after.state.clockSeconds > before.state.clockSeconds,
      { beforeVersion: before.state.stateVersion, afterVersion: after.state.stateVersion,
        beforeClock: before.state.clockSeconds, afterClock: after.state.clockSeconds });
    await session.rewind({ campaignId: 'camp-s', sourceBranchId: 'camp-s-main', atStateVersion: 1, newBranchId: 'rewound' });
    const oldCard = await session.getCard('rewound', 'actor-shen');
    const oldSkill = db.prepare("SELECT rank FROM actor_skills WHERE branch_id='rewound' AND actor_id='actor-shen' AND skill_id='stealth'").get();
    const next = await session.playTurn({ campaignId: 'camp-s', branchId: 'rewound', intent: 'historical check' });
    check('rewound card uses historical skill rank', oldCard.skills.stealth === oldSkill.rank,
      { historicalRank: oldSkill.rank, cardRank: oldCard.skills.stealth, actualDice: next.dice });

    const milestone = { campaignId: 'camp-s', branchId: 'camp-s-main', actorId: 'actor-shen',
      skillId: 'stealth', points: 2, encounterId: 'same-milestone' };
    await session.grantMilestone(milestone);
    const first = db.prepare("SELECT practice_points FROM actor_skills WHERE branch_id='camp-s-main' AND actor_id='actor-shen' AND skill_id='stealth'").get().practice_points;
    await session.grantMilestone(milestone);
    const second = db.prepare("SELECT practice_points FROM actor_skills WHERE branch_id='camp-s-main' AND actor_id='actor-shen' AND skill_id='stealth'").get().practice_points;
    check('same milestone is idempotent', second === first, { first, second });

    const exported = await exportSave({ db: adapter, sha256Hex: f.sha.sha256Hex,
      campaignId: 'camp-s', branchId: 'camp-s-main', createdAt: 'review' });
    await restoreSave({ db: adapter, save: exported.save, newCampaignId: 'restored-c', newBranchId: 'restored-b', createdAt: 'review' });
    const restored = await session.getSummary('restored-c', 'restored-b');
    let continueError = null;
    try { await session.playTurn({ campaignId: 'restored-c', branchId: 'restored-b', intent: 'continue restored game' }); }
    catch (e) { continueError = e.message; }
    check('exported game restores playable dependencies and cards', continueError === null,
      { cards: restored.cards.length, packageRevision: restored.packageRevision, continueError });
    db.close();
  }
  {
    const db = f.setupDb();
    const { session, provider } = await f.makeSession(db);
    const normalComplete = provider.complete.bind(provider);
    provider.complete = async request => {
      const response = await normalComplete(request);
      if (request.role === 'Planner') {
        const contract = JSON.parse(response.text);
        contract.requiresRoll = false;
        for (const clause of Object.values(contract.outcomes)) {
          clause.effects = [{ op: 'restoreResource', actorId: 'actor-shen', resourceId: 'hp', amount: 999 }];
        }
        response.text = JSON.stringify(contract);
      }
      return response;
    };
    let rejected = false;
    try { await session.playTurn({ campaignId: 'camp-s', branchId: 'camp-s-main', intent: 'observe' }); }
    catch { rejected = true; }
    const after = await session.getSummary('camp-s', 'camp-s-main');
    check('planner cannot grant arbitrary healing above card maximum', rejected || after.state.actors['actor-shen'].resources.hp <= 10,
      { rejected, hp: after.state.actors['actor-shen'].resources.hp, maxHp: 10 });
    db.close();
  }
  {
    const entry = { entryId: 'secret', kind: 'lore', visibility: 'discoverable', definition: { text: 'unlearned secret' } };
    const groups = f.assembleBook({ entries: [entry], sections: [{ book: 'monster_manual', sectionKey: 's', position: 0, entryIds: ['secret'] }] },
      'monster_manual', { includeGm: false });
    check('undiscovered entries stay hidden in player view', !groups.some(g => g.entries.some(e => e.entryId === 'secret')),
      { exposedIds: groups.flatMap(g => g.entries.map(e => e.entryId)) });
    let distance, rejected = false;
    try { distance = f.distanceBetweenZones([{ zoneId: 'a', exits: ['b'] }, { zoneId: 'b', exits: ['a'] }, { zoneId: 'isolated', exits: [] }], 'a', 'isolated'); }
    catch { rejected = true; }
    check('disconnected target is not reachable at far range', rejected || distance === 'out_of_range', { rejected, distance });
  }
  console.log(JSON.stringify({ acceptanceFailures: failures }));
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 2; });
