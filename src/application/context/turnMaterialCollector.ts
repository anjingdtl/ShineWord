/**
 * Typed material collection (P8-1, plan §9): every input becomes either a
 * candidate or a diagnostic — silent drops are forbidden (plan B02). The
 * legacy 【label】 parts are adapted onto typed materials so the existing
 * permission-filtered producers keep working while the collector records
 * anything it cannot classify.
 */

import type { ContextCandidate } from './contextTypes';
import { buildCandidate } from './candidateCollector';
import { estimateTokens } from './tokenEstimate';
import { textRelevance } from './relevance';
import {
  isTurnMaterialKind,
  type AuthorityDomain,
  type MaterialRetention,
  type RenderPolicy,
  type TurnMaterialCandidate,
  type TurnMaterialDiagnostic,
  type VisibilityScope,
} from './turnMaterialTypes';
import { stableFingerprint } from '../../application/llm/requestPlan';

/** Legacy part label → board/heading/kind mapping (collector never does visibility). */
const LABEL_MATERIALS: ReadonlyArray<{
  prefix: string;
  board: ContextCandidate['board'];
  heading: string;
  kind: TurnMaterialCandidate['kind'];
  authorityDomain: AuthorityDomain;
  retention: MaterialRetention;
  boardOverride?: TurnMaterialCandidate['boardOverride'];
}> = [
  { prefix: '【世界】', board: 'worldKnowledge', heading: '世界设定', kind: 'world_entry', authorityDomain: 'world_baseline', retention: 'preferred' },
  { prefix: '【世界规则】', board: 'worldKnowledge', heading: '世界规则', kind: 'rule_summary', authorityDomain: 'rules', retention: 'preferred' },
  { prefix: '【当前位置可调查的隐藏线索引用】', board: 'worldKnowledge', heading: '可调查线索', kind: 'world_entry', authorityDomain: 'viewer_knowledge', retention: 'preferred' },
  { prefix: '【可见人物】', board: 'worldKnowledge', heading: '相关人物', kind: 'character_relationship', authorityDomain: 'viewer_knowledge', retention: 'preferred', boardOverride: 'worldKnowledge' },
  { prefix: '【角色】', board: 'currentState', heading: '队伍', kind: 'actor_state', authorityDomain: 'committed_state', retention: 'mandatory' },
  { prefix: '【当前时刻】', board: 'currentState', heading: '当前时刻', kind: 'situation', authorityDomain: 'committed_state', retention: 'mandatory' },
  { prefix: '【主目标】', board: 'currentState', heading: '当前目标', kind: 'current_objective', authorityDomain: 'story_memory', retention: 'mandatory' },
  { prefix: '【当前局面】', board: 'currentState', heading: '当前局面', kind: 'situation', authorityDomain: 'committed_state', retention: 'mandatory' },
  { prefix: '【相关长期记忆】', board: 'storyMemory', heading: '长期故事状态', kind: 'relevant_recall', authorityDomain: 'story_memory', retention: 'preferred' },
  { prefix: '【未整理补桥】', board: 'storyMemory', heading: '未整理补桥', kind: 'pending_bridge', authorityDomain: 'committed_state', retention: 'preferred' },
  { prefix: '【角色已知线索】', board: 'worldKnowledge', heading: '已知线索', kind: 'world_entry', authorityDomain: 'viewer_knowledge', retention: 'preferred' },
  { prefix: '【最近的经历】', board: 'recentHistory', heading: '最近的经历', kind: 'recent_text', authorityDomain: 'committed_state', retention: 'preferred' },
  { prefix: '【可用技能】', board: 'authority', heading: '可用技能', kind: 'available_actions', authorityDomain: 'rules', retention: 'mandatory' },
];

function boardForKind(material: Pick<TurnMaterialCandidate, 'kind' | 'boardOverride'>): ContextCandidate['board'] {
  switch (material.kind) {
    case 'rule_summary':
    case 'available_actions':
      return 'authority';
    case 'situation':
    case 'actor_state':
    case 'current_objective':
      return 'currentState';
    case 'world_entry':
      return 'worldKnowledge';
    case 'character_relationship':
      return material.boardOverride ?? 'storyMemory';
    case 'pending_bridge':
    case 'relevant_recall':
      return 'storyMemory';
    case 'recent_text':
      return 'recentHistory';
    case 'style':
    case 'task_requirement':
      return 'authority';
    default:
      return 'worldKnowledge';
  }
}

function headingForKind(kind: TurnMaterialCandidate['kind']): string {
  switch (kind) {
    case 'rule_summary': return '规则摘要';
    case 'situation': return '当前局面';
    case 'available_actions': return '可用行动';
    case 'actor_state': return '角色状态';
    case 'world_entry': return '世界条目';
    case 'current_objective': return '当前目标';
    case 'character_relationship': return '人物与关系';
    case 'pending_bridge': return '未整理补桥';
    case 'recent_text': return '近期原文';
    case 'relevant_recall': return '相关往事';
    case 'style': return '文风';
    case 'task_requirement': return '任务要求';
    default: return '材料';
  }
}

export function hashTypedMaterialPayload(payload: Readonly<Record<string, unknown>>): string {
  return stableFingerprint(payload);
}

export function buildTypedMaterial(input: {
  id: string;
  kind: TurnMaterialCandidate['kind'];
  source: TurnMaterialCandidate['source'];
  authorityDomain: AuthorityDomain;
  visibility: VisibilityScope;
  coverage?: TurnMaterialCandidate['coverage'];
  entityIds?: readonly string[];
  retention?: MaterialRetention;
  renderPolicy?: RenderPolicy;
  relevance?: number;
  dependencies?: readonly string[];
  payload: Readonly<Record<string, unknown>>;
  boardOverride?: TurnMaterialCandidate['boardOverride'];
}): TurnMaterialCandidate {
  if (!isTurnMaterialKind(input.kind)) {
    throw new Error(`turn-material-1: unknown material kind ${String(input.kind)}`);
  }
  return {
    id: input.id,
    kind: input.kind,
    source: input.source,
    authorityDomain: input.authorityDomain,
    visibility: input.visibility,
    coverage: input.coverage,
    entityIds: input.entityIds ?? [],
    retention: input.retention ?? 'preferred',
    renderPolicy: input.renderPolicy ?? 'whole_item',
    relevance: input.relevance ?? 0.5,
    dependencies: input.dependencies ?? [],
    payload: input.payload,
    contentHash: hashTypedMaterialPayload({ kind: input.kind, payload: input.payload }),
    ...(input.boardOverride ? { boardOverride: input.boardOverride } : {}),
  };
}

/** Renders a typed material's trusted payload into prompt text. */
export function renderTypedMaterialText(material: TurnMaterialCandidate): string {
  const payload = material.payload as { text?: unknown };
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text.trim();
  return JSON.stringify(material.payload);
}

function materialRequirement(retention: MaterialRetention): ContextCandidate['requirement'] {
  return retention === 'mandatory' ? 'mandatory' : retention === 'preferred' ? 'preferred' : 'optional';
}

/** Converts a typed material into the board candidate consumed by the budget kernel. */
export function typedMaterialToCandidate(
  material: TurnMaterialCandidate,
  queryText: string,
): ContextCandidate | null {
  const text = renderTypedMaterialText(material);
  if (!text) return null;
  const estimated = estimateTokens(text);
  const requirement = materialRequirement(material.retention);
  return buildCandidate({
    id: material.id,
    board: boardForKind(material),
    heading: headingForKind(material.kind),
    text,
    requirement,
    // Board-default priorities keep the existing allocation policy stable;
    // typed materials express relevance, not priority overrides.
    relevance: material.relevance > 0 ? material.relevance : textRelevance(queryText, text),
    minTokens: requirement === 'mandatory' ? estimated : 0,
    targetTokens: estimated,
    clipMode: material.renderPolicy === 'whole_item'
      ? 'whole_item'
      : 'text',
    provenance: {
      sourceType: material.source.sourceType,
      sourceId: material.source.recordId,
      stateVersion: material.coverage?.toStateVersion,
    },
  }, queryText);
}

export interface CollectTypedCandidatesInput {
  /** Legacy permission-filtered 【label】 parts (adapter path). */
  parts?: readonly string[];
  /** Directly provided typed materials. */
  materials?: readonly TurnMaterialCandidate[];
  queryText: string;
}

export interface CollectTypedCandidatesResult {
  candidates: ContextCandidate[];
  diagnostics: TurnMaterialDiagnostic[];
}

/**
 * Collects turn materials. Unknown labels are reported as diagnostics and
 * excluded — a diagnostic is an explicit, auditable drop, never silence.
 */
export function collectTypedCandidates(
  input: CollectTypedCandidatesInput,
): CollectTypedCandidatesResult {
  const candidates: ContextCandidate[] = [];
  const diagnostics: TurnMaterialDiagnostic[] = [];

  for (const material of input.materials ?? []) {
    if (!isTurnMaterialKind(material.kind)) {
      diagnostics.push({ code: 'unknown_material_kind', detail: `material ${material.id}: unknown kind ${String(material.kind)}` });
      continue;
    }
    if (material.dependencies.length > 0) {
      const known = new Set((input.materials ?? []).map(item => item.id));
      const missing = material.dependencies.filter(dep => !known.has(dep));
      if (missing.length > 0) {
        diagnostics.push({ code: 'missing_dependency', detail: `material ${material.id}: missing dependencies ${missing.join(', ')}` });
        continue;
      }
    }
    const candidate = typedMaterialToCandidate(material, input.queryText);
    if (candidate) candidates.push(candidate);
    else diagnostics.push({ code: 'empty_payload', detail: `material ${material.id}: payload rendered to empty text` });
  }

  let index = 0;
  for (const part of input.parts ?? []) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const mapped = LABEL_MATERIALS.find(item => trimmed.startsWith(item.prefix));
    if (mapped) {
      const material = buildTypedMaterial({
        id: `part-${index}`,
        kind: mapped.kind,
        source: { origin: 'campaign', sourceType: 'world_context_part', recordId: `part-${index}` },
        authorityDomain: mapped.authorityDomain,
        visibility: 'party',
        retention: mapped.retention,
        payload: { text: trimmed },
        ...(mapped.boardOverride ? { boardOverride: mapped.boardOverride } : {}),
      });
      const candidate = typedMaterialToCandidate(material, input.queryText);
      if (candidate) candidates.push(candidate);
    } else if (trimmed.startsWith('使用队伍中存在的')) {
      const material = buildTypedMaterial({
        id: 'authority-protocol',
        kind: 'task_requirement',
        source: { origin: 'campaign', sourceType: 'world_context_part', recordId: 'authority-protocol' },
        authorityDomain: 'rules',
        visibility: 'party',
        retention: 'mandatory',
        payload: { text: trimmed },
      });
      const candidate = typedMaterialToCandidate(material, input.queryText);
      if (candidate) candidates.push(candidate);
    } else {
      const excerpt = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
      diagnostics.push({ code: 'unknown_material_label', detail: `unclassified turn material dropped: ${excerpt}` });
    }
    index += 1;
  }

  return { candidates, diagnostics };
}
