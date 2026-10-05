/**
 * P8-1 acceptance: typed material collection, checkpoint eligibility and
 * the pending bridge (plan §9, gate A01/A02/A03 evidence).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectTypedCandidates,
  buildTypedMaterial,
  typedMaterialToCandidate,
  renderTypedMaterialText,
} = require('../dist/application/context/turnMaterialCollector');
const {
  evaluateCheckpointEligibility,
  buildCoverageManifest,
} = require('../dist/application/memory/storyMemoryEligibility');
const {
  buildPendingBridge,
  renderPendingBridge,
} = require('../dist/application/memory/pendingBridge');
const { planMemoryCoverage } = require('../dist/application/memory/storyMemoryPolicy');

test('typed collector maps the active-situation label onto currentState with mandatory retention', () => {
  const { candidates, diagnostics } = collectTypedCandidates({
    parts: ['【当前局面】粮仓起火（压力：加剧）\n可选介入办法：提水'],
    queryText: '粮仓起火 提水',
  });
  assert.equal(diagnostics.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].board, 'currentState');
  assert.equal(candidates[0].requirement, 'mandatory');
  assert.equal(candidates[0].heading, '当前局面');
  assert.ok(candidates[0].text.includes('粮仓起火'));
});

test('typed collector reports unknown labels as diagnostics instead of dropping silently', () => {
  const { candidates, diagnostics } = collectTypedCandidates({
    parts: ['【世界】边陲镇', '【神秘的未知分区】绝密材料'],
    queryText: '边陲镇',
  });
  assert.equal(candidates.length, 1, 'the mapped part still lands');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'unknown_material_label');
  assert.ok(diagnostics[0].detail.includes('神秘的未知分区'), 'the diagnostic names the dropped input');
});

test('typed materials reject unknown kinds and missing dependencies with diagnostics', () => {
  assert.throws(() => buildTypedMaterial({
    id: 'm-bad',
    kind: 'not_a_kind',
    source: { origin: 'campaign', sourceType: 'test', recordId: 'r' },
    authorityDomain: 'rules',
    visibility: 'party',
    payload: { text: 'x' },
  }), /unknown material kind/);

  const { candidates, diagnostics } = collectTypedCandidates({
    materials: [
      buildTypedMaterial({
        id: 'm-dep',
        kind: 'situation',
        source: { origin: 'campaign', sourceType: 'test', recordId: 'r1' },
        authorityDomain: 'committed_state',
        visibility: 'party',
        dependencies: ['m-missing'],
        payload: { text: '依赖缺失材料' },
      }),
    ],
    queryText: '',
  });
  assert.equal(candidates.length, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'missing_dependency');
});

test('typed material conversion keeps content hash and renders trusted payload text', () => {
  const material = buildTypedMaterial({
    id: 'm1',
    kind: 'world_entry',
    source: { origin: 'world', sourceType: 'world_package', recordId: 'loc-1', revision: '3' },
    authorityDomain: 'world_baseline',
    visibility: 'public',
    payload: { text: '边陲镇位于边境' },
  });
  assert.match(material.contentHash, /^[0-9a-f]+$/);
  assert.equal(renderTypedMaterialText(material), '边陲镇位于边境');
  const candidate = typedMaterialToCandidate(material, '边陲镇');
  assert.equal(candidate.board, 'worldKnowledge');
  assert.equal(candidate.provenance.sourceType, 'world_package');
  assert.equal(candidate.provenance.sourceId, 'loc-1');
});

function memoryState(branchId, through, status = 'clean', fingerprint = 'fp-chain') {
  return {
    schemaVersion: 3,
    branchId,
    throughStateVersion: through,
    characters: {},
    relationships: {},
    narrative: {
      currentArc: null,
      currentObjective: '目标',
      activeConflicts: [],
      openThreads: [],
      foreshadowing: [],
      recentCompletedBeats: [],
      recentResolvedThreads: [],
      archiveDigest: '',
    },
    metadata: { status, dirtyFromStateVersion: null, fingerprint, lastAppliedPatchId: null, updatedAt: '2026-10-04T00:00:00.000Z' },
  };
}

test('checkpoint eligibility accepts a clean same-branch checkpoint with provable coverage', () => {
  const verdict = evaluateCheckpointEligibility({
    memoryState: memoryState('branch-a', 8),
    branchId: 'branch-a',
    currentStateVersion: 12,
    committedTurnVersions: [
      { turnId: 't9', stateVersion: 9 },
      { turnId: 't10', stateVersion: 10 },
      { turnId: 't11', stateVersion: 11 },
      { turnId: 't12', stateVersion: 12 },
    ],
  });
  assert.equal(verdict.usable, true);
  assert.equal(verdict.coverage.throughStateVersion, 8);
  assert.equal(verdict.coverage.contiguous, true);
  assert.equal(verdict.coverage.entries.length, 4);
  assert.ok(verdict.coverage.entries.every(entry => entry.status === 'pending_bridge'));
});

test('checkpoint eligibility rejects future, foreign-branch, dirty, un fingerprinted and gapped checkpoints', () => {
  const future = evaluateCheckpointEligibility({
    memoryState: memoryState('branch-a', 20),
    branchId: 'branch-a',
    currentStateVersion: 15,
    committedTurnVersions: [],
  });
  assert.equal(future.usable, false);
  assert.equal(future.code, 'future_evidence');
  assert.equal(future.checkpoint, undefined);

  const foreign = evaluateCheckpointEligibility({
    memoryState: memoryState('branch-b', 5),
    branchId: 'branch-a',
    currentStateVersion: 15,
  });
  assert.equal(foreign.usable, false);
  assert.equal(foreign.code, 'branch_mismatch');

  const dirty = evaluateCheckpointEligibility({
    memoryState: memoryState('branch-a', 5, 'dirty'),
    branchId: 'branch-a',
    currentStateVersion: 15,
  });
  assert.equal(dirty.usable, false);
  assert.equal(dirty.code, 'status_not_consumable');

  const noFingerprint = evaluateCheckpointEligibility({
    memoryState: memoryState('branch-a', 5, 'clean', 'seed'),
    branchId: 'branch-a',
    currentStateVersion: 15,
  });
  assert.equal(noFingerprint.usable, false);
  assert.equal(noFingerprint.code, 'fingerprint_invalid');

  const gapped = evaluateCheckpointEligibility({
    memoryState: memoryState('branch-a', 5),
    branchId: 'branch-a',
    currentStateVersion: 15,
    committedTurnVersions: [{ turnId: 't15', stateVersion: 15 }],
  });
  assert.equal(gapped.usable, false);
  assert.equal(gapped.code, 'coverage_gap');
});

test('coverage manifest marks missing commits as explicit gaps', () => {
  const manifest = buildCoverageManifest({
    throughStateVersion: 2,
    currentStateVersion: 5,
    committedTurnVersions: [
      { turnId: 't3', stateVersion: 3 },
      { turnId: 't5', stateVersion: 5 },
    ],
  });
  assert.equal(manifest.contiguous, false);
  assert.deepEqual(
    manifest.entries.map(entry => entry.status),
    ['pending_bridge', 'gap', 'pending_bridge'],
  );
});

test('pending bridge enumerates every commit after the checkpoint and renders gap markers', () => {
  const bridge = buildPendingBridge({
    committedTurns: [
      { turnId: 't9', stateVersion: 9, publicSummary: '调查粮仓' },
      { turnId: 't10', stateVersion: 10, publicSummary: '发现火油桶' },
      { turnId: 't12', stateVersion: 12, publicSummary: '村民疏散' },
    ],
    fromStateVersion: 8,
    toStateVersion: 12,
  });
  assert.deepEqual(bridge.commits.map(commit => commit.stateVersion), [9, 10, 12]);
  assert.equal(bridge.gaps.length, 1);
  assert.equal(bridge.gaps[0].fromStateVersion, 11);
  const text = renderPendingBridge(bridge);
  assert.ok(text.includes('t9'));
  assert.ok(text.includes('调查粮仓'));
  assert.ok(text.includes('覆盖缺口'));
  assert.ok(text.includes('v11'));
});

test('planMemoryCoverage keeps its clean/safe_lag/hard_gap contract via the shared bridge', () => {
  const clean = planMemoryCoverage({
    currentStateVersion: 8,
    memoryThroughVersion: 8,
    committedTurns: [],
  });
  assert.equal(clean.mode, 'clean');

  const lag = planMemoryCoverage({
    currentStateVersion: 10,
    memoryThroughVersion: 8,
    committedTurns: [
      { stateVersion: 9, turnId: 't9' },
      { stateVersion: 10, turnId: 't10' },
    ],
  });
  assert.equal(lag.mode, 'safe_lag');
  assert.deepEqual(lag.bridgeTurns.map(turn => turn.stateVersion), [9, 10]);

  const gap = planMemoryCoverage({
    currentStateVersion: 10,
    memoryThroughVersion: 8,
    committedTurns: [{ stateVersion: 10, turnId: 't10' }],
  });
  assert.equal(gap.mode, 'hard_gap');
});
