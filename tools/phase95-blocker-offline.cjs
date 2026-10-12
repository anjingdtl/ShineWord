// Read-only exact evidence check. Prints counts/booleans only; never dispatches
// a provider, opens a device, or writes a campaign/rejected candidate.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { campaignActorPreparationTemplates, campaignCompletionRewardBlocker } = require('../dist/application/campaignPlan/routeReadiness');
const { createTemplateCard } = require('../dist/domain/characters/card');
const { applyEffects } = require('../dist/domain/state/effects');
const { settleCampaignProgress } = require('../dist/application/campaignPlan/settlement');
const { extractJsonObject } = require('../dist/application/campaignPlan/candidateModel');
const { buildStructuralRepairGuidance } = require('../dist/application/campaignPlan/generationService');
const filename = process.argv[2];
if (!filename) throw new Error('Provide the private frozen SQLite snapshot path.');
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const beforeHash = digest();
const db = new DatabaseSync(filename, { readOnly: true });
try {
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  const state = JSON.parse(db.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=?').get('camp-mv3mw9hk-main', 70).snapshot_json);
  const binding = state.campaignRuntime.planBinding;
  const plan = JSON.parse(db.prepare('SELECT plan_json FROM campaign_plan_revisions WHERE plan_id=? AND revision=?').get(binding.planId, binding.revision).plan_json);
  const artifacts = db.prepare('SELECT artifact_json FROM campaign_content_artifacts').all()
    .map(r => JSON.parse(r.artifact_json)).filter(a => state.campaignContentBinding.artifactIds.includes(a.artifactId));
  const stored = db.prepare('SELECT action_contract_json,status FROM turns WHERE branch_id=? AND turn_id=?').get(state.branchId, 'turn-0071');
  assert.equal(stored.status, 'Resolved');
  assert.equal(db.prepare('SELECT grade FROM roll_records WHERE branch_id=? AND turn_id=?').get(state.branchId, 'turn-0071').grade, 'success');
  assert.equal(db.prepare('SELECT status FROM interaction_operations WHERE branch_id=? AND status=?').get(state.branchId, 'paused_system').status, 'paused_system');
  const contract = JSON.parse(stored.action_contract_json);
  const situation = artifacts.flatMap(a => a.situations).find(s => s.entryId === contract.methodRef.situationId);
  const method = situation.definition.methods.find(m => m.methodId === contract.methodRef.methodId);
  const blocker = campaignCompletionRewardBlocker({ state, plan, artifacts, situationId: situation.entryId, method });
  assert.equal(blocker, 'campaign_method_actor_unavailable');
  const campaign = db.prepare('SELECT world_id,package_revision,anchor_json FROM campaigns WHERE campaign_id=(SELECT campaign_id FROM branches WHERE branch_id=?)').get(state.branchId);
  const base = db.prepare('SELECT * FROM package_entries WHERE world_id=? AND revision=?').all(campaign.world_id, campaign.package_revision).map(r => ({
    entryId: r.entry_id, kind: r.kind, definition: JSON.parse(r.definition_json), visibility: r.visibility,
  }));
  const segments = db.prepare('SELECT artifact_json FROM world_segment_artifacts').all().map(r => JSON.parse(r.artifact_json))
    .filter(a => state.segmentContentBinding.artifactIds.includes(a.artifactId));
  const catalog = [...new Map([...base, ...segments.flatMap(a => a.entries)].map(e => [e.entryId, e])).values()];
  const templates = campaignActorPreparationTemplates({ state, artifacts, entries: catalog,
    worldTimeOrder: Math.max(JSON.parse(campaign.anchor_json).worldTimeOrder, state.causalWorldTimeOrder ?? 0) });
  const simulated = structuredClone(state);
  simulated.branchId = 'offline-new-branch';
  const player = state.party.find(p => p.controller === 'player').actorId;
  for (const entry of templates) {
    if ((state.cards ?? []).some(c => c.card.templateId === entry.entryId)) continue;
    const card = createTemplateCard({ actorId: `npc-${entry.entryId}`, worldId: campaign.world_id,
      worldPackageRevision: campaign.package_revision, templateId: entry.entryId, definition: entry.definition, controller: 'gm', kind: 'npc' });
    simulated.cards.push({ actorId: card.actorId, card });
    simulated.actors[card.actorId] = { actorId: card.actorId, locationId: state.actors[player].locationId,
      resources: { ...card.resourceMax }, conditions: [], lifeStatus: 'active' };
  }
  assert.equal(campaignCompletionRewardBlocker({ state: simulated, plan, artifacts, situationId: situation.entryId, method }), null);
  const grades = ['full_success', 'success', 'failure', 'severe_failure'];
  const outcomes = {};
  for (const grade of grades) {
    const nextState = applyEffects(simulated, contract.outcomes[grade].effects, contract.timeCostMinutes);
    settleCampaignProgress({ nextState, turnId: `offline-new-${grade}`, nextStateVersion: simulated.stateVersion + 1,
      action: { contract: { ...contract, turnId: `offline-new-${grade}` }, grade }, transactionEvents: [], plan, artifacts,
      historyEvents: db.prepare('SELECT * FROM branch_events WHERE branch_id=?').all(state.branchId).map(r => ({
        eventType: r.event_type, payload: JSON.parse(r.payload_json), eventKey: String(r.event_seq), stateVersion: r.state_version,
      })) });
    outcomes[grade] = nextState.campaignRuntime.nodeStates.find(n => n.nodeId === situation.nodeId).status;
    if (grade === 'success') {
      assert.equal(outcomes[grade], 'succeeded');
      assert.ok(nextState.relationships.some(r => r.fromActorId === player && r.closeness >= 2), 'completion relationship reward remains applied');
    }
  }
  const candidate = db.prepare("SELECT raw_response_text,validation_errors_json,job_id FROM campaign_plan_candidates WHERE validation_errors_json LIKE '%cons-settlement%'").get();
  const errors = JSON.parse(candidate.validation_errors_json);
  const model = extractJsonObject(candidate.raw_response_text);
  const guidance = buildStructuralRepairGuidance(errors, model);
  assert.match(guidance, /consequence cons-crest-truth/);
  assert.match(guidance, /consequence cons-settlement/);
  assert.match(guidance, /距排程节点至少两段）：stage-5, stage-6/);
  assert.match(guidance, /knowledge_known/);
  assert.match(guidance, /settlement_secured/);
  console.log(JSON.stringify({ snapshotQuickCheck: 'ok', originalJ1Version: 70, originalTurnFrozen: true,
    originalActorBlocker: blocker, preparationHasLegalTemplates: templates.length > 0, simulatedGradeSettlement: outcomes,
    exactRejectedCandidateDiagnostics: errors[0].split('; ').length,
    candidateBranchMatchesHandoffJ2: db.prepare('SELECT branch_id FROM campaign_plan_jobs WHERE job_id=?').get(candidate.job_id).branch_id === 'camp-mv3khpat-main',
    exactRepairGuidance: 'PASS', providerRequests: 0 }));
} finally {
  db.close();
  assert.equal(digest(), beforeHash, 'the exact evidence file is immutable');
}
