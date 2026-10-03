/**
 * 我的 Tab — model endpoint, keychain secret, theme skin, about (plan §9).
 *
 * P3.4: every control is a phase-3 component (the local `legacyInput` frame is
 * gone), the sections are layered (皮肤 / 模型与密钥 / 关于) and the product
 * brand is Shine-TRPG. Profile persistence keeps its v1 key with an in-place
 * schema normalization; the API key still uses the Keychain-only path.
 *
 * The first-run screen shares the same form and shows the brand lockup instead
 * of a header, as required by plan §9.2.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { typeStyle } from '../components/typography';
import { BrandLockup } from '../brand';
import { PRODUCT_AUTHOR } from '../brand';
import { AboutCard } from '../features/profile/AboutCard';
import { ProfileFormCard } from '../features/profile/ProfileFormCard';
import { ThemeSkinCard } from '../features/profile/ThemeSkinCard';
import versionJson from '../../version.json';
import { useProfileForm } from '../features/profile/useProfileForm';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

export function ProfileScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const form = useProfileForm();
  return (
    <ScreenShell>
      <Header
        title="我的"
        subtitle="模型端点 · 密钥 · 主题皮肤 · 关于"
        // Debug-only: the theme self-check gallery is reached by a long press
        // and is not registered in release builds (plan §6.5).
        onTitleLongPress={__DEV__ ? () => navigation.navigate('ThemeGallery') : undefined}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={theme.space.sm} style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}>
        <ThemeSkinCard />
        <ProfileFormCard form={form} submitLabel="保存" onSaved={() => undefined} />
        <AboutCard />
      </ScrollView></KeyboardAvoidingView>
    </ScreenShell>
  );
}

/** Rendered instead of the navigator until an API profile exists. */
export function FirstRunScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const form = useProfileForm();
  return (
    <ScreenShell>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={theme.space.sm} style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.xl }}>
        <View style={[styles.hero, { paddingTop: theme.space.xxl, gap: theme.space.md }]}>
          <BrandLockup />
          <Text style={[typeStyle(theme, theme.type.heading), { color: theme.text.primary }]}>
            配置你的 AI 模型
          </Text>
          <Text
            style={[
              typeStyle(theme, theme.type.small),
              { color: theme.text.secondary, textAlign: 'center' },
            ]}>
            配置一个 OpenAI 兼容端点后即可导入小说并开局；密钥只写入系统 Keychain。
          </Text>
        </View>
        <ProfileFormCard form={form} submitLabel="保存并进入书架" onSaved={() => undefined} />
        <View style={styles.credit}>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.text.muted, textAlign: 'center' }]}>
            作者：{PRODUCT_AUTHOR}
          </Text>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted, textAlign: 'center' }]}>
            Shine-TRPG {versionJson.versionName}（versionCode {versionJson.versionCode}）
          </Text>
        </View>
      </ScrollView></KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center' },
  credit: { alignItems: 'center', gap: 2, paddingBottom: 24 },
});
