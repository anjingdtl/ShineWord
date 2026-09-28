/**
 * Bridges the design tokens into React Navigation's own theme object, so the
 * navigator's containers, card backgrounds and default text already match the
 * active skin before a screen paints (no white flash on push, and the tab bar
 * inherits the right surface).
 */
import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import type { ThemeTokens } from '../theme/tokens';

export function buildNavigationTheme(tokens: ThemeTokens): Theme {
  const base = tokens.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: tokens.scheme === 'dark',
    colors: {
      ...base.colors,
      primary: tokens.accent.primary,
      background: tokens.bg.base,
      card: tokens.bg.raised,
      text: tokens.text.primary,
      border: tokens.border.color,
      notification: tokens.accent.secondary,
    },
  };
}
