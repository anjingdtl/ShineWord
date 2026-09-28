/* Run after npm run build:core. Synthetic fixtures + in-memory SQLite only.
 * Exit 1: failed acceptance expectation. Exit 2: probe setup error.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const fixturePath = path.resolve(__dirname, '../../tests/phase2-campaign.test.cjs');
const req = createRequire(fixturePath);
const ctx = vm.createContext({ console, require: id => id === 'node:test' ? (() => {}) : req(id) });
vm.runInContext(fs.readFileSync(fixturePath, 'utf8') + '\nglobalThis.f = { setupDb, makeSession, sha };', ctx, { filename: fixturePath });
const { setupDb, makeSession, sha } = ctx.f;
const { exportSave, restoreSave } = req('../dist/application/export/saveFile');
let failures = 0;
function check(name, passed, evidence) {
  if (!passed) failures++;
  console.log(JSON.stringify({ name, result: passed ? 'PASS' : 'FAIL', evidence }));
}
async function createFight() {
  const db = setupDb();
  const { session, adapter } = await makeSession(db, { initialSkills: ['stealth', 'sword'] });
  const fight = await session.encounters.begin({ campaignId: 'camp-s', branchId: 'camp-s-main',
    encounterId: 'review-fight', hostiles: [{ templateId: 'guard-template', count: 1 }] });
  return { db, session, adapter, fight, ids: { campaignId: 'camp-s', branchId: 'camp-s-main', encounterId: fight.encounterId } };
}
async function main() {
  {
    const { db, session, adapter, fight, ids } = await createFight();
    const before = await session.getSummary(ids.campaignId, ids.branchId);
    const first = await session.encounters.playerMove({ ...ids, toZoneId: 'z-b' });
    let secondAccepted = false;
    try { await session.encounters.playerMove({ ...ids, toZoneId: 'z-a' }); secondAccepted = true; } catch {}
    const after = await session.getSummary(ids.campaignId, ids.branchId);
    check('one standard move per actor per round', !secondAccepted,
      { secondAccepted, actor: fight.currentActorId, firstZone: first.actors.find(a => a.actorId === fight.currentActorId)?.zoneId });
    check('combat movement is versioned', after.state.stateVersion > before.state.stateVersion,
      { before: before.state.stateVersion, after: after.state.stateVersion });

    // The first legal move closes distance to the guard, so the same actor can
    // now attack without consuming a second movement or advancing initiative.
    const hostile = fight.actors.find(a => a.side === 'hostile').actorId;
    await session.encounters.playerAttack({ ...ids, targetId: hostile });
    const at = await session.getSummary(ids.campaignId, ids.branchId);
    await session.rewind({ campaignId: ids.campaignId, sourceBranchId: ids.branchId,
      atStateVersion: at.state.stateVersion, newBranchId: 'fight-fork' });
    const forkFight = await session.encounters.getActiveEncounter(ids.campaignId, 'fight-fork');
    check('fork inside combat restores active encounter', forkFight !== null,
      { forkStateVersion: at.state.stateVersion, activeEncounter: forkFight?.encounterId ?? null,
        restoredCards: (await session.listCards('fight-fork')).length });

    const exported = await exportSave({ db: adapter, sha256Hex: sha.sha256Hex,
      campaignId: ids.campaignId, branchId: ids.branchId, createdAt: 'review' });
    await restoreSave({ db: adapter, save: exported.save, newCampaignId: 'import-c', newBranchId: 'import-b', createdAt: 'review' });
    const importedFight = await session.encounters.getActiveEncounter('import-c', 'import-b');
    check('combat save restores encounter cursor and battlefield', importedFight !== null,
      { originalActiveEncounter: (await session.encounters.getActiveEncounter(ids.campaignId, ids.branchId))?.encounterId,
        importedActiveEncounter: importedFight?.encounterId ?? null });
    db.close();
  }
  {
    const { db, session, ids } = await createFight();
    const hostile = (await session.encounters.getActiveEncounter(ids.campaignId, ids.branchId)).actors
      .find(actor => actor.side === 'hostile').actorId;
    let beforeView = await session.encounters.getView(ids.campaignId, ids.branchId, ids.encounterId);
    let npcSteps = 0;
    while (!beforeView.currentActorIsPlayer && npcSteps < 8) {
      beforeView = await session.encounters.npcTurn({ ...ids, requestId: `fault-setup-npc-${npcSteps}` });
      npcSteps += 1;
    }
    if (!beforeView.currentActorIsPlayer) throw new Error('Could not reach a player-controlled combat slot.');
    const attacker = beforeView.actors.find(actor => actor.actorId === beforeView.currentActorId);
    const defender = beforeView.actors.find(actor => actor.actorId === hostile);
    if (attacker.zoneId !== defender.zoneId) {
      if (!beforeView.zones.some(zone => zone.zoneId === defender.zoneId && zone.exits.includes(attacker.zoneId))) {
        throw new Error('Attack fault fixture could not close to an adjacent zone.');
      }
      beforeView = await session.encounters.playerMove({ ...ids, toZoneId: defender.zoneId, requestId: 'fault-prep-move' });
    }
    const before = await session.getSummary(ids.campaignId, ids.branchId);
    beforeView = await session.encounters.getView(ids.campaignId, ids.branchId, ids.encounterId);
    // Fail at the transactional snapshot boundary. The earlier repro patched
    // saveEncounter(), which the unified UnitOfWork no longer calls, so it
    // could report PASS without injecting any failure.
    const requestId = 'round2-atomic-attack';
    let randomCalls = 0;
    session.encounters.deps.random = {
      nextIntInclusive: (_min, max) => { randomCalls += 1; return max; },
    };
    db.exec(`CREATE TRIGGER injected_combat_snapshot_failure BEFORE INSERT ON snapshots
      WHEN NEW.branch_id = '${ids.branchId}' AND NEW.state_version = ${before.state.stateVersion + 1}
      BEGIN SELECT RAISE(ABORT, 'injected combat snapshot failure'); END;`);
    let failed = false;
    let failureMessage = '';
    try {
      await session.encounters.playerAttack({ ...ids, targetId: hostile, requestId });
    } catch (error) {
      failureMessage = String(error?.message ?? error);
      failed = failureMessage.includes('injected combat snapshot failure');
    } finally {
      db.exec('DROP TRIGGER injected_combat_snapshot_failure;');
    }
    const after = await session.getSummary(ids.campaignId, ids.branchId);
    const afterView = await session.encounters.getView(ids.campaignId, ids.branchId, ids.encounterId);
    const hpBefore = before.state.actors[hostile].resources.hp;
    const hpAfter = after.state.actors[hostile].resources.hp;
    const cursorAdvanced = afterView.currentActorId !== beforeView.currentActorId;
    const partialEvents = db.prepare('SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = ? AND state_version = ?')
      .get(ids.branchId, before.state.stateVersion + 1).n;
    const partialRewards = db.prepare('SELECT COUNT(*) AS n FROM reward_ledger WHERE branch_id = ? AND encounter_id = ?')
      .get(ids.branchId, ids.encounterId).n;
    const rolledBeforeRetry = db.prepare('SELECT rolls_json FROM roll_records WHERE branch_id = ? AND turn_id = ?')
      .get(ids.branchId, `enc:${ids.encounterId}:request:${requestId}`);
    let retryIdempotent = false;
    let randomCallsAfterFailure = randomCalls;
    if (failed) {
      const retry = await session.encounters.playerAttack({ ...ids, targetId: hostile, requestId });
      const afterRetry = await session.getSummary(ids.campaignId, ids.branchId);
      const eventCount = db.prepare('SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = ? AND turn_id = ?')
        .get(ids.branchId, `enc:${ids.encounterId}:request:${requestId}`).n;
      const hpAfterRetry = afterRetry.state.actors[hostile]?.resources.hp ?? 0;
      await session.encounters.playerAttack({ ...ids, targetId: hostile, requestId });
      const afterDuplicate = await session.getSummary(ids.campaignId, ids.branchId);
      const duplicateEventCount = db.prepare('SELECT COUNT(*) AS n FROM branch_events WHERE branch_id = ? AND turn_id = ?')
        .get(ids.branchId, `enc:${ids.encounterId}:request:${requestId}`).n;
      retryIdempotent = retry.stateVersion === before.state.stateVersion + 1
        && retry.currentActorId !== beforeView.currentActorId
        && eventCount > 0
        && afterRetry.state.stateVersion === before.state.stateVersion + 1
        && afterDuplicate.state.stateVersion === afterRetry.state.stateVersion
        && (afterDuplicate.state.actors[hostile]?.resources.hp ?? 0) === hpAfterRetry
        && duplicateEventCount === eventCount
        && randomCalls === randomCallsAfterFailure;
    }
    check('attack state and encounter cursor commit atomically',
      failed && !!rolledBeforeRetry
        && after.state.stateVersion === before.state.stateVersion
        && hpAfter === hpBefore
        && !cursorAdvanced
        && partialEvents === 0
        && partialRewards === 0
        && retryIdempotent,
      { faultRaised: failed, failureMessage, rolledBeforeRetry: !!rolledBeforeRetry, hpBefore, hpAfter,
        beforeVersion: before.state.stateVersion, afterFailureVersion: after.state.stateVersion,
        beforeActor: beforeView.currentActorId, afterFailureActor: afterView.currentActorId,
        partialEvents, partialRewards, retryIdempotent, randomCallsAfterFailure, randomCallsAfterRetry: randomCalls });
    db.close();
  }
  console.log(JSON.stringify({ acceptanceFailures: failures }));
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 2; });
