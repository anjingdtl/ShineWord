/**
 * Trusted mechanism registry (P8-6, plan §6): only implementations shipped
 * with the app are registered. World packages select module ids/versions and
 * bounded parameters — they can never contribute code, SQL, providers or
 * keys. Composition order is fixed; dependencies and conflicts are validated
 * before any world configuration may publish (I01/I15).
 */

export interface MechanismManifest {
  moduleId: string;
  version: string;
  requires: ReadonlyArray<{ moduleId: string; version: string }>;
  conflicts: readonly string[];
  /** Executable capabilities this module contributes. */
  capabilities: readonly string[];
  /** State fields owned exclusively by this module. */
  ownedFields: readonly string[];
  parameterSchemaId: string;
  stateSchemaVersion: number;
}

export const MECHANISM_MANIFEST_VERSION = 'mechanism-manifest-1';

export const MECHANISM_MODULES: readonly MechanismManifest[] = [
  {
    moduleId: 'resources_conditions',
    version: '1.0.0',
    requires: [],
    conflicts: [],
    capabilities: ['resource_cap', 'resource_spend', 'resource_restore', 'condition_apply', 'condition_remove', 'cooldown'],
    ownedFields: ['actors.resources', 'actors.conditions', 'actors.abilityCooldowns'],
    parameterSchemaId: 'resources_conditions.params-1',
    stateSchemaVersion: 1,
  },
  {
    moduleId: 'skill_actions',
    version: '1.0.0',
    requires: [{ moduleId: 'resources_conditions', version: '1.0.0' }],
    conflicts: [],
    capabilities: ['skill_check', 'skill_difficulty_band', 'action_cost_time'],
    ownedFields: ['actors.skills'],
    parameterSchemaId: 'skill_actions.params-1',
    stateSchemaVersion: 1,
  },
  {
    moduleId: 'exploration_discovery',
    version: '1.0.0',
    requires: [{ moduleId: 'resources_conditions', version: '1.0.0' }],
    conflicts: [],
    capabilities: ['move_location', 'investigate_clue', 'discover_entry'],
    ownedFields: ['discoveredEntryIds'],
    parameterSchemaId: 'exploration_discovery.params-1',
    stateSchemaVersion: 1,
  },
  {
    moduleId: 'social_relationships',
    version: '1.0.0',
    requires: [{ moduleId: 'resources_conditions', version: '1.0.0' }],
    conflicts: [],
    capabilities: ['talk_action', 'relationship_delta', 'recruit_companion'],
    ownedFields: ['relationships'],
    parameterSchemaId: 'social_relationships.params-1',
    stateSchemaVersion: 1,
  },
  {
    moduleId: 'combat_zones',
    version: '1.0.0',
    requires: [{ moduleId: 'resources_conditions', version: '1.0.0' }],
    conflicts: [],
    capabilities: ['encounter_begin', 'zone_move', 'initiative_queue', 'rescue', 'retreat', 'npc_turn', 'loot_grant'],
    ownedFields: ['encounters'],
    parameterSchemaId: 'combat_zones.params-1',
    stateSchemaVersion: 1,
  },
  {
    moduleId: 'growth_rest',
    version: '1.0.0',
    requires: [{ moduleId: 'resources_conditions', version: '1.0.0' }],
    conflicts: [],
    capabilities: ['short_rest', 'long_rest', 'skill_training', 'practice_award', 'milestone_award'],
    ownedFields: ['actors.skills[].progress'],
    parameterSchemaId: 'growth_rest.params-1',
    stateSchemaVersion: 1,
  },
  {
    moduleId: 'situations_causality',
    version: '1.0.0',
    requires: [{ moduleId: 'resources_conditions', version: '1.0.0' }],
    conflicts: [],
    capabilities: ['situation_activation', 'situation_pressure', 'conditional_event', 'fate_divergence', 'prepared_resolution'],
    ownedFields: ['situations', 'causalOrder'],
    parameterSchemaId: 'situations_causality.params-1',
    stateSchemaVersion: 1,
  },
  {
    moduleId: 'pressure_track',
    version: '1.0.0',
    requires: [{ moduleId: 'resources_conditions', version: '1.0.0' }],
    conflicts: [],
    capabilities: ['pressure_raise', 'pressure_relief', 'pressure_threshold_trigger'],
    ownedFields: ['pressureTracks'],
    parameterSchemaId: 'pressure_track.params-1',
    stateSchemaVersion: 1,
  },
];

/** Fixed composition order (plan §6.2): never Map insertion or async order. */
export const MODULE_COMPOSITION_ORDER: readonly string[] = [
  'resources_conditions',
  'skill_actions',
  'exploration_discovery',
  'social_relationships',
  'combat_zones',
  'growth_rest',
  'situations_causality',
  'pressure_track',
];

export type ModuleCompositionErrorCode =
  | 'unknown_module'
  | 'duplicate_module'
  | 'unsupported_module_version'
  | 'missing_dependency'
  | 'module_conflict'
  | 'dependency_cycle';

export interface ModuleCompositionError {
  code: ModuleCompositionErrorCode;
  detail: string;
}

export interface ResolvedModuleComposition {
  ok: boolean;
  /** Enabled modules in the fixed composition order. */
  ordered: ReadonlyArray<MechanismManifest>;
  errors: readonly ModuleCompositionError[];
}

export function getMechanismManifest(moduleId: string): MechanismManifest | null {
  return MECHANISM_MODULES.find(module => module.moduleId === moduleId) ?? null;
}

/**
 * Resolves and validates a selection of module ids against the registry.
 * Deterministic: identical selections always produce identical compositions.
 */
export function resolveModuleComposition(
  selections: ReadonlyArray<{ moduleId: string; version: string }>,
): ResolvedModuleComposition {
  const errors: ModuleCompositionError[] = [];
  const selected = new Map<string, string>();
  for (const selection of selections) {
    if (selected.has(selection.moduleId)) errors.push({ code: 'duplicate_module', detail: `module '${selection.moduleId}' selected more than once` });
    const manifest = getMechanismManifest(selection.moduleId);
    if (!manifest) {
      errors.push({ code: 'unknown_module', detail: `module '${selection.moduleId}' is not registered with this app build` });
      continue;
    }
    if (manifest.version !== selection.version) {
      errors.push({
        code: 'unsupported_module_version',
        detail: `module '${selection.moduleId}' requested version ${selection.version}, registered ${manifest.version}`,
      });
      continue;
    }
    selected.set(selection.moduleId, selection.version);
  }
  for (const [moduleId, version] of selected) {
    const manifest = getMechanismManifest(moduleId)!;
    for (const requirement of manifest.requires) {
      if (!selected.has(requirement.moduleId)) {
        errors.push({
          code: 'missing_dependency',
          detail: `module '${moduleId}' requires '${requirement.moduleId}@${requirement.version}' which is not enabled`,
        });
      } else if (selected.get(requirement.moduleId) !== requirement.version) {
        errors.push({
          code: 'missing_dependency',
          detail: `module '${moduleId}' requires '${requirement.moduleId}@${requirement.version}' but '${selected.get(requirement.moduleId)}' is enabled`,
        });
      }
    }
    for (const conflictId of manifest.conflicts) {
      if (selected.has(conflictId)) {
        errors.push({ code: 'module_conflict', detail: `module '${moduleId}' conflicts with enabled module '${conflictId}'` });
      }
    }
  }
  // Cycle check over the registry's own requires graph (all registered
  // modules must be acyclic; a cycle would be a build-time registry bug).
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (moduleId: string): void => {
    if (visited.has(moduleId)) return;
    if (visiting.has(moduleId)) {
      errors.push({ code: 'dependency_cycle', detail: `registry dependency cycle through '${moduleId}'` });
      return;
    }
    visiting.add(moduleId);
    const manifest = getMechanismManifest(moduleId);
    if (manifest) {
      for (const requirement of manifest.requires) visit(requirement.moduleId);
    }
    visiting.delete(moduleId);
    visited.add(moduleId);
  };
  for (const moduleId of selected.keys()) visit(moduleId);

  const ordered = MODULE_COMPOSITION_ORDER
    .filter(moduleId => selected.has(moduleId))
    .map(moduleId => getMechanismManifest(moduleId)!)
    .filter(manifest => Boolean(manifest));
  return { ok: errors.length === 0, ordered, errors };
}
