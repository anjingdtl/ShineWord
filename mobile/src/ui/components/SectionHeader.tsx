/**
 * SectionHeader — the one section-title rhythm used by every page, so headings,
 * subtitles and their trailing action never drift between screens.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from './typography';

export function SectionHeader(props: {
  title: string;
  subtitle?: string;
  /** Trailing slot (a Chip or a small Button). */
  action?: React.ReactNode;
  /** Draw a hairline under the block. */
  divider?: boolean;
  /**
   * Which surface the header sits on: `raised` (inside a Card, the common case)
   * or `base` (directly on the page). Light skins such as 漫 invert the text
   * ramp between the two, so the caller must state it instead of guessing.
   */
  tone?: 'base' | 'raised';
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const tone = props.tone ?? 'raised';
  const titleColor = tone === 'raised' ? theme.onRaised.primary : theme.text.primary;
  const subtitleColor = tone === 'raised' ? theme.onRaised.secondary : theme.text.secondary;
  return (
    <View
      style={[
        styles.root,
        {
          paddingBottom: theme.space.sm,
          marginBottom: theme.space.sm,
          gap: theme.space.md,
          borderBottomWidth: props.divider === false ? 0 : theme.border.hairline,
          borderBottomColor: theme.effects.dividerUsesAccent ? theme.border.colorStrong : theme.border.color,
        },
        props.style,
      ]}>
      <View style={{ flex: 1 }}>
        <Text style={[typeStyle(theme, theme.type.heading), { color: titleColor }]}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={[typeStyle(theme, theme.type.caption), { color: subtitleColor }]}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.action ? <View style={styles.action}>{props.action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-end' },
  action: { paddingBottom: 2 },
});