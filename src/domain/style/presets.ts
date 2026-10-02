import { DEFAULT_STYLE } from './defaults';
import type { StyleSemanticV1 } from './types';

export interface WriterStylePreset { id: string; version: string; title: string; semantic: StyleSemanticV1 }
const preset = (id: string, title: string, semantic: Partial<StyleSemanticV1>): WriterStylePreset =>
  ({ id, version: '1', title, semantic: { ...DEFAULT_STYLE, ...semantic, prohibitions: [...DEFAULT_STYLE.prohibitions] } });
/** Assets are version-pinned into project bindings; changing this list does not change history. */
export const WRITER_STYLE_PRESETS: readonly WriterStylePreset[] = [
  preset('restrained', '克制日常', { genre: '日常', tone: '温和、克制', pacing: '舒缓且行动明确', texture: '朴素白话', imagery: '少用比喻', verbosity: 'concise' }),
  preset('mystery', '悬疑', { genre: '悬疑', tone: '冷静、紧张', syntax: '短句与停顿交替', suspense: '通过措辞和节奏营造悬念', sensory: '选用声音与光影', pacing: '有张有弛' }),
  preset('heroic', '热血冒险', { genre: '冒险', tone: '昂扬、有力量', syntax: '直接、利落', characterVoice: '坚定，人物语气有区分', pacing: '紧凑鲜明', imagery: '少量有力度的比喻', verbosity: 'rich' }),
  preset('fantasy', '奇幻', { genre: '奇幻', tone: '沉静、奇异', texture: '白话中适量文学色彩', environment: '突出可见奇观与近处细节', imagery: '具体而节制的比喻', sensory: '色彩、声音与触感' }),
  preset('xianxia', '仙侠', { genre: '仙侠', tone: '疏朗、清逸', texture: '白话为主，少量文言', vocabulary: '用词凝练', environment: '山水与近处气息', imagery: '少量自然意象' }),
];
export function getWriterStylePreset(id: string): WriterStylePreset {
  const value = WRITER_STYLE_PRESETS.find(item => item.id === id);
  if (!value) throw new Error(`unknown_style_preset:${id}`);
  return { ...value, semantic: { ...value.semantic, prohibitions: [...value.semantic.prohibitions] } };
}
