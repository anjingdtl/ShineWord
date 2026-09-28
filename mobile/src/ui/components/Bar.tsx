/**
 * Bar — the resource meter (气血 / 体力 / HUD 进度条), plus the die badge that
 * every skill row carries.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { textStyle, typeStyle } from './typography';

export type BarVariant = 'fill' | 'alt';

export function Bar(props: {
  /** 0–1 fill ratio; the caller clamps it from live state. */
  ratio: number;
  variant?: BarVariant;
  label?: string;
  valueText?: string;
  /** Reserve a fixed label column so stacked bars align. */
  labelWidth?: number;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const ratio = Math.max(0, Math.min(1, Number.isFinite(props.ratio) ? props.ratio : 0));
  const fill = props.variant === 'alt' ? theme.bar.fillAlt : theme.bar.fill;
  return (
    <View style={[styles.row, { gap: theme.space.sm, marginBottom: theme.space.sm }]}>
      {props.label ? (
        <Text
          numberOfLines={1}
          style={[
            typeStyle(theme, theme.type.caption),
            { color: theme.onRaised.secondary, width: props.labelWidth ?? theme.space.xxl * 2 },
          ]}>
          {props.label}
        </Text>
      ) : null}
      <View
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
        style={{
          flex: 1,
          height: theme.bar.height,
          borderRadius: theme.bar.radius,
          backgroundColor: theme.bar.track,
          borderWidth: theme.border.hairline,
          borderColor: theme.bar.border,
          overflow: 'hidden',
        }}>
        <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: fill }} />
      </View>
      {props.valueText ? (
        <Text
          numberOfLines={1}
          style={[
            textStyle(theme, theme.type.micro, theme.onRaised.secondary),
            { fontFamily: theme.font.numeric, textAlign: 'right' },
          ]}>
          {props.valueText}
        </Text>
      ) : null}
    </View>
  );
}

/** Regular polygon tile showing a die face (d4–d12), used on skill rows. */
export function DieBadge(props: {
  /** Die sides, rendered as the literal label (`d8`). */
  sides: number;
  size?: number;
}): React.JSX.Element {
  const { theme } = useTheme();
  const size = props.size ?? theme.die.size;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`d${props.sides}`}>
      <Svg width={size} height={size} viewBox="0 0 26 26" pointerEvents="none">
        <Polygon points="13,0 26,6.5 26,19.5 13,26 0,19.5 0,6.5" fill={theme.die.fill} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.dieLabel]}>
        <Text style={[textStyle(theme, theme.type.micro, theme.die.text), { fontFamily: theme.font.numeric }]}>
          d{props.sides}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dieLabel: { alignItems: 'center', justifyContent: 'center' },
});
