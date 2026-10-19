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
import { headerTitleContainerStyle } from '../layout/headerLayout';

export function Header(props: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Long-press on the title; used by the temporary theme self-check entry. */
  onTitleLongPress?: () => void;
  /** Trailing actions (icon buttons, settings). */
  actions?: React.ReactNode;
  /** Put the title on its own full-width row when its available width is constrained. */
  stackTitle?: boolean;
  /** Hairline under the bar; on by default. */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const divider = props.divider ?? true;
  const back = props.onBack ? (
    <Button
      label={props.backLabel ?? '‹ 返回'}
      variant="chip"
      onPress={props.onBack}
      accessibilityLabel={props.backLabel ?? '返回'}
    />
  ) : null;
  const title = (
    <View style={headerTitleContainerStyle(!!props.stackTitle)}>
      <Text
        numberOfLines={props.stackTitle ? undefined : 1}
        onLongPress={props.onTitleLongPress}
        accessibilityLabel={props.title}
        style={[typeStyle(theme, theme.type.title), { color: theme.text.primary }]}>
        {props.title}
      </Text>
      {props.subtitle ? (
        <Text
          numberOfLines={props.stackTitle ? undefined : 1}
          accessibilityLabel={props.subtitle}
          style={[typeStyle(theme, theme.type.caption), { color: theme.text.secondary }]}>
          {props.subtitle}
        </Text>
      ) : null}
    </View>
  );
  const actions = props.actions ? <View style={[styles.actions, { gap: theme.space.sm }]}>{props.actions}</View> : null;
  return (
    <View
      style={[
        styles.header,
        props.stackTitle ? styles.stackedHeader : null,
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
      {props.stackTitle ? (
        <>
          <View style={styles.toolbar}>
            {back}
            {actions}
          </View>
          {title}
        </>
      ) : (
        <>
          {back}
          {title}
          {actions}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  stackedHeader: { flexDirection: 'column', alignItems: 'stretch' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
