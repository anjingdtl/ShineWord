/**
 * SegmentedControl — the two-to-five way switch used by tabs and mode pickers
 * (world detail sub-tabs, character origin, book tabs, panel tabs).
 *
 * Selection is shown by the accent fill *and* an underline bar, so the state
 * survives greyscale screenshots and colour-blind readers (plan §30).
 *
 * `scrollable` opts into a horizontal scroll viewport (e.g. the avatar picker's
 * four four-character theme tabs, which exceed a 360dp phone and used to clip
 * the last segment out of reach). When the segments fit, the layout is
 * pixel-identical to the non-scrollable control: the content container grows
 * to the viewport and `block` segments still share it evenly.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
  /** Horizontal scroll viewport instead of clipping on narrow screens. */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const block = props.block ?? true;
  // Default segments expose a visible 44dp target. Compact rows keep their
  // denser appearance and add only vertical hitSlop to reach the same floor.
  // Horizontal slop stays zero because adjacent segments share their edges.
  const hitSlop = useMemo(() => {
    const type = props.compact ? theme.type.label : theme.type.small;
    const paddingVertical = props.compact ? theme.space.xs : theme.space.sm;
    const visualHeight = props.compact
      ? paddingVertical * 2 + type.lineHeight
      : theme.touch.min;
    const pad = Math.max(0, Math.ceil((theme.touch.min - visualHeight) / 2));
    return { top: pad, bottom: pad, left: 0, right: 0 };
  }, [props.compact, theme]);
  const segments = props.options.map(option => {
    const selected = option.value === props.value;
    const disabled = props.disabled === true || option.disabled === true;
    return (
      <Pressable
        key={option.value}
        onPress={() => props.onChange(option.value)}
        disabled={disabled}
        hitSlop={hitSlop}
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
            minHeight: props.compact ? undefined : theme.touch.min,
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
  });
  const chrome: StyleProp<ViewStyle> = [
    {
      padding: theme.space.xs,
      backgroundColor: theme.bg.overlay,
      borderColor: theme.border.color,
      borderWidth: theme.border.hairline,
      borderRadius: theme.radius.md,
    },
    props.style,
  ];

  if (props.scrollable) {
    return (
      <View style={chrome}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          alwaysBounceHorizontal={false}
          contentContainerStyle={{ flexGrow: 1 }}>
          {/* Plain-View row inside the scroll viewport: measuring the segments
              directly in the scroll content container truncates CJK labels by
              a hair (measure/draw rounding), so keep the text in the exact
              layout context the non-scrollable control uses. */}
          <View style={[styles.row, { gap: theme.space.xs, flexGrow: 1 }]}>{segments}</View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.row, { gap: theme.space.xs }, chrome]}>
      {segments}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', alignSelf: 'stretch' },
  segment: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
