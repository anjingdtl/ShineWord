/**
 * Token -> TextStyle bridge.
 *
 * Components describe *which* type token they want (`body`, `heading`, …) and
 * this helper resolves the family, size, weight and tracking, so no component
 * ever writes a fontSize or a fontFamily string.
 */
import type { TextStyle } from 'react-native';
import type { ThemeTokens, TypeToken } from '../theme/tokens';

/** Resolves one type token against the active theme's font stacks. */
export function typeStyle(theme: ThemeTokens, token: TypeToken): TextStyle {
  return {
    fontFamily: theme.font[token.family],
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    fontWeight: token.fontWeight,
    letterSpacing: token.letterSpacing,
  };
}

/** Type token plus a colour, for the common "styled Text" case. */
export function textStyle(theme: ThemeTokens, token: TypeToken, color: string): TextStyle {
  return { ...typeStyle(theme, token), color };
}
