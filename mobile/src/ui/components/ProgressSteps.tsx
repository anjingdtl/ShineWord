/**
 * ProgressSteps — the numbered rail used by the opening wizard
 * (`1 起点 → 2 角色 → 3 同伴 → 4 确认`).
 *
 * Completed steps keep a ✓ so progress is readable without colour, and the
 * whole rail is exposed as an accessible progress value.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from './typography';

export function ProgressSteps(props: {
  steps: readonly string[];
  /** Zero-based index of the active step. */
  current: number;
  /** Allow jumping back to a finished step (never forward past validation). */
  onStepPress?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const current = Math.max(0, Math.min(props.current, props.steps.length - 1));
  return (
    <View
      style={[styles.root, { gap: theme.space.xs }, props.style]}
      accessibilityLabel={`步骤 ${current + 1} / ${props.steps.length}：${props.steps[current] ?? ''}`}
      accessibilityValue={{ min: 1, max: props.steps.length, now: current + 1 }}>
      {props.steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const reachable = Boolean(props.onStepPress) && index <= current;
        return (
          <React.Fragment key={step}>
            {index > 0 ? (
              <View
                style={{
                  flex: 1,
                  height: theme.border.hairline,
                  marginBottom: theme.space.sm,
                  backgroundColor: done || active ? theme.accent.secondary : theme.border.color,
                }}
              />
            ) : null}
            <Pressable
              onPress={reachable ? () => props.onStepPress?.(index) : undefined}
              disabled={!reachable}
              // The step's press surface is the number circle (~24dp wide); the
              // flex dividers between steps leave room for horizontal slop that
              // lifts it to the 44dp floor without overlapping a neighbour.
              hitSlop={{
                top: 0,
                bottom: 0,
                left: Math.ceil((theme.touch.min - theme.space.xl) / 2),
                right: Math.ceil((theme.touch.min - theme.space.xl) / 2),
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !reachable }}
              accessibilityLabel={`第 ${index + 1} 步 ${step}${done ? '（已完成）' : active ? '（当前）' : ''}`}
              style={styles.step}>
              <View
                style={{
                  width: theme.space.xl,
                  height: theme.space.xl,
                  borderRadius: theme.radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? theme.accent.primary : 'transparent',
                  borderWidth: theme.border.hairline + (done ? 0 : 1),
                  borderColor: done ? theme.accent.secondary : active ? theme.accent.primary : theme.border.color,
                }}>
                <Text
                  style={[
                    typeStyle(theme, theme.type.label),
                    {
                      color: active ? theme.onAccent : done ? theme.accentOnBase : theme.text.muted,
                    },
                  ]}>
                  {done ? '✓' : String(index + 1)}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={[
                  typeStyle(theme, theme.type.caption),
                  {
                    color: active ? theme.text.primary : theme.text.secondary,
                    fontWeight: active ? '700' : '400',
                  },
                ]}>
                {step}
              </Text>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-end' },
  step: { alignItems: 'center', gap: 4 },
});