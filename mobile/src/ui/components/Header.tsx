/**
 * Header — the compact in-page top bar (world name + branch, with optional
 * back / action slots). Navigation headers in P2 reuse the same tokens so the
 * two look identical.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './Button';
import { typeStyle } from './typography';

export function Header(props: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Long-press on the title; used by the temporary theme self-check entry. */
  onTitleLongPress?: () => void;
  /** Trailing actions (icon buttons, settings). */
  actions?: React.ReactNode;
  /** Hairline under the bar; on by default. */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const divider = props.divider ?? true;
  return (
    <View
      style={[
        styles.header,
        {
          paddingHorizontal: theme.space.lg,
          paddingTop: theme.space.md,
          paddingBottom: theme.space.md,
          gap: theme.space.md,
          backgroundColor: theme.bg.base,
          borderBottomWidth: divider ? theme.border.hairline : 0,
          borderBottomColor: theme.border.color,
        },
        props.style,
      ]}>
      {props.onBack ? (
        <Button
          label={props.backLabel ?? '‹ 返回'}
          variant="chip"
          onPress={props.onBack}
          accessibilityLabel={props.backLabel ?? '返回'}
        />
      ) : null}
      <View style={styles.titles}>
        <Text
          numberOfLines={1}
          onLongPress={props.onTitleLongPress}
          style={[typeStyle(theme, theme.type.title), { color: theme.text.primary }]}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text
            numberOfLines={1}
            style={[typeStyle(theme, theme.type.caption), { color: theme.text.secondary }]}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.actions ? <View style={[styles.actions, { gap: theme.space.sm }]}>{props.actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  titles: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
