/**
 * BranchBadge — the role + identity pill for one branch (plan §8.2).
 *
 * The role is spelled out (主线 / 分支) so the relationship survives without
 * colour, and a fork always shows the branch it came from.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';

export function BranchBadge(props: {
  role: 'main' | 'fork';
  /** Branch id as stored (never re-generated here). */
  label: string;
  /** Branch state version, when known. */
  stateVersion?: number;
}): React.JSX.Element {
  const { theme } = useTheme();
  const main = props.role === 'main';
  return (
    <View
      style={[
        styles.root,
        {
          gap: theme.space.xs,
          borderWidth: theme.border.hairline,
          borderColor: main ? theme.accent.secondary : theme.border.colorStrong,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.space.sm,
          paddingVertical: 2,
          backgroundColor: theme.bg.overlay,
        },
      ]}>
      <Text
        style={[
          typeStyle(theme, theme.type.label),
          { color: main ? theme.accentText : theme.onRaised.secondary },
        ]}>
        {main ? '主线' : '分支'}
      </Text>
      <Text
        numberOfLines={1}
        style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.primary }]}>
        {props.label}
      </Text>
      {props.stateVersion !== undefined ? (
        <Text
          style={[
            typeStyle(theme, theme.type.micro),
            { color: theme.onRaised.secondary, fontFamily: theme.font.numeric },
          ]}>
          v{props.stateVersion}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
});