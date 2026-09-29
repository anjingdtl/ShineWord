/**
 * StatusBanner — inline page feedback in four tones (info / success / warning /
 * error). Each tone carries a glyph and a leading rule as well as its colour,
 * and the message itself always uses a text token that clears the contrast
 * floor (plan §30).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from './typography';

export type StatusTone = 'info' | 'success' | 'warning' | 'error';

const GLYPH: Record<StatusTone, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '▲',
  error: '✕',
};

export function StatusBanner(props: {
  tone?: StatusTone;
  title?: string;
  message: string;
  /** Trailing action slot (a Button). */
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const tone = props.tone ?? 'info';
  // The leading rule is a 3dp fill, so it uses the bright `semantic` ramp; the
  // tone glyph is rendered as text, so it uses the contrast-safe `semanticText`
  // ramp instead (plan §30).
  const ruleColor =
    tone === 'success'
      ? theme.semantic.good
      : tone === 'warning'
        ? theme.semantic.warn
        : tone === 'error'
          ? theme.semantic.bad
          : theme.semantic.info;
  const glyphColor =
    tone === 'success'
      ? theme.semanticText.good
      : tone === 'warning'
        ? theme.semanticText.warn
        : tone === 'error'
          ? theme.semanticText.bad
          : theme.semanticText.info;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${props.title ? `${props.title}。` : ''}${props.message}`}
      style={[
        styles.root,
        {
          backgroundColor: theme.bg.overlay,
          borderColor: theme.border.color,
          borderWidth: theme.border.hairline,
          borderRadius: theme.radius.md,
          padding: theme.space.md,
          gap: theme.space.sm,
        },
        props.style,
      ]}>
      <View style={[styles.rule, { backgroundColor: ruleColor, borderRadius: theme.radius.sm }]} />
      <View style={{ flex: 1, gap: theme.space.xs }}>
        {props.title ? (
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, fontWeight: '700' }]}>
            <Text style={{ color: glyphColor }}>{GLYPH[tone]} </Text>
            {props.title}
          </Text>
        ) : null}
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          {props.title ? '' : `${GLYPH[tone]} `}
          {props.message}
        </Text>
      </View>
      {props.action ? <View>{props.action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start' },
  rule: { width: 3, alignSelf: 'stretch' },
});