// Read-only audit. State differences are evidence candidates, not a semantic
// quality score or an automatic PASS for the phase-9 journey contract.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const [database, branchId, output, afterVersionText] = process.argv.slice(2);
if (!database || !branchId) throw Error('Usage: node tools/phase9-journey-audit.cjs <private SQLite> <branch ID> [private report.json] [after version]');
const afterVersion = afterVersionText === undefined ? -1 : Number(afterVersionText);
if (!Number.isInteger(afterVersion) || afterVersion < -1) throw Error('After version must be an integer >= 0');
if (output && path.resolve(output) === path.resolve(database)) throw Error('Report must not overwrite the source database');
const db = new DatabaseSync(database, { readOnly: true });
const parse = (text, label) => { try { return JSON.parse(text); } catch { throw Error(`Invalid archived JSON: ${label}`); } };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function semanticRows(state, key) {
  const rows = state[key] ?? [];
  if (key === 'discoveries') return sorted(rows.map(r => [r.actorId, r.entryId]));
  if (key === 'relationships') return sorted(rows.map(r => [r.fromActorId, r.toActorId, r.stance, r.closeness]));
  if (key === 'questProgress') return sorted(rows.map(r => [r.questId, r.status, r.counters]));
  if (key === 'skills') return sorted(rows.map(r => [r.actorId, r.skillId, r.rank]));
  if (key === 'party') return sorted(rows.map(r => [r.actorId, r.controller, r.role, r.groupId]));
  return rows;
}
try {
  if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Source database failed integrity check');
  const snapshots = db.prepare('SELECT state_version,snapshot_json FROM snapshots WHERE branch_id=? ORDER BY state_version').all(branchId)
    .map(row => ({ version: row.state_version, state: parse(row.snapshot_json, 'snapshot') }));
  if (!snapshots.length) throw Error('No branch snapshots');
  const turns = db.prepare("SELECT turn_id,committed_state_version,action_contract_json,effects_json,outcome_grade FROM turns WHERE branch_id=? AND status='Committed' ORDER BY committed_state_version").all(branchId);
  const events = db.prepare('SELECT state_version,event_type FROM branch_events WHERE branch_id=? ORDER BY event_seq').all(branchId);
  const decisions = [];
  for (const turn of turns) {
    const version = turn.committed_state_version;
    if (turn.turn_id.includes(':manage-') || turn.turn_id.includes(':system-')) continue;
    const before = snapshots.filter(row => row.version < version).at(-1)?.state;
    const after = snapshots.find(row => row.version === version)?.state;
    const contract = parse(turn.action_contract_json, 'contract');
    const effects = parse(turn.effects_json, 'effects');
    const rest = contract.actionKind === 'rest' || contract.actionId === 'short_rest' || contract.actionId === 'long_rest';
    const changes = [];
    if (before && after && !rest) {
      for (const key of ['discoveries', 'relationships', 'itemOwners', 'questProgress', 'party', 'skills']) {
        if (!equal(semanticRows(before, key), semanticRows(after, key))) changes.push(key);
      }
      for (const situation of after.situations ?? []) {
        const old = before.situations?.find(s => s.situationId === situation.situationId);
        for (const key of ['status', 'counters', 'promises', 'suppressedEventKeys']) {
          const baseline = old?.[key] ?? (key === 'counters' ? {} : key === 'status' ? 'active' : []);
          if (!equal(baseline, situation[key])) changes.push('situation.' + key);
        }
      }
      for (const [id, actor] of Object.entries(after.actors)) {
        const old = before.actors[id];
        if (old && (!equal(old.lifeStatus, actor.lifeStatus) || !equal(old.conditions, actor.conditions))) changes.push('actor.status');
        if (old && old.locationId !== actor.locationId && contract.methodRef) changes.push('method.location');
      }
      for (const node of after.campaignRuntime?.nodeStates ?? []) {
        if (['succeeded', 'failed', 'cancelled', 'superseded'].includes(node.status)
          && before.campaignRuntime?.nodeStates.find(n => n.nodeId === node.nodeId)?.status !== node.status) changes.push('node.resolution');
      }
      if (!equal(before.campaignRuntime?.deferredConsequences ?? [], after.campaignRuntime?.deferredConsequences ?? [])) changes.push('consequences');
      if (!equal(before.campaignRuntime?.ending, after.campaignRuntime?.ending)) changes.push('ending');
      const previousTypes = new Set(events.filter(e => e.state_version < version).map(e => e.event_type));
      if (effects.some(e => e.op === 'recordEvent' && !previousTypes.has(e.eventType))) changes.push('new.committed_event');
    }
    decisions.push({ turnId: turn.turn_id, version, grade: turn.outcome_grade, methodId: contract.methodRef?.methodId,
      changes: [...new Set(changes)], candidateMeaningful: changes.length > 0 && !rest,
      ...(rest ? { excluded: 'rest' } : !before || !after ? { excluded: 'snapshot evidence incomplete' } : changes.length === 0 ? { excluded: 'no lasting change beyond time/resource expenditure' } : {}) });
  }
  const scopedDecisions = decisions.filter(d => d.version > afterVersion);
  const candidates = scopedDecisions.filter(d => d.candidateMeaningful);
  const consequences = [];
  const seen = new Set();
  for (const row of snapshots) for (const c of row.state.campaignRuntime?.deferredConsequences ?? []) {
    if (c.status !== 'triggered' || seen.has(c.idempotencyKey)) continue;
    seen.add(c.idempotencyKey);
    const intervening = candidates.filter(d => d.version > c.createdAtVersion && d.version < c.triggeredAtVersion).length;
    consequences.push({ consequenceId: c.consequenceId, createdAtVersion: c.createdAtVersion, triggeredAtVersion: c.triggeredAtVersion,
      interveningCandidateDecisions: intervening, meetsDelayCandidate: intervening >= 2 });
  }
  const last = snapshots.at(-1);
  const report = { schema: 'phase9-journey-audit-1', at: new Date().toISOString(), branchId, sourceDatabaseReadOnly: true,
    headVersion: last.version, campaignStatus: last.state.campaignRuntime?.campaignStatus, ending: last.state.campaignRuntime?.ending,
    afterVersion, submittedPlayerTurns: scopedDecisions.length, candidateMeaningfulDecisions: candidates.length, excludedPlayerTurns: scopedDecisions.length - candidates.length,
    semanticReviewRequired: true, decisions: scopedDecisions, consequences };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ branchId, headVersion: report.headVersion, campaignStatus: report.campaignStatus,
    submittedPlayerTurns: report.submittedPlayerTurns, candidateMeaningfulDecisions: candidates.length, excludedPlayerTurns: report.excludedPlayerTurns,
    delayedConsequenceCandidates: consequences.filter(c => c.meetsDelayCandidate).length, semanticReviewRequired: true }, null, 2));
} finally { db.close(); }
