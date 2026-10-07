/**
 * Phase 9 replan/fork/goal tests (P9-5): local trigger evaluation, single-
 * flight job enqueue, stable-boundary adoption with CAS revalidation,
 * goal change management commit and branch isolation on fork (A18/A20/A21/A31).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel } = require('./helpers/phase9CampaignFixture.cjs');

const { evaluateReplanTriggers, adoptReplanCandidate } = require('../dist/application/campaignPlan/replanService');
const { forkBranch } = require('../dist/application/branch/fork');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');

test('P9-5: local trigger evaluation is deterministic and never fires on idle play', async () => {
  const h = await fixture();
  try {
    const state = await h.turns.getState(h.branchId);
    const context = await h.session.getCampaignProgress(h.campaignId, h.branchId);
    assert.ok(context, 'progress projection available');
    assert.equal(context.status, 'active');
    assert.equal(context.completedStages.length, 0);

    // Idle evaluation: no reasons on a healthy campaign.
    const runtime = state.campaignRuntime;
    const planRow = await h.adapter.queryOne(
      'SELECT plan_json FROM campaign_plan_revisions WHERE plan_id=? AND revision=?',
      [runtime.planBinding.planId, runtime.planBinding.revision]);
    const plan = JSON.parse(planRow.plan_json);
    assert.deepEqual(evaluateReplanTriggers({ plan, runtime, state }), []);

    // A dead actor referenced by FUTURE main nodes flips the trigger.
    const deadState = {
      ...state,
      actors: { ...state.actors, pc: { ...state.actors.pc, lifeStatus: 'dead' } },
    };
    // pc is not referenced by node conditions; craft a state where a future
    // node's referenced actor (via condition on tpl alias) is dead.
    const withActor = {
      ...state,
      actors: { ...state.actors, 'npc-tpl-lin': { actorId: 'npc-tpl-lin', locationId: '青石巷', resources: { hp: 0 }, conditions: [], lifeStatus: 'dead' } },
    };
    void deadState;
    const reasons = evaluateReplanTriggers({ plan, runtime, state: withActor });
    // stage-2 completion is event-based; no actor conditions on future nodes
    // in this fixture ⇒ no trigger. Actor-fate triggering is proven by the
    // direct construction below.
    const actorConditionPlan = {
      ...plan,
      nodes: plan.nodes.map(node => node.nodeId === 'stage-2'
        ? { ...node, completion: { kind: 'actor_alive', actorId: 'npc-tpl-lin' } }
        : node),
    };
    const reasonsWithActorCondition = evaluateReplanTriggers({ plan: actorConditionPlan, runtime, state: withActor });
    assert.ok(reasonsWithActorCondition.includes('critical_actor_fate'), 'future-node actor death fires the trigger');
    const templateAliasPlan = { ...plan, nodes: plan.nodes.map(node => node.nodeId === 'stage-2'
      ? { ...node, completion: { kind: 'actor_alive', actorId: 'tpl-lin' } } : node) };
    assert.ok(evaluateReplanTriggers({ plan: templateAliasPlan, runtime, state: withActor }).includes('critical_actor_fate'));
    const rescued = { ...withActor, actors: { ...withActor.actors, 'npc-tpl-lin': { ...withActor.actors['npc-tpl-lin'], resources: { hp: 2 }, lifeStatus: 'active' } } };
    assert.ok(!evaluateReplanTriggers({ plan: templateAliasPlan, runtime, state: rescued }).includes('critical_actor_fate'), 'current survival overrides an earlier planned fate');

    // Primary failure fires its trigger.
    const failedRuntime = {
      ...runtime,
      nodeStates: runtime.nodeStates.map(node => node.nodeId === 'stage-1' ? { ...node, status: 'failed' } : node),
      primaryNodeId: 'stage-1',
    };
    assert.ok(evaluateReplanTriggers({ plan, runtime: failedRuntime, state }).includes('primary_node_failed'));
    // Early resolution fires its trigger.
    const earlyRuntime = {
      ...runtime,
      nodeStates: runtime.nodeStates.map(node => node.nodeId === 'stage-1' ? { ...node, status: 'superseded', supersedeReason: 'skipped_by_early_completion' } : node),
    };
    assert.ok(evaluateReplanTriggers({ plan, runtime: earlyRuntime, state }).includes('early_resolution'));
    // Ended campaigns never replan.
    const endedRuntime = { ...runtime, campaignStatus: 'completed' };
    assert.deepEqual(evaluateReplanTriggers({ plan, runtime: endedRuntime, state }), []);
  } finally {
    h.db.close();
  }
});

test('P9-5: goal change is a management commit with event + single-flight replan; play stays legal (A18/A20)', async () => {
  const h = await fixture();
  try {
    const before = await h.turns.getState(h.branchId);
    const change = await h.session.changeCampaignGoal({
      campaignId: h.campaignId, branchId: h.branchId,
      newGoal: '护送林凡离开青石巷', newRawIntent: '护送林凡离开',
    });
    assert.equal(change.intentRevision, before.campaignRuntime.intentRevision + 1);
    assert.equal(change.replanEnqueued, true);

    const after = await h.turns.getState(h.branchId);
    assert.equal(after.stateVersion, before.stateVersion + 1, 'management commit advanced the version');
    assert.equal(after.campaignRuntime.intentRevision, change.intentRevision);
    assert.ok(after.campaignRuntime.replanReasonCodes.includes('goal_changed'));
    const goalEvent = h.db.prepare(
      "SELECT payload_json FROM branch_events WHERE branch_id=? AND event_type='campaign_goal_changed'").get(h.branchId);
    assert.ok(goalEvent, 'goal change lands as a branch event');

    // Exactly ONE replan job exists for this branch (single-flight).
    const jobs = h.db.prepare(
      "SELECT job_id, status, trigger_reasons_json FROM campaign_plan_jobs WHERE branch_id=? AND job_kind='replan'").all(h.branchId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'queued');
    assert.deepEqual(JSON.parse(jobs[0].trigger_reasons_json), ['goal_changed']);

    // Legal play remains available after the goal change.
    const turn = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '查看周围的情况' });
    assert.ok(turn.turnId, 'play continues while the replan is queued');

    // A second goal change merges into the SAME queued job.
    await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: h.branchId, newGoal: '先确保自己安全' });
    const jobsAfter = h.db.prepare(
      "SELECT job_id FROM campaign_plan_jobs WHERE branch_id=? AND job_kind='replan'").all(h.branchId);
    assert.equal(jobsAfter.length, 1, 'duplicate trigger absorbed (A21)');
  } finally {
    h.db.close();
  }
});

test('P9-5: adoptReplanCandidate refuses while a turn is in flight and stales against a moved-on base (A20)', async () => {
  const h = await fixture();
  try {
    // Simulate a ready replan candidate compiled against revision 1.
    const runtime = (await h.turns.getState(h.branchId)).campaignRuntime;
    const planRow = await h.adapter.queryOne('SELECT plan_json FROM campaign_plan_revisions WHERE plan_id=?', [runtime.planBinding.planId]);
    const plan = JSON.parse(planRow.plan_json);
    const artifactRow = await h.adapter.queryOne('SELECT artifact_json FROM campaign_content_artifacts WHERE artifact_id=?', [plan.contentArtifactRefs[0]]);
    const candidateId = 'cand-replan-1';
    const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
    const artifact = { ...JSON.parse(artifactRow.artifact_json), artifactId: 'artifact-replan-1', planRevision: 2 };
    const nextPlan = { ...plan, revision: 2, parentRevision: 1, contentArtifactRefs: [artifact.artifactId] };
    for (const value of [artifact, nextPlan]) {
      const { contentHash, ...body } = value;
      value.contentHash = sha256HexOf(canonicalJsonOf(body));
    }
    const candidateHash = sha256HexOf(canonicalJsonOf({ plan: nextPlan, artifact }));
    await h.planStore.insertJob({
      jobId: 'job-replan-1', setupId: 'replan:c-t', campaignId: h.campaignId, branchId: h.branchId,
      jobKind: 'replan', triggerReasons: ['goal_changed'],
      baseStateVersion: 0, basePlanId: plan.planId, basePlanRevision: 1, intentHash: plan.intentHash,
      contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
      status: 'candidate_ready', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 1,
      nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    await h.planStore.upsertCandidate({
      candidateId, jobId: 'job-replan-1', setupId: 'replan:c-t', attemptGroup: 'a1', attemptNo: 1,
      stage: 'ready', rawResponseRef: null, rawResponseText: 'fixture', parseResultJson: null,
      validationErrors: [], repairUsed: false, candidateHash,
      plan: nextPlan, artifact,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    // In-flight turn on the branch ⇒ adoption refuses (stable boundary).
    await h.adapter.execute(
      "INSERT INTO turns (branch_id, turn_id, expected_state_version, committed_state_version, status, outcome_grade, public_summary, effects_json, action_contract_json, action_contract_hash, created_at) VALUES (?, 'turn-stale', 0, NULL, 'Planned', NULL, '', '[]', '{}', 'x', ?)",
      [h.branchId, new Date().toISOString()]);
    const refused = await adoptReplanCandidate({
      db: h.adapter, planStore: h.planStore, turns: h.turns,
      campaignId: h.campaignId, branchId: h.branchId, candidateId,
    });
    assert.equal(refused.outcome, 'stale');
    assert.match(refused.reason, /in-flight/);
    await h.adapter.execute('DELETE FROM turns WHERE branch_id=? AND turn_id=?', [h.branchId, 'turn-stale']);

    // Clean boundary with matching base bindings ⇒ adoption commits a new
    // revision and switches the runtime binding in ONE management commit.
    const adopted = await adoptReplanCandidate({
      db: h.adapter, planStore: h.planStore, turns: h.turns,
      campaignId: h.campaignId, branchId: h.branchId, candidateId,
    });
    assert.equal(adopted.outcome, 'adopted', JSON.stringify(adopted));
    assert.equal(adopted.revision, 2);
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.planBinding.revision, 2, 'runtime switched to the adopted revision');
    const planEvent = h.db.prepare(
      "SELECT payload_json FROM branch_events WHERE branch_id=? AND event_type='campaign_plan_adopted'").get(h.branchId);
    assert.ok(planEvent, 'adoption lands as a branch event');
    const revisionRow = await h.planStore.getPlanRevision(plan.planId, 2);
    assert.ok(revisionRow, 'revision 2 archived immutably');

    // A SECOND adoption of the same candidate is stale (job already adopted).
    const replay = await adoptReplanCandidate({
      db: h.adapter, planStore: h.planStore, turns: h.turns,
      campaignId: h.campaignId, branchId: h.branchId, candidateId,
    });
    assert.equal(replay.outcome, 'stale');
  } finally {
    h.db.close();
  }
});

test('P9-5: fork isolates campaign runtime; branches diverge without pollution (A31)', async () => {
  const h = await fixture();
  try {
    // Complete stage-1 on the source branch through route B.
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const source = await h.turns.getState(h.branchId);
    assert.equal(source.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(source.campaignRuntime.grantedRewardKeys.length, 1);

    const gameStore = new SqliteGameStore(h.adapter);
    const forkA = await forkBranch({
      db: h.adapter, turnStore: h.turns, gameStore,
      sourceBranchId: h.branchId, targetBranchId: `${h.branchId}-a`, campaignId: h.campaignId, forkTurnId: null,
      createdAt: new Date().toISOString(),
    });
    const forkB = await forkBranch({
      db: h.adapter, turnStore: h.turns, gameStore,
      sourceBranchId: h.branchId, targetBranchId: `${h.branchId}-b`, campaignId: h.campaignId, forkTurnId: null,
      createdAt: new Date().toISOString(),
    });
    // Both forks rebind the runtime branchId and inherit EXACT progress.
    assert.equal(forkA.snapshot.campaignRuntime.branchId, `${h.branchId}-a`);
    assert.equal(forkB.snapshot.campaignRuntime.branchId, `${h.branchId}-b`);
    assert.equal(forkA.snapshot.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(forkA.snapshot.campaignRuntime.grantedRewardKeys.length, 1, 'inherited grant history blocks re-granting');

    // Branch A changes its goal; branch B stays. No cross-talk.
    await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: `${h.branchId}-a`, newGoal: 'A 线目标' });
    const stateA = await h.turns.getState(`${h.branchId}-a`);
    const stateB = await h.turns.getState(`${h.branchId}-b`);
    assert.ok(stateA.campaignRuntime.replanReasonCodes.includes('goal_changed'));
    assert.ok(!stateB.campaignRuntime.replanReasonCodes.includes('goal_changed'), 'sibling branch unaffected');
    assert.equal(stateA.campaignRuntime.publicObjectiveProjection, 'A 线目标');
    assert.equal(stateB.campaignRuntime.publicObjectiveProjection, source.campaignRuntime.publicObjectiveProjection);

    // Replan jobs are branch-scoped: only branch A has one.
    const jobsA = h.db.prepare("SELECT job_id FROM campaign_plan_jobs WHERE branch_id=?").all(`${h.branchId}-a`);
    const jobsB = h.db.prepare("SELECT job_id FROM campaign_plan_jobs WHERE branch_id=?").all(`${h.branchId}-b`);
    assert.equal(jobsA.length, 1);
    assert.equal(jobsB.length, 0);

    // The source branch's progress is untouched by both forks.
    const sourceAfter = await h.turns.getState(h.branchId);
    assert.equal(sourceAfter.campaignRuntime.intentRevision, source.campaignRuntime.intentRevision);
  } finally {
    h.db.close();
  }
});
