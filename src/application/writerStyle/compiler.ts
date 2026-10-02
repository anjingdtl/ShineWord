import { estimateTokens } from '../context/tokenEstimate';
import type { EffectiveStyleSnapshotV1, StyleOverridesV1, StyleSemanticV1 } from '../../domain/style/types';
import { validateStyleOverrides, validateStyleSemantic } from '../../domain/style/validation';
import type { KnownParticipantVoice, VoiceExpression } from './ports';
import { STYLE_EXPRESSION_BOUNDARY } from '../../domain/style/defaults';
export { STYLE_EXPRESSION_BOUNDARY } from '../../domain/style/defaults';

export type StyleProjectionLevel = EffectiveStyleSnapshotV1['projectionLevel'];
export interface CompiledStyleProjection { level: StyleProjectionLevel; text: string; tokenEstimate: number; semantic: StyleSemanticV1 }
const protectedFields: readonly (keyof StyleSemanticV1)[] = ['pointOfView', 'tone', 'prohibitions'];
const compactFields: readonly (keyof StyleSemanticV1)[] = [...protectedFields, 'texture', 'pacing', 'verbosity', 'extraInstructions'];
const standardFields: readonly (keyof StyleSemanticV1)[] = [...compactFields, 'syntax', 'dialogue', 'characterVoice', 'environment', 'informationReveal', 'continuity', 'actionPresentation'];
const voiceFields = new Set<keyof VoiceExpression>(['characterVoice', 'dialogue', 'syntax', 'vocabulary']);

export function resolveStyleSemantic(baseline: StyleSemanticV1, overrides: StyleOverridesV1): StyleSemanticV1 {
  validateStyleSemantic(baseline); validateStyleOverrides(overrides);
  return { ...baseline, ...overrides, prohibitions: [...(overrides.prohibitions ?? baseline.prohibitions)] };
}

function sceneExpression(sceneKind: string): StyleOverridesV1 {
  switch (sceneKind) {
    case 'combat': return { pacing: '动作紧凑，关键变化清楚', syntax: '短句为主' };
    case 'investigation': return { pacing: '观察与行动交替', sensory: '当下可感知细节' };
    case 'dialogue': return { dialogue: '话语与动作自然交替', pacing: '给对话留适量停顿' };
    case 'rest': return { pacing: '舒缓、简练', environment: '少量近处环境描写' };
    default: return {};
  }
}

function validateVoices(voices: readonly KnownParticipantVoice[], ids: readonly string[]): KnownParticipantVoice[] {
  const seen = new Set<string>();
  return voices.slice(0, 5).map(voice => {
    if (voice.knownToPlayer !== true || !ids.includes(voice.participantId) || seen.has(voice.participantId)) {
      throw new Error('invalid_style_voice_scope');
    }
    seen.add(voice.participantId);
    validateStyleOverrides(voice.expression);
    if (Object.keys(voice.expression).some(key => !voiceFields.has(key as keyof VoiceExpression))) {
      throw new Error('invalid_style_voice_field');
    }
    return { ...voice, expression: { ...voice.expression } };
  });
}

/** No remote calls. Every projection is measured against the caller's hard input allowance. */
export function compileWriterStyle(input: {
  baseline: StyleSemanticV1; overrides: StyleOverridesV1; sceneKind: string;
  participantIds: readonly string[]; voices?: readonly KnownParticipantVoice[]; tokenAllowance: number;
}): CompiledStyleProjection {
  if (!Number.isSafeInteger(input.tokenAllowance) || input.tokenAllowance < 0) throw new Error('invalid_style_token_allowance');
  const semantic = resolveStyleSemantic({ ...input.baseline, ...sceneExpression(input.sceneKind) }, input.overrides);
  const voices = validateVoices(input.voices ?? [], input.participantIds).map(voice => ({
    participantId: voice.participantId,
    // Explicit project choices remain authoritative over scene and voice overlays.
    expression: Object.fromEntries(Object.entries(voice.expression).filter(([key]) => !(key in input.overrides))),
  })).filter(voice => Object.keys(voice.expression).length > 0);
  const options: readonly [StyleProjectionLevel, readonly (keyof StyleSemanticV1)[]][] = [
    ['detailed', Object.keys(semantic) as (keyof StyleSemanticV1)[]],
    ['standard', standardFields], ['compact', compactFields], ['minimal', protectedFields],
  ];
  for (const [level, fields] of options) {
    const projection = Object.fromEntries(fields.map(field => [field, semantic[field]]));
    const text = `${STYLE_EXPRESSION_BOUNDARY}\n${JSON.stringify(projection)}${level !== 'minimal' && voices.length ? `\n人物表达:${JSON.stringify(voices)}` : ''}`;
    const tokenEstimate = estimateTokens(text);
    if (tokenEstimate <= input.tokenAllowance) return { level, text, tokenEstimate, semantic };
  }
  // Never discard a user's prohibition or POV silently to pretend a budget fits.
  throw new Error('style_budget_infeasible');
}
