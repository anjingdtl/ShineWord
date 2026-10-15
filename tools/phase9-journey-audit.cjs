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
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const eventSignature = (type, payload) => JSON.stringify([type, canonical(payload)]);
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
  const turns = db.prepare("SELECT turn_id,committed_state_version,action_contract_json,effects_json,outcome_grade FROM turns WHERE branch_id=? AND status='Committed' ORDER BY committed_state_version").all(branchId);
  const events = db.prepare('SELECT turn_id,state_version,event_type,payload_json FROM branch_events WHERE branch_id=? ORDER BY event_seq').all(branchId)
    .map(event => {
      const payload = parse(event.payload_json, 'branch event');
      return { ...event, payload, semanticType: event.event_type === 'recordEvent' ? payload.eventType : event.event_type };
    });
  const decisions = [];
  for (const turn of turns) {
    const version = turn.committed_state_version;
    if (turn.turn_id.includes(':manage-') || turn.turn_id.includes(':system-')
      || turn.turn_id.startsWith('system-') || turn.turn_id.endsWith(':adoption')) continue;
    const beforeSnapshot = snapshots.filter(row => row.version < version).at(-1);
    const afterSnapshot = snapshots.find(row => row.version === version);
    const before = beforeSnapshot?.state;
    const after = afterSnapshot?.state;
    const snapshotsContiguous = Boolean(beforeSnapshot && beforeSnapshot.version === version - 1 && afterSnapshot);
    const contract = parse(turn.action_contract_json, 'contract');
    const effects = parse(turn.effects_json, 'effects');
    const recordEventEffects = effects.filter(effect => effect.op === 'recordEvent' && typeof effect.eventType === 'string');
    const rest = contract.actionKind === 'rest' || contract.actionId === 'short_rest' || contract.actionId === 'long_rest';
    const changes = [];
    let evidenceStatus = 'complete';
    let eventEvidenceStatus = recordEventEffects.length ? 'complete' : 'not_required';
    if (snapshotsContiguous && before && after && !rest) {
      for (const key of ['discoveries', 'relationships', 'itemOwners', 'questProgress', 'party', 'skills']) {
        if (!equal(semanticRows(before, key), semanticRows(after, key))) changes.push(key);
      }
      for (const situation of after.situations ?? []) {
        const old = before.situations?.find(s => s.situationId === situation.situationId);
        for (const key of ['status', 'counters', 'promises', 'suppressedEventKeys']) {
          const baseline = old?.[key] ?? (key === 'counters' || key === 'suppressedEventKeys' ? {} : key === 'status' ? 'active' : []);
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
      const currentEvents = events.filter(event => event.state_version === version);
      const previousSignatures = new Set(events.filter(event => event.state_version < version)
        .map(event => eventSignature(event.semanticType, event.payload)));
      for (const effect of recordEventEffects) {
        const signature = eventSignature(effect.eventType, effect);
        const committed = currentEvents.some(event => event.turn_id === turn.turn_id && event.semanticType === effect.eventType
          && eventSignature(event.semanticType, event.payload) === signature);
        if (!committed) {
          eventEvidenceStatus = 'incomplete';
          evidenceStatus = 'unknown';
          continue;
        }
        if (!previousSignatures.has(signature)) changes.push('new.committed_event');
      }
    } else if (rest && snapshotsContiguous && before && after) {
      // Rest is excluded as a meaningful decision, but contiguous snapshots remain complete evidence.
      const currentEvents = events.filter(event => event.state_version === version && event.turn_id === turn.turn_id);
      for (const effect of recordEventEffects) {
        const signature = eventSignature(effect.eventType, effect);
        if (!currentEvents.some(event => event.semanticType === effect.eventType
          && eventSignature(event.semanticType, event.payload) === signature)) {
          eventEvidenceStatus = 'incomplete';
          evidenceStatus = 'unknown';
        }
      }
    } else {
      evidenceStatus = 'unknown';
      if (recordEventEffects.length) eventEvidenceStatus = 'incomplete';
    }
    decisions.push({ turnId: turn.turn_id, version, beforeVersion: beforeSnapshot?.version ?? null, afterVersion: afterSnapshot?.version ?? null,
      grade: turn.outcome_grade, methodId: contract.methodRef?.methodId,
      changes: [...new Set(changes)], evidenceStatus, eventEvidenceStatus, candidateMeaningful: changes.length > 0 && !rest,
      ...(rest ? { excluded: 'rest' } : !snapshotsContiguous ? { excluded: 'snapshot evidence incomplete' }
        : evidenceStatus === 'unknown' ? { excluded: 'committed event evidence incomplete' }
          : changes.length === 0 ? { excluded: 'no lasting change beyond time/resource expenditure' } : {}) });
  }
  const scopedDecisions = decisions.filter(d => d.version > afterVersion);
  const candidates = scopedDecisions.filter(d => d.candidateMeaningful);
  // Keep the latest lifecycle state per idempotency identity. Production may
  // trigger and discharge an obligation inside one transaction, so no saved
  // snapshot ever contains its transient `triggered` state.
  const latestConsequences = new Map();
  const consequenceIdentityById = new Map();
  let unidentifiedLifecycleRecords = 0;
  let consequenceIdentityChanged = false;
  for (const row of snapshots) for (const c of row.state.campaignRuntime?.deferredConsequences ?? []) {
    if (typeof c.idempotencyKey !== 'string' || !c.idempotencyKey || typeof c.consequenceId !== 'string' || !c.consequenceId) {
      unidentifiedLifecycleRecords += 1; continue;
    }
    const priorIdentity = consequenceIdentityById.get(c.consequenceId);
    if (priorIdentity && priorIdentity !== c.idempotencyKey) consequenceIdentityChanged = true;
    consequenceIdentityById.set(c.consequenceId, c.idempotencyKey);
    latestConsequences.set(c.idempotencyKey, c);
  }
  const consequences = [...latestConsequences.values()]
    .filter(c => ['pending', 'triggered', 'discharged', 'cancelled'].includes(c.status))
    .map(c => {
      const hasTriggerVersion = Number.isInteger(c.triggeredAtVersion);
      const validSchedule = Number.isInteger(c.createdAtVersion) && hasTriggerVersion && c.triggeredAtVersion >= c.createdAtVersion;
      // Output scoping must not erase the earlier history needed to prove delay.
      const intervening = validSchedule
        ? decisions.filter(d => d.candidateMeaningful && d.version > c.createdAtVersion && d.version < c.triggeredAtVersion).length
        : null;
      const eventAt = (type, version) => events.find(event => event.semanticType === type
        && event.state_version === version && event.payload?.consequenceId === c.consequenceId
        && turns.some(turn => turn.turn_id === event.turn_id && turn.committed_state_version === version));
      const scheduleEvent = Number.isInteger(c.createdAtVersion) ? eventAt('campaign_consequence_scheduled', c.createdAtVersion) : undefined;
      const triggerEvent = hasTriggerVersion ? eventAt('campaign_consequence_triggered', c.triggeredAtVersion) : undefined;
      const dischargeEvent = Number.isInteger(c.dischargedAtVersion) ? eventAt('campaign_consequence_discharged', c.dischargedAtVersion) : undefined;
      const cancellationEvent = Number.isInteger(c.cancelledAtVersion) ? eventAt('campaign_consequence_cancelled', c.cancelledAtVersion) : undefined;
      const appliedEffectEventTypes = Number.isInteger(c.dischargedAtVersion) ? events.filter(event =>
        event.state_version === c.dischargedAtVersion && event.payload?.consequenceId === c.consequenceId
          && !['campaign_consequence_scheduled', 'campaign_consequence_triggered', 'campaign_consequence_discharged', 'campaign_consequence_cancelled'].includes(event.semanticType))
        .map(event => event.semanticType) : [];
      const scheduleTurn = turns.find(turn => turn.turn_id === c.sourceTurnId);
      const scheduleEventEvidence = Boolean(scheduleEvent && scheduleTurn && scheduleEvent.turn_id === c.sourceTurnId
        && scheduleTurn.committed_state_version === c.createdAtVersion);
      const terminalEvidenceComplete = c.status === 'pending' ? scheduleEventEvidence
        : c.status === 'triggered' ? Boolean(scheduleEventEvidence && triggerEvent)
          : c.status === 'discharged' ? Boolean(scheduleEventEvidence && triggerEvent && dischargeEvent)
            : c.status === 'cancelled' ? Boolean(scheduleEventEvidence && cancellationEvent) : false;
      return { consequenceId: c.consequenceId, idempotencyKey: c.idempotencyKey, status: c.status,
        scheduleTurnId: c.sourceTurnId ?? null,
        triggerTurnId: triggerEvent?.turn_id ?? null,
        createdAtVersion: c.createdAtVersion ?? null, triggeredAtVersion: c.triggeredAtVersion ?? null,
        dischargedAtVersion: c.dischargedAtVersion ?? null,
        cancelledAtVersion: c.cancelledAtVersion ?? null, cancelReason: c.cancelReason ?? null,
        scheduleEventEvidence,
        triggerEventEvidence: Boolean(triggerEvent),
        applicationStatus: c.status === 'discharged' ? 'applied' : c.status === 'triggered' ? 'triggered_not_discharged'
          : c.status === 'cancelled' ? 'not_applied_cancelled' : 'not_triggered',
        applicationEventEvidence: Boolean(dischargeEvent), appliedEffectEventTypes,
        cancellationEventEvidence: Boolean(cancellationEvent),
        downstreamConsumerEvidence: 'not_tracked', causalChainClosed: false,
        lifecycleEvidence: terminalEvidenceComplete ? 'complete' : 'incomplete',
        interveningCandidateDecisions: intervening,
        meetsDelayCandidate: ['triggered', 'discharged'].includes(c.status) && terminalEvidenceComplete && intervening !== null && intervening >= 2 };
    });
  const last = snapshots.at(-1);
  const evidenceStatus = snapshots.length > 0 && unidentifiedLifecycleRecords === 0 && !consequenceIdentityChanged
    && decisions.every(decision => decision.evidenceStatus === 'complete')
    && consequences.every(consequence => consequence.lifecycleEvidence === 'complete') ? 'complete' : 'unknown';
  const report = { schema: 'phase9-journey-audit-1', at: new Date().toISOString(), branchId, sourceDatabaseReadOnly: true,
    evidenceStatus, unidentifiedLifecycleRecords, consequenceIdentityChanged,
    headVersion: last?.version ?? null, campaignStatus: last?.state.campaignRuntime?.campaignStatus, ending: last?.state.campaignRuntime?.ending,
    afterVersion, submittedPlayerTurns: scopedDecisions.length, candidateMeaningfulDecisions: candidates.length, excludedPlayerTurns: scopedDecisions.length - candidates.length,
    semanticReviewRequired: true, decisions: scopedDecisions, consequences };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ branchId, headVersion: report.headVersion, evidenceStatus: report.evidenceStatus, campaignStatus: report.campaignStatus,
    submittedPlayerTurns: report.submittedPlayerTurns, candidateMeaningfulDecisions: candidates.length, excludedPlayerTurns: report.excludedPlayerTurns,
    delayedConsequenceCandidates: consequences.filter(c => c.meetsDelayCandidate).length, semanticReviewRequired: true }, null, 2));
} finally { db.close(); }
