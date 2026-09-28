/**
 * PlayHeader — the compact in-play top bar (plan §15/§18).
 *
 * Title = campaign title, subtitle = branch, place and the world clock formatted
 * for the active skin (plan §14.4: 时辰 / natural / plain / HUD timecode). The
 * authoritative value is always `clockSeconds`; only the rendering differs.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Header } from '../../components/Header';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import type { ThemeId } from '../../theme/tokens';

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
      const ke = Math.floor(((hours % 2) * 60 + minutes) / 15);
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
  branchLabel: string;
  locationLabel: string;
  clockSeconds: number | null;
  stateVersion: number | null;
  onBack: () => void;
  onMenu?: () => void;
  busy?: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  const clock = props.clockSeconds === null ? null : formatWorldClock(theme.id, props.clockSeconds);
  return (
    <Header
      title={props.title}
      onBack={props.onBack}
      backLabel="‹ 战役"
      actions={
        <View style={styles.meta}>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.secondary }]}>
            {props.branchLabel}
            {props.locationLabel ? ` · ${props.locationLabel}` : ''}
          </Text>
          <Text
            style={[
              typeStyle(theme, theme.type.micro),
              { color: theme.text.muted, fontFamily: theme.font.numeric },
            ]}>
            {clock ? `${clock} · ` : ''}v{props.stateVersion ?? '–'}
            {props.busy ? ' · 结算中…' : ''}
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  meta: { alignItems: 'flex-end' },
});