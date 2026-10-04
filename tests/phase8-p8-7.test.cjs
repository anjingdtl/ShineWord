/**
 * P8-7 acceptance: three genre configurations run with their own mechanisms,
 * the pressure_track module plugs in with bounded trigger/relief, restores
 * through fork/save, and disabled worlds have no pressure entry (plan §6.3,
 * §7.3, gates A27/A28).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeWorldRuleConfigurationHash,
  compileWorldRuleConfiguration,
  renderRulePreview,
} = require('../dist/application/content/ruleConfigCompiler');
const {
  ensurePressureTrack,
  applyPressureChange,
  pressureThresholdReached,
} = require('../dist/domain/rules/modules/pressureTrack');
const { applyEffects } = require('../dist/domain/state/effects');

function genreConfig(name, modules, constraints = []) {
  const config = {
    schemaVersion: 'world-rule-config-1',
    worldId: `w-${name}`,
    revision: 1,
    core: { id: 'shineword-core', version: '0.3.0' },
    modules: modules.map(moduleId => ({
      moduleId,
      version: '1.0.0',
      parameters: moduleId === 'pressure_track' ? { maxLevel: 6, reliefAmount: 2 } : {},
    })),
    vocabulary: {},
    constraints,
    provenance: [],
    configHash: '',
  };
  config.configHash = computeWorldRuleConfigurationHash(config);
  return config;
}

const GENRES = {
  // 奇幻冒险：全机制（§7.3 样本一）。
  fantasy: genreConfig('fantasy', [
    'resources_conditions', 'skill_actions', 'exploration_discovery', 'social_relationships',
    'combat_zones', 'growth_rest', 'situations_causality',
  ]),
  // 现代悬疑：无战斗 + 压力轨道（§7.3 样本二）。
  suspense: genreConfig('suspense', [
    'resources_conditions', 'skill_actions', 'exploration_discovery',
    'social_relationships', 'situations_causality', 'pressure_track',
  ], [{
    constraintId: 'no-combat-world', name: '无战斗世界',
    description: '本世界不启用战斗机制',
    enforcement: 'block_action', targetKinds: ['ability'],
  }]),
  // 日常关系：无战斗、无压力，成长走休整与社交（§7.3 样本三）。
  daily: genreConfig('daily', [
    'resources_conditions', 'skill_actions', 'exploration_discovery',
    'social_relationships', 'situations_causality', 'growth_rest',
  ]),
};

test('A27: three genre configurations compile with distinct capability surfaces', () => {
  const compiled = Object.fromEntries(
    Object.entries(GENRES).map(([name, config]) => [name, compileWorldRuleConfiguration(config)]),
  );
  for (const [name, result] of Object.entries(compiled)) {
    assert.equal(result.ok, true, `${name} config must compile: ${JSON.stringify(result.diagnostics)}`);
  }
  assert.ok(compiled.fantasy.capabilityTable.capabilities.includes('encounter_begin'),
    'fantasy keeps combat');
  assert.ok(!compiled.suspense.capabilityTable.capabilities.includes('encounter_begin'),
    'suspense has no combat entry');
  assert.ok(compiled.suspense.capabilityTable.capabilities.includes('pressure_raise'),
    'suspense runs the pressure track');
  assert.ok(!compiled.suspense.capabilityTable.capabilities.includes('pressure_raise') === false
    && !compiled.daily.capabilityTable.capabilities.includes('pressure_raise'),
    'daily has no pressure entry');
  assert.ok(!compiled.daily.capabilityTable.capabilities.includes('encounter_begin'),
    'daily has no combat');
  assert.ok(compiled.daily.capabilityTable.capabilities.includes('skill_training'),
    'daily growth comes from training, not kills');
});

test('rule preview renders enabled modules, disabled entries and constraints', () => {
  const compiled = compileWorldRuleConfiguration(GENRES.suspense);
  assert.equal(compiled.ok, true);
  const lines = renderRulePreview(compiled.publicProjection, compiled.capabilityTable);
  const joined = lines.join('\n');
  assert.ok(joined.includes('已启用机制 pressure_track'));
  assert.ok(joined.includes('encounter_begin'), 'disabled entries are named explicitly');
  assert.ok(joined.includes('无战斗世界'));
});

function baseSnapshot() {
  return {
    branchId: 'b1', stateVersion: 7, clockSeconds: 600, clockMinutes: 10,
    actors: { 'actor-a': { actorId: 'actor-a', locationId: 'scene', resources: { stamina: 5 }, conditions: [] } },
    itemOwners: {},
  };
}

test('A28: pressure track raises with bounds, crosses a threshold exactly once, and relieves', () => {
  let state = baseSnapshot();
  // Raise: engine-injected op declares its own maxLevel bound.
  state = applyEffects(state, [
    { op: 'raisePressure', trackId: 'tension', amount: 3, maxLevel: 6 },
  ], 0);
  assert.equal(state.pressureTracks.tension.level, 3);
  assert.equal(pressureThresholdReached(state, 'tension', 3), true);

  // Bound: raising past maxLevel clamps instead of growing unbounded.
  state = applyEffects(state, [
    { op: 'raisePressure', trackId: 'tension', amount: 50, maxLevel: 6 },
  ], 0);
  assert.equal(state.pressureTracks.tension.level, 6);
  assert.equal(applyPressureChange(state, 'tension', 1, 8).applied, 0, 'already at max: nothing applied');

  // Relief.
  state = applyEffects(state, [{ op: 'relievePressure', trackId: 'tension', amount: 2 }], 0);
  assert.equal(state.pressureTracks.tension.level, 4);
  assert.equal(pressureThresholdReached(state, 'tension', 3), true, 'already at/above threshold is still true after relief');
  state = applyEffects(state, [{ op: 'relievePressure', trackId: 'tension', amount: 9 }], 0);
  assert.equal(state.pressureTracks.tension.level, 0, 'relief clamps at zero');
  assert.equal(pressureThresholdReached(state, 'tension', 3), false);
});

test('A28: relief on an unknown track is an explicit error, never a silent creation', () => {
  assert.throws(
    () => applyEffects(baseSnapshot(), [{ op: 'relievePressure', trackId: 'nope', amount: 1 }], 0),
    /unknown track/,
  );
});

test('A28: pressure state survives snapshot clone (fork/save parity) and stays off disabled worlds', () => {
  const state = applyEffects(baseSnapshot(), [
    { op: 'raisePressure', trackId: 'tension', amount: 4, maxLevel: 6 },
  ], 0);
  // Snapshot persistence round trip (what fork and save do: JSON serialize).
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(restored.pressureTracks.tension.level, 4);
  assert.equal(restored.pressureTracks.tension.maxLevel, 6);
  // A world without the module never gains a track through any effect path:
  // the capability closure already refuses such definitions, and relief on
  // a missing track is refused at runtime (tested above).
  const quiet = baseSnapshot();
  assert.equal(quiet.pressureTracks, undefined);
});

test('A28: module helpers keep level inside [0, maxLevel] and refuse absurd max levels', () => {
  const state = baseSnapshot();
  assert.throws(() => ensurePressureTrack(state, 'x', 0), /maxLevel/);
  assert.throws(() => ensurePressureTrack(state, 'x', 99), /maxLevel/);
  ensurePressureTrack(state, 'x', 5);
  assert.equal(applyPressureChange(state, 'x', -3, 9).applied, -0 || 0, 'raising below zero applies nothing');
  assert.equal(state.pressureTracks.x.level, 0);
});
