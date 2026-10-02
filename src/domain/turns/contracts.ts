import { isEffectiveStyleSnapshotV1 } from '../style/validation';
import { DIFFICULTY_BANDS, ROLL_GRADES } from '../rules/types';
import type { ActionContract, EffectOperation, OutcomeClause } from './types';

const FORBIDDEN_PLANNER_FIELDS = new Set([
  'diceCount',
  'dieSides',
  'randomValue',
  'rolls',
  'highest',
  'margin',
  'grade',
  'balance',
  'newLevel',
  // Engine-only fields: the planner never caps restores or grants loot.
  'cap',
]);

/** Ops an LLM action contract may contain (V0.2). Engine-only ops
 * (removeCondition, grantItem) are rejected here — they belong to local
 * settlement, never to model output. */
const VALID_EFFECT_OPS = new Set([
  'consumeResource',
  'changeLocation',
  'applyCondition',
  'advanceClock',
  'transferItem',
  'restoreResource',
  'recordEvent',
]);
const VALID_ENGINE_EFFECT_OPS = new Set(['removeCondition', 'grantItem']);

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEffect(effect: unknown, path: string, errors: string[], origin: ContractOrigin): void {
  if (typeof effect !== 'object' || effect === null) {
    errors.push(`${path}: effect must be an object.`);
    return;
  }
  const op = (effect as { op?: unknown }).op;
  const allowedOps = origin === 'engine'
    ? new Set([...VALID_EFFECT_OPS, ...VALID_ENGINE_EFFECT_OPS])
    : VALID_EFFECT_OPS;
  if (typeof op !== 'string' || !allowedOps.has(op)) {
    errors.push(`${path}: op must be one of ${[...allowedOps].join(', ')}; received ${String(op)}.`);
    return;
  }
  const e = effect as EffectOperation;
  switch (e.op) {
    case 'consumeResource':
      if (!nonEmpty(e.actorId) || !nonEmpty(e.resourceId)) {
        errors.push(`${path}: actorId and resourceId are required.`);
      }
      if (!Number.isFinite(e.amount) || e.amount <= 0) {
        errors.push(`${path}: consumeResource amount must be > 0.`);
      }
      return;
    case 'changeLocation':
      if (!nonEmpty(e.actorId) || !nonEmpty(e.locationId)) {
        errors.push(`${path}: actorId and locationId are required.`);
      }
      return;
    case 'applyCondition':
      if (!nonEmpty(e.actorId) || !nonEmpty(e.conditionId)) {
        errors.push(`${path}: actorId and conditionId are required.`);
      }
      return;
    case 'advanceClock':
      if (!Number.isFinite(e.minutes) || e.minutes <= 0) {
        errors.push(`${path}: advanceClock minutes must be > 0.`);
      }
      return;
    case 'transferItem':
      if (!nonEmpty(e.itemId) || !nonEmpty(e.fromActorId) || !nonEmpty(e.toActorId)) {
        errors.push(`${path}: itemId, fromActorId and toActorId are required.`);
      }
      if (e.fromActorId === e.toActorId) {
        errors.push(`${path}: transferItem must change owner.`);
      }
      return;
    case 'restoreResource':
      if (!nonEmpty(e.actorId) || !nonEmpty(e.resourceId)) {
        errors.push(`${path}: actorId and resourceId are required.`);
      }
      if (!Number.isFinite(e.amount) || e.amount <= 0) {
        errors.push(`${path}: restoreResource amount must be > 0.`);
      }
      return;
    case 'recordEvent':
      if (!nonEmpty(e.eventType) || !nonEmpty(e.summary)) {
        errors.push(`${path}: eventType and summary are required.`);
      }
      return;
    case 'removeCondition':
      if (!nonEmpty(e.actorId) || !nonEmpty(e.conditionId)) {
        errors.push(`${path}: actorId and conditionId are required.`);
      }
      return;
    case 'grantItem':
      if (!nonEmpty(e.itemId) || !nonEmpty(e.actorId)) {
        errors.push(`${path}: itemId and actorId are required.`);
      }
      return;
  }
}

function validateOutcome(outcome: OutcomeClause, path: string, errors: string[], origin: ContractOrigin): void {
  if (typeof outcome.achieved !== 'boolean') {
    errors.push(`${path}: achieved must be a boolean.`);
  }
  if (!nonEmpty(outcome.publicSummary)) {
    errors.push(`${path}: publicSummary is required.`);
  }
  if (!Array.isArray(outcome.effects)) {
    errors.push(`${path}: effects must be an array.`);
    return;
  }
  outcome.effects.forEach((effect, index) => validateEffect(effect, `${path}.effects[${index}]`, errors, origin));
}

function findForbiddenKeys(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, errors));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PLANNER_FIELDS.has(key)) {
      errors.push(`${path}.${key}: field is controlled by the local rules engine.`);
    }
    findForbiddenKeys(nested, `${path}.${key}`, errors);
  }
}

export type ContractOrigin = 'planner' | 'engine';

export function validateActionContract(contract: ActionContract, origin: ContractOrigin = 'planner'): string[] {
  const errors: string[] = [];
  // Engine-generated contracts (rest, encounters, training) may carry
  // engine-injected fields like `cap`; model output may never.
  if (origin === 'planner') {
    findForbiddenKeys(contract, 'contract', errors);
  }

  if (contract.protocolVersion !== '1.0') errors.push('protocolVersion must be 1.0.');
  if (!nonEmpty(contract.turnId)) errors.push('turnId is required.');
  if (!Number.isInteger(contract.expectedStateVersion) || contract.expectedStateVersion < 0) {
    errors.push('expectedStateVersion must be a non-negative integer.');
  }
  if (contract.styleSnapshot !== undefined && (!isEffectiveStyleSnapshotV1(contract.styleSnapshot) || contract.styleSnapshot.turnId !== contract.turnId)) errors.push('styleSnapshot must be valid and bind the contract branch/turn.');
  if (contract.contentDependency !== undefined) {
    const dependency = contract.contentDependency;
    if (!dependency || !nonEmpty(dependency.manifestHash) || !/^[a-f0-9]{64}$/i.test(dependency.manifestHash)) {
      errors.push('contentDependency.manifestHash must be a SHA-256 digest.');
    }
    if (!Number.isSafeInteger(dependency.contentVersion) || dependency.contentVersion < 0 ||
        !Number.isSafeInteger(dependency.basePackageRevision) || dependency.basePackageRevision < 1) {
      errors.push('contentDependency package versions are invalid.');
    }
    if (!nonEmpty(dependency.branchId) || dependency.stateVersion !== contract.expectedStateVersion) {
      errors.push('contentDependency must bind the contract branch and expected state version.');
    }
    if (!Array.isArray(dependency.deltaIds) || dependency.deltaIds.length > 512 ||
        dependency.deltaIds.some(id => !nonEmpty(id)) || new Set(dependency.deltaIds).size !== dependency.deltaIds.length) {
      errors.push('contentDependency.deltaIds must contain unique package ids.');
    }
    if (dependency.artifactIds !== undefined && (!Array.isArray(dependency.artifactIds)
      || dependency.artifactIds.length > 512 || dependency.artifactIds.some(id => !nonEmpty(id))
      || new Set(dependency.artifactIds).size !== dependency.artifactIds.length
      || typeof dependency.artifactManifestHash !== 'string' || !/^[a-f0-9]{64}$/i.test(dependency.artifactManifestHash))) {
      errors.push('contentDependency artifacts must have unique ids and a frozen manifest hash.');
    }
  }
  if (!nonEmpty(contract.actorId)) errors.push('actorId is required.');
  if (!nonEmpty(contract.actionType)) errors.push('actionType is required.');
  if (contract.actionType === 'ability' && !nonEmpty(contract.abilityId)) {
    errors.push('abilityId is required for ability actions.');
  }
  if (!nonEmpty(contract.intent)) errors.push('intent is required.');
  if (!Array.isArray(contract.evidenceIds)) errors.push('evidenceIds must be an array.');
  if (!Number.isFinite(contract.timeCostMinutes) || contract.timeCostMinutes < 0) {
    errors.push('timeCostMinutes must be >= 0.');
  }
  if (contract.requiresRoll) {
    if (!contract.skillId || !nonEmpty(contract.skillId)) {
      errors.push('skillId is required when requiresRoll is true.');
    }
    if (!contract.difficultyBand || !DIFFICULTY_BANDS.includes(contract.difficultyBand)) {
      errors.push('difficultyBand is required when requiresRoll is true.');
    }
  }

  for (const grade of ROLL_GRADES) {
    const outcome = contract.outcomes?.[grade];
    if (!outcome) {
      errors.push(`outcomes.${grade} is required.`);
    } else {
      validateOutcome(outcome, `outcomes.${grade}`, errors, origin);
    }
  }

  if (Array.isArray(contract.resourcePreconditions)) {
    contract.resourcePreconditions.forEach((item, index) => {
      if (typeof item !== 'object' || item === null) {
        errors.push(`resourcePreconditions[${index}]: precondition must be an object.`);
        return;
      }
      if (!nonEmpty(item.actorId) || !nonEmpty(item.resourceId)) {
        errors.push(`resourcePreconditions[${index}]: actorId and resourceId are required.`);
      }
      if (!Number.isFinite(item.minimum) || item.minimum < 0) {
        errors.push(`resourcePreconditions[${index}].minimum must be >= 0.`);
      }
    });
  } else if (contract.resourcePreconditions !== undefined && contract.resourcePreconditions !== null) {
    errors.push('resourcePreconditions must be an array when present.');
  }

  return errors;
}

export function assertValidActionContract(contract: ActionContract, origin: ContractOrigin = 'planner'): void {
  const errors = validateActionContract(contract, origin);
  if (errors.length > 0) {
    throw new Error(`Invalid action contract:\n- ${errors.join('\n- ')}`);
  }
}
