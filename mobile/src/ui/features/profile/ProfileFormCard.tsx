/**
 * ProfileFormCard — 模型与密钥 (plan §9.1).
 *
 * Every field is the shared `TextField`; the API key stays a secure field whose
 * plaintext never leaves Keychain (`useProfileForm` unchanged).
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatusBanner } from '../../components/StatusBanner';
import { TextField } from '../../components/TextField';
import { SectionHeader } from '../../components/SectionHeader';
import { SegmentedControl } from '../../components/SegmentedControl';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { MODEL_PRESETS, presetById } from '../../../profileStore';
import type { ProfileFormState } from './useProfileForm';
import { reasoningDialectForModel } from '../../../../../src/application/llm/reasoningPolicy';
import { previewLlmRequestBudget } from '../../../../../src/application/llm/requestBudgetPreview';

function parsePreviewInteger(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatTokens(value: number): string {
  return `${Math.round(value / 1024)}K`;
}

export function ProfileFormCard(props: {
  form: ProfileFormState;
  submitLabel: string;
  onSaved: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { form } = props;
  const [advancedSettingsVisible, setAdvancedSettingsVisible] = useState(false);
  const preset = presetById(form.presetId ?? undefined);
  const preview = previewLlmRequestBudget({
    contextWindowTokens: parsePreviewInteger(form.contextWindowTokens) ?? preset?.profile.capabilities.contextWindow,
    maxOutputTokens: parsePreviewInteger(form.maxOutputTokens) ?? preset?.profile.capabilities.maxOutputTokens,
    model: form.model,
    providerDialect: form.reasoningParameterSupport === 'unsupported'
      ? 'unsupported'
      : preset?.profile.reasoningDialect ?? reasoningDialectForModel(form.model),
    reasoningTier: form.reasoningTier,
    requestKind: 'planner',
  });
  return (
    <Card>
      <SectionHeader
        title="模型与密钥"
        subtitle="OpenAI 兼容端点；密钥只写入系统 Keychain"
      />
      <View style={{ gap: theme.space.md }}>
        <View style={{ gap: theme.space.sm }} testID="profile-saved-list">
          {form.savedProfiles.map(saved => (
            <Button key={saved.id}
              label={`${saved.id === form.activeId ? '✓ ' : ''}${saved.name} · ${saved.model}`}
              variant="secondary"
              disabled={form.busy || form.probeBusy}
              onPress={() => form.selectSaved(saved.id)}
              testID={`profile-select-${saved.id}`} />
          ))}
          <Button label="添加 API 配置" variant="secondary" onPress={form.addProfile}
            disabled={form.busy || form.probeBusy} testID="profile-add" />
        </View>
        <TextField label="配置名称" value={form.name} onChangeText={form.setName}
          placeholder="例如：主力模型、备用 API" testID="profile-name" />
        <View style={{ gap: theme.space.sm }} testID="profile-presets">
          {MODEL_PRESETS.map(preset => {
            const selected = form.presetId === preset.id;
            return (
              <Pressable
                key={preset.id}
                onPress={() => (selected ? form.clearPreset() : form.choosePreset(preset.id))}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`preset-${preset.id}`}
                style={{
                  borderWidth: 1,
                  borderColor: selected ? theme.accent.primary : theme.border.color,
                  borderRadius: theme.radius.md,
                  padding: theme.space.md,
                }}>
                <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
                  {`${selected ? '✓ ' : ''}${preset.label}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label="模型端点"
          value={form.endpoint}
          onChangeText={form.setEndpoint}
          placeholder="https://api.example.com/v1"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hint="只请求你配置的端点；应用没有其他网络调用。"
          testID="profile-endpoint"
        />
        <TextField
          label="模型名称"
          value={form.model}
          onChangeText={form.setModel}
          placeholder="例如 gpt-4o-mini"
          autoCapitalize="none"
          autoCorrect={false}
          testID="profile-model"
        />
        <View style={{ gap: theme.space.sm }} testID="profile-reasoning-tier">
          <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
            思考强度
          </Text>
          <SegmentedControl
            options={[
              { value: 'low', label: '低' },
              { value: 'high', label: '高' },
              { value: 'max', label: '最高' },
            ]}
            value={form.reasoningTier}
            onChange={form.setReasoningTier}
            testID="profile-reasoning"
          />
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
            思考越充分，复杂判断通常越稳定，也会消耗更多输出预算并减少本轮可用上下文。
          </Text>
          <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
            {`预计思考预留：${preview.available ? formatTokens(preview.reasoningReserveTokens) : '无法计算精确预算'}（Planner 估算）`}
          </Text>
        </View>
        <Pressable
          onPress={() => setAdvancedSettingsVisible(value => !value)}
          accessibilityRole="button"
          accessibilityLabel={advancedSettingsVisible ? '收起高级模型设置' : '展开高级模型设置'}
          accessibilityState={{ selected: advancedSettingsVisible }}
          testID="profile-advanced-toggle"
          style={{
            minHeight: theme.touch.min,
            justifyContent: 'center',
            paddingHorizontal: theme.space.sm,
            borderColor: theme.border.color,
            borderWidth: theme.border.hairline,
            borderRadius: theme.radius.md,
          }}>
          <Text style={[typeStyle(theme, theme.type.body), { color: theme.accent.primary }]}>
            {advancedSettingsVisible ? '收起高级模型设置' : '高级模型设置'}
          </Text>
        </Pressable>
        {advancedSettingsVisible ? (
          <View style={{ gap: theme.space.md }} testID="profile-advanced-settings">
            {preset ? (
              <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.secondary }]}>
                {`预设能力：上下文 ${formatTokens(preset.profile.capabilities.contextWindow ?? 0)}，最大输出 ${formatTokens(preset.profile.capabilities.maxOutputTokens ?? 0)}。`}
              </Text>
            ) : null}
              <>
                <TextField
                  label="上下文窗口（Token）"
                  value={form.contextWindowTokens}
                  onChangeText={form.setContextWindowTokens}
                  placeholder="留空表示未知"
                  keyboardType="number-pad"
                  hint="填写当前端点支持的上下文上限；预设数值可以调整，未知时保持空白。"
                  testID="profile-context-window"
                />
                <TextField
                  label="最大输出 Token"
                  value={form.maxOutputTokens}
                  onChangeText={form.setMaxOutputTokens}
                  placeholder="留空表示未知"
                  keyboardType="number-pad"
                  hint="未知时不写入虚构上限；依赖精确预算的任务可能无法启动。"
                  testID="profile-max-output"
                />
              </>
            <View style={{ gap: theme.space.sm }}>
              <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
                思考参数协议
              </Text>
              <SegmentedControl
                options={[
                  { value: 'automatic', label: '自动映射' },
                  { value: 'unsupported', label: '端点不支持' },
                ]}
                value={form.reasoningParameterSupport}
                onChange={form.setReasoningParameterSupport}
                testID="profile-reasoning-protocol"
              />
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                选择“不支持”时，请求会在发送前失败，避免端点静默忽略思考档位。
              </Text>
            </View>
            {preview.available ? (
              <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
                {`预算预览：上下文 ${formatTokens(preview.contextWindowTokens)} · 正文约 ${formatTokens(preview.businessOutputTokens)} · 思考预留 ${formatTokens(preview.reasoningReserveTokens)} · 安全余量 ${formatTokens(preview.safetyMarginTokens)} · 估算输入上限 ${formatTokens(preview.hardInputLimit)}（设置页估算，未计入实际回合的必需协议输入）`}
              </Text>
            ) : preview.errorCode === 'reasoning_capability_insufficient'
              || preview.errorCode === 'output_demand_infeasible'
              || preview.errorCode === 'envelope_infeasible' ? (
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semanticText.bad }]}>
                当前模型上下文或最大输出不足以支持所选思考档位及最低正文预算。
              </Text>
            ) : preview.errorCode === 'reasoning_dialect_unsupported' ? (
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semanticText.bad }]}>
                当前端点不支持思考档位参数，无法保证所选思考强度。
              </Text>
            ) : (
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                上下文或最大输出未知时，无法计算精确预算；需要精确预算的任务将提示补充能力信息。
              </Text>
            )}
          </View>
        ) : null}
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          切换配置会复用对应密钥。失败任务可在构建卡点“用当前 API 继续”；正在运行的构建保持原配置。
        </Text>
        <TextField
          label="API Key"
          value={form.apiKey}
          onChangeText={form.setApiKey}
          placeholder="sk-…"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          hint="留空表示沿用已保存在 Keychain 中的密钥。"
          testID="profile-apikey"
        />
      </View>
      <View style={{ marginTop: theme.space.lg, gap: theme.space.sm }}>
        <Button
          label={form.busy ? '保存中…' : props.submitLabel}
          onPress={() => form.submit(props.onSaved)}
          disabled={form.busy}
          block
        />
        <Button
          label={form.probeBusy ? '测试连接中…' : '测试连接'}
          variant="secondary"
          onPress={form.testConnection}
          disabled={form.probeBusy}
          block
          testID="profile-test-connection"
        />
      </View>
      {form.probeResult ? (
        <View style={{ marginTop: theme.space.md }} testID="profile-probe-result">
          <StatusBanner
            tone={form.probeResult.ok ? 'success' : 'error'}
            title={form.probeResult.ok ? '连接成功' : '连接失败'}
            message={[
              form.probeResult.message,
              `模型：${form.probeResult.model || '（未填写）'}`,
              `思考参数：${form.probeResult.outcome === 'reasoning_unsupported' ? '不兼容' : '已按当前档位发送'}`,
            ].join('\n')}
          />
        </View>
      ) : null}
      {form.notice ? (
        <View style={{ marginTop: theme.space.md }}>
          <StatusBanner tone="success" message={form.notice} />
        </View>
      ) : null}
      {form.error ? (
        <View style={{ marginTop: theme.space.md }}>
          <StatusBanner tone="error" title="保存失败" message={form.error} />
        </View>
      ) : null}
    </Card>
  );
}
