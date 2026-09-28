/**
 * Slot 3 — full-bleed background texture (竹简竖线 / 网点纸 / 六边形网格) plus
 * the opt-in HUD scanline overlay.
 *
 * Both render behind content and never intercept touches. When the active skin
 * has no texture the component returns `null`, which is how `fantasy` stays
 * clean without any branching at the call site.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Pattern, Polygon, Rect } from 'react-native-svg';
import { useTheme } from '../ThemeContext';
import { PATTERN_SPECS } from './specs';
import { resolveTone } from './helpers';

export function BackgroundPattern(props: { style?: StyleProp<ViewStyle> }): React.JSX.Element | null {
  const { theme } = useTheme();
  const spec = PATTERN_SPECS[theme.ornament.pattern];
  if (!spec) return null;
  const color = resolveTone(theme, spec.tone);
  // One pattern id per skin: React Native SVG scopes ids per document, and a
  // stable id keeps re-renders from leaking a new `<defs>` entry each time.
  const patternId = `shineword-pattern-${theme.id}`;
  return (
    <Svg style={[styles.fill, props.style]} width="100%" height="100%" pointerEvents="none">
      <Pattern
        id={patternId}
        x="0"
        y="0"
        width={spec.width}
        height={spec.height}
        patternUnits="userSpaceOnUse">
        {spec.kind === 'line' ? (
          <Rect
            x={spec.width - spec.strokeWidth}
            y={0}
            width={spec.strokeWidth}
            height={spec.height}
            fill={color}
            fillOpacity={spec.opacity}
          />
        ) : null}
        {spec.kind === 'dot' ? (
          <Circle
            cx={spec.width / 2}
            cy={spec.height / 2}
            r={spec.strokeWidth}
            fill={color}
            fillOpacity={spec.opacity}
          />
        ) : null}
        {spec.kind === 'hex' ? (
          <Polygon
            points={[
              `${spec.width * 0.25},1`,
              `${spec.width * 0.75},1`,
              `${spec.width},${spec.height / 2}`,
              `${spec.width * 0.75},${spec.height - 1}`,
              `${spec.width * 0.25},${spec.height - 1}`,
              `0,${spec.height / 2}`,
            ].join(' ')}
            fill="none"
            stroke={color}
            strokeOpacity={spec.opacity}
            strokeWidth={spec.strokeWidth}
          />
        ) : null}
      </Pattern>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}

/** Scanlines are a token switch (`effects.scanlines`), off by default. */
export function ScanlineOverlay(): React.JSX.Element | null {
  const { theme } = useTheme();
  if (!theme.effects.scanlines) return null;
  const patternId = `shineword-scan-${theme.id}`;
  return (
    <Svg style={styles.fill} width="100%" height="100%" pointerEvents="none">
      <Pattern id={patternId} x="0" y="0" width={4} height={4} patternUnits="userSpaceOnUse">
        <Line
          x1={0}
          y1={0}
          x2={4}
          y2={0}
          stroke={theme.accent.primary}
          strokeOpacity={0.05}
          strokeWidth={1}
        />
      </Pattern>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
