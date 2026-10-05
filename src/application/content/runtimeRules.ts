import type { WorldRuleConfiguration, RuleBinding } from '../../domain/rules/worldRuleConfiguration';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { EffectOperation, ActionContract } from '../../domain/turns/types';
import type { ContentEntry, AbilityDefinition } from '../../domain/content/types';
import { SHINEWORD_RULESET_VERSION } from '../../domain/rules/ruleset';
import { compileWorldRuleConfiguration, computeWorldRuleConfigurationHash, type CompiledWorldRuleConfiguration } from './ruleConfigCompiler';

export type WorldRulePreset = 'fantasy' | 'suspense' | 'daily';

/** Explicit new-project preset; never used to repair an old package/state. */
export function createWorldRuleConfiguration(worldId: string, revision: number,
  preset: WorldRulePreset = 'fantasy'): WorldRuleConfiguration {
  const ids = ['resources_conditions', 'skill_actions', 'exploration_discovery', 'social_relationships',
    ...(preset === 'fantasy' ? ['combat_zones'] : []), 'growth_rest', 'situations_causality',
    ...(preset === 'suspense' ? ['pressure_track'] : [])];
  const config: WorldRuleConfiguration = { schemaVersion: 'world-rule-config-1', worldId, revision,
    core: { id: 'shineword-core', version: SHINEWORD_RULESET_VERSION },
    modules: ids.map((moduleId): WorldRuleConfiguration['modules'][number] => ({ moduleId, version: '1.0.0', parameters: moduleId === 'pressure_track'
      ? { maxLevel: 4, reliefAmount: 2 } : moduleId === 'growth_rest'
        ? { awardPolicy: preset === 'daily' ? 'milestone_only' : 'risk_success_or_honest_failure' } : {} })),
    vocabulary: { hp: '生命', stamina: '体力', tension: '警戒' }, constraints: [],
    provenance: [{ field: 'modules', origin: 'design_fill', detail: `开发默认规则预设（设计补全，可由用户修改）：${preset}` }], configHash: '' };
  config.configHash = computeWorldRuleConfigurationHash(config);
  return config;
}

export function requireCompiledRules(configuration: WorldRuleConfiguration | undefined): CompiledWorldRuleConfiguration & {
  binding: RuleBinding; capabilityTable: NonNullable<CompiledWorldRuleConfiguration['capabilityTable']>;
  publicProjection: NonNullable<CompiledWorldRuleConfiguration['publicProjection']>;
} {
  if (!configuration) throw new Error('World rule configuration is missing; current projects must lock an explicit configuration.');
  const compiled = compileWorldRuleConfiguration(configuration);
  if (!compiled.ok || !compiled.binding || !compiled.capabilityTable || !compiled.publicProjection) {
    throw new Error(`World rule configuration is invalid: ${compiled.diagnostics.map(d => d.detail).join('; ')}`);
  }
  return compiled as ReturnType<typeof requireCompiledRules>;
}

export function assertModuleEnabled(state: GameStateSnapshot, moduleId: string): void {
  const rules = requireCompiledRules(state.ruleConfiguration);
  if (!rules.binding.moduleVersions.some(module => module.moduleId === moduleId)) {
    throw new Error(`当前世界未启用机制 ${moduleId}，该行动不可用。`);
  }
}

export function assertRuleEffects(state: GameStateSnapshot, effects: readonly EffectOperation[]): void {
  if (!state.ruleConfiguration) return; // Standalone reducer has no campaign; production gates require the binding.
  const rules = requireCompiledRules(state.ruleConfiguration);
  const enabled = new Set(rules.binding.moduleVersions.map(m => m.moduleId));
  for (const effect of effects) {
    const moduleId = effect.op === 'raisePressure' || effect.op === 'relievePressure' ? 'pressure_track'
      : effect.op === 'changeLocation' ? 'exploration_discovery' : null;
    if (moduleId && !enabled.has(moduleId)) throw new Error(`Effect ${effect.op} requires disabled module ${moduleId}.`);
  }
}

export function bindRuleContract(contract: ActionContract, state: GameStateSnapshot): ActionContract {
  if (!state.ruleConfiguration) return contract;
  const binding = requireCompiledRules(state.ruleConfiguration).binding;
  if (contract.ruleBinding && contract.ruleBinding.configurationHash !== binding.configurationHash) {
    throw new Error('Action contract rule binding differs from the locked campaign.');
  }
  return { ...contract, ruleBinding: binding };
}

/** Typed gates are checked for API calls as well as visible action entries. */
export function assertRuleAction(state: GameStateSnapshot, kind: string, actorId: string): void {
  if (!state.ruleConfiguration) return;
  const rules = requireCompiledRules(state.ruleConfiguration);
  const capabilityByAction: Record<string, string> = { skill_check: 'skill_check', ability: 'resource_spend', talk: 'talk_action',
    move: 'move_location', short_rest: 'short_rest', long_rest: 'long_rest', rest: 'short_rest', train: 'skill_training',
    milestone: 'milestone_award', recruit: 'recruit_companion', dismiss: 'recruit_companion',
    companion_recruited:'recruit_companion', companion_rejoined:'recruit_companion', companion_left:'recruit_companion',
    companion_directive_changed:'recruit_companion', party_split:'recruit_companion',
    encounter_begin:'encounter_begin',encounter_join_queue:'initiative_queue',guard:'npc_turn',rescue:'rescue',retreat:'retreat',dash:'zone_move',
    knowledge_shared:'discover_entry',source_knowledge_recorded:'discover_entry',item_transferred:'resource_spend' };
  if (kind === 'move' && state.encounters?.some(e => e.state.status === 'active')) capabilityByAction.move = 'zone_move';
  const capability = capabilityByAction[kind] ?? (rules.capabilityTable.capabilities.includes(kind) ? kind : undefined);
  if ((['observe', 'interact', 'talk', 'move', 'skill_check', 'ability'].includes(kind) && !rules.capabilityTable.actionKinds.includes(kind))
    || (capability && !rules.capabilityTable.capabilities.includes(capability))) throw new Error(`当前世界未启用 ${kind} 行动。`);
  for (const constraint of rules.capabilityTable.constraints) {
    if (constraint.enforcement !== 'block_action' || !constraint.targetKinds.some(t => t === kind || t === capability)) continue;
    const condition = constraint.conditionRef;
    const actor = state.actors[actorId];
    const triggered = !condition || (condition.kind === 'resource_minimum'
      ? (actor?.resources[condition.key] ?? 0) < (condition.minimum ?? 0)
      : condition.kind === 'condition_present' ? actor?.conditions.includes(condition.key)
        : state.worldRuleFlags?.[condition.key] === true);
    if (triggered) throw new Error(`行动被世界规则 ${constraint.constraintId} 阻止。`);
  }
}

export function validateRuleEntryCapabilities(entries: readonly ContentEntry[], rules: ReturnType<typeof requireCompiledRules>): string[] {
  const errors: string[] = [];
  const enabled = new Set(rules.binding.moduleVersions.map(m => m.moduleId));
  for (const entry of entries) {
    if (entry.kind === 'skill' && !enabled.has('skill_actions')) errors.push(`${entry.entryId}: skill_actions is disabled`);
    if (entry.kind === 'situation' && !enabled.has('situations_causality')) errors.push(`${entry.entryId}: situations_causality is disabled`);
    if (entry.kind === 'constraint' && (entry.definition as { enforcement: string }).enforcement !== 'audit') {
      errors.push(`${entry.entryId}: blocking constraints must use ruleConfiguration.constraints with typed targets`);
    }
    if (entry.kind === 'scene' && !enabled.has('combat_zones')) {
      const encounter = (entry.definition as { encounterParticipants?: { hostiles?: unknown[] } }).encounterParticipants;
      if (encounter?.hostiles?.length) errors.push(`${entry.entryId}: hostile encounter requires combat_zones`);
    }
    if (entry.kind !== 'ability') continue;
    const ability = entry.definition as AbilityDefinition;
    for (const effect of ability.effects) {
      if (!rules.capabilityTable.abilityEffectOps.includes(effect.op)) errors.push(`${entry.entryId}: effect ${effect.op} is not executable`);
      if (effect.op === 'damage' && !enabled.has('combat_zones')) errors.push(`${entry.entryId}: damage requires combat_zones`);
    }
    if (ability.targetPolicy === 'area') errors.push(`${entry.entryId}: area targets are not implemented`);
  }
  return errors;
}
