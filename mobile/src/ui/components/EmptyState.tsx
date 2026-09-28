/**
 * EmptyState — the "nothing here yet" panel every list needs.
 *
 * Replaces the bare `<Text>还没有…</Text>` placeholders of the current UI: an
 * icon slot, a title, an explanation and one optional call to action.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from './typography';

export function EmptyState(props: {
  title: string;
  description?: string;
  /** Icon node — callers pass a lucide icon so the library stays decoupled. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.root,
        {
          paddingVertical: props.compact ? theme.space.lg : theme.space.xxl,
          paddingHorizontal: theme.space.lg,
          gap: theme.space.sm,
          borderColor: theme.border.color,
          borderWidth: theme.border.hairline,
          borderStyle: 'dashed',
          borderRadius: theme.radius.md,
          backgroundColor: theme.bg.base,
        },
        props.style,
      ]}>
      {props.icon ? <View style={{ marginBottom: theme.space.xs }}>{props.icon}</View> : null}
      <Text
        style={[
          typeStyle(theme, theme.type.heading),
          { color: theme.text.primary, textAlign: 'center' },
        ]}>
        {props.title}
      </Text>
      {props.description ? (
        <Text
          style={[
            typeStyle(theme, theme.type.small),
            { color: theme.text.secondary, textAlign: 'center' },
          ]}>
          {props.description}
        </Text>
      ) : null}
      {props.action ? <View style={{ marginTop: theme.space.sm }}>{props.action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
});
