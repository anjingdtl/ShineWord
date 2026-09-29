import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { StoredEntity, StoredEvent, StoredFact, StoredRuleMapping } from '../../application/ports/worldStore';
import { SHINEWORD_RULESET_VERSION } from '../../domain/rules/ruleset';
import { ruleMappingIdFor } from '../world/extraction';
import { parseStrictJsonObject } from '../llm/json';
import type {
  BookSection,
  ContentEntry,
  EntryKind,
  EntryVisibility,
  Provenance,
  SkillDefinition,
  WorldPackageBuildScope,
  WorldPackageManifest,
} from '../../domain/content/types';
import { publishWorldPackage } from './publish';
import { sourceRangesCoverWholeText } from './preparationStatus';

/**
 * P2-4: builds a publishable three-book world package from the canon facts,
 * events and entities extracted from a novel. The LLM proposes entries in
 * BATCHED mapping calls covering EVERY mappable fact; local code then
 * deterministically cleans every proposal, fills a conservative baseline
 * catalog (design_fill) and publishes through the standard gate.
 *
 * G04 honesty gate: a mapping failure refuses publication entirely (the
 * extracted facts stay persisted for resume) — a generic default package is
 * never smuggled out as this novel's complete three books.
 */

export interface MappingCompleteRequest {
  role: string;
  system: string;
  user: string;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}

export interface MappingProvider {
  complete(request: MappingCompleteRequest): Promise<{
    text: string;
    usage?: unknown;
    /** Sanitized per-attempt physical metrics (unified P1: every billed attempt). */
    requestMetrics?: unknown;
  }>;
}

export interface BuildPackageInput {
  worldStore: SqliteWorldStore;
  provider: MappingProvider;
  sha256Hex(input: string): Promise<string> | string;
  worldId: string;
  sourceSha256: string;
  mappingVersion: string;
  createdAt: string;
  /** Exact normalized source chunks, supplied only after every chunk extracted. */
  sourceRanges?: WorldPackageBuildScope['sourceRanges'];
  sourceCodePointCount?: number;
  /**
   * WorldMapper V2 (1M plan P4): map with WHOLE-BOOK vision - every fact in
   * ONE request (the 800-fact input truncation is lifted), full entity and
   * event context, and the mapper additionally proposes ruleMappings that
   * land through the same evidence-verified store path. Windowed runs keep
   * the existing batched mapping untouched.
   */
  resident?: boolean;
  /**
   * Stage scope (unified P3): publish a CUMULATIVE stage package covering the
   * built prefix of the book instead of the whole source. `ranges` must be
   * contiguous from code point 0; `coversWholeText` upgrades completeness to
   * complete/whole_source. The same mapping/cleaning/quality gates apply.
   */
  stageScope?: {
    ranges: ReadonlyArray<{ startCodePoint: number; endCodePoint: number; contentSha256: string }>;
    coversWholeText: boolean;
  };
  signal?: { aborted: boolean };
  onProgress?(info: { phase: string; message?: string }): void;
}

export interface BuildPackageResult {
  manifest: WorldPackageManifest;
  entries: ContentEntry[];
  sections: BookSection[];
  reviewIssues: number;
  mappingUsage: unknown | null;
}

// ---------------------------------------------------------------------------
// Prompt and enum whitelists. The prompt carries only novel-derived content;
// provider credentials and user paths never enter it.
// ---------------------------------------------------------------------------

const ATTRIBUTES = ['physique', 'agility', 'insight', 'knowledge', 'willpower', 'social'];
const POWER_TIERS = ['ordinary', 'enhanced', 'supernatural'];

/**
 * Closed-enum fields are validated strictly, but the model is free-form text on
 * the way in and a single wording slip ("mundane" instead of "ordinary") used to
 * throw the whole proposal away - in the field that silently removed every
 * canonical skill of the novel from its three books. Known synonyms now fold
 * onto the canonical value before validation; genuinely unknown values are
 * still rejected and surfaced in the review queue.
 */
const ATTRIBUTE_SYNONYMS: Readonly<Record<string, string>> = {
  physique: 'physique', strength: 'physique', body: 'physique', might: 'physique', power: 'physique',
  agility: 'agility', dexterity: 'agility', speed: 'agility', reflex: 'agility', finesse: 'agility',
  insight: 'insight', perception: 'insight', awareness: 'insight', senses: 'insight', observation: 'insight',
  knowledge: 'knowledge', intellect: 'knowledge', intelligence: 'knowledge', lore: 'knowledge', learning: 'knowledge',
  willpower: 'willpower', will: 'willpower', resolve: 'willpower', spirit: 'willpower', courage: 'willpower',
  social: 'social', charisma: 'social', presence: 'social', persuasion: 'social', rapport: 'social',
  // The novels are Chinese; a model may answer the enum in the source language.
  体魄: 'physique', 力量: 'physique', 体质: 'physique',
  敏捷: 'agility', 灵巧: 'agility', 速度: 'agility',
  洞察: 'insight', 感知: 'insight', 观察: 'insight',
  学识: 'knowledge', 智力: 'knowledge', 知识: 'knowledge',
  意志: 'willpower', 心志: 'willpower', 定力: 'willpower',
  交涉: 'social', 社交: 'social', 魅力: 'social',
};

const POWER_TIER_SYNONYMS: Readonly<Record<string, string>> = {
  ordinary: 'ordinary', mundane: 'ordinary', normal: 'ordinary', common: 'ordinary', mortal: 'ordinary',
  base: 'ordinary', none: 'ordinary', low: 'ordinary', basic: 'ordinary',
  enhanced: 'enhanced', heroic: 'enhanced', elite: 'enhanced', trained: 'enhanced', magical: 'enhanced',
  martial: 'enhanced', mid: 'enhanced', high: 'enhanced', advanced: 'enhanced',
  supernatural: 'supernatural', divine: 'supernatural', legendary: 'supernatural', immortal: 'supernatural',
  mythic: 'supernatural', superhuman: 'supernatural', transcendent: 'supernatural',
  凡俗: 'ordinary', 普通: 'ordinary', 世俗: 'ordinary',
  强化: 'enhanced', 精英: 'enhanced', 卓越: 'enhanced',
  超凡: 'supernatural', 神话: 'supernatural', 仙: 'supernatural',
};

/** Lowercases and folds separators so `Super-Natural` reaches the synonym table. */
function enumKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Folds a free-form enum answer onto the canonical value. Unmapped answers are
 * returned lowercased so the caller's allow-list check still rejects them (and
 * reports the original text).
 */
function normalizeEnum(value: string, synonyms: Readonly<Record<string, string>>): string {
  const key = enumKey(value);
  return synonyms[key] ?? key;
}
const PROVENANCE_KINDS = ['explicit', 'inferred', 'rule_mapping', 'design_fill'];
const ACTOR_CATEGORIES = ['human', 'beast', 'spirit', 'undead', 'construct', 'faction'];
const ITEM_CATEGORIES = ['weapon', 'armor', 'tool', 'consumable', 'valuables', 'key'];
const ENFORCEMENTS = ['block_action', 'block_effect', 'audit'];
const EFFECT_OPS = [
  'damage', 'heal', 'apply_condition', 'remove_condition', 'move_self', 'move_target',
  'consume_resource', 'restore_resource', 'reveal_information', 'grant_bonus_dice', 'change_distance',
];
const ATTACK_RANGES = ['touch', 'near', 'mid', 'far'];
const MORALE = ['low', 'steady', 'fierce'];
/** Skill usage enum (A07): attack skills compile into attack actions. */
const SKILL_USAGES = ['attack', 'utility', 'social', 'knowledge'];

/** Facts per mapping call; truncation keeps the prompt bounded and evidence ids valid. */
const MAX_PROMPT_FACTS = 800;
const MAPPING_MAX_OUTPUT_TOKENS = 6000;
/** Whole-book mapping output budget (1M plan §3.2: GLM high / 16k content). */
const RESIDENT_MAPPING_MAX_OUTPUT_TOKENS = 16_384;
export const CANON_MAPPER_ROLE = 'WorldMapper';

const MAPPER_SYSTEM = [
  'You are ShineWord WorldMapper. You map novel canon facts into a tabletop RPG world package and output exactly one JSON object, no prose.',
  'Schema: {"skills":[{"id":string,"name":string,"description":string,"attribute":string,"usage":"attack|utility|social|knowledge","allowUntrained":boolean,"requirements":string[],"powerTier":"ordinary|enhanced|supernatural","provenanceKind":string,"evidenceFactIds":string[],"rationale":string}],',
  '"constraints":[{"id":string,"name":string,"description":string,"enforcement":"block_action|block_effect|audit","pattern":string,"provenanceKind":string,"evidenceFactIds":string[],"rationale":string}],',
  '"actorTemplates":[{"id":string,"name":string,"category":"human|beast|spirit|undead|construct|faction","description":string,"attributes":object,"skills":object,"hp":number,"stamina":number,"defense":number,"attacks":[{"name":string,"skillId":string,"damage":number,"range":"touch|near|mid|far"}],"abilities":string[],"behavior":{"goal":string,"retreatThreshold":number,"morale":"low|steady|fierce"},"lootPolicy":string,"lootItemIds":string[],"threat":{"damage":number,"durability":number,"actions":number,"control":number,"environment":number},"provenanceKind":string,"evidenceFactIds":string[],"rationale":string}],',
  '"items":[{"id":string,"name":string,"description":string,"category":"weapon|armor|tool|consumable|valuables|key","armorReduction":number,"weaponSkillId":string,"weaponBonusDice":number,"effects":[{"op":string,"amount":number}],"unique":boolean,"provenanceKind":string,"evidenceFactIds":string[],"rationale":string}],',
  '"lore":[{"id":string,"name":string,"title":string,"text":string,"provenanceKind":string,"evidenceFactIds":string[],"rationale":string}],',
  '"ruleMappings":[{"target":string,"kind":"attribute|skill|power_tier|resource","mapping":object,"evidenceFactIds":string[]}]}',
  'Rules:',
  '- attribute MUST be exactly one of: physique, agility, insight, knowledge, willpower, social.',
  '- powerTier MUST be exactly one of: ordinary, enhanced, supernatural. Use ordinary for anything a normal person can learn.',
  '- usage MUST be exactly one of attack, utility, social, knowledge - attack is for skills that can serve as a weapon technique in combat; a skill with no combat technique evidence is never attack.',
  '- effect op MUST be exactly one of: damage, heal, apply_condition, remove_condition, move_self, move_target, consume_resource, restore_resource, reveal_information, grant_bonus_dice, change_distance.',
  '- provenanceKind MUST be one of: explicit, inferred, rule_mapping, design_fill. Numeric hp/stamina/defense/threat values are rule_mapping (game rule values), never canon facts from the novel.',
  '- explicit or inferred provenance REQUIRES at least one evidenceFactId from the provided fact list; without novel evidence you must use rule_mapping or design_fill instead.',
  '- Every entry MUST cite evidenceFactIds using only fact ids from the provided fact list, plus a one-sentence rationale.',
  '- Every id must be a short stable english token (letters, digits, dash). attack skillId and weaponSkillId must reference a proposed skill id.',
  '- lootItemIds may list only ids of items proposed in this same package; leave it empty when the evidence does not define loot.',
  '- Skill names come from the novel\'s own vocabulary (what the text calls the practice), never from a generic genre dictionary.',
  '- Do not invent facts the evidence does not support; prefer fewer, well-evidenced entries.',
  '- ruleMappings target MUST be the name of an entity from the provided entities list; kind MUST be one of attribute, skill, power_tier, resource; evidenceFactIds must reference provided fact ids. Mappings without verified evidence are dropped.',
].join('\n');

// ---------------------------------------------------------------------------
// Conservative local baseline (design_fill): the playable minimum catalog a
// novel-derived package needs even when the LLM mapping returns nothing.
// ---------------------------------------------------------------------------

interface DefaultSkill {
  id: string;
  name: string;
  description: string;
  attribute: string;
  allowUntrained: boolean;
}

const DEFAULT_SKILLS: readonly DefaultSkill[] = [
  { id: 'stealth', name: '潜行', description: '隐蔽移动、藏匿身形与消声行动。', attribute: 'agility', allowUntrained: false },
  { id: 'sword', name: '剑术', description: '刀剑类近战武器的攻防技艺。', attribute: 'agility', allowUntrained: false },
  { id: 'medicine', name: '医术', description: '诊伤疗毒、正骨续命的医道修为。', attribute: 'knowledge', allowUntrained: false },
  { id: 'diplomacy', name: '交涉', description: '谈判、劝说与斡旋的言辞之道。', attribute: 'social', allowUntrained: true },
  { id: 'observation', name: '观察', description: '留意环境细节与察觉异常的功夫。', attribute: 'insight', allowUntrained: true },
  { id: 'lore_skill', name: '学识', description: '典籍、掌故与秘闻的知识储备。', attribute: 'knowledge', allowUntrained: true },
  { id: 'endurance', name: '坚韧', description: '忍耐伤痛、疲惫与酷刑的意志。', attribute: 'physique', allowUntrained: true },
  { id: 'athletics', name: '运动', description: '奔跑、攀爬、跳跃与泅水的能力。', attribute: 'physique', allowUntrained: true },
];

const DESIGN_FILL_RATIONALE = '设计补全：可玩性所需的世界默认值。';

// ---------------------------------------------------------------------------
// Small strict-ish coercion helpers for LLM output cleaning.
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Numeric fields tolerate a numeric string.
 *
 * Models routinely answer `"hp":"6"` inside an otherwise well-formed proposal.
 * Rejecting that throws away the whole entry - in the live GLM run it silently
 * dropped the novel's protagonist template from the monster manual over a
 * quoting difference. Coercion only reads a value the model actually supplied;
 * a genuinely missing or non-numeric value is still rejected, because local
 * code must never invent combat stats for canon NPCs.
 */
function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Entry ids must be stable tokens; whitespace collapses to dashes. */
function slugId(raw: unknown): string | null {
  const text = asString(raw);
  if (!text) return null;
  const slug = text.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  return slug.length > 0 ? slug : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function makeEntry(params: {
  entryId: string;
  kind: EntryKind;
  provenance: Provenance;
  definition: unknown;
  visibility?: EntryVisibility;
  dependencyIds?: readonly string[];
  fieldProvenance?: Record<string, Provenance>;
}): ContentEntry {
  return {
    entryId: params.entryId,
    kind: params.kind,
    revision: 0,
    provenance: params.provenance,
    fieldProvenance: params.fieldProvenance ?? {},
    visibility: params.visibility ?? 'public',
    dependencyIds: params.dependencyIds ?? [],
    definition: params.definition,
  };
}

// ---------------------------------------------------------------------------
// Proposal cleaning: unknown fields are dropped, invalid enums reject the
// whole entry into the review queue, safe defaults fill optional fields.
// ---------------------------------------------------------------------------

interface CleanContext {
  knownFactIds: Set<string>;
  rejected: Array<{ kind: string; id: string; reasons: string[] }>;
}

interface CleanedProposals {
  skills: ContentEntry[];
  constraints: ContentEntry[];
  lore: ContentEntry[];
}

interface RawActorTemplate {
  entryId: string;
  entry: ContentEntry;
  attackSkillIds: string[];
  weaponSkillIds: string[];
}

function rejectEntry(ctx: CleanContext, kind: string, id: string, reasons: string[]): void {
  ctx.rejected.push({ kind, id, reasons });
}

function cleanProvenance(
  ctx: CleanContext,
  raw: Record<string, unknown>,
  fallbackKind: Provenance['kind'],
  fallbackRationale: string,
  reasons?: string[],
): Provenance | null {
  const kind = (asString(raw.provenanceKind) ?? fallbackKind) as Provenance['kind'];
  if (!PROVENANCE_KINDS.includes(kind)) {
    reasons?.push(`unknown provenanceKind ${String(raw.provenanceKind)}.`);
    return null;
  }
  const evidenceFactIds = asStringArray(raw.evidenceFactIds).filter(id => ctx.knownFactIds.has(id));
  // Evidence honesty gate (unified P2/U07): explicit/inferred claims assert
  // the novel says so - without a surviving evidence fact that is exactly the
  // "no evidence masquerading as explicit" failure. rule_mapping/design_fill
  // stay allowed with empty evidence (honest labels for local values).
  if ((kind === 'explicit' || kind === 'inferred') && evidenceFactIds.length === 0) {
    reasons?.push('explicit/inferred provenance requires evidence fact ids (U07).');
    return null;
  }
  return {
    kind,
    sourceFactIds: evidenceFactIds,
    rationale: asString(raw.rationale) ?? fallbackRationale,
  };
}

function skillEntryId(id: string): string {
  return `skill-${id}`;
}

/** Shared rule-system floor used for progressive openings and complete builds. */
export function createProgressiveBaselineEntries(): ContentEntry[] {
  const entries = DEFAULT_SKILLS.map(defaults => makeEntry({
    entryId: skillEntryId(defaults.id),
    kind: 'skill',
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: DESIGN_FILL_RATIONALE },
    definition: {
      name: defaults.name,
      description: defaults.description,
      attribute: defaults.attribute,
      allowUntrained: defaults.allowUntrained,
      requirements: [],
      powerTier: 'ordinary',
    },
  }));
  entries.push(makeEntry({
    entryId: 'common-guard-template',
    kind: 'actor_template',
    provenance: {
      kind: 'design_fill',
      sourceFactIds: [],
      rationale: '设计补全：遭遇兜底用的普通人守卫模板。',
    },
    visibility: 'gm',
    dependencyIds: [skillEntryId('sword')],
    fieldProvenance: {
      hp: { kind: 'design_fill', sourceFactIds: [], rationale: DESIGN_FILL_RATIONALE },
      stamina: { kind: 'design_fill', sourceFactIds: [], rationale: DESIGN_FILL_RATIONALE },
      defense: { kind: 'design_fill', sourceFactIds: [], rationale: DESIGN_FILL_RATIONALE },
      threat: { kind: 'design_fill', sourceFactIds: [], rationale: DESIGN_FILL_RATIONALE },
    },
    definition: {
      name: '普通人守卫',
      category: 'human',
      description: '集镇或门派里最普通的守卫，用于兜底遭遇。',
      attributes: { physique: 1, agility: 1 },
      skills: { [skillEntryId('sword')]: 'trained' },
      hp: 6,
      stamina: 4,
      defense: 2,
      attacks: [{ name: '棍棒', skillId: skillEntryId('sword'), damage: 1, range: 'touch' }],
      abilities: [],
      behavior: { goal: '守住岗位，驱散闹事者', retreatThreshold: 0.25, morale: 'steady' },
      lootPolicy: '无掉落',
      threat: { damage: 1, durability: 1, actions: 1, control: 0, environment: 0 },
    },
  }));
  return entries;
}

function itemEntryId(id: string): string {
  return id.startsWith('item-') ? id : `item-${id}`;
}

function cleanSkill(raw: unknown, ctx: CleanContext): ContentEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = slugId(record.id);
  const name = asString(record.name);
  const reasons: string[] = [];
  if (!id) reasons.push('missing or invalid id.');
  if (!name) reasons.push('missing name.');
  const rawAttribute = asString(record.attribute);
  const attribute = rawAttribute ? normalizeEnum(rawAttribute, ATTRIBUTE_SYNONYMS) : null;
  if (!attribute || !ATTRIBUTES.includes(attribute)) reasons.push(`unknown attribute ${String(record.attribute)}.`);
  const provenance = cleanProvenance(ctx, record, 'inferred', '映射自小说事实的模型提案。', reasons);
  if (reasons.length > 0 || !id || !name || !attribute || !provenance) {
    rejectEntry(ctx, 'skill', id ?? String(record.id ?? '?'), reasons);
    return null;
  }
  const requirements = Array.isArray(record.requirements)
    ? asStringArray(record.requirements)
    : [];
  const allowUntrained = typeof record.allowUntrained === 'boolean' ? record.allowUntrained : false;
  const rawPowerTier = asString(record.powerTier);
  const powerTier = rawPowerTier ? normalizeEnum(rawPowerTier, POWER_TIER_SYNONYMS) : 'ordinary';
  if (!POWER_TIERS.includes(powerTier)) {
    rejectEntry(ctx, 'skill', id, [`unknown powerTier ${String(record.powerTier)}.`]);
    return null;
  }
  // Usage (unified P2/A07): only attack-usage skills compile into attack
  // actions; the default is utility and an unknown value degrades to it.
  const rawUsage = asString(record.usage);
  const usage = SKILL_USAGES.includes(rawUsage ?? '') ? rawUsage as SkillDefinition['usage'] : 'utility';
  return makeEntry({
    entryId: skillEntryId(id),
    kind: 'skill',
    provenance,
    definition: {
      name,
      description: asString(record.description) ?? name,
      attribute,
      usage,
      allowUntrained,
      requirements,
      powerTier,
    },
  });
}

function cleanConstraint(raw: unknown, ctx: CleanContext): ContentEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = slugId(record.id);
  const name = asString(record.name);
  const reasons: string[] = [];
  if (!id) reasons.push('missing or invalid id.');
  if (!name) reasons.push('missing name.');
  const provenance = cleanProvenance(ctx, record, 'inferred', '映射自小说事实的模型提案。');
  if (!provenance) reasons.push('invalid provenance.');
  if (reasons.length > 0 || !id || !name || !provenance) {
    rejectEntry(ctx, 'constraint', id ?? String(record.id ?? '?'), reasons);
    return null;
  }
  const enforcement = asString(record.enforcement) ?? 'audit';
  if (!ENFORCEMENTS.includes(enforcement)) {
    rejectEntry(ctx, 'constraint', id, [`unknown enforcement ${enforcement}.`]);
    return null;
  }
  const definition: Record<string, unknown> = {
    name,
    description: asString(record.description) ?? name,
    enforcement,
  };
  const pattern = asString(record.pattern);
  if (pattern) definition.pattern = pattern;
  return makeEntry({ entryId: `constraint-${id}`, kind: 'constraint', provenance, definition });
}

/**
 * WorldMapper V2 rule-mapping cleaning (1M plan P4): the target must be a
 * known entity name, the kind whitelisted, and every evidenceFactId must be
 * a fact id from the provided list - the same evidence discipline as
 * cleanProvenance. A mapping without surviving evidence is rejected whole.
 */
function cleanRuleMapping(
  raw: unknown,
  ctx: CleanContext,
  entityNameIndex: Map<string, string>,
  worldId: string,
): StoredRuleMapping | null {
  const record = asRecord(raw);
  if (!record) return null;
  const target = asString(record.target);
  const kind = asString(record.kind);
  if (!target || !kind) return null;
  if (!['attribute', 'skill', 'power_tier', 'resource'].includes(kind)) return null;
  const targetEntityId = entityNameIndex.get(target);
  if (!targetEntityId) return null;
  const evidenceRefs = asStringArray(record.evidenceFactIds).filter(id => ctx.knownFactIds.has(id));
  if (evidenceRefs.length === 0) return null;
  const mapping = asRecord(record.mapping) ?? {};
  return {
    worldId,
    mappingId: ruleMappingIdFor(worldId, targetEntityId, kind as StoredRuleMapping['mappingKind'], mapping),
    targetEntityId,
    mappingKind: kind as StoredRuleMapping['mappingKind'],
    mapping,
    evidenceRefs,
    rulesetVersion: SHINEWORD_RULESET_VERSION,
    status: 'active',
  };
}

function cleanItemEffects(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const effects: Array<Record<string, unknown>> = [];
  for (const candidate of raw) {
    const record = asRecord(candidate);
    if (!record) continue;
    const op = asString(record.op);
    if (!op || !EFFECT_OPS.includes(op)) continue; // unknown ops are dropped, never published
    const effect: Record<string, unknown> = { op };
    const amount = asFiniteNumber(record.amount);
    if (amount !== null) effect.amount = amount;
    const conditionId = asString(record.conditionId);
    if (conditionId) effect.conditionId = conditionId;
    const resource = asString(record.resource);
    if (resource) effect.resource = resource;
    effects.push(effect);
  }
  return effects;
}

function cleanItem(raw: unknown, ctx: CleanContext): { entry: ContentEntry; weaponSkillId: string | null } | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = slugId(record.id);
  const name = asString(record.name);
  const reasons: string[] = [];
  if (!id) reasons.push('missing or invalid id.');
  if (!name) reasons.push('missing name.');
  const provenance = cleanProvenance(ctx, record, 'inferred', '映射自小说事实的模型提案。');
  if (!provenance) reasons.push('invalid provenance.');
  if (reasons.length > 0 || !id || !name || !provenance) {
    rejectEntry(ctx, 'item', id ?? String(record.id ?? '?'), reasons);
    return null;
  }
  const category = asString(record.category) ?? 'tool';
  if (!ITEM_CATEGORIES.includes(category)) {
    rejectEntry(ctx, 'item', id, [`unknown category ${category}.`]);
    return null;
  }
  const weaponSkillId = slugId(record.weaponSkillId);
  const definition: Record<string, unknown> = {
    name,
    description: asString(record.description) ?? name,
    category,
    effects: cleanItemEffects(record.effects),
    unique: record.unique === true,
  };
  const armorReduction = asFiniteNumber(record.armorReduction);
  if (armorReduction !== null) definition.armorReduction = armorReduction;
  const weaponBonusDice = asFiniteNumber(record.weaponBonusDice);
  if (weaponBonusDice !== null) definition.weaponBonusDice = weaponBonusDice;
  if (weaponSkillId) definition.weaponSkillId = skillEntryId(weaponSkillId);
  return {
    entry: makeEntry({ entryId: `item-${id}`, kind: 'item', provenance, definition }),
    weaponSkillId: weaponSkillId ? skillEntryId(weaponSkillId) : null,
  };
}

function cleanLore(raw: unknown, ctx: CleanContext): ContentEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = slugId(record.id);
  const name = asString(record.name);
  const reasons: string[] = [];
  if (!id) reasons.push('missing or invalid id.');
  if (!name) reasons.push('missing name.');
  const provenance = cleanProvenance(ctx, record, 'inferred', '映射自小说事实的模型提案。');
  if (!provenance) reasons.push('invalid provenance.');
  if (reasons.length > 0 || !id || !name || !provenance) {
    rejectEntry(ctx, 'lore', id ?? String(record.id ?? '?'), reasons);
    return null;
  }
  return makeEntry({
    entryId: `lore-${id}`,
    kind: 'lore',
    provenance,
    definition: {
      name,
      title: asString(record.title) ?? name,
      text: typeof record.text === 'string' ? record.text : '',
    },
  });
}

function cleanActorTemplate(raw: unknown, ctx: CleanContext): RawActorTemplate | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = slugId(record.id);
  const name = asString(record.name);
  const reasons: string[] = [];
  if (!id) reasons.push('missing or invalid id.');
  if (!name) reasons.push('missing name.');
  const hp = asFiniteNumber(record.hp);
  const defense = asFiniteNumber(record.defense);
  // Combat readiness (plan §7.2) requires positive hp and defense; the model
  // must supply them, local code never invents combat stats for canon NPCs.
  if (hp === null || hp <= 0) reasons.push('hp must be a positive number.');
  if (defense === null || defense <= 0) reasons.push('defense must be a positive number.');
  const provenance = cleanProvenance(ctx, record, 'rule_mapping', '映射自小说事实的模型提案；数值为规则映射值。');
  if (!provenance) reasons.push('invalid provenance.');
  if (reasons.length > 0 || !id || !name || hp === null || defense === null || !provenance) {
    rejectEntry(ctx, 'actor_template', id ?? String(record.id ?? '?'), reasons);
    return null;
  }
  const category = asString(record.category) ?? 'human';
  if (!ACTOR_CATEGORIES.includes(category)) {
    rejectEntry(ctx, 'actor_template', id, [`unknown category ${category}.`]);
    return null;
  }

  const attackSkillIds: string[] = [];
  const attacks: Array<Record<string, unknown>> = [];
  if (Array.isArray(record.attacks)) {
    for (const candidate of record.attacks) {
      const attack = asRecord(candidate);
      if (!attack) continue;
      const skillId = slugId(attack.skillId);
      if (!skillId) continue;
      const damage = asFiniteNumber(attack.damage) ?? 1;
      const range = asString(attack.range) ?? 'touch';
      if (!ATTACK_RANGES.includes(range)) continue;
      attackSkillIds.push(skillEntryId(skillId));
      attacks.push({
        name: asString(attack.name) ?? '攻击',
        skillId: skillEntryId(skillId),
        damage: damage > 0 ? damage : 1,
        range,
      });
    }
  }

  const stamina = asFiniteNumber(record.stamina);
  const threatRecord = asRecord(record.threat);
  const behaviorRecord = asRecord(record.behavior);
  const morale = asString(behaviorRecord?.morale) ?? 'steady';
  const retreatThreshold = asFiniteNumber(behaviorRecord?.retreatThreshold) ?? 0.25;
  const threatDamage = asFiniteNumber(threatRecord?.damage) ?? Math.max(1, ...attacks.map(a => Number(a.damage)));

  const ruleMappingField: Provenance = {
    kind: 'rule_mapping',
    sourceFactIds: provenance.sourceFactIds,
    rationale: '数值化为游戏规则值，非原著事实。',
  };
  // Skill RANKS on a template are game-rule translations (unified P2): the
  // template's possession of the skill is evidence-backed, the trained/master
  // ladder value is a local rule mapping unless a skill ruleMapping says
  // otherwise - so ranks stay traceable, never silently "explicit".
  const skillRankField: Provenance = {
    kind: 'rule_mapping',
    sourceFactIds: provenance.sourceFactIds,
    rationale: '技能等级为规则映射值；技能归属本身来自证据事实。',
  };
  const definition: Record<string, unknown> = {
    name,
    category,
    description: asString(record.description) ?? name,
    attributes: asRecord(record.attributes) ?? {},
    skills: asRecord(record.skills) ?? {},
    hp,
    stamina: stamina !== null && stamina >= 0 ? stamina : 4,
    defense,
    attacks,
    abilities: asStringArray(record.abilities),
    behavior: {
      goal: asString(behaviorRecord?.goal) ?? '依原著动机行动',
      retreatThreshold: retreatThreshold >= 0 && retreatThreshold <= 1 ? retreatThreshold : 0.25,
      morale: MORALE.includes(morale) ? morale : 'steady',
    },
    lootPolicy: asString(record.lootPolicy) ?? '无掉落',
    threat: {
      damage: threatDamage > 0 ? threatDamage : 1,
      durability: asFiniteNumber(threatRecord?.durability) ?? 1,
      actions: asFiniteNumber(threatRecord?.actions) ?? 1,
      control: asFiniteNumber(threatRecord?.control) ?? 0,
      environment: asFiniteNumber(threatRecord?.environment) ?? 0,
    },
  };
  const lootItemIds = [...new Set(asStringArray(record.lootItemIds)
    .map(slugId)
    .filter((id): id is string => id !== null)
    .map(itemEntryId))];
  if (lootItemIds.length > 0) definition.lootItemIds = lootItemIds;
  return {
    entryId: `npc-${id}`,
    entry: makeEntry({
      entryId: `npc-${id}`,
      kind: 'actor_template',
      provenance,
      definition,
      visibility: 'gm',
      dependencyIds: lootItemIds,
      fieldProvenance: {
        hp: ruleMappingField,
        stamina: ruleMappingField,
        defense: ruleMappingField,
        threat: ruleMappingField,
        ...(Object.keys(definition.skills as Record<string, unknown>).length > 0 ? { skills: skillRankField } : {}),
        ...(attacks.length > 0 ? { attacks: skillRankField } : {}),
        ...(lootItemIds.length > 0 ? { lootItemIds: ruleMappingField } : {}),
      },
    }),
    attackSkillIds,
    weaponSkillIds: [],
  };
}

// ---------------------------------------------------------------------------
// Mapping call + degradation
// ---------------------------------------------------------------------------

interface MapperPromptPayload {
  facts: Array<{
    factId: string;
    subject: string;
    predicate: string;
    value: Record<string, unknown>;
    /** World-time window and reveal gating travel WITH the fact (G05). */
    validFrom?: string | null;
    validTo?: string | null;
    revealAt?: string | null;
  }>;
  entities: Array<{ entityId: string; type: string; name: string }>;
  events: Array<{ eventId: string; title: string; summary: string }>;
}

function buildMapperUserPrompt(
  facts: readonly StoredFact[],
  entities: readonly StoredEntity[],
  events: readonly StoredEvent[],
): string {
  const nameByEntity = new Map(entities.map(entity => [entity.entityId, entity.name]));
  const payload: MapperPromptPayload = {
    facts: facts.map(fact => ({
      factId: fact.factId,
      subject: nameByEntity.get(fact.subjectEntityId) ?? fact.subjectEntityId,
      predicate: fact.predicate,
      value: fact.value,
      validFrom: fact.validFrom ?? null,
      validTo: fact.validTo ?? null,
      revealAt: fact.revealAt ?? null,
    })),
    entities: entities.map(entity => ({ entityId: entity.entityId, type: entity.type, name: entity.name })),
    events: events.map(event => ({ eventId: event.eventId, title: event.title, summary: event.summary })),
  };
  return JSON.stringify(payload);
}

async function requestMappingProposals(
  input: BuildPackageInput,
  facts: readonly StoredFact[],
  entities: readonly StoredEntity[],
  events: readonly StoredEvent[],
  knownFactIds: Set<string>,
): Promise<{
  proposals: CleanedProposals;
  usage: unknown | null;
  actorTemplates: RawActorTemplate[];
  items: Array<{ entry: ContentEntry; weaponSkillId: string | null }>;
  rejected: Array<{ kind: string; id: string; reasons: string[] }>;
  mappedFactCount: number;
  batches: number;
  /** Closeout C3: per-batch usage plus cache-hit accounting. */
  usagePerBatch: Array<unknown | null>;
  skippedBatches: number;
  /** WorldMapper V2: rule mappings that passed evidence checks (plan P4). */
  ruleMappingCount: number;
}> {
  // Batched mapping (P2 acceptance G04): EVERY mappable fact is offered to the
  // mapper — a single 800-fact call used to silently drop the rest and still
  // publish "complete" books. Batches run sequentially; each failure fails the
  // whole mapping honestly instead of pretending coverage.
  // WorldMapper V2 (1M plan P4): a resident run maps with WHOLE-BOOK vision -
  // one batch with every fact (the 800-fact truncation lifts), full entity
  // and event context, rule-mapping proposals included.
  const batches: Array<readonly StoredFact[]> = [];
  if (input.resident) {
    batches.push(facts);
  } else {
    for (let offset = 0; offset < facts.length; offset += MAX_PROMPT_FACTS) {
      batches.push(facts.slice(offset, offset + MAX_PROMPT_FACTS));
    }
  }

  const skills: ContentEntry[] = [];
  const constraints: ContentEntry[] = [];
  const lore: ContentEntry[] = [];
  const actorTemplates: RawActorTemplate[] = [];
  const items: Array<{ entry: ContentEntry; weaponSkillId: string | null }> = [];
  const allRejected: Array<{ kind: string; id: string; reasons: string[] }> = [];
  const usagePerBatch: Array<unknown | null> = [];
  let mappedFactCount = 0;
  let skippedBatches = 0;
  let ruleMappingCount = 0;
  // Closeout C3: entries are keyed for MERGE, not first-wins — a later batch
  // extending an existing entryId unions its fact provenance; incompatible
  // definitions surface as review rejections instead of silent drops.
  const entriesById = new Map<string, ContentEntry>();
  const templatesById = new Map<string, RawActorTemplate>();
  const itemsById = new Map<string, { entry: ContentEntry; weaponSkillId: string | null }>();

  const mergeEntry = (entry: ContentEntry | null, kind: 'skill' | 'constraint' | 'lore'): void => {
    if (!entry) return;
    const existing = entriesById.get(entry.entryId);
    if (!existing) {
      entriesById.set(entry.entryId, entry);
      if (kind === 'skill') skills.push(entry);
      else if (kind === 'constraint') constraints.push(entry);
      else lore.push(entry);
      return;
    }
    const mergedFactIds = new Set([...existing.provenance.sourceFactIds, ...entry.provenance.sourceFactIds]);
    const sameDefinition = JSON.stringify(existing.definition) === JSON.stringify(entry.definition);
    if (sameDefinition || existing.revision === entry.revision) {
      existing.provenance = {
        ...existing.provenance,
        sourceFactIds: [...mergedFactIds],
      };
      return;
    }
    // Incompatible redefinition of the same entryId across batches: keep the
    // first definition and record the conflict for review - never silently
    // overwrite (plan §7.3).
    allRejected.push({
      kind: 'conflict',
      id: entry.entryId,
      reasons: [`later batch redefined ${entry.entryId} with a different definition`],
    });
  };

  const entityNameIndex = new Map(entities.map(entity => [entity.name, entity.entityId]));

  for (let index = 0; index < batches.length; index += 1) {
    if (input.signal?.aborted) throw new Error('World package mapping canceled.');
    const batch = batches[index]!;
    input.onProgress?.({
      phase: 'mapping',
      message: input.resident
        ? `LLM 全书视野规则映射 ${index + 1}/${batches.length}（单批 ${batch.length} 条事实）`
        : `LLM 映射事实批次 ${index + 1}/${batches.length}（每批至多 ${MAX_PROMPT_FACTS} 条）`,
    });

    // Closeout C3: resume - a batch already completed for the same fact set
    // and mapping version is skipped instead of re-paying the request.
    const batchHash = await input.sha256Hex(batch.map(fact => fact.factId).join("|"))
    const batchJobId = `job-map-${input.worldId}-b${String(index + 1).padStart(4, '0')}`;
    const doneJob = await input.worldStore.getJob(input.worldId, batchJobId);
    if (doneJob?.status === 'done' && doneJob.contentHash === batchHash
      && doneJob.extractorVersion === `mapper-${input.mappingVersion}`) {
      skippedBatches += 1;
      mappedFactCount += batch.length;
      usagePerBatch.push(doneJob?.usageJson ? JSON.parse(doneJob.usageJson) : null);
      continue;
    }

    let relatedEntities: readonly StoredEntity[];
    let relatedEvents: readonly StoredEvent[];
    if (input.resident) {
      // Whole-book vision: no trimming (1M plan P4).
      relatedEntities = entities;
      relatedEvents = events;
    } else {
      // Closeout C3: per-batch context, not the whole world - subjects of this
      // batch plus entities named inside fact values, plus a bounded event set.
      const relatedIds = new Set<string>(batch.map(fact => fact.subjectEntityId));
      for (const fact of batch) {
        const valueJson = JSON.stringify(fact.value);
        for (const [name, entityId] of entityNameIndex) {
          if (relatedIds.has(entityId)) continue;
          if (name.length >= 2 && valueJson.includes(name)) relatedIds.add(entityId);
        }
      }
      relatedEntities = entities.filter(entity => relatedIds.has(entity.entityId));
      const relatedNames = new Set(relatedEntities.map(entity => entity.name));
      relatedEvents = events
        .filter(event => [...relatedNames].some(name =>
          name.length >= 2 && (event.title.includes(name) || event.summary.includes(name))))
        .slice(0, 300);
    }

    const response = await input.provider.complete({
      role: CANON_MAPPER_ROLE,
      system: MAPPER_SYSTEM,
      user: buildMapperUserPrompt(batch, relatedEntities, relatedEvents),
      maxOutputTokens: input.resident ? RESIDENT_MAPPING_MAX_OUTPUT_TOKENS : MAPPING_MAX_OUTPUT_TOKENS,
      jsonMode: true,
    });
    if (input.signal?.aborted) throw new Error('World package mapping canceled.');
    const raw = parseStrictJsonObject<Record<string, unknown>>(response.text, 'WorldMapper mapping output');
    const proposalKeys = ['skills', 'constraints', 'actorTemplates', 'items', 'lore'];
    if (!proposalKeys.some(key => Array.isArray(raw[key]))) {
      throw new Error('WorldMapper mapping output has no recognizable proposal arrays.');
    }
    usagePerBatch.push(response.usage ?? null);

    const ctx: CleanContext = { knownFactIds, rejected: [] };
    // WorldMapper V2 (plan P4): evidence-verified rule mappings land through
    // the store's idempotent path; rejects surface in the review queue.
    if (Array.isArray(raw.ruleMappings)) {
      for (const candidate of raw.ruleMappings) {
        const mapping = cleanRuleMapping(candidate, ctx, entityNameIndex, input.worldId);
        if (!mapping) {
          rejectEntry(ctx, 'rule_mapping', String((asRecord(candidate) ?? {}).target ?? '?'),
            ['unknown target, kind, or no verified evidenceFactIds.']);
          continue;
        }
        await input.worldStore.saveRuleMapping(mapping, input.createdAt);
        ruleMappingCount += 1;
      }
    }
    for (const candidate of Array.isArray(raw.skills) ? raw.skills : []) mergeEntry(cleanSkill(candidate, ctx), 'skill');
    for (const candidate of Array.isArray(raw.constraints) ? raw.constraints : []) mergeEntry(cleanConstraint(candidate, ctx), 'constraint');
    for (const candidate of Array.isArray(raw.lore) ? raw.lore : []) mergeEntry(cleanLore(candidate, ctx), 'lore');
    for (const candidate of Array.isArray(raw.actorTemplates) ? raw.actorTemplates : []) {
      const cleaned = cleanActorTemplate(candidate, ctx);
      if (!cleaned) continue;
      const existing = templatesById.get(cleaned.entryId);
      if (!existing) {
        templatesById.set(cleaned.entryId, cleaned);
        actorTemplates.push(cleaned);
      } else {
        const merged = new Set([...existing.entry.provenance.sourceFactIds, ...cleaned.entry.provenance.sourceFactIds]);
        existing.entry.provenance = { ...existing.entry.provenance, sourceFactIds: [...merged] };
      }
    }
    for (const candidate of Array.isArray(raw.items) ? raw.items : []) {
      const cleaned = cleanItem(candidate, ctx);
      if (!cleaned) continue;
      const existing = itemsById.get(cleaned.entry.entryId);
      if (!existing) {
        itemsById.set(cleaned.entry.entryId, cleaned);
        items.push(cleaned);
      } else {
        const merged = new Set([...existing.entry.provenance.sourceFactIds, ...cleaned.entry.provenance.sourceFactIds]);
        existing.entry.provenance = { ...existing.entry.provenance, sourceFactIds: [...merged] };
      }
    }
    mappedFactCount += batch.length;
    allRejected.push(...ctx.rejected);

    // Persist the batch checkpoint AFTER its results are merged in memory;
    // a crash before this write re-runs exactly this batch, nothing else.
    await input.worldStore.upsertJob({
      worldId: input.worldId,
      jobId: batchJobId,
      kind: 'rule_mapping',
      targetId: null,
      status: 'done',
      attempts: (doneJob?.attempts ?? 0) + 1,
      contentHash: batchHash,
      extractorVersion: `mapper-${input.mappingVersion}`,
      modelFingerprint: null,
      usageJson: JSON.stringify({
        usage: response.usage ?? null,
        requestMetrics: response.requestMetrics ?? [],
      }),
      resultJson: JSON.stringify({ facts: batch.length }),
      error: null,
      createdAt: doneJob?.createdAt ?? input.createdAt,
      updatedAt: input.createdAt,
    }, input.createdAt);
  }

  return {
    proposals: { skills, constraints, lore },
    usage: usagePerBatch.filter(Boolean).length > 0
      ? { batches: usagePerBatch, skippedBatches }
      : null,
    actorTemplates,
    items,
    rejected: allRejected,
    mappedFactCount,
    batches: batches.length,
    usagePerBatch,
    skippedBatches,
    ruleMappingCount,
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function buildSections(entries: readonly ContentEntry[]): BookSection[] {
  const byKind = (kind: EntryKind, visibility?: EntryVisibility): string[] =>
    entries
      .filter(entry => entry.kind === kind && (visibility === undefined || entry.visibility === visibility))
      .map(entry => entry.entryId);

  const worldLore = entries
    .filter(entry => entry.kind === 'lore' && entry.entryId !== 'lore-review-summary')
    .map(entry => entry.entryId);
  const reviewLore = entries.filter(entry => entry.entryId === 'lore-review-summary').map(entry => entry.entryId);
  const skills = byKind('skill');
  const constraints = byKind('constraint');
  const templates = byKind('actor_template');
  const items = byKind('item');

  let playerPosition = 0;
  let gmPosition = 0;
  let manualPosition = 0;
  const sections: BookSection[] = [];
  const push = (section: Omit<BookSection, 'position'>): void => {
    if (section.entryIds.length === 0) return; // empty sections are noise, skip entirely
    sections.push({ ...section, position: section.book === 'player_handbook' ? playerPosition++ : section.book === 'gm_guide' ? gmPosition++ : manualPosition++ });
  };

  push({ book: 'player_handbook', sectionKey: 'world', title: '世界设定', entryIds: worldLore });
  push({ book: 'player_handbook', sectionKey: 'skills', title: '技能', entryIds: skills });
  push({ book: 'player_handbook', sectionKey: 'constraints', title: '世界约束', entryIds: constraints });
  push({ book: 'gm_guide', sectionKey: 'constraints', title: '世界约束', entryIds: constraints });
  push({ book: 'gm_guide', sectionKey: 'review', title: '冲突与审核摘要', entryIds: reviewLore });
  push({ book: 'gm_guide', sectionKey: 'npcs', title: '人物模板', entryIds: templates });
  push({ book: 'gm_guide', sectionKey: 'items', title: '物品', entryIds: items });
  push({ book: 'monster_manual', sectionKey: 'creatures', title: '对手图鉴', entryIds: templates });
  return sections;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Builds and publishes a world package revision from canon facts. Never
 * throws for LLM problems (parse failures degrade to local design_fill);
 * only unresolved canon conflicts or unrecoverable validation failures throw.
 */
export async function buildPackageFromCanon(input: BuildPackageInput): Promise<BuildPackageResult> {
  const { worldStore, worldId } = input;
  const progress = (phase: string, message?: string): void => input.onProgress?.({ phase, message });

  if (input.stageScope) {
    // Stage coverage: the built prefix must be contiguous from 0 with no
    // holes; the whole-text guard below only applies to whole-source builds.
    const stage = input.stageScope;
    let cursor = 0;
    for (const range of [...stage.ranges].sort((a, b) => a.startCodePoint - b.startCodePoint)) {
      if (range.startCodePoint !== cursor) {
        throw new Error('阶段来源范围不连续（起点必须为 0 且无缺口），不会发布阶段包。');
      }
      cursor = range.endCodePoint;
    }
  } else if (input.sourceRanges?.length
    && !sourceRangesCoverWholeText(input.sourceRanges, input.sourceCodePointCount ?? 0)) {
    throw new Error('无法证明已抽取的来源范围连续覆盖全文，因此不会发布全量精编包。');
  }
  if (input.signal?.aborted) throw new Error('World package mapping canceled.');

  progress('load', '读取小说事实、事件与实体');
  const [allFacts, events, entities] = await Promise.all([
    worldStore.listFacts(worldId),
    worldStore.listEvents(worldId),
    worldStore.listEntities(worldId),
  ]);
  // Stage scoping (unified P3): a stage package maps only facts whose
  // evidence lies inside the built prefix. Facts without recorded spans are
  // world-level synthetics (e.g. opening facts) and stay in scope.
  const stageRanges = input.stageScope?.ranges;
  const factInRange = (fact: typeof allFacts[number]): boolean => {
    if (!stageRanges || stageRanges.length === 0) return true;
    if (!fact.sources || fact.sources.length === 0) return true;
    return fact.sources.some(span =>
      stageRanges.some(range => span.endOffset > range.startCodePoint && span.startOffset < range.endCodePoint));
  };
  const scopedFacts = allFacts.filter(factInRange);
  const mappableFacts = scopedFacts.filter(fact => fact.status === 'explicit' || fact.status === 'inference');
  const conflictFacts = scopedFacts.filter(fact => fact.status === 'conflict');
  const knownFactIds = new Set(allFacts.map(fact => fact.factId));

  let reviewIssueCount = 0;

  // d. Conflict detection: conflicting canon facts block publication until a
  // human resolves the review queue.
  if (conflictFacts.length > 0) {
    await worldStore.saveReviewIssue({
      worldId,
      issueId: 'canon-conflict',
      kind: 'canon_conflict',
      severity: 'blocking',
      detailJson: JSON.stringify({
        factIds: conflictFacts.map(fact => fact.factId),
        count: conflictFacts.length,
      }),
      createdAt: input.createdAt,
    });
    reviewIssueCount += 1;
  } else {
    // This attempt found no conflicting facts, so the notice recorded by an
    // earlier one describes a condition that no longer holds. Leaving it open
    // would block publication forever with a message the user cannot act on.
    // (reviewIssueCount only counts issues this build *records*.)
    await worldStore.resolveReviewIssuesByPrefix(worldId, ['canon-conflict']);
  }

  // A world with NOTHING mappable and no conflicts has no novel content at
  // all - publishing a generic design_fill package for it would masquerade as
  // this novel's three books (P2 acceptance G04).
  if (mappableFacts.length === 0 && conflictFacts.length === 0) {
    throw new Error(
      '这个世界没有任何可映射的小说事实，未发布任何版本。请先完成抽取（或修复失败的文本块），再进入三宝书映射。',
    );
  }

  // b. Batched LLM mapping over ALL mappable facts. Any failure (network,
  // parse, structure) degrades to the pure local baseline — but the result is
  // published as an explicitly labeled needs_review PREVIEW, never as the
  // novel's complete three books (P2 acceptance G04).
  progress('mapping', 'LLM 映射小说事实为世界包条目提案');
  let mappingUsage: unknown | null = null;
  let proposals: CleanedProposals = { skills: [], constraints: [], lore: [] };
  let actorTemplates: RawActorTemplate[] = [];
  let items: Array<{ entry: ContentEntry; weaponSkillId: string | null }> = [];
  let mappingSucceeded = false;
  let mappedFactCount = 0;
  let mappingBatches = 0;
  try {
    const mapped = await requestMappingProposals(input, mappableFacts, entities, events, knownFactIds);
    proposals = mapped.proposals;
    // Closeout C3: aggregate usage across batches (sum token counters,
    // OR the estimated flags) instead of keeping only the last response.
    const usages = (mapped.usagePerBatch ?? []).filter((u): u is Record<string, unknown> =>
      typeof u === 'object' && u !== null);
    if (usages.length === 1) {
      mappingUsage = usages[0];
    } else if (usages.length > 1) {
      const aggregate: Record<string, unknown> = {};
      for (const usage of usages) {
        for (const [key, value] of Object.entries(usage)) {
          if (typeof value === 'number' && typeof aggregate[key] === 'number') {
            aggregate[key] = (aggregate[key] as number) + value;
          } else if (typeof value === 'boolean') {
            aggregate[key] = (aggregate[key] === true) || value;
          } else if (!(key in aggregate)) {
            aggregate[key] = value;
          }
        }
      }
      aggregate.batches = usages.length;
      aggregate.skippedBatches = mapped.skippedBatches;
      mappingUsage = aggregate;
    }
    actorTemplates = mapped.actorTemplates;
    items = mapped.items;
    mappedFactCount = mapped.mappedFactCount;
    mappingBatches = mapped.batches;
    mappingSucceeded = true;
    // The mapping produced a package, so the `mapping-failed` blocking notice of
    // an earlier attempt (typically a transient network error) no longer
    // describes reality. It used to stay open forever: the gate kept refusing
    // publication with "映射失败：未生成任何世界包" even though the retry had just
    // succeeded, and the only way out was a manual waive of a stale message.
    // Previous rejection rows are retired here too and re-derived from THIS
    // attempt below, so the queue always shows the current mapping's verdict.
    await worldStore.resolveReviewIssuesByPrefix(worldId, ['mapping-failed', 'invalid-proposal']);
    // Rejected proposals (invalid enums, missing ids, unknown attributes) go
    // to the review queue as major issues instead of entering the package.
    for (const rejection of mapped.rejected) {
      await worldStore.saveReviewIssue({
        worldId,
        issueId: `invalid-proposal-${rejection.kind}-${rejection.id}`,
        kind: 'invalid_proposal',
        severity: 'major',
        detailJson: JSON.stringify(rejection),
        createdAt: input.createdAt,
      });
      reviewIssueCount += 1;
    }
  } catch (error) {
    if (input.signal?.aborted) throw new Error('World package mapping canceled.');
    // Mapping failed: NO package revision is created. The extracted facts,
    // entities and events are already persisted, so re-entering the build
    // resumes from them; a generic default package must never masquerade as
    // this novel's complete three books (P2 acceptance G04).
    await worldStore.saveReviewIssue({
      worldId,
      issueId: 'mapping-failed',
      kind: 'mapping_failed',
      severity: 'blocking',
      detailJson: JSON.stringify({
        reason: error instanceof Error ? error.message : String(error),
        note: '映射失败：未生成任何世界包。已完成的抽取成果已保存，重新进入构建可续建。',
      }),
      createdAt: input.createdAt,
    });
    throw new Error(
      `小说→三宝书映射失败，未发布任何版本：${error instanceof Error ? error.message : String(error)}。` +
        '抽取成果已保存，重新构建将从已完成的进度续建。',
    );
  }

  // c. Local deterministic cleaning results + design_fill baseline.
  const entries: ContentEntry[] = [];

  const acceptedSkillIds = new Set(proposals.skills.map(entry => entry.entryId));
  for (const skill of proposals.skills) entries.push(skill);
  for (const constraint of proposals.constraints) entries.push(constraint);
  for (const lore of proposals.lore) entries.push(lore);

  // Fill missing baseline skills with conservative design_fill defaults.
  const baselineEntries = createProgressiveBaselineEntries();
  for (const entry of baselineEntries.filter(candidate => candidate.kind === 'skill')) {
    if (acceptedSkillIds.has(entry.entryId)) continue;
    entries.push(entry);
    acceptedSkillIds.add(entry.entryId);
  }

  // Encounter fallback template, always present (design_fill).
  entries.push(baselineEntries.find(entry => entry.entryId === 'common-guard-template')!);

  // LLM actor templates: keep attack skill references that resolve after the
  // baseline fill; dangling ones are dropped instead of blocking publication.
  for (const template of actorTemplates) {
    const definition = template.entry.definition as Record<string, unknown>;
    const attacks = (definition.attacks as Array<Record<string, unknown>>)
      .filter(attack => acceptedSkillIds.has(String(attack.skillId)));
    definition.attacks = attacks;
    const lootItemIds = Array.isArray(definition.lootItemIds)
      ? definition.lootItemIds.filter((itemId): itemId is string => typeof itemId === 'string')
      : [];
    template.entry.dependencyIds = [...new Set([
      ...attacks.map(attack => String(attack.skillId)),
      ...lootItemIds,
    ])];
    entries.push(template.entry);
  }

  for (const item of items) {
    item.entry.dependencyIds = item.weaponSkillId && acceptedSkillIds.has(item.weaponSkillId)
      ? [item.weaponSkillId]
      : [];
    entries.push(item.entry);
  }

  // GM-facing review summary: conflict facts and open issues, always attached.
  const openIssues = await worldStore.listReviewIssues(worldId, 'open');
  const summaryParts = [
    `本世界包基于 ${mappableFacts.length} 条已采纳事实构建（映射分 ${mappingBatches} 批全部覆盖）。`,
    conflictFacts.length > 0
      ? `检测到 ${conflictFacts.length} 条冲突事实，发布被阻止，需 GM 仲裁。`
      : '未检测到冲突事实。',
    `当前开放审核问题 ${openIssues.length} 条。`,
  ];
  entries.push(makeEntry({
    entryId: 'lore-review-summary',
    kind: 'lore',
    provenance: {
      kind: 'inferred',
      sourceFactIds: conflictFacts.map(fact => fact.factId),
      rationale: '审核摘要：由本地冲突检测与审核队列状态生成。',
    },
    visibility: 'gm',
    definition: {
      name: '审核摘要',
      title: '本包审核状态',
      text: summaryParts.join(''),
    },
  }));

  const sections = buildSections(entries);

  // g. Publish with explicit coverage accounting. Validation failure FAILS —
  // silently retrying with a stripped design_fill package used to smuggle a
  // generic world out as the novel's books (P2 acceptance G04).
  progress('publish', '校验并发布世界包');
  if (input.signal?.aborted) throw new Error('World package mapping canceled.');
  const result = await publishWorldPackage({
    worldStore,
    sha256Hex: input.sha256Hex,
    worldId,
    sourceSha256: input.sourceSha256,
    mappingVersion: input.mappingVersion,
    entries,
    sections,
    createdAt: input.createdAt,
    ...(input.stageScope ? {
      buildScope: {
        strategy: 'progressive' as const,
        scope: input.stageScope.coversWholeText ? 'whole_source' as const : 'incremental' as const,
        completeness: input.stageScope.coversWholeText ? 'complete' as const : 'partial' as const,
        sourceRanges: input.stageScope.ranges.map(range => ({ ...range })),
      },
    } : input.sourceRanges?.length ? {
      buildScope: {
        strategy: 'full' as const,
        scope: 'whole_source' as const,
        completeness: 'complete' as const,
        sourceRanges: input.sourceRanges.map(range => ({ ...range })),
      },
    } : {}),
    coverage: {
      mappableFacts: mappableFacts.length,
      factsOfferedToMapper: mappedFactCount,
      mappingBatches,
      mappingSucceeded,
      novelEntries: entries.filter(entry => entry.provenance.kind !== 'design_fill').length,
      designFillEntries: entries.filter(entry => entry.provenance.kind === 'design_fill').length,
    },
  });
  progress('published', '全量精编三宝书已通过发布校验');
  return { manifest: result.manifest, entries, sections, reviewIssues: reviewIssueCount, mappingUsage };
}
