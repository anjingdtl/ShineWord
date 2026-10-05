/**
 * PlayHeader — the compact in-play top bar (plan §15/§18).
 *
 * Title = campaign title, subtitle = branch, place and the world clock formatted
 * for the active skin (plan §14.4: 时辰 / natural / plain / HUD timecode). The
 * authoritative value is always `clockSeconds`; only the rendering differs.
 */
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Header } from '../../components/Header';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import type { ThemeId } from '../../theme/tokens';
import { findAvatar, useAvatar } from '../avatar';

const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const KE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八'];

/** Renders the world clock in the active skin's idiom. */
export function formatWorldClock(themeId: ThemeId, clockSeconds: number): string {
  const safe = Number.isFinite(clockSeconds) ? Math.max(0, Math.floor(clockSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const pad = (value: number): string => String(value).padStart(2, '0');
  switch (themeId) {
    case 'ink': {
      // 时辰 = two-hour periods starting at 23:00; 刻 = 15 minutes (8 per 时辰).
      const period = Math.floor(((hours + 1) % 24) / 2);
      const ke = Math.floor((((hours + 1) % 2) * 60 + minutes) / 15);
      return `${SHICHEN[period]}时${KE_NUMERALS[ke]}刻`;
    }
    case 'fantasy':
      return `第 ${Math.floor(hours / 24) + 1} 日 · ${pad(hours % 24)}:${pad(minutes)}`;
    case 'manga':
      return `D${Math.floor(hours / 24) + 1} ${pad(hours % 24)}:${pad(minutes)}`;
    case 'scifi':
      return `T+${String(Math.floor(hours / 24)).padStart(3, '0')}:${pad(hours % 24)}:${pad(minutes)}`;
    default:
      return `${pad(hours % 24)}:${pad(minutes)}`;
  }
}

export function PlayHeader(props: {
  title: string;
  clockSeconds: number | null;
  onBack: () => void;
  onMenu?: () => void;
  busy?: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { avatarId } = useAvatar();
  const avatar = findAvatar(avatarId);
  const clock = props.clockSeconds === null ? null : formatWorldClock(theme.id, props.clockSeconds);
  return (
    <Header
      title={props.title}
      onBack={props.onBack}
      backLabel="‹ 战役"
      actions={
        <View style={[styles.actions, { gap: theme.space.sm }]}>
          <View style={styles.meta} accessibilityLiveRegion="polite">
            <Text
              style={[
                typeStyle(theme, theme.type.caption),
                { color: theme.text.secondary, fontFamily: theme.font.numeric },
              ]}>
              {props.busy ? '正在结算…' : clock ?? ''}
            </Text>
          </View>
          {avatar ? (
            <View
              accessible
              accessibilityLabel={`玩家头像：${avatar.label}`}
              testID="play-avatar"
              style={[
                styles.avatar,
                {
                  borderColor: theme.accent.primary,
                  borderRadius: theme.radius.pill,
                  width: theme.space.xxl,
                  height: theme.space.xxl,
                },
              ]}>
              <Image source={avatar.source} style={styles.avatarImage} resizeMode="cover" />
            </View>
          ) : null}
          {props.onMenu ? (
            <Pressable
              onPress={props.onMenu}
              accessibilityRole="button"
              accessibilityLabel="打开游戏信息"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              testID="play-menu"
              style={({ pressed }) => [
                styles.menu,
                {
                  borderColor: theme.border.colorStrong,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.space.sm,
                  minHeight: theme.touch.min,
                  minWidth: theme.touch.min,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.accentOnBase }]}>☰ 信息</Text>
            </Pressable>
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  meta: { alignItems: 'flex-end' },
  actions: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  menu: { borderWidth: 1 },
  // 32dp circled identity display (plan §6.2, PartyStrip player-plate idiom);
  // non-interactive, so no touch-target floor applies.
  avatar: { borderWidth: 1, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
});
