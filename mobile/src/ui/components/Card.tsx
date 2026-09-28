/**
 * Card — the surface everything in a screen is built from.
 *
 * `ornament` mounts the four-corner frame for narrative panels; `cut` is driven
 * by the skin's `effects.clipCorner` so only the HUD skin gets angled corners.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { OrnamentFrame } from '../theme/ornaments/OrnamentCorner';
import { Surface } from './Surface';

export type CardTone = 'raised' | 'overlay' | 'base';

export interface CardProps {
  children?: React.ReactNode;
  tone?: CardTone;
  /** Corner frame (narrative panels). */
  ornament?: boolean;
  onPress?: () => void;
  /** `lg` for hero panels, `sm` for dense list rows. */
  radiusSize?: 'sm' | 'md' | 'lg';
  /** Skip the default padding when the card owns its own layout. */
  unpadded?: boolean;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function Card(props: CardProps): React.JSX.Element {
  const { theme } = useTheme();
  const tone = props.tone ?? 'raised';
  const radiusSize = props.radiusSize ?? 'md';
  const radius = theme.radius[radiusSize];
  const backgroundColor = tone === 'overlay'
    ? theme.bg.overlay
    : tone === 'base'
      ? theme.bg.base
      : theme.bg.raised;
  const padding = props.padding ?? (props.unpadded ? 0 : theme.space.lg);

  const body = (
    <Surface
      backgroundColor={backgroundColor}
      borderColor={tone === 'raised' ? theme.border.color : theme.border.colorStrong}
      borderWidth={theme.effects.cardBorderWidth}
      radius={radius}
      shadow={theme.effects.cardShadow}
      insetFrame={theme.effects.insetFrame}
      cut={theme.effects.clipCorner}
      behindColor={theme.bg.base}
      style={props.onPress ? styles.block : props.style}
      contentStyle={{ borderRadius: radius }}>
      <View style={{ padding }}>
        {props.children}
      </View>
      {props.ornament ? <OrnamentFrame inset={theme.space.xs} size={theme.space.xl} /> : null}
    </Surface>
  );

  if (!props.onPress) return body;

  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      style={({ pressed }) => [
        styles.block,
        props.style,
        pressed ? { transform: [{ scale: theme.effects.pressedScale }] } : null,
      ]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch' },
});
