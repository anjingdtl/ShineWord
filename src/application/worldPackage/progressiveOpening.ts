import type { BookSection, ContentEntry, Provenance, WorldPackageManifest } from '../../domain/content/types';
import type { ApiProfile, LlmPhysicalRequestMetric, LlmProvider, LlmRequest, LlmUsage } from '../llm/types';
import { LlmRequestFailure } from '../llm/types';
import type { FactSourceSpan, StoredChapter } from '../ports/worldStore';
import type { SqliteWorldStore } from '../../infra/sqlite/sqliteWorldStore';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
import { codePointLength } from '../../domain/world/textOffsets';
import { parseStrictJsonObject } from '../llm/json';
import { createProgressiveBaselineEntries, buildSections } from './buildPackageFromCanon';
import { publishWorldPackage } from './publish';
import { modelBudgetFromProfile } from '../worldBuild/profileModelBudget';

export const OPENING_DOSSIER_VERSION = 'opening-dossier-1';
export const OPENING_SOURCE_BUDGET_CODE_POINTS = 8_000;
const OPENING_EVIDENCE_BUDGET_CODE_POINTS = 1_600;
const DOSSIER_OUTPUT_TOKEN_LIMIT = 8_000;

/**
 * Uses the saved phone profile before reading/requesting. Two model tokens per
 * CJK code point is a conservative context-capacity bound, not a latency
 * estimate; provider-reported usage remains authoritative after the call.
 */
export function openingSourceBudgetForProfile(profile: ApiProfile, availableCodePoints: number): {
  sourceCodePoints: number;
  maxOutputTokens: number;
} {
  const modelBudget = modelBudgetFromProfile(profile);
  const maxOutputTokens = Math.min(DOSSIER_OUTPUT_TOKEN_LIMIT, modelBudget.maxOutputTokens);
  const promptAllowance = modelBudget.contextWindowTokens - maxOutputTokens
    - modelBudget.reserveTokens - 1_500;
  const desired = Math.min(availableCodePoints, OPENING_SOURCE_BUDGET_CODE_POINTS);
  if (promptAllowance < desired * 2) throw new OpeningPreparationError('profile_budget');
  return { sourceCodePoints: desired, maxOutputTokens };
}

/** Only facts needed to establish the first playable scene are accepted. */
export interface OpeningDossier {
  locationName: string;
  locationQuote: string;
  setting: string;
  settingQuote: string;
  situation: string;
  situationQuote: string;
  initialGoal: string;
  goalQuote: string;
  unknowns: string[];
}

export interface OpeningDossierResult {
  dossier: OpeningDossier;
  requestMetrics: LlmPhysicalRequestMetric[];
  usage: LlmUsage | null;
  physicalRequests: number;
  repairUsed: boolean;
}

/**
 * Fine-grained, desensitized stage label for the coarse `category`. It lets a
 * release failure be attributed to one exact stage (F3.1) without ever storing
 * prompt text, novel text, or the model response. It carries no model output.
 */
export type OpeningFailureDetail =
  | 'json_parse'
  | 'schema'
  | 'citation'
  | 'reference_closure'
  | 'compile'
  | 'publish';

export class OpeningPreparationError extends Error {
  constructor(
    readonly category: 'provider_failure' | 'profile_budget' | 'empty_completion' | 'invalid_dossier' | 'package_validation',
    readonly requestMetrics: readonly LlmPhysicalRequestMetric[] = [],
    readonly detail?: OpeningFailureDetail,
  ) {
    super(category === 'provider_failure'
      ? '开局资料请求失败，可稍后重试。'
      : category === 'profile_budget'
        ? '所选模型的上下文预算不足以安全整理开篇，请检查模型配置。'
      : category === 'empty_completion'
        ? '模型没有返回可用的开局资料；推理仍保持当前配置。'
        : category === 'invalid_dossier'
          ? '开局资料未通过原文引文校验，请稍后重试。'
          : '开局范围包未通过发布校验。');
    this.name = 'OpeningPreparationError';
  }

  /** Coarse category plus the desensitized stage, e.g. `invalid_dossier:citation`. */
  get errorCode(): string {
    return this.detail ? `${this.category}:${this.detail}` : this.category;
  }
}

const DOSSIER_SYSTEM = [
  '你是 ShineWord 的开局资料整理器。只读取给定小说开头，为第一幕提取一个可玩的场景。',
  '只输出一个 JSON 对象，不要解释、Markdown、隐藏字段或规则数值。',
  '格式：{"locationName":string,"locationQuote":string,"setting":string,"settingQuote":string,"situation":string,"situationQuote":string,"initialGoal":string,"goalQuote":string,"unknowns":string[]}',
  '严格只整理小说最初场景，不整理后续章节、后续事件、伏笔答案、人物秘密或尚未揭示的信息。',
  '四个 quote 必须逐字出自输入开头 1600 个码点内；不得改写或拼接。locationName 必须能在 locationQuote 中找到。',
  'setting、situation、initialGoal 要简短、面向玩家且只概述当前已经发生的内容。无法确定地点或当前目标时，把问题写入 unknowns，不要猜测。',
  '不得创建或改写骰点、属性、技能、成长、伤害或其他游戏规则；规则由本地规则集提供。',
].join('\n');

/** Canonical request construction is shared by the app and the live probe. */
export function openingDossierRequest(sourceExcerpt: string, maxOutputTokens = DOSSIER_OUTPUT_TOKEN_LIMIT): LlmRequest {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > DOSSIER_OUTPUT_TOKEN_LIMIT) {
    throw new Error('Opening dossier output allowance is invalid.');
  }
  return {
    role: 'Extractor',
    system: DOSSIER_SYSTEM,
    user: [
      '仅使用以下小说开头整理第一幕。输入可能包含更后的内容，必须忽略它们；所有引文限制在本段的前 1600 个码点。',
      '小说开头（本段最多 8000 个码点）：',
      sourceExcerpt,
    ].join('\n'),
    maxOutputTokens,
    jsonMode: true,
  };
}

function boundedText(value: unknown, maxCodePoints: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  const length = codePointLength(result);
  return length > 0 && length <= maxCodePoints ? result : null;
}

function parseDossier(raw: string, sourceExcerpt: string): OpeningDossier {
  let object: Record<string, unknown>;
  try {
    object = parseStrictJsonObject<Record<string, unknown>>(raw, 'opening dossier');
  } catch {
    throw new OpeningPreparationError('invalid_dossier', [], 'json_parse');
  }
  const locationName = boundedText(object.locationName, 64);
  const locationQuote = boundedText(object.locationQuote, 240);
  const setting = boundedText(object.setting, 320);
  const settingQuote = boundedText(object.settingQuote, 240);
  const situation = boundedText(object.situation, 420);
  const situationQuote = boundedText(object.situationQuote, 240);
  const initialGoal = boundedText(object.initialGoal, 180);
  const goalQuote = boundedText(object.goalQuote, 240);
  const firstScene = Array.from(sourceExcerpt).slice(0, OPENING_EVIDENCE_BUDGET_CODE_POINTS).join('');
  const quotes = [locationQuote, settingQuote, situationQuote, goalQuote];
  if (!locationName || !locationQuote || !setting || !settingQuote || !situation || !situationQuote
    || !initialGoal || !goalQuote) {
    throw new OpeningPreparationError('invalid_dossier', [], 'schema');
  }
  if (quotes.some(quote => !quote || codePointLength(quote) < 4 || !firstScene.includes(quote))
    || !locationQuote.includes(locationName)) {
    throw new OpeningPreparationError('invalid_dossier', [], 'citation');
  }
  const unknowns = Array.isArray(object.unknowns)
    ? object.unknowns.map(value => boundedText(value, 120)).filter((value): value is string => Boolean(value)).slice(0, 5)
    : [];
  return { locationName, locationQuote, setting, settingQuote, situation, situationQuote, initialGoal, goalQuote, unknowns };
}

function sourceFailureMetrics(error: unknown): LlmPhysicalRequestMetric[] {
  return error instanceof LlmRequestFailure ? [...error.requestMetrics] : [];
}

/** One normal request, with at most one bounded JSON/evidence repair request. */
export async function extractOpeningDossier(input: {
  provider: LlmProvider;
  sourceExcerpt: string;
  maxOutputTokens?: number;
}): Promise<OpeningDossierResult> {
  const request = openingDossierRequest(input.sourceExcerpt, input.maxOutputTokens);
  let firstText: string;
  let metrics: LlmPhysicalRequestMetric[] = [];
  let usage: LlmUsage | null = null;
  try {
    const response = await input.provider.complete(request);
    firstText = response.text;
    metrics.push(...(response.requestMetrics ?? []));
    usage = response.usage ?? null;
  } catch (error) {
    throw new OpeningPreparationError('provider_failure', sourceFailureMetrics(error));
  }
  if (!firstText.trim()) throw new OpeningPreparationError('empty_completion', metrics);
  try {
    return {
      dossier: parseDossier(firstText, input.sourceExcerpt),
      requestMetrics: metrics,
      usage,
      physicalRequests: metrics.length || 1,
      repairUsed: false,
    };
  } catch {
    // Keep the rejected output in memory only; never persist or log it.
    let repairMetrics: LlmPhysicalRequestMetric[] = [];
    try {
      const repaired = await input.provider.complete({
        ...request,
        user: `${request.user}\n上一版未通过本地 JSON/引文验证。请仅按规定格式修正，不要补充新事实。\n待修正 JSON：\n${firstText}`,
      });
      repairMetrics = [...(repaired.requestMetrics ?? [])];
      if (!repaired.text.trim()) throw new OpeningPreparationError('empty_completion', [...metrics, ...repairMetrics]);
      const dossier = parseDossier(repaired.text, input.sourceExcerpt);
      return {
        dossier,
        requestMetrics: [...metrics, ...repairMetrics],
        usage: sumUsage(usage, repaired.usage ?? null),
        physicalRequests: metrics.length + repairMetrics.length || 2,
        repairUsed: true,
      };
    } catch (error) {
      if (error instanceof OpeningPreparationError) {
        throw new OpeningPreparationError(
          error.category,
          [...metrics, ...repairMetrics, ...error.requestMetrics],
          error.detail,
        );
      }
      throw new OpeningPreparationError('invalid_dossier', [...metrics, ...repairMetrics, ...sourceFailureMetrics(error)]);
    }
  }
}

function sumUsage(a: LlmUsage | null, b: LlmUsage | null): LlmUsage | null {
  if (!a) return b;
  if (!b) return a;
  const sum = (left?: number, right?: number): number | undefined =>
    left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    reasoningTokens: sum(a.reasoningTokens, b.reasoningTokens),
    cachedInputTokens: sum(a.cachedInputTokens, b.cachedInputTokens),
    estimated: a.estimated || b.estimated,
  };
}

async function evidenceSpan(input: {
  quote: string;
  sourceExcerpt: string;
  chapters: readonly StoredChapter[];
  sha256Hex: Sha256HexProvider['sha256Hex'];
}): Promise<FactSourceSpan> {
  const firstScene = Array.from(input.sourceExcerpt).slice(0, OPENING_EVIDENCE_BUDGET_CODE_POINTS).join('');
  const utf16Start = firstScene.indexOf(input.quote);
  if (utf16Start < 0) throw new OpeningPreparationError('invalid_dossier', [], 'reference_closure');
  const startOffset = codePointLength(firstScene.slice(0, utf16Start));
  const endOffset = startOffset + codePointLength(input.quote);
  const chapter = input.chapters.find(item => startOffset >= item.startOffset && endOffset <= item.endOffset);
  if (!chapter) throw new OpeningPreparationError('invalid_dossier', [], 'reference_closure');
  return {
    chapterId: chapter.chapterId,
    startOffset,
    endOffset,
    quote: input.quote,
    quoteSha256: (await input.sha256Hex(input.quote)).toLowerCase(),
  };
}

function provenance(kind: Provenance['kind'], sourceFactIds: string[], rationale: string): Provenance {
  return { kind, sourceFactIds, rationale };
}

/** Compiles a strictly bounded dossier into the existing immutable package gate. */
export async function compileProgressiveOpeningPackage(input: {
  worldStore: SqliteWorldStore;
  sha256Hex: Sha256HexProvider['sha256Hex'];
  worldId: string;
  sourceSha256: string;
  sourceExcerpt: string;
  sourceEndCodePoint: number;
  chapters: readonly StoredChapter[];
  dossier: OpeningDossier;
  requestMetrics: readonly LlmPhysicalRequestMetric[];
  usage: LlmUsage | null;
  extractionMs: number;
  createdAt: string;
}): Promise<{ manifest: WorldPackageManifest; entries: ContentEntry[]; sections: BookSection[] }> {
  const [rangeHash, locationEvidence, settingEvidence, situationEvidence, goalEvidence] = await Promise.all([
    input.sha256Hex(input.sourceExcerpt),
    evidenceSpan({ quote: input.dossier.locationQuote, sourceExcerpt: input.sourceExcerpt, chapters: input.chapters, sha256Hex: input.sha256Hex }),
    evidenceSpan({ quote: input.dossier.settingQuote, sourceExcerpt: input.sourceExcerpt, chapters: input.chapters, sha256Hex: input.sha256Hex }),
    evidenceSpan({ quote: input.dossier.situationQuote, sourceExcerpt: input.sourceExcerpt, chapters: input.chapters, sha256Hex: input.sha256Hex }),
    evidenceSpan({ quote: input.dossier.goalQuote, sourceExcerpt: input.sourceExcerpt, chapters: input.chapters, sha256Hex: input.sha256Hex }),
  ]);
  const locationEntityId = `ent-${input.worldId}-opening-location`;
  const factIds = {
    location: `fact-${input.worldId}-opening-location`,
    setting: `fact-${input.worldId}-opening-setting`,
    situation: `fact-${input.worldId}-opening-situation`,
    goal: `fact-${input.worldId}-opening-goal`,
  };
  const timestamp = input.createdAt;
  await input.worldStore.upsertEntity({
    worldId: input.worldId,
    entityId: locationEntityId,
    type: 'location',
    name: input.dossier.locationName,
    firstSeenChapterId: locationEvidence.chapterId,
    aliases: [],
  }, timestamp);
  const evidenceFacts = [
    { factId: factIds.location, predicate: 'opening_location', value: { name: input.dossier.locationName }, status: 'explicit' as const, source: locationEvidence },
    { factId: factIds.setting, predicate: 'opening_setting', value: { text: input.dossier.setting }, status: 'inference' as const, source: settingEvidence },
    { factId: factIds.situation, predicate: 'opening_situation', value: { text: input.dossier.situation }, status: 'inference' as const, source: situationEvidence },
    { factId: factIds.goal, predicate: 'opening_goal', value: { text: input.dossier.initialGoal }, status: 'inference' as const, source: goalEvidence },
  ];
  for (const fact of evidenceFacts) {
    await input.worldStore.saveFact({
      worldId: input.worldId,
      factId: fact.factId,
      subjectEntityId: locationEntityId,
      predicate: fact.predicate,
      value: fact.value,
      status: fact.status,
      confidence: fact.status === 'explicit' ? 1 : 0.75,
      validFrom: null,
      validTo: null,
      revealAt: '1',
      scope: 'opening',
      sources: [fact.source],
    }, timestamp);
  }

  const entries = createProgressiveBaselineEntries();
  entries.push({
    entryId: 'lore-progressive-opening',
    kind: 'lore',
    revision: 0,
    provenance: provenance('inferred', [factIds.setting], '仅由开篇范围内逐字核验的证据整理。'),
    fieldProvenance: { text: provenance('inferred', [factIds.setting], '改写已核验的开篇证据，不包含后续章节信息。') },
    visibility: 'public',
    dependencyIds: [],
    definition: {
      name: '开局资料',
      title: '开篇场景',
      text: input.dossier.setting,
    },
  });
  entries.push({
    entryId: 'scene-progressive-opening',
    kind: 'scene',
    revision: 0,
    provenance: provenance('inferred', [factIds.location, factIds.situation, factIds.goal], '场景与目标只从开篇原文证据编译。'),
    fieldProvenance: {
      name: provenance('explicit', [factIds.location], '地点名由逐字匹配的原文引文确认。'),
      description: provenance('inferred', [factIds.situation, factIds.goal], '仅概述当前场景与眼前目标。'),
      locationId: provenance('design_fill', [], '本地开局场景的稳定地点 ID。'),
      zones: provenance('design_fill', [], '依据固定场景模板生成一个可操作区域。'),
    },
    visibility: 'public',
    dependencyIds: [],
    definition: {
      name: input.dossier.locationName,
      description: `${input.dossier.situation}\n眼前目标：${input.dossier.initialGoal}`,
      locationId: 'opening-location',
      zones: [{ zoneId: 'opening-zone', name: input.dossier.locationName, cover: false, exits: [] }],
      actors: [],
      visibleItems: [],
      hazards: [],
      clues: [],
    },
  });
  const sections = buildSections(entries);
  try {
    const published = await publishWorldPackage({
      worldStore: input.worldStore,
      sha256Hex: input.sha256Hex,
      worldId: input.worldId,
      sourceSha256: input.sourceSha256,
      mappingVersion: `${OPENING_DOSSIER_VERSION}#local-template-1`,
      entries,
      sections,
      status: 'published',
      buildScope: {
        strategy: 'progressive',
        scope: 'opening',
        completeness: 'partial',
        sourceRanges: [{
          startCodePoint: 0,
          endCodePoint: input.sourceEndCodePoint,
          contentSha256: rangeHash,
        }],
        packageLineage: { kind: 'base' },
      },
      coverage: {
        progressiveOpening: {
          dossierVersion: OPENING_DOSSIER_VERSION,
          sourceCodePoints: input.sourceEndCodePoint,
          evidenceCodePoints: Math.min(input.sourceEndCodePoint, OPENING_EVIDENCE_BUDGET_CODE_POINTS),
          extractionMs: input.extractionMs,
          physicalRequests: input.requestMetrics.length,
          requestMetrics: input.requestMetrics,
          usage: input.usage,
          unresolvedQuestions: input.dossier.unknowns,
        },
      },
      createdAt: timestamp,
    });
    return { manifest: published.manifest, entries, sections };
  } catch {
    throw new OpeningPreparationError('package_validation', input.requestMetrics, 'publish');
  }
}
