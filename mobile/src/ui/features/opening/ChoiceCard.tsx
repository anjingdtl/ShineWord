/**
 * ChoiceCard — the single-select card used across the opening wizard
 * (plan §11.2: card selection instead of a ☑ / ☐ text prefix).
 *
 * Selection is carried by the accent border, a bold title and a leading ✓, so
 * it survives greyscale and never depends on colour alone.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Surface } from '../../components/Surface';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

export function ChoiceCard(props: {
  title: string;
  subtitle?: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Extra content (directive chips, badges) rendered under the description. */
  children?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={props.disabled ? undefined : props.onPress}
      disabled={props.disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected, disabled: props.disabled === true }}
      accessibilityLabel={props.subtitle ? `${props.title}，${props.subtitle}` : props.title}
      testID={props.testID}
      style={({ pressed }) => [
        styles.block,
        props.disabled ? styles.disabled : null,
        pressed && !props.disabled ? { transform: [{ scale: theme.effects.pressedScale }] } : null,
      ]}>
      <Surface
        backgroundColor={theme.bg.raised}
        borderColor={props.selected ? theme.accent.primary : theme.border.color}
        borderWidth={props.selected ? theme.border.hairline + 1 : theme.effects.cardBorderWidth}
        radius={theme.radius.md}
        shadow={theme.effects.cardShadow}
        contentStyle={{
          padding: theme.space.md,
          gap: theme.space.xs,
          borderRadius: theme.radius.md,
        }}>
        <View style={[styles.head, { gap: theme.space.sm }]}>
          {props.selected ? (
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.accentText }]}>✓</Text>
          ) : null}
          <Text
            style={[
              typeStyle(theme, theme.type.small),
              { color: theme.onRaised.primary, fontWeight: props.selected ? '700' : '500', flex: 1 },
            ]}>
            {props.title}
          </Text>
          {props.subtitle ? (
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              {props.subtitle}
            </Text>
          ) : null}
        </View>
        {props.description ? (
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
            {props.description}
          </Text>
        ) : null}
        {props.children}
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch' },
  head: { flexDirection: 'row', alignItems: 'center' },
  disabled: { opacity: 0.45 },
});