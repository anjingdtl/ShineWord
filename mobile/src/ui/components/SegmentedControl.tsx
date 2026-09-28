/**
 * SegmentedControl — the two-to-five way switch used by tabs and mode pickers
 * (world detail sub-tabs, character origin, book tabs, panel tabs).
 *
 * Selection is shown by the accent fill *and* an underline bar, so the state
 * survives greyscale screenshots and colour-blind readers (plan §30).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from './typography';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading glyph (callers pass a lucide icon). */
  icon?: React.ReactNode;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>(props: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  block?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const block = props.block ?? true;
  return (
    <View
      style={[
        styles.row,
        {
          gap: theme.space.xs,
          padding: theme.space.xs,
          backgroundColor: theme.bg.overlay,
          borderColor: theme.border.color,
          borderWidth: theme.border.hairline,
          borderRadius: theme.radius.md,
        },
        props.style,
      ]}>
      {props.options.map(option => {
        const selected = option.value === props.value;
        const disabled = props.disabled === true || option.disabled === true;
        return (
          <Pressable
            key={option.value}
            onPress={() => props.onChange(option.value)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={option.label}
            testID={props.testID ? `${props.testID}.${option.value}` : undefined}
            style={({ pressed }) => [
              styles.segment,
              {
                flexGrow: block ? 1 : 0,
                backgroundColor: selected ? theme.accent.primary : 'transparent',
                borderRadius: theme.radius.sm,
                paddingVertical: props.compact ? theme.space.xs : theme.space.sm,
                paddingHorizontal: theme.space.md,
                opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
                minHeight: props.compact ? undefined : theme.touch.min - theme.space.sm,
              },
            ]}>
            {option.icon ? <View style={{ marginRight: theme.space.xs }}>{option.icon}</View> : null}
            <Text
              numberOfLines={1}
              style={[
                typeStyle(theme, props.compact ? theme.type.label : theme.type.small),
                {
                  color: selected ? theme.onAccent : theme.onRaised.secondary,
                  fontWeight: selected ? '700' : '500',
                },
              ]}>
              {option.label}
            </Text>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: theme.space.md,
                right: theme.space.md,
                bottom: theme.space.xs / 2,
                height: 2,
                borderRadius: 1,
                backgroundColor: selected ? theme.onAccent : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', alignSelf: 'stretch' },
  segment: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});