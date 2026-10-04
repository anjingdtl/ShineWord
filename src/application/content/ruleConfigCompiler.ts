/**
 * Rule configuration compiler (P8-6, plan §7.2/§8.2): validates a world rule
 * configuration against the trusted registry, closes the capability table,
 * and produces the public rule projection shared by the three-treasures
 * book, character cards, action eligibility and the Narrator explanation.
 *
 * Publishing a world that references capabilities outside the enabled
 * modules' table fails with per-entry diagnostics — "schema accepts it but
 * the compiler ignores it" is exactly what this gate forbids (B12/A29).
 */

import {
  WORLD_RULE_CONFIG_SCHEMA,
  validateWorldRuleConfiguration,
  type RuleBinding,
  type WorldRuleConfiguration,
  type RuleConfigDiagnostic,
} from '../../domain/rules/worldRuleConfiguration';
import { SHINEWORD_RULESET_ID, SHINEWORD_RULESET_VERSION } from '../../domain/rules/ruleset';
import { resolveModuleComposition } from '../../domain/rules/moduleRegistry';
import { stableFingerprint } from '../llm/requestPlan';

/** Effect ops the execution compiler actually implements (B12 closure). */
export const EXECUTABLE_ABILITY_EFFECT_OPS: readonly string[] = [
  'damage',
  'heal',
  'restore_resource',
  'consume_resource',
  'apply_condition',
  'remove_condition',
];

export interface ExecutableCapabilityTable {
  coreId: string;
  coreVersion: string;
  configurationHash: string;
  tableHash: string;
  actionKinds: readonly string[];
  abilityEffectOps: readonly string[];
  capabilities: readonly string[];
  /** Constraints enforced locally, with their typed targets. */
  constraints: ReadonlyArray<{
    constraintId: string;
    enforcement: 'block_action' | 'audit';
    targetKinds: readonly string[];
    conditionRef?: { kind: 'resource_minimum' | 'condition_present' | 'flag'; key: string; minimum?: number };
  }>;
}

export interface PublicRuleProjection {
  coreId: string;
  coreVersion: string;
  configurationHash: string;
  /** One entry per enabled module: what it contributes and why. */
  modules: ReadonlyArray<{ moduleId: string; version: string; capabilities: readonly string[] }>;
  /** Public vocabulary: internal id -> world-facing display name. */
  vocabulary: Readonly<Record<string, string>>;
  /** Human-readable rule lines with provenance. */
  rules: ReadonlyArray<{ text: string; origin: string }>;
}

export interface CompiledWorldRuleConfiguration {
  ok: boolean;
  binding: RuleBinding | null;
  capabilityTable: ExecutableCapabilityTable | null;
  publicProjection: PublicRuleProjection | null;
  diagnostics: RuleConfigDiagnostic[];
}

function canonicalConfigurationWithoutHash(config: WorldRuleConfiguration): Record<string, unknown> {
  return { ...config, configHash: '' };
}

export function computeWorldRuleConfigurationHash(config: WorldRuleConfiguration): string {
  return stableFingerprint(canonicalConfigurationWithoutHash(config));
}

/**
 * Human-readable rule preview for the three-treasures book / world build UI
 * (plan §8.1): generated from the published configuration, showing what is
 * enabled, why, what is executable and what is NOT supported. The book's
 * prose never becomes a second rule authority — this preview IS the rule
 * summary, with provenance.
 */
export function renderRulePreview(
  projection: PublicRuleProjection,
  capabilityTable: ExecutableCapabilityTable,
): string[] {
  const lines: string[] = [];
  lines.push(`规则核心 ${projection.coreId}@${projection.coreVersion}（配置 ${projection.configurationHash.slice(0, 12)}…）`);
  for (const module of projection.modules) {
    lines.push(`· 已启用机制 ${module.moduleId} v${module.version}：可执行能力 ${module.capabilities.join('、')}`);
  }
  const disabledCapabilities = ['pressure_raise', 'pressure_relief', 'encounter_begin', 'initiative_queue', 'loot_grant']
    .filter(capability => !capabilityTable.capabilities.includes(capability));
  if (disabledCapabilities.length > 0) {
    lines.push(`· 未启用能力（相应行动入口不可用）：${disabledCapabilities.join('、')}`);
  }
  for (const constraint of capabilityTable.constraints) {
    lines.push(`· 限制 ${constraint.constraintId}：${constraint.enforcement === 'block_action' ? '阻止' : '审计'} ${constraint.targetKinds.join('、')}`);
  }
  for (const rule of projection.rules) {
    if (rule.origin === 'explicit') lines.push(`· ${rule.text}`);
  }
  return lines;
}

/**
 * Compiles (validates + closes) a world rule configuration. Deterministic:
 * identical configurations produce byte-identical bindings and projections.
 */
export function compileWorldRuleConfiguration(
  config: WorldRuleConfiguration,
): CompiledWorldRuleConfiguration {
  const coreVersion = SHINEWORD_RULESET_VERSION;
  const validation = validateWorldRuleConfiguration(config, coreVersion);
  const diagnostics: RuleConfigDiagnostic[] = [...validation.diagnostics];
  if (!validation.ok) {
    return { ok: false, binding: null, capabilityTable: null, publicProjection: null, diagnostics };
  }

  const configurationHash = config.configHash || computeWorldRuleConfigurationHash(config);
  const composition = resolveModuleComposition(config.modules);
  const capabilities = composition.ordered.flatMap(module => module.capabilities);
  const actionKinds = ['observe', 'talk', 'interact', 'move', 'skill_check', 'ability'];
  const capabilityTable: ExecutableCapabilityTable = {
    coreId: SHINEWORD_RULESET_ID,
    coreVersion,
    configurationHash,
    tableHash: stableFingerprint({
      configurationHash,
      actionKinds,
      abilityEffectOps: EXECUTABLE_ABILITY_EFFECT_OPS,
      capabilities: [...new Set(capabilities)],
      constraints: config.constraints,
    }),
    actionKinds,
    abilityEffectOps: EXECUTABLE_ABILITY_EFFECT_OPS,
    capabilities: [...new Set(capabilities)],
    constraints: config.constraints.map(constraint => ({
      constraintId: constraint.constraintId,
      enforcement: constraint.enforcement,
      targetKinds: constraint.targetKinds,
      ...(constraint.conditionRef ? { conditionRef: constraint.conditionRef } : {}),
    })),
  };
  const binding: RuleBinding = {
    coreId: SHINEWORD_RULESET_ID,
    coreVersion,
    configurationHash,
    moduleVersions: validation.moduleVersions,
    executableCapabilitiesHash: capabilityTable.tableHash,
  };
  const publicProjection: PublicRuleProjection = {
    coreId: SHINEWORD_RULESET_ID,
    coreVersion,
    configurationHash,
    modules: composition.ordered.map(module => ({
      moduleId: module.moduleId,
      version: module.version,
      capabilities: [...module.capabilities],
    })),
    vocabulary: config.vocabulary,
    rules: [
      ...composition.ordered.map(module => ({
        text: `启用机制 ${module.moduleId}（v${module.version}）：${module.capabilities.join('、')}`,
        origin: 'rule_mapping',
      })),
      ...config.constraints.map(constraint => ({
        text: `限制「${constraint.name}」作用于 ${constraint.targetKinds.join('、')}（${constraint.enforcement === 'block_action' ? '阻止行动' : '仅审计'}）${constraint.textExplanation ? `：${constraint.textExplanation}` : ''}`,
        origin: 'explicit',
      })),
    ],
  };
  return { ok: true, binding, capabilityTable, publicProjection, diagnostics };
}
