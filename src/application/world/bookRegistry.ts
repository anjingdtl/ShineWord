/**
 * Pass 0 whole-book entity registry (1M resident plan §4.3).
 *
 * One request over the byte-stable whole-book prefix produces the book-wide
 * character/faction/location/ability inventory; it lands as entity SEEDS via
 * the existing upsertEntity and a rule_mapping job checkpoint (idempotent by
 * content hash + registry version). The compact registry summary is then
 * injected into every resident scope instruction so later extraction units
 * prefer established keys and cross-group entity fragmentation drops.
 *
 * The model only PROPOSES: local code whitelists types, drops malformed
 * entries and never lets the registry bypass any validation gate.
 */
import type { LlmRequest, LlmResponse } from '../llm/types';
import { parseStrictJsonObject } from '../llm/json';
import type { WorldStore } from '../ports/worldStore';
import type { StoredEntity } from '../ports/worldStore';
import { entityIdFor } from './extraction';
import type { ReasoningEffort } from '../worldBuild/groupPlanner';

export const BOOK_REGISTRY_VERSION = 'book-registry-1';
/** Pass 0 output stays a bounded inventory (plan §4.3: "输出 ≤8K"). */
export const REGISTRY_MAX_OUTPUT_TOKENS = 8_192;
/** Registry thinking task (plan §4.3: GLM high / DeepSeek thinking). */
export const REGISTRY_REASONING_EFFORT: ReasoningEffort = 'high';
/** Compact summary budget: enough keys to steer extraction, never the book. */
export const REGISTRY_SUMMARY_MAX_ENTITIES = 80;

const ENTITY_TYPES = ['character', 'faction', 'location', 'item', 'ability', 'rule', 'event'] as const;

const REGISTRY_SYSTEM = [
  'You are ShineWord Book Registrar. You read the WHOLE Chinese novel provided as numbered segments (each header looks like [S<segmentNumber> <chapterTitle>]) and output exactly one JSON object, no prose.',
  'Schema: {"entities":[{"key":string,"type":"character|faction|location|item|ability|rule|event","name":string,"aliases":string[]}]}',
  'Rules:',
  '- List the IMPORTANT recurring characters, factions, locations and power/ability systems of the whole book.',
  '- key is a short stable identifier reused to refer to this entity; use the most common name as key and name.',
  '- aliases list other spellings/names used in the book; keep each list short.',
  '- Prefer precision over recall: at most ~120 entities for a long book, fewer for a short one.',
  '- Never invent entities that do not appear in the text.',
].join('\n');

export interface RegistryEntity {
  entityKey: string;
  type: StoredEntity['type'];
  name: string;
  aliases: readonly string[];
}

export interface BookRegistry {
  entities: RegistryEntity[];
  /** True when the checkpoint job was reused without a new request. */
  reused: boolean;
}

interface RawRegistry {
  entities?: Array<{ key?: unknown; type?: unknown; name?: unknown; aliases?: unknown }>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Compact, deterministic summary for the scope instruction: "key:type" pairs
 * joined by commas. Bounded so the per-unit instruction stays a few hundred
 * tokens regardless of registry size.
 */
export function registrySummaryFor(entities: readonly RegistryEntity[]): string {
  return entities
    .slice(0, REGISTRY_SUMMARY_MAX_ENTITIES)
    .map(entity => `${entity.entityKey}:${entity.type}`)
    .join('，');
}

export function registryJobId(worldId: string): string {
  return `job-registry-${worldId}`;
}

export interface BuildBookRegistryInput {
  worldStore: WorldStore;
  /** Provider completion fn (the same one the extractors use). */
  complete: (request: LlmRequest) => Promise<LlmResponse>;
  /** Whole-book segments, SAME assembly as the resident prefix (§4.2). */
  segmentBody: string;
  worldId: string;
  modelFingerprint: string;
  createdAt: string;
  /** Content identity of the book (chunk ids + spans). */
  contentHash: string;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

/**
 * Registry checkpoint payload: only the inventory itself (key/type/name/
 * aliases) - the same fields that already live in the entities table. No
 * novel prose, no provider response text.
 */
function registryResultJson(entities: readonly RegistryEntity[]): string {
  return JSON.stringify({
    entities: entities.map(entity => ({
      entityKey: entity.entityKey, type: entity.type, name: entity.name, aliases: entity.aliases,
    })),
  });
}

export async function buildBookRegistry(input: BuildBookRegistryInput): Promise<BookRegistry> {
  const jobId = registryJobId(input.worldId);
  const existing = await input.worldStore.getJob(input.worldId, jobId);
  if (existing?.status === 'done' && existing.contentHash === input.contentHash
    && existing.extractorVersion === BOOK_REGISTRY_VERSION && existing.resultJson) {
    const stored = JSON.parse(existing.resultJson) as {
      entities?: Array<{ entityKey?: unknown; key?: unknown; type?: unknown; name?: unknown; aliases?: unknown }>;
    };
    // Legacy checkpoints serialized the field as `key` (registry-1 bug): map
    // both spellings so reuse never yields entities with undefined keys.
    const entities: RegistryEntity[] = [];
    for (const candidate of stored.entities ?? []) {
      const key = typeof candidate.entityKey === 'string' && candidate.entityKey.trim().length > 0
        ? candidate.entityKey.trim()
        : typeof candidate.key === 'string' && candidate.key.trim().length > 0 ? candidate.key.trim() : null;
      const type = typeof candidate.type === 'string' ? candidate.type : null;
      const name = typeof candidate.name === 'string' ? candidate.name : null;
      if (!key || !type || !name) continue;
      entities.push({
        entityKey: key,
        type: type as RegistryEntity['type'],
        name,
        aliases: Array.isArray(candidate.aliases)
          ? candidate.aliases.filter((alias): alias is string => typeof alias === 'string')
          : [],
      });
    }
    return { entities, reused: true };
  }

  const response = await input.complete({
    role: 'WorldMapper',
    system: REGISTRY_SYSTEM,
    user: input.segmentBody,
    maxOutputTokens: input.maxOutputTokens ?? REGISTRY_MAX_OUTPUT_TOKENS,
    jsonMode: true,
    reasoningEffort: input.reasoningEffort ?? REGISTRY_REASONING_EFFORT,
  });
  const raw = parseStrictJsonObject<RawRegistry>(response.text, 'BookRegistrar output');
  const entities: RegistryEntity[] = [];
  const seenKeys = new Set<string>();
  for (const candidate of raw.entities ?? []) {
    const key = asString(candidate.key);
    const name = asString(candidate.name);
    const type = asString(candidate.type);
    if (!key || !name || !type) continue;
    if (!ENTITY_TYPES.includes(type as (typeof ENTITY_TYPES)[number])) continue;
    const dedupeKey = `${type}:${key}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    entities.push({
      entityKey: key,
      type: type as RegistryEntity['type'],
      name,
      aliases: Array.isArray(candidate.aliases)
        ? candidate.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0)
        : [],
    });
  }

  // Entity seeds through the existing upsert - entityMerge logic unchanged.
  for (const entity of entities) {
    await input.worldStore.upsertEntity({
      worldId: input.worldId,
      entityId: entityIdFor(input.worldId, entity.entityKey),
      type: entity.type,
      name: entity.name,
      firstSeenChapterId: null,
      aliases: [entity.name, ...entity.aliases],
    }, input.createdAt);
  }

  await input.worldStore.upsertJob({
    worldId: input.worldId,
    jobId,
    kind: 'rule_mapping',
    targetId: null,
    status: 'done',
    attempts: (existing?.attempts ?? 0) + 1,
    contentHash: input.contentHash,
    extractorVersion: BOOK_REGISTRY_VERSION,
    modelFingerprint: input.modelFingerprint,
    usageJson: response.usage ? JSON.stringify(response.usage) : null,
    resultJson: registryResultJson(entities),
    error: null,
    createdAt: existing?.createdAt ?? input.createdAt,
    updatedAt: input.createdAt,
  }, input.createdAt);

  return { entities, reused: false };
}
