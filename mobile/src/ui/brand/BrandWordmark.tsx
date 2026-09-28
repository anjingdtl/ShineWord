/**
 * BrandWordmark — the product name set in the active skin's type tokens.
 *
 * The string itself always comes from `PRODUCT_NAME` so no screen can drift
 * back to the old brand.
 */
import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from '../components/typography';
import { PRODUCT_NAME } from './brand';

export function BrandWordmark(props: {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  align?: 'auto' | 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const size = props.size ?? 'md';
  const token = size === 'sm' ? theme.type.heading : size === 'lg' ? theme.type.display : theme.type.title;
  return (
    <Text
      numberOfLines={1}
      style={[
        typeStyle(theme, token),
        { color: props.color ?? theme.text.primary, textAlign: props.align ?? 'auto' },
        props.style,
      ]}>
      {PRODUCT_NAME}
    </Text>
  );
}