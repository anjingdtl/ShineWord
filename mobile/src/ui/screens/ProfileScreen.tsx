/**
 * 我的 Tab — model endpoint, keychain secret, theme skin, about (plan §2).
 *
 * Also serves as the first-run screen: before a profile exists the navigator is
 * not mounted at all and `FirstRunScreen` renders the same form. Both share
 * `useProfileForm`, and the persistence still goes through the untouched
 * `src/profileStore` + `src/secureKeyStore` bridge modules.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Palette, ShieldCheck } from 'lucide-react-native';
import { saveApiProfile } from '../../profileStore';
import { KeychainSecretStore } from '../../secureKeyStore';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { useTheme } from '../theme/ThemeContext';
import { THEMES, THEME_ORDER, type ThemeId } from '../theme/tokens';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList } from '../navigation/types';
import { textStyle, typeStyle } from '../components/typography';

interface ProfileFormState {
  endpoint: string;
  model: string;
  apiKey: string;
  busy: boolean;
  error: string | null;
  notice: string | null;
  setEndpoint: (value: string) => void;
  setModel: (value: string) => void;
  setApiKey: (value: string) => void;
  submit: (onSaved: () => void) => void;
}

/** Shared form state for the first-run and settings variants. */
function useProfileForm(): ProfileFormState {
  const { profile, setProfile } = useAppSession();
  const [endpoint, setEndpoint] = useState(profile?.endpoint ?? '');
  const [model, setModel] = useState(profile?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function submit(onSaved: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    void (async () => {
      try {
        const saved = await saveApiProfile({ endpoint, model });
        const trimmedKey = apiKey.trim();
        const keyStore = new KeychainSecretStore();
        if (trimmedKey) {
          await keyStore.set(saved.keyRef, trimmedKey);
          setApiKey('');
        } else {
          const existing = await keyStore.get(saved.keyRef);
          if (!existing) throw new Error('请输入 API Key（将只写入系统 Keychain）。');
        }
        setProfile(saved);
        setNotice('已保存。密钥只存放在系统 Keychain 中。');
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  }

  return { endpoint, model, apiKey, busy, error, notice, setEndpoint, setModel, setApiKey, submit };
}

/** The four-skin switcher; the only place the app-level skin is chosen. */
function ThemeSkinPicker(): React.JSX.Element {
  const { theme, themeId, setThemeId } = useTheme();
  return (
    <Card>
      <View style={[skinStyles.rowGap, { gap: theme.space.sm }]}>
        <Palette size={16} color={theme.accentText} strokeWidth={1.8} />
        <Text style={[typeStyle(theme, theme.type.heading), { color: theme.onRaised.primary }]}>
          主题皮肤
        </Text>
      </View>
      <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary, marginTop: theme.space.xs }]}>
        当前：{theme.label} · {theme.tagline}
      </Text>
      <View style={[skinStyles.wrap, { gap: theme.space.sm, marginTop: theme.space.md }]}>
        {THEME_ORDER.map((id: ThemeId) => (
          <Chip
            key={id}
            label={THEMES[id].label}
            selected={id === themeId}
            onPress={() => setThemeId(id)}
            testID={`theme-skin-${id}`}
          />
        ))}
      </View>
      <View style={[skinStyles.wrap, { gap: theme.space.sm, marginTop: theme.space.md }]}>
        {[theme.bg.base, theme.bg.raised, theme.accent.primary, theme.accent.secondary, theme.accentText].map(
          (swatch, index) => (
            <View
              // Index key: two token slots can legitimately hold the same colour
              // (scifi accent.primary === accentText), so the colour is not unique.
              key={`swatch-${index}`}
              style={{
                width: theme.space.xl,
                height: theme.space.md,
                backgroundColor: swatch,
                borderWidth: theme.border.hairline,
                borderColor: theme.border.colorStrong,
                borderRadius: theme.radius.sm,
              }}
            />
          ),
        )}
      </View>
      <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary, marginTop: theme.space.md }]}>
        每个世界还可以单独指定皮肤（worldId → 主题）——存储与解析已就绪，入口在后续阶段接入。
      </Text>
    </Card>
  );
}

function ProfileForm(props: { form: ProfileFormState; submitLabel: string; onSaved: () => void }): React.JSX.Element {
  const { theme } = useTheme();
  const { form } = props;
  return (
    <Card>
      <View style={[skinStyles.rowGap, { gap: theme.space.sm }]}>
        <ShieldCheck size={16} color={theme.accentText} strokeWidth={1.8} />
        <Text style={[typeStyle(theme, theme.type.heading), { color: theme.onRaised.primary }]}>
          模型与密钥
        </Text>
      </View>
      <TextInput
        style={[legacyInput, { borderColor: theme.border.color, backgroundColor: theme.bg.overlay, color: theme.onRaised.primary, marginTop: theme.space.md }]}
        value={form.endpoint}
        onChangeText={form.setEndpoint}
        autoCapitalize="none"
        placeholder="OpenAI-compatible endpoint"
        placeholderTextColor={theme.onRaised.secondary}
        testID="profile-endpoint"
      />
      <TextInput
        style={[legacyInput, { borderColor: theme.border.color, backgroundColor: theme.bg.overlay, color: theme.onRaised.primary }]}
        value={form.model}
        onChangeText={form.setModel}
        autoCapitalize="none"
        placeholder="模型名称"
        placeholderTextColor={theme.onRaised.secondary}
        testID="profile-model"
      />
      <TextInput
        style={[legacyInput, { borderColor: theme.border.color, backgroundColor: theme.bg.overlay, color: theme.onRaised.primary }]}
        value={form.apiKey}
        onChangeText={form.setApiKey}
        autoCapitalize="none"
        secureTextEntry
        placeholder="API Key（仅写入系统 Keychain）"
        placeholderTextColor={theme.onRaised.secondary}
        testID="profile-apikey"
      />
      <Button
        label={form.busy ? '保存中…' : props.submitLabel}
        onPress={() => form.submit(props.onSaved)}
        disabled={form.busy}
        block
      />
      {form.notice ? (
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semantic.good, marginTop: theme.space.sm }]}>
          {form.notice}
        </Text>
      ) : null}
      {form.error ? (
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semantic.bad, marginTop: theme.space.sm }]}>
          {form.error}
        </Text>
      ) : null}
    </Card>
  );
}

export function ProfileScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const form = useProfileForm();
  return (
    <ScreenShell>
      <Header
        title="我的"
        subtitle="模型端点 · 密钥 · 主题皮肤 · 关于"
        // Temporary: the theme self-check gallery is reached by a long press.
        onTitleLongPress={() => navigation.navigate('ThemeGallery')}
      />
      <ScrollView contentContainerStyle={{ padding: theme.space.lg }}>
        <ThemeSkinPicker />
        <View style={{ height: theme.space.md }} />
        <ProfileForm form={form} submitLabel="保存" onSaved={() => undefined} />
        <View style={{ height: theme.space.md }} />
        <Card>
          <Text style={[typeStyle(theme, theme.type.heading), { color: theme.onRaised.primary }]}>
            关于
          </Text>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary, marginTop: theme.space.xs }]}>
            ShineWord · 小说三宝书 · 单人跑团战役。规则与存档全部在本机运行，云端只用于抽取与叙事生成。
          </Text>
        </Card>
      </ScrollView>
    </ScreenShell>
  );
}

/** Rendered instead of the navigator until an API profile exists. */
export function FirstRunScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const form = useProfileForm();
  return (
    <ScreenShell>
      <Header title="ShineWord" subtitle="小说三宝书 · 单人跑团战役" />
      <ScrollView contentContainerStyle={{ padding: theme.space.lg }}>
        <Text style={[textStyle(theme, theme.type.small, theme.text.secondary), { marginBottom: theme.space.md }]}>
          先配置一个 OpenAI 兼容端点，密钥只写入系统 Keychain。配置完成后即可导入小说并开局。
        </Text>
        <ProfileForm form={form} submitLabel="保存并进入书架" onSaved={() => undefined} />
      </ScrollView>
    </ScreenShell>
  );
}

/** Shared field frame for the profile form (themed colours are applied inline). */
const legacyInput = {
  borderWidth: 1,
  borderRadius: 10,
  paddingHorizontal: 14,
  paddingVertical: 12,
  marginBottom: 12,
};

const skinStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center' },
});
