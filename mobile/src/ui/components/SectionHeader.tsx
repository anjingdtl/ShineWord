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
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
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
        <Text style={[typeStyle(theme, theme.type.heading), { color: theme.text.primary }]}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.secondary }]}>
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