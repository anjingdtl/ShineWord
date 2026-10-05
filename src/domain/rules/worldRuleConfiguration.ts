/**
 * World rule configuration (P8-6, plan §7): the single contract a world
 * package uses to select trusted mechanisms, their bounded parameters, its
 * vocabulary and its rule constraints. A published configuration is
 * immutable; campaigns lock it at creation via the RuleBinding hash.
 */

import { resolveModuleComposition } from './moduleRegistry';

export const WORLD_RULE_CONFIG_SCHEMA = 'world-rule-config-1';

/** Bounded parameter value types — no free-form scripts anywhere. */
export type RuleParameterValue = string | number | boolean;

export interface RuleParameterSpec {
  key: string;
  type: 'string' | 'number' | 'boolean';
  /** For numbers: inclusive bounds. For strings: allowed enum values. */
  minimum?: number;
  maximum?: number;
  enumValues?: readonly string[];
  required: boolean;
}

export interface ModuleParameterSchema {
  schemaId: string;
  parameters: readonly RuleParameterSpec[];
}

/**
 * Bounded parameter schemas for the first-phase modules. Publishing a
 * configuration with parameters outside these schemas fails — the schema is
 * the contract, not documentation (plan §7.1).
 */
export const MODULE_PARAMETER_SCHEMAS: Readonly<Record<string, ModuleParameterSchema>> = {
  'resources_conditions.params-1': {
    schemaId: 'resources_conditions.params-1',
    parameters: [
      { key: 'staminaMax', type: 'number', minimum: 1, maximum: 100, required: false },
      { key: 'hpMax', type: 'number', minimum: 1, maximum: 100, required: false },
    ],
  },
  'skill_actions.params-1': {
    schemaId: 'skill_actions.params-1',
    parameters: [
      { key: 'untrainedPolicy', type: 'string', enumValues: ['forbid'], required: false },
    ],
  },
  'exploration_discovery.params-1': { schemaId: 'exploration_discovery.params-1', parameters: [] },
  'social_relationships.params-1': { schemaId: 'social_relationships.params-1', parameters: [] },
  'combat_zones.params-1': {
    schemaId: 'combat_zones.params-1',
    parameters: [
      { key: 'maxRoundCount', type: 'number', minimum: 4, maximum: 64, required: false },
    ],
  },
  'growth_rest.params-1': {
    schemaId: 'growth_rest.params-1',
    parameters: [
      { key: 'awardPolicy', type: 'string', enumValues: ['risk_success_or_honest_failure', 'milestone_only'], required: false },
    ],
  },
  'situations_causality.params-1': { schemaId: 'situations_causality.params-1', parameters: [] },
  'pressure_track.params-1': {
    schemaId: 'pressure_track.params-1',
    parameters: [
      { key: 'maxLevel', type: 'number', minimum: 1, maximum: 10, required: true },
      { key: 'reliefAmount', type: 'number', minimum: 1, maximum: 5, required: false },
    ],
  },
};

/**
 * Typed rule constraint targets (plan §7.1/B13): a hard constraint names the
 * module capability or action kinds it restricts. Free-text patterns may
 * accompany the typed target as an EXPLANATION, but enforcement is always
 * declared through `targetKinds` — the compiler refuses constraints that
 * would rely on substring matching alone for blocking enforcement.
 */
export interface TypedRuleConstraint {
  constraintId: string;
  name: string;
  description: string;
  enforcement: 'block_action' | 'audit';
  /** Typed targets: action kinds or capability ids from the enabled modules. */
  targetKinds: readonly string[];
  /** Optional human-facing explanation of the restriction (never executed). */
  textExplanation?: string;
  /** Optional bounded condition AST reference for eligibility gating. */
  conditionRef?: { kind: 'resource_minimum' | 'condition_present' | 'flag'; key: string; minimum?: number };
}

export interface RuleConfigProvenance {
  field: string;
  origin: 'explicit' | 'inferred' | 'rule_mapping' | 'design_fill' | 'user_override';
  detail: string;
}

export interface WorldRuleConfiguration {
  schemaVersion: typeof WORLD_RULE_CONFIG_SCHEMA;
  worldId: string;
  revision: number;
  core: { id: 'shineword-core'; version: string };
  modules: ReadonlyArray<{ moduleId: string; version: string; parameters: Readonly<Record<string, RuleParameterValue>> }>;
  vocabulary: Readonly<Record<string, string>>;
  constraints: readonly TypedRuleConstraint[];
  provenance: readonly RuleConfigProvenance[];
  configHash: string;
}

export interface RuleBinding {
  coreId: string;
  coreVersion: string;
  configurationHash: string;
  moduleVersions: ReadonlyArray<{ moduleId: string; version: string }>;
  executableCapabilitiesHash: string;
}

export interface RuleConfigDiagnostic {
  code:
    | 'schema_version'
    | 'core_mismatch'
    | 'module_error'
    | 'parameter_invalid'
    | 'constraint_untyped'
    | 'constraint_unknown_target'
    | 'configuration_hash_mismatch';
  detail: string;
}

/** Validates parameters against the module's bounded schema. */
export function validateModuleParameters(
  moduleId: string,
  parameterSchemaId: string,
  parameters: Readonly<Record<string, RuleParameterValue>>,
): RuleConfigDiagnostic[] {
  const schema = MODULE_PARAMETER_SCHEMAS[parameterSchemaId];
  if (!schema) return [{ code: 'parameter_invalid', detail: `module '${moduleId}' declares unknown parameter schema '${parameterSchemaId}'` }];
  const diagnostics: RuleConfigDiagnostic[] = [];
  for (const spec of schema.parameters) {
    const value = parameters[spec.key];
    if (value === undefined) {
      if (spec.required) diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' missing required parameter '${spec.key}'` });
      continue;
    }
    if (spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' parameter '${spec.key}' must be a finite number` });
        continue;
      }
      if (spec.minimum !== undefined && value < spec.minimum) diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' parameter '${spec.key}' below minimum ${spec.minimum}` });
      if (spec.maximum !== undefined && value > spec.maximum) diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' parameter '${spec.key}' above maximum ${spec.maximum}` });
    } else if (spec.type === 'string') {
      if (typeof value !== 'string') diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' parameter '${spec.key}' must be a string` });
      else if (spec.enumValues && !spec.enumValues.includes(value)) {
        diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' parameter '${spec.key}' must be one of: ${spec.enumValues.join(', ')}` });
      }
    } else if (spec.type === 'boolean' && typeof value !== 'boolean') {
      diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' parameter '${spec.key}' must be a boolean` });
    }
  }
  const knownKeys = new Set(schema.parameters.map(spec => spec.key));
  for (const key of Object.keys(parameters)) {
    if (!knownKeys.has(key)) diagnostics.push({ code: 'parameter_invalid', detail: `module '${moduleId}' received undeclared parameter '${key}'` });
  }
  return diagnostics;
}

/**
 * Validates a configuration against the trusted registry and produces the
 * frozen RuleBinding inputs. Deterministic: same configuration in, same
 * binding out.
 */
export function validateWorldRuleConfiguration(
  config: WorldRuleConfiguration,
  coreVersion: string,
): { ok: boolean; diagnostics: RuleConfigDiagnostic[]; moduleVersions: ReadonlyArray<{ moduleId: string; version: string }> } {
  const diagnostics: RuleConfigDiagnostic[] = [];
  if (!config || typeof config !== 'object' || !config.core || !Array.isArray(config.modules)
    || !Array.isArray(config.constraints) || !Array.isArray(config.provenance) || !config.vocabulary
    || !Number.isSafeInteger(config.revision) || config.revision < 1 || typeof config.worldId !== 'string' || !config.worldId.trim()
    || config.modules.some(m => !m || typeof m.moduleId !== 'string' || !m.parameters || typeof m.parameters !== 'object')
    || config.constraints.some(c => !c || typeof c.constraintId !== 'string' || !['block_action', 'audit'].includes(c.enforcement))) {
    return { ok: false, diagnostics: [{ code: 'schema_version', detail: 'Malformed world rule configuration.' }], moduleVersions: [] };
  }
  if (config.schemaVersion !== WORLD_RULE_CONFIG_SCHEMA) {
    diagnostics.push({ code: 'schema_version', detail: `configuration schema '${String(config.schemaVersion)}' is not '${WORLD_RULE_CONFIG_SCHEMA}'` });
  }
  if (config.core.id !== 'shineword-core' || config.core.version !== coreVersion) {
    diagnostics.push({ code: 'core_mismatch', detail: `configuration targets core '${config.core.id}@${config.core.version}', this runtime registers 'shineword-core@${coreVersion}'` });
  }
  const composition = resolveModuleComposition(config.modules);
  for (const error of composition.errors) {
    diagnostics.push({ code: 'module_error', detail: `${error.code}: ${error.detail}` });
  }
  for (const module of config.modules) {
    const manifest = composition.ordered.find(item => item.moduleId === module.moduleId);
    if (!manifest) continue;
    diagnostics.push(...validateModuleParameters(module.moduleId, manifest.parameterSchemaId, module.parameters));
  }
  for (const constraint of config.constraints) {
    if (constraint.conditionRef && (!['resource_minimum', 'condition_present', 'flag'].includes(constraint.conditionRef.kind)
      || !constraint.conditionRef.key?.trim() || (constraint.conditionRef.kind === 'resource_minimum'
        && (!Number.isFinite(constraint.conditionRef.minimum) || Number(constraint.conditionRef.minimum) < 0)))) {
      diagnostics.push({ code: 'constraint_untyped', detail: `constraint '${constraint.constraintId}' has invalid conditionRef` });
    }
    if (!constraint.targetKinds || constraint.targetKinds.length === 0) {
      diagnostics.push({ code: 'constraint_untyped', detail: `constraint '${constraint.constraintId}' has no typed targetKinds; text-only blocking is not executable` });
      continue;
    }
    for (const target of constraint.targetKinds) {
      const supported = composition.ordered.some(module => module.capabilities.includes(target))
        || ['observe', 'talk', 'interact', 'move', 'skill_check', 'ability'].includes(target);
      if (!supported) {
        diagnostics.push({ code: 'constraint_unknown_target', detail: `constraint '${constraint.constraintId}' targets unknown kind '${target}'` });
      }
    }
  }
  return { ok: diagnostics.length === 0, diagnostics, moduleVersions: config.modules.map(module => ({ moduleId: module.moduleId, version: module.version })) };
}
