/**
 * Slot 1 — corner ornaments.
 *
 * Artwork is authored top-left and mirrored for the other three corners, which
 * mirrors how the prototype does it with CSS `scaleX/scaleY`.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import { useTheme } from '../ThemeContext';
import { CORNER_SPECS } from './specs';
import { renderDots, renderShapes } from './helpers';

export type CornerPosition = 'tl' | 'tr' | 'bl' | 'br';

const MIRROR: Record<CornerPosition, (box: number) => string | undefined> = {
  tl: () => undefined,
  tr: box => `translate(${box},0) scale(-1,1)`,
  bl: box => `translate(0,${box}) scale(1,-1)`,
  br: box => `translate(${box},${box}) scale(-1,-1)`,
};

/** A single corner flourish. Which art is drawn comes from the active skin. */
export function OrnamentCorner(props: {
  position: CornerPosition;
  /** Rendered square size in dp. */
  size?: number;
  /** Multiplied on top of the token colour, e.g. to dim frame art. */
  opacity?: number;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  const spec = CORNER_SPECS[theme.ornament.corner];
  if (!spec) return null;
  const size = props.size ?? 30;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${spec.box} ${spec.box}`}
      opacity={props.opacity}
      pointerEvents="none">
      <G transform={MIRROR[props.position](spec.box)}>
        {renderShapes(spec.shapes, theme, props.position)}
        {renderDots(spec.dots, theme, props.position)}
      </G>
    </Svg>
  );
}

const CORNERS: readonly CornerPosition[] = ['tl', 'tr', 'bl', 'br'];

/**
 * The four-corner frame that decorative cards mount once, so cards never
 * hand-place ornaments and every skin keeps the same layout.
 */
export function OrnamentFrame(props: {
  size?: number;
  /** Absolute inset from the host edges. */
  inset?: number;
  opacity?: number;
}): React.JSX.Element {
  const size = props.size ?? 30;
  const inset = props.inset ?? 5;
  const placements: Record<CornerPosition, { top?: number; bottom?: number; left?: number; right?: number }> = {
    tl: { top: inset, left: inset },
    tr: { top: inset, right: inset },
    bl: { bottom: inset, left: inset },
    br: { bottom: inset, right: inset },
  };
  return (
    <View style={styles.frame} pointerEvents="none">
      {CORNERS.map(position => (
        <View key={position} style={[styles.corner, placements[position]]}>
          <OrnamentCorner position={position} size={size} opacity={props.opacity} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  corner: { position: 'absolute' },
});
