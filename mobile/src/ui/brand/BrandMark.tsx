/**
 * BrandMark — the product logo.
 *
 * Geometry (frozen, plan §3.3): a D20 hexagon silhouette, the inner face
 * triangle, and an "S" path — the story forks — drawn as the single accent.
 * Only the colours adapt per skin; the shape never changes.
 */
import React from 'react';
import Svg, { Path, Polygon } from 'react-native-svg';
import { useBrandPalette } from './brand';

export function BrandMark(props: {
  /** Rendered square size in dp. 48 must stay recognisable. */
  size?: number;
  /** Two-tone (ink + accent) or a single flat colour. */
  duo?: boolean;
  /** Overrides the ink colour; brand palette by default. */
  color?: string;
  /** Overrides the accent colour; brand palette by default. */
  accent?: string;
}): React.JSX.Element {
  const palette = useBrandPalette();
  const size = props.size ?? 24;
  const ink = props.color ?? palette.ink;
  const accent = props.duo === false ? ink : props.accent ?? palette.accent;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" pointerEvents="none">
      <Polygon
        points="24,3.4 42.6,14 42.6,34 24,44.6 5.4,34 5.4,14"
        fill="none"
        stroke={ink}
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      <Polygon
        points="24,3.4 42.6,34 5.4,34"
        fill="none"
        stroke={ink}
        strokeWidth={1.4}
        opacity={0.55}
        strokeLinejoin="round"
      />
      <Path
        d="M28.6 19.4 A4.6 4.6 0 0 0 19.4 19.4 L28.6 28.6 A4.6 4.6 0 0 1 19.4 28.6"
        fill="none"
        stroke={accent}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

