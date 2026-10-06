/**
 * P8-6 acceptance: trusted mechanism registry, world rule configuration
 * compilation and capability closure (plan §6-§8, gates A26/A29/A30).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveModuleComposition,
  getMechanismManifest,
  MODULE_COMPOSITION_ORDER,
} = require('../dist/domain/rules/moduleRegistry');
const {
  computeWorldRuleConfigurationHash,
  compileWorldRuleConfiguration,
} = require('../dist/application/content/ruleConfigCompiler');
const { validateDefinition } = require('../dist/domain/content/types');

function fantasyConfig(overrides = {}) {
  return {
    schemaVersion: 'world-rule-config-1',
    worldId: 'w-fantasy',
    revision: 1,
    core: { id: 'shineword-core', version: '0.4.0' },
    modules: [
      { moduleId: 'resources_conditions', version: '1.0.0', parameters: {} },
      { moduleId: 'skill_actions', version: '1.0.0', parameters: {} },
      { moduleId: 'exploration_discovery', version: '1.0.0', parameters: {} },
      { moduleId: 'social_relationships', version: '1.0.0', parameters: {} },
      { moduleId: 'combat_zones', version: '1.0.0', parameters: {} },
      { moduleId: 'growth_rest', version: '1.0.0', parameters: {} },
      { moduleId: 'situations_causality', version: '1.0.0', parameters: {} },
    ],
    vocabulary: { stamina: '体力', hp: '气血' },
    constraints: [{
      constraintId: 'no-night-combat',
      name: '夜间禁斗',
      description: '入夜后庭院不可开战',
      enforcement: 'block_action',
      targetKinds: ['ability'],
      textExplanation: '宵禁期间巡夜差役会当场拿人',
    }],
    provenance: [],
    configHash: '',
    ...overrides,
  };
}

test('A26: unknown modules, wrong versions and missing dependencies fail composition', () => {
  const unknown = resolveModuleComposition([{ moduleId: 'no-such-module', version: '1.0.0' }]);
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some(e => e.code === 'unknown_module'));

  const wrongVersion = resolveModuleComposition([{ moduleId: 'skill_actions', version: '9.9.9' }]);
  assert.equal(wrongVersion.ok, false);
  assert.ok(wrongVersion.errors.some(e => e.code === 'unsupported_module_version'));

  const missingDep = resolveModuleComposition([{ moduleId: 'skill_actions', version: '1.0.0' }]);
  assert.equal(missingDep.ok, false);
  assert.ok(missingDep.errors.some(e => e.code === 'missing_dependency'));
});

test('composition resolves in the fixed registry order regardless of selection order', () => {
  const a = resolveModuleComposition([
    { moduleId: 'pressure_track', version: '1.0.0' },
    { moduleId: 'situations_causality', version: '1.0.0' },
    { moduleId: 'resources_conditions', version: '1.0.0' },
  ]);
  const b = resolveModuleComposition([
    { moduleId: 'resources_conditions', version: '1.0.0' },
    { moduleId: 'situations_causality', version: '1.0.0' },
    { moduleId: 'pressure_track', version: '1.0.0' },
  ]);
  assert.equal(a.ok, true);
  assert.deepEqual(
    a.ordered.map(m => m.moduleId),
    MODULE_COMPOSITION_ORDER.filter(id => ['resources_conditions', 'situations_causality', 'pressure_track'].includes(id)),
  );
  assert.deepEqual(a.ordered.map(m => m.moduleId), b.ordered.map(m => m.moduleId),
    'selection order must not influence composition order');
});

test('A26: a fantasy configuration compiles to a deterministic binding, capability table and projection', () => {
  const config = fantasyConfig();
  config.configHash = computeWorldRuleConfigurationHash(config);
  const compiled = compileWorldRuleConfiguration(config);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.binding.coreVersion, '0.4.0');
  assert.equal(compiled.binding.configurationHash, config.configHash);
  const capabilities = compiled.capabilityTable.capabilities;
  assert.ok(capabilities.includes('encounter_begin'), 'combat enabled');
  const again = compileWorldRuleConfiguration(config);
  assert.equal(again.binding.executableCapabilitiesHash, compiled.binding.executableCapabilitiesHash,
    'identical configurations produce identical capability tables');
  assert.ok(compiled.publicProjection.modules.some(m => m.moduleId === 'combat_zones'));
  assert.ok(compiled.publicProjection.rules.some(r => r.text.includes('夜间禁斗')));
});

test('A26: parameter violations and untyped constraints block publication with per-entry diagnostics', () => {
  const badParams = fantasyConfig({
    modules: [
      { moduleId: 'resources_conditions', version: '1.0.0', parameters: {} },
      { moduleId: 'pressure_track', version: '1.0.0', parameters: { maxLevel: 99 } },
    ],
  });
  const paramResult = compileWorldRuleConfiguration(badParams);
  assert.equal(paramResult.ok, false);
  assert.ok(paramResult.diagnostics.some(d => d.code === 'parameter_invalid' && d.detail.includes('maxLevel')));

  const undeclared = fantasyConfig({
    modules: [{ moduleId: 'resources_conditions', version: '1.0.0', parameters: { mystery: 1 } }],
  });
  const undeclaredResult = compileWorldRuleConfiguration(undeclared);
  assert.equal(undeclaredResult.ok, false);
  assert.ok(undeclaredResult.diagnostics.some(d => d.code === 'parameter_invalid' && d.detail.includes('mystery')));

  const untyped = fantasyConfig({
    constraints: [{
      constraintId: 'text-only', name: '仅文本', description: '只给一句描述',
      enforcement: 'block_action', targetKinds: [],
    }],
  });
  const untypedResult = compileWorldRuleConfiguration(untyped);
  assert.equal(untypedResult.ok, false);
  assert.ok(untypedResult.diagnostics.some(d => d.code === 'constraint_untyped'),
    'text-only blocking constraints are not executable and must fail (B13)');

  const unknownTarget = fantasyConfig({
    constraints: [{
      constraintId: 'bad-target', name: '未知目标', description: 'x',
      enforcement: 'block_action', targetKinds: ['teleport'],
    }],
  });
  const unknownResult = compileWorldRuleConfiguration(unknownTarget);
  assert.equal(unknownResult.ok, false);
  assert.ok(unknownResult.diagnostics.some(d => d.code === 'constraint_unknown_target'));
});

test('A29: abilities referencing non-executable effect ops are refused at publication', () => {
  const def = {
    name: '隐身术', description: '消失', attribute: 'agility',
    effects: [{ op: 'reveal_information' }],
    range: 'self', targetPolicy: 'self', costs: {}, requiresRoll: false,
  };
  const errors = validateDefinition('ability', def);
  assert.ok(errors.some(e => e.includes('not executable in this build')),
    'publication must refuse schema-expressible but non-executable effects');
  assert.ok(!errors.some(e => e.includes('unknown effect op')),
    'the diagnostic names the closure reason, not just an unknown-op error');

  const executable = {
    name: '治疗术', description: '回复', attribute: 'knowledge',
    effects: [{ op: 'restore_resource', resource: 'hp', amount: 2 }],
    range: 'touch', targetPolicy: 'single_ally', costs: { stamina: 1 }, requiresRoll: false,
  };
  assert.deepEqual(validateDefinition('ability', executable), []);
});

test('A28 groundwork: a suspense-world config without combat compiles and omits combat capabilities', () => {
  const suspense = fantasyConfig({
    worldId: 'w-suspense',
    modules: [
      { moduleId: 'resources_conditions', version: '1.0.0', parameters: {} },
      { moduleId: 'skill_actions', version: '1.0.0', parameters: {} },
      { moduleId: 'exploration_discovery', version: '1.0.0', parameters: {} },
      { moduleId: 'social_relationships', version: '1.0.0', parameters: {} },
      { moduleId: 'situations_causality', version: '1.0.0', parameters: {} },
      { moduleId: 'pressure_track', version: '1.0.0', parameters: { maxLevel: 5, reliefAmount: 2 } },
    ],
  });
  suspense.configHash = computeWorldRuleConfigurationHash(suspense);
  const compiled = compileWorldRuleConfiguration(suspense);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.ok(!compiled.capabilityTable.capabilities.includes('encounter_begin'),
    'a world with combat_zones disabled has no combat capabilities');
  assert.ok(compiled.capabilityTable.capabilities.includes('pressure_raise'),
    'the optional pressure_track module contributes its capabilities');
});
