/**
 * ProfileFormCard — 模型与密钥 (plan §9.1).
 *
 * Every field is the shared `TextField`; the API key stays a secure field whose
 * plaintext never leaves Keychain (`useProfileForm` unchanged).
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatusBanner } from '../../components/StatusBanner';
import { TextField } from '../../components/TextField';
import { SectionHeader } from '../../components/SectionHeader';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { MODEL_PRESETS } from '../../../profileStore';
import type { ProfileFormState } from './useProfileForm';

export function ProfileFormCard(props: {
  form: ProfileFormState;
  submitLabel: string;
  onSaved: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { form } = props;
  return (
    <Card>
      <SectionHeader
        title="模型与密钥"
        subtitle="OpenAI 兼容端点；密钥只写入系统 Keychain"
      />
      <View style={{ gap: theme.space.md }}>
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
                <Text style={[typeStyle(theme, theme.type.body), { color: theme.text.primary }]}>
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
      <View style={{ marginTop: theme.space.lg }}>
        <Button
          label={form.busy ? '保存中…' : props.submitLabel}
          onPress={() => form.submit(props.onSaved)}
          disabled={form.busy}
          block
        />
      </View>
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