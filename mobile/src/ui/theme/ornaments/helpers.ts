/**
 * Shared ornament rendering helpers.
 *
 * The only job here is turning a semantic `OrnamentTone` into a concrete token
 * colour, so no ornament component ever writes a literal colour.
 */
import React from 'react';
import { Circle, Path } from 'react-native-svg';
import type { ThemeTokens } from '../tokens';
import type { OrnamentDot, OrnamentShape, OrnamentTone } from './specs';

/**
 * `edge` means "the ink of this skin": pure black for manga (which supplies it
 * through `effects.cardShadow`), the hairline colour for everyone else.
 */
export function resolveTone(theme: ThemeTokens, tone: OrnamentTone): string {
  switch (tone) {
    case 'primary':
      return theme.accent.primary;
    case 'secondary':
      return theme.accent.secondary;
    case 'tertiary':
      return theme.accent.tertiary;
    case 'edge':
      return theme.effects.cardShadow?.color ?? theme.border.colorStrong;
  }
}

export function renderShapes(
  shapes: readonly OrnamentShape[],
  theme: ThemeTokens,
  keyPrefix: string,
): React.JSX.Element[] {
  return shapes.map((shape, index) => React.createElement(Path, {
    key: `${keyPrefix}-s${index}`,
    d: shape.d,
    stroke: resolveTone(theme, shape.tone),
    strokeWidth: shape.strokeWidth,
    strokeOpacity: shape.opacity ?? 1,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }));
}

export function renderDots(
  dots: readonly OrnamentDot[],
  theme: ThemeTokens,
  keyPrefix: string,
): React.JSX.Element[] {
  return dots.map((dot, index) => React.createElement(Circle, {
    key: `${keyPrefix}-d${index}`,
    cx: dot.cx,
    cy: dot.cy,
    r: dot.r,
    fill: dot.filled ? resolveTone(theme, dot.tone) : 'none',
    stroke: dot.filled ? undefined : resolveTone(theme, dot.tone),
    strokeWidth: dot.filled ? undefined : dot.strokeWidth ?? 1,
  }));
}
