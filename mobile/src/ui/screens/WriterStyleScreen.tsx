import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { ProjectStyleViewV1, StyleMode, StyleOverridesV1, StyleSemanticV1 } from '../../../../src/domain/style/types';
import { DEFAULT_STYLE } from '../../../../src/domain/style/defaults';
import { getWriterStylePreset, WRITER_STYLE_PRESETS } from '../../../../src/domain/style/presets';
import type { SourceStyleProfile } from '../../../../src/application/writerStyle/ports';
import { validateStyleOverrides } from '../../../../src/domain/style/validation';
import { getProjectWriterStyle, updateProjectWriterStyle, listProjectStyleSuggestions,
  adoptProjectStyleSuggestion, reanalyzeProjectStyle } from '../../writerStyle';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { SectionHeader } from '../components/SectionHeader';
import { TextField } from '../components/TextField';
import { StatusBanner } from '../components/StatusBanner';
import { typeStyle } from '../components/typography';
import { useTheme } from '../theme/ThemeContext';

type StyleRoute = RouteProp<{ WriterStyle: { worldId: string; title: string } }, 'WriterStyle'>;
const STATUS: Record<ProjectStyleViewV1['analysisStatus'], string> = {
  pending: '原著风格待分析，当前采用默认表达', running: '原著风格分析中，可继续开局与游玩',
  ready: '原著风格已分析', failed: '原著风格分析未完成，可稍后重试', suggestion: '有新的原著风格建议，当前设置保持不变',
};
const MODES: readonly { value: StyleMode; label: string }[] = [
  { value: 'source', label: '跟随原著' }, { value: 'preset', label: '风格预设' }, { value: 'custom', label: '自定义' },
];

export function WriterStyleScreen(): React.JSX.Element {
  const { theme } = useTheme(); const route = useRoute<StyleRoute>(); const navigation = useNavigation();
  const { worldId, title } = route.params;
  const [view, setView] = useState<ProjectStyleViewV1 | null>(null);
  const [suggestions, setSuggestions] = useState<SourceStyleProfile[]>([]);
  const [mode, setMode] = useState<StyleMode>('source'); const [presetId, setPresetId] = useState('restrained');
  const [overrides, setOverrides] = useState<StyleOverridesV1>({}); const [draftVersion, setDraftVersion] = useState('');
  const [advanced, setAdvanced] = useState(false); const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (replaceDraft: boolean) => {
    const [current, options] = await Promise.all([getProjectWriterStyle(worldId), listProjectStyleSuggestions(worldId)]);
    setView(current); setSuggestions(options);
    if (replaceDraft) {
      setMode(current.mode); setOverrides({ ...current.overrides }); setDraftVersion(current.styleVersion);
      if (current.mode === 'preset') setPresetId(current.styleId.split('@')[0] ?? 'restrained');
      setDirty(false);
    }
  }, [worldId]);
  useFocusEffect(useCallback(() => {
    void refresh(true).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]));
  const baseline: StyleSemanticV1 = mode === 'preset' ? getWriterStylePreset(presetId).semantic
    : mode === 'source' && view?.mode !== 'source' ? view?.sourceSemantic ?? suggestions[0]?.semantic ?? { ...DEFAULT_STYLE }
      : view?.semantic ?? { ...DEFAULT_STYLE };
  const effective = { ...baseline, ...overrides };
  function edit(field: keyof StyleSemanticV1, value: string) {
    setOverrides(current => ({ ...current, [field]: value })); setDirty(true); setMessage(null);
  }
  async function save() {
    if (!view || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      validateStyleOverrides(overrides);
      await updateProjectWriterStyle({ projectId: worldId, expectedVersion: draftVersion, mode,
        presetId: mode === 'preset' ? presetId : undefined, overrides });
      await refresh(true); setMessage('已保存，之后的新回合使用此风格。已冻结回合与历史正文保持原样。');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function analyze() {
    if (busy) return; setBusy(true); setError(null);
    try { await reanalyzeProjectStyle(worldId); await refresh(false); setMessage('已读取分析状态，新建议可单独采用。'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function adopt(profile: SourceStyleProfile) {
    if (!view || busy || dirty) return; setBusy(true); setError(null);
    try { await adoptProjectStyleSuggestion(worldId, profile.profileVersion, view.styleVersion); await refresh(true); setMessage('已采用原著风格建议，手动覆盖已保留。'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const fields: readonly [keyof StyleSemanticV1, string][] = [
    ['tone', '基调'], ['texture', '语言质感'], ['pacing', '节奏'],
  ];
  const advancedFields: readonly [keyof StyleSemanticV1, string][] = [
    ['genre', '题材表达'], ['audience', '读者倾向'], ['narratorDistance', '叙述距离'], ['interiority', '内心描写'],
    ['syntax', '句式'], ['vocabulary', '用词'], ['paragraphStructure', '段落'], ['environment', '环境表达'],
    ['characterPresentation', '人物呈现'], ['characterVoice', '人物语气'], ['dialogue', '对白'],
    ['conflict', '冲突表达'], ['informationReveal', '信息组织'], ['suspense', '悬念'], ['continuity', '表达连续性'],
    ['imagery', '意象'], ['sensory', '感官'], ['recapPreference', '回顾偏好'], ['actionPresentation', '动作表达'],
  ];
  return <ScreenShell bottom>
    <Header title="叙述风格" subtitle={title} onBack={() => navigation.goBack()} />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}>
        {error ? <StatusBanner tone="error" message={error} action={<Button variant="chip" label="重新读取" disabled={busy} onPress={() => void refresh(true).catch(e => setError(String(e)))} />} /> : null}
        {message ? <StatusBanner tone="success" message={message} /> : null}
        {view ? <>
          <StatusBanner message={`${STATUS[view.analysisStatus]}。风格只影响表达。手动覆盖 ${Object.keys(view.overrides).length} 项。`} />
          <Card><SectionHeader title="表达方式" subtitle="设置在下一个未冻结回合生效" />
            <View style={{ gap: theme.space.md }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                {MODES.map(item => <Button key={item.value} label={item.label} variant="chip" selected={mode === item.value} disabled={busy}
                  testID={`writer-style.mode.${item.value}`} onPress={() => { setMode(item.value); setDirty(true); }} />)}
              </View>
              {mode === 'preset' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                {WRITER_STYLE_PRESETS.map(item => <Button key={item.id} label={item.title} variant="chip" selected={presetId === item.id} disabled={busy}
                  testID={`writer-style.preset.${item.id}`} onPress={() => { setPresetId(item.id); setDirty(true); }} />)}
              </View> : null}
              <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>叙事视角</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                {([{ value: 'second_person', label: '第二人称' }, { value: 'limited_third', label: '限知第三人称' }] as const).map(item =>
                  <Button key={item.value} label={item.label} variant="chip" selected={effective.pointOfView === item.value} disabled={busy}
                    onPress={() => { setOverrides(current => ({ ...current, pointOfView: item.value })); setDirty(true); }} />)}
              </View>
              {fields.map(([field, label]) => <TextField key={field} label={label} value={String(effective[field])} maxLength={160} disabled={busy}
                testID={`writer-style.field.${field}`} onChangeText={value => edit(field, value)} />)}
              <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>正文简洁度</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                {([{ value: 'concise', label: '简洁' }, { value: 'standard', label: '标准' }, { value: 'rich', label: '丰富' }] as const).map(item =>
                  <Button key={item.value} label={item.label} variant="chip" selected={effective.verbosity === item.value} disabled={busy}
                    onPress={() => { setOverrides(current => ({ ...current, verbosity: item.value })); setDirty(true); }} />)}
              </View>
              <Button label={advanced ? '收起高级表达' : '高级表达与禁止项'} variant="secondary" onPress={() => setAdvanced(value => !value)} />
              {advanced ? <>
                {advancedFields.map(([field, label]) => <TextField key={field} label={label} value={String(effective[field])} maxLength={160} disabled={busy}
                  onChangeText={value => edit(field, value)} />)}
                <TextField label="禁止项" value={(overrides.prohibitions ?? baseline.prohibitions).join('；')} disabled={busy}
                  hint="用中文分号分隔，例如：少用排比；避免反复总结" maxLength={960}
                  onChangeText={value => { setOverrides(current => ({ ...current, prohibitions: value.split(/[；;\n]/).map(s => s.trim()).filter(Boolean) })); setDirty(true); }} />
                <TextField label="自定义表达说明" value={effective.extraInstructions} disabled={busy} maxLength={320}
                  hint="描述语言偏好，例如少用排比。" onChangeText={value => edit('extraInstructions', value)} />
              </> : null}
              <Button label="保存风格" block disabled={busy || !dirty} testID="writer-style.save" onPress={() => void save()} />
              <Button label="清除手动覆盖" variant="secondary" disabled={busy || Object.keys(overrides).length === 0}
                onPress={() => { setOverrides({}); setDirty(true); }} />
            </View>
          </Card>
          <Card><SectionHeader title="原著风格" subtitle="分析使用短样本，可在游玩之外独立完成" />
            <View style={{ gap: theme.space.md }}>
              <Button label="检查或重试原著分析" variant="secondary" disabled={busy} testID="writer-style.analyze" onPress={() => void analyze()} />
              {suggestions.map(profile => <View key={profile.profileId} style={{ gap: theme.space.sm }}>
                <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>{profile.semantic.tone} · {profile.semantic.texture} · {profile.semantic.pacing}</Text>
                <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>{profile.coverageDescription} · 置信度 {Math.round(profile.confidence * 100)}%</Text>
                <Button label="采用此建议" variant="chip" disabled={busy || dirty} onPress={() => void adopt(profile)} />
              </View>)}
              {dirty && suggestions.length ? <StatusBanner message="先保存或重新读取当前编辑，再采用建议。" /> : null}
            </View>
          </Card>
        </> : <StatusBanner message="正在读取项目风格…" />}
      </ScrollView>
    </KeyboardAvoidingView>
  </ScreenShell>;
}
