/**
 * Slot 2 — chapter dividers (印章菱形 / ─ ❖ ─ / 粗黑星 / 刻度轨).
 *
 * The rules are plain views so they can stretch with the container; only the
 * centre motif is vector art. The optional label sits between the rules and the
 * motif, which is how `卷三`-style chapter marks read in the prototype.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';
import { useTheme } from '../ThemeContext';
import { DIVIDER_SPECS } from './specs';
import { renderDots, renderShapes } from './helpers';

export function ChapterDivider(props: {
  /** Optional chapter mark rendered between the rules, e.g. 卷三. */
  label?: string;
  /** Motif size in dp. */
  size?: number;
}): React.JSX.Element {
  const { theme } = useTheme();
  const spec = DIVIDER_SPECS[theme.ornament.divider];
  const size = props.size ?? 16;
  // Thick comic rules read as ink; the other skins tint with the accent.
  const ruleColor = theme.effects.dividerUsesAccent ? theme.accent.secondary : theme.border.colorStrong;
  const ruleThickness = theme.effects.cardBorderWidth > 1 ? theme.border.hairline : theme.border.hairline;

  const rule = (
    <View style={styles.ruleStack}>
      <View style={[styles.rule, { backgroundColor: ruleColor, height: ruleThickness }]} />
      {spec.twinRule ? (
        <View
          style={[
            styles.rule,
            styles.twinRule,
            { backgroundColor: ruleColor, height: ruleThickness, marginTop: theme.space.xs / 2 },
          ]}
        />
      ) : null}
    </View>
  );

  return (
    <View style={[styles.divider, { paddingVertical: theme.space.sm }]}>
      {rule}
      {props.label ? (
        <View
          style={{
            marginHorizontal: theme.space.sm,
            paddingHorizontal: theme.space.sm,
            paddingVertical: theme.space.xs / 2,
            borderColor: ruleColor,
            borderWidth: theme.border.hairline,
            borderRadius: theme.radius.sm,
          }}>
          <Text
            style={{
              color: theme.effects.dividerUsesAccent ? theme.accent.primary : theme.text.primary,
              fontFamily: theme.font.ui,
              fontSize: theme.type.label.fontSize,
              lineHeight: theme.type.label.lineHeight,
              fontWeight: theme.type.label.fontWeight,
              letterSpacing: theme.type.label.letterSpacing,
            }}>
            {props.label}
          </Text>
        </View>
      ) : null}
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${spec.box} ${spec.box}`}
        style={{ marginHorizontal: props.label ? theme.space.sm : theme.space.md }}
        pointerEvents="none">
        {renderShapes(spec.shapes, theme, 'divider')}
        {renderDots(spec.dots, theme, 'divider')}
      </Svg>
      {rule}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  ruleStack: { flex: 1 },
  rule: { width: '100%' },
  twinRule: { opacity: 0.55 },
});
