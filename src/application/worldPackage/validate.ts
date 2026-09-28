import { canonicalStringify, type Sha256HexProvider, type CanonicalJson } from '../../domain/turns/canonical';
import {
  validateDefinition,
  type BookSection,
  type ContentEntry,
  type WorldPackageBuildScope,
  type WorldPackageManifest,
} from '../../domain/content/types';

export interface PackageValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  entryCount: number;
  countsByKind: Record<string, number>;
}

const KIND_DEPENDENCY_RULES: Record<string, { allowed: string[]; description: string }> = {
  ability: {
    allowed: ['skill', 'resource-less', 'ability', 'item', 'condition'],
    description: 'ability may reference its prerequisite skill, conditions and items',
  },
  actor_template: {
    allowed: ['skill', 'ability', 'item'],
    description: 'actor templates reference skills, abilities and loot items',
  },
  origin: { allowed: ['skill', 'item'], description: 'origins grant skills and starting items' },
  path: { allowed: ['origin', 'ability'], description: 'paths require origins and grant abilities' },
  scene: { allowed: ['actor_template', 'item', 'quest'], description: 'scenes place actors, items and clues' },
  quest: { allowed: ['item', 'scene'], description: 'quests reward items and reference scenes' },
};

/**
 * Structural and playability gate before a world package can publish
 * (plan §7.3): every definition validates per kind, dependencies resolve,
 * the dependency graph is acyclic, provenance is present, and mechanical
 * fields required for encounters are complete.
 */
export function validatePackage(
  manifest: Pick<WorldPackageManifest, 'worldId' | 'revision'>,
  entries: readonly ContentEntry[],
  sections: readonly BookSection[],
): PackageValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(entries.map(entry => [entry.entryId, entry]));
  const countsByKind: Record<string, number> = {};

  if (entries.length === 0) {
    errors.push('A world package requires at least one entry.');
  }

  for (const entry of entries) {
    countsByKind[entry.kind] = (countsByKind[entry.kind] ?? 0) + 1;

    for (const error of validateDefinition(entry.kind, entry.definition)) {
      errors.push(`${entry.entryId}: ${error}`);
    }

    const provenance = entry.provenance;
    if (!provenance || typeof provenance.kind !== 'string' || !provenance.rationale?.trim()) {
      errors.push(`${entry.entryId}: provenance with rationale is required.`);
    }

    if (entry.entryId !== entry.entryId.trim() || /\s/.test(entry.entryId)) {
      errors.push(`${entry.entryId}: entry ids must be stable tokens without whitespace.`);
    }

    for (const dependencyId of entry.dependencyIds) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        errors.push(`${entry.entryId}: dangling dependency ${dependencyId}.`);
        continue;
      }
      const rule = KIND_DEPENDENCY_RULES[entry.kind];
      if (rule && !rule.allowed.includes(dependency.kind) && dependency.kind !== 'lore') {
        errors.push(
          `${entry.entryId}: ${entry.kind} may not depend on ${dependency.kind} (${rule.description}).`,
        );
      }
    }
  }

  // Acyclic dependency graph (iterative DFS with colors).
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(entries.map(entry => [entry.entryId, WHITE]));
  for (const entry of entries) {
    const stack: Array<{ id: string; next: number }> = [{ id: entry.entryId, next: 0 }];
    if (color.get(entry.entryId) !== WHITE) continue;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.next === 0) color.set(frame.id, GRAY);
      const dependencies = byId.get(frame.id)?.dependencyIds ?? [];
      if (frame.next < dependencies.length) {
        const dependencyId = dependencies[frame.next]!;
        frame.next += 1;
        const dependencyColor = color.get(dependencyId) ?? BLACK;
        if (dependencyColor === GRAY) {
          errors.push(`Dependency cycle detected through ${dependencyId}.`);
          stack.length = 0;
          break;
        }
        if (dependencyColor === WHITE) stack.push({ id: dependencyId, next: 0 });
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }

  // Encounter readiness: every actor template must carry complete mechanical
  // fields before it can join combat (plan §7.2).
  for (const entry of entries) {
    if (entry.kind !== 'actor_template') continue;
    const def = entry.definition as Record<string, unknown>;
    if (typeof def.hp !== 'number' || typeof def.defense !== 'number') {
      errors.push(`${entry.entryId}: actor template cannot enter combat without hp and defense.`);
    }
    if (def.lootItemIds !== undefined) {
      if (!Array.isArray(def.lootItemIds) || def.lootItemIds.some(itemId => typeof itemId !== 'string')) {
        errors.push(`${entry.entryId}: lootItemIds must be an array of item entry ids.`);
      } else {
        for (const itemId of new Set(def.lootItemIds as string[])) {
          if (byId.get(itemId)?.kind !== 'item') {
            errors.push(`${entry.entryId}: loot item ${itemId} must reference a published item entry.`);
          }
        }
      }
    }
    if (def.startingItems !== undefined) {
      if (!Array.isArray(def.startingItems)) {
        errors.push(`${entry.entryId}: startingItems must be an array of item entry ids.`);
      } else {
        for (const itemId of new Set(def.startingItems as string[])) {
          if (byId.get(itemId)?.kind !== 'item') {
            errors.push(`${entry.entryId}: starting item ${itemId} must reference a published item entry.`);
          }
        }
      }
    }
    const recruitment = def.recruitment as Record<string, unknown> | undefined;
    if (recruitment?.openingEligible === true && entry.visibility !== 'public') {
      errors.push(`${entry.entryId}: opening-eligible companions must have public visibility.`);
    }
    if (Array.isArray(recruitment?.requiredQuestIds)) {
      for (const questId of new Set(recruitment.requiredQuestIds as string[])) {
        if (byId.get(questId)?.kind !== 'quest') {
          errors.push(`${entry.entryId}: recruitment requirement ${questId} must reference a published quest entry.`);
        }
      }
    }
  }

  // Three books must reference entries of the same revision, without ghosts.
  const sectionEntryIds = new Set<string>();
  for (const section of sections) {
    if (section.entryIds.length === 0) {
      warnings.push(`Book section ${section.book}/${section.sectionKey} is empty.`);
    }
    for (const entryId of section.entryIds) {
      sectionEntryIds.add(entryId);
      if (!byId.has(entryId)) {
        errors.push(`Book section ${section.book}/${section.sectionKey} references missing entry ${entryId}.`);
      }
    }
  }
  for (const entry of entries) {
    if (entry.visibility !== 'gm' && !sectionEntryIds.has(entry.entryId)) {
      warnings.push(`Entry ${entry.entryId} is not referenced by any book section.`);
    }
  }

  // Blocking conflicts are checked by the caller against review_issues (DB);
  // structural validation here reports them via the manifest gate.
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    entryCount: entries.length,
    countsByKind,
  };
}

/** Canonical content hash over entries + sections (order-independent). */
export async function computePackageContentHash(
  entries: readonly ContentEntry[],
  sections: readonly BookSection[],
  sha256Hex: Sha256HexProvider['sha256Hex'],
  buildScope?: WorldPackageBuildScope,
): Promise<string> {
  const payload: Record<string, CanonicalJson> = {
    entries: [...entries]
      .map(entry => ({
        entryId: entry.entryId,
        kind: entry.kind,
        revision: entry.revision,
        provenance: entry.provenance,
        fieldProvenance: entry.fieldProvenance,
        visibility: entry.visibility,
        revealPolicyId: entry.revealPolicyId ?? null,
        dependencyIds: [...entry.dependencyIds].sort(),
        definition: entry.definition,
      }))
      .sort((a, b) => (a.entryId < b.entryId ? -1 : 1)) as unknown as CanonicalJson,
    sections: [...sections]
      .map(section => ({
        book: section.book,
        sectionKey: section.sectionKey,
        title: section.title,
        entryIds: [...section.entryIds].sort(),
        position: section.position,
      }))
      .sort((a, b) => (a.book + a.sectionKey < b.book + b.sectionKey ? -1 : 1)) as unknown as CanonicalJson,
  };
  if (buildScope) payload.buildScope = buildScope as unknown as CanonicalJson;
  const hash = await sha256Hex(canonicalStringify(payload));
  return hash.toLowerCase();
}
