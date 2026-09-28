/**
 * Button — primary / secondary / chip, all token-driven.
 *
 * Press feedback is a scale + opacity applied by `Pressable`'s style callback,
 * so it uses React Native's built-in press handling and needs no animation
 * dependency (plan §4 forbids reanimated before P4).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Surface } from './Surface';
import { typeStyle } from './typography';
import { useVerticalHitSlop } from './a11y';

export type ButtonVariant = 'primary' | 'secondary' | 'chip';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Chip only: paint the highlight style (`chip.hot` in the prototype). */
  hot?: boolean;
  /** Secondary/chip only: the "currently chosen" outline. */
  selected?: boolean;
  /** Stretch to the parent width. */
  block?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function Button(props: ButtonProps): React.JSX.Element {
  const { theme } = useTheme();
  const variant = props.variant ?? 'primary';
  const disabled = props.disabled ?? false;
  const isChip = variant === 'chip';

  const type = isChip ? theme.type.small : theme.type.body;
  const paddingVertical = isChip ? theme.space.sm : theme.space.md;
  const paddingHorizontal = isChip ? theme.space.lg : theme.space.lg;
  // Compact controls keep their look and get the missing touch area via hitSlop.
  const hitSlop = useVerticalHitSlop(paddingVertical * 2 + type.lineHeight);

  const accentFill = props.hot && theme.chip.hotBackground ? theme.chip.hotBackground : null;

  let backgroundColor = theme.bg.raised;
  let borderColor = theme.border.color;
  let borderWidth = theme.effects.cardBorderWidth;
  let labelColor = theme.onRaised.primary;
  let radius = theme.radius.md;

  if (variant === 'primary') {
    backgroundColor = theme.accent.primary;
    borderColor = theme.effects.controlShadow?.color ?? theme.accent.primary;
    borderWidth = theme.effects.controlShadow ? theme.effects.cardBorderWidth : 0;
    labelColor = theme.onAccent;
  } else if (variant === 'chip') {
    radius = theme.radius.pill;
    borderWidth = theme.border.hairline;
    if (accentFill) {
      backgroundColor = accentFill;
      borderColor = theme.chip.hotBorder;
      labelColor = theme.chip.hotText;
    } else if (props.hot) {
      borderColor = theme.chip.hotBorder;
      labelColor = theme.chip.hotText;
    } else if (props.selected) {
      borderColor = theme.accent.primary;
      // Selection is carried by the border; the label uses the accent colour
      // that clears the 4.5:1 floor on this skin's surfaces.
      labelColor = theme.accentText;
    }
  } else if (variant === 'secondary') {
    // Inset fill so a secondary control stays visible on a raised card, where
    // `bg.raised` would have left only the hairline border.
    backgroundColor = theme.bg.overlay;
    if (props.selected) {
      borderColor = theme.accent.primary;
      labelColor = theme.accentText;
    }
  }

  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled, selected: props.selected }}
      testID={props.testID}
      style={({ pressed }) => [
        props.block ? styles.block : styles.inline,
        props.style,
        disabled ? styles.disabled : null,
        pressed && !disabled
          ? { transform: [{ scale: theme.effects.pressedScale }], opacity: 0.9 }
          : null,
      ]}>
      <Surface
        backgroundColor={backgroundColor}
        borderColor={borderColor}
        borderWidth={borderWidth}
        radius={radius}
        shadow={theme.effects.controlShadow}
        style={props.block ? styles.block : undefined}
        contentStyle={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space.sm,
          paddingHorizontal,
          paddingVertical,
          minHeight: theme.touch.min,
          borderRadius: radius,
        }}>
        {props.leading ? <View>{props.leading}</View> : null}
        <Text style={[typeStyle(theme, type), { color: labelColor }]} numberOfLines={1}>
          {props.label}
        </Text>
        {props.trailing ? <View>{props.trailing}</View> : null}
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inline: { alignSelf: 'flex-start' },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
});
