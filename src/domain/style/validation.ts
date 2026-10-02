import type { EffectiveStyleSnapshotV1, StyleOverridesV1, StyleSemanticV1 } from './types';
import { STYLE_EXPRESSION_BOUNDARY } from './defaults';

export const STYLE_FIELDS = [
  'genre', 'tone', 'audience', 'pointOfView', 'narratorDistance', 'interiority',
  'texture', 'syntax', 'vocabulary', 'paragraphStructure', 'environment',
  'characterPresentation', 'characterVoice', 'dialogue', 'pacing', 'conflict',
  'informationReveal', 'suspense', 'continuity', 'imagery', 'sensory',
  'prohibitions', 'extraInstructions', 'verbosity', 'recapPreference', 'actionPresentation',
] as const satisfies readonly (keyof StyleSemanticV1)[];
const allowed = new Set<string>(STYLE_FIELDS);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const id = (value: unknown): value is string => typeof value === 'string'
  && value.trim().length > 0 && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

/** These are descriptors, never executable instructions or model configuration. */
export function validateStyleText(value: unknown, field: string, maxLength = 160): asserts value is string {
  if (typeof value !== 'string' || Array.from(value).length > maxLength
    || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error(`invalid_style_field:${field}`);
  }
  // Reject role delimiters, endpoint/credential/budget settings, authority
  // changes and knowledge expansion. JSON quoting below is a second boundary.
  const text = value.normalize('NFKC');
  if (/(?:https?:\/\/|sk-[A-Za-z0-9]|api[ _-]?key|endpoint|max[ _-]?tokens|context[ _-]?window|temperature|top[ _-]?p|<\/?(?:system|assistant|developer)|\[\/?(?:INST|SYSTEM)\]|\[im_start\]|\[im_end\]|system\s*:|developer\s*:|ignore\s+(?:all\s+)?(?:previous|prior|instructions|rules|results)|override\s+(?:rules|results|system)|reveal\s+(?:future|secret|identity)|change\s+(?:outcome|result))/iu.test(text)
    || /(?:忽略|无视|覆盖|绕过|修改|改变|推翻).{0,12}(?:系统|规则|指令|权限|裁定|检定|结果|事实|预算)|(?:透露|揭露|告知|泄露|展示).{0,12}(?:未来|后续|秘密|身份|未公开|未获知)|(?:失败|未成功).{0,8}(?:写成|改成|变为|视为|转为|成功)|(?:隐藏|隐瞒|省略).{0,8}(?:检定|裁定|结果|关键状态)|(?:全知|上帝视角|系统提示|开发者指令|越权|未来剧情|后续人物|真实身份|真凶|幕后身份|其实是)/u.test(text)) {
    throw new Error(`unsafe_style_field:${field}`);
  }
}

export function validateStyleOverrides(value: unknown): asserts value is StyleOverridesV1 {
  if (!record(value)) throw new Error('invalid_style_overrides');
  for (const [field, item] of Object.entries(value)) {
    if (!allowed.has(field)) throw new Error(`unknown_style_field:${field}`);
    if (field === 'pointOfView') {
      if (item !== 'second_person' && item !== 'limited_third') throw new Error('invalid_style_pointOfView');
    } else if (field === 'verbosity') {
      if (!['concise', 'standard', 'rich'].includes(String(item))) throw new Error('invalid_style_verbosity');
    } else if (field === 'prohibitions') {
      if (!Array.isArray(item) || item.length > 12) throw new Error('invalid_style_prohibitions');
      for (const text of item) validateStyleText(text, field, 80);
    } else {
      validateStyleText(item, field, field === 'extraInstructions' ? 320 : 160);
    }
  }
}

export function validateStyleSemantic(value: unknown): asserts value is StyleSemanticV1 {
  validateStyleOverrides(value);
  if (STYLE_FIELDS.some(field => !(field in value))) throw new Error('incomplete_style_semantic');
}

/** Runtime gate for portable, self-contained historical snapshots. */
export function validateStyleSnapshot(value: unknown): asserts value is EffectiveStyleSnapshotV1 {
  if (!record(value) || !id(value.snapshotId) || !id(value.projectId) || !id(value.branchId)
    || !id(value.turnId) || !id(value.styleId) || !id(value.styleVersion)
    || !(value.sourceProfileVersion === null || id(value.sourceProfileVersion))
    || !Number.isSafeInteger(value.userOverrideVersion) || Number(value.userOverrideVersion) < 0
    || value.compilerVersion !== 'trpg-style-compiler-1'
    || !['minimal', 'compact', 'standard', 'detailed'].includes(String(value.projectionLevel))
    || !hash(value.compiledHash) || typeof value.compiledText !== 'string'
    || value.compiledText.length > 16000 || !id(value.sceneKind)
    || !Array.isArray(value.participantIds) || value.participantIds.length > 5
    || !value.participantIds.every(id) || new Set(value.participantIds).size !== value.participantIds.length
    || !Number.isSafeInteger(value.tokenEstimate) || Number(value.tokenEstimate) < 0) throw new Error('invalid_style_snapshot');
  validateStyleSemantic(value.semantic);
  validateCompiledStyleProjection(value.compiledText, value.semantic, value.participantIds as string[]);
}

/** A rehashed portable save cannot smuggle arbitrary narrator directives. */
export function validateCompiledStyleProjection(text: string, semantic: StyleSemanticV1, participantIds: readonly string[]): void {
  if (!text.startsWith(`${STYLE_EXPRESSION_BOUNDARY}\n`)) throw new Error('invalid_style_projection_boundary');
  const parts = text.slice(STYLE_EXPRESSION_BOUNDARY.length + 1).split('\n人物表达:');
  if (parts.length > 2) throw new Error('invalid_style_projection');
  const projection: unknown = JSON.parse(parts[0]!);
  validateStyleOverrides(projection);
  if (!['pointOfView', 'tone', 'prohibitions'].every(key => key in projection)
    || Object.entries(projection).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(semantic[key as keyof StyleSemanticV1]))) throw new Error('style_projection_semantic_mismatch');
  if (parts[1] !== undefined) {
    const voices: unknown = JSON.parse(parts[1]);
    if (!Array.isArray(voices) || voices.length > 5) throw new Error('invalid_style_projection_voices');
    const seen = new Set<string>();
    for (const voice of voices) {
      if (!record(voice) || Object.keys(voice).some(key => !['participantId', 'expression'].includes(key))
        || !id(voice.participantId) || !participantIds.includes(voice.participantId) || seen.has(voice.participantId)) throw new Error('invalid_style_projection_voice_scope');
      seen.add(voice.participantId); validateStyleOverrides(voice.expression);
      if (Object.keys(voice.expression).some(key => !['characterVoice', 'dialogue', 'syntax', 'vocabulary'].includes(key))) throw new Error('invalid_style_projection_voice_field');
    }
  }
}

export function validateStyleId(value: unknown): asserts value is string {
  if (!id(value)) throw new Error('invalid_style_id');
}

export function isEffectiveStyleSnapshotV1(value: unknown): value is EffectiveStyleSnapshotV1 {
  try { validateStyleSnapshot(value); return true; } catch { return false; }
}
