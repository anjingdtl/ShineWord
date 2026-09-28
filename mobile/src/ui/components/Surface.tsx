/**
 * Surface — the one primitive that knows how a skin draws a box.
 *
 * Every skin renders "a panel" differently:
 *   ink / scifi  → flat fill + hairline border
 *   fantasy      → flat fill + an inner double hairline frame
 *   manga        → 3px black outline + a hard offset shadow (never a blur)
 *   scifi        → HUD corner cut (a diagonal instead of each corner)
 *
 * Card and Button both sit on this, so the rules live in exactly one place.
 *
 * The HUD corner cut is built from plain views, not from an SVG fill: React
 * Native cannot clip arbitrary content, and an absolutely-positioned
 * `react-native-svg` fill inside a clipped card did not paint on Android (it
 * also swallowed the card's own content). Four 45°-rotated squares in the
 * host's background colour notch the corners, and four rotated hairlines draw
 * the diagonal edges — no measurement, no z-order surprises, and the card still
 * renders correctly if `behindColor` does not match its backdrop.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export interface HardShadow {
  dx: number;
  dy: number;
  color: string;
}

/** One notched corner: the eraser square plus the diagonal edge it reveals. */
function CutCorner(props: {
  cut: number;
  borderWidth: number;
  borderColor: string;
  behindColor: string;
  vertical: 'top' | 'bottom';
  horizontal: 'left' | 'right';
}): React.JSX.Element {
  const { cut, borderWidth, borderColor, behindColor, vertical, horizontal } = props;
  const hairline = Math.max(borderWidth, StyleSheet.hairlineWidth);
  // A square rotated 45° centred on the corner covers `|x| + |y| <= size / √2`.
  // Solving for the triangle `(0,0)-(cut,0)-(0,cut)` gives `size = cut * √2`.
  const size = cut * Math.SQRT2;
  const eraser: ViewStyle = {
    position: 'absolute',
    width: size,
    height: size,
    backgroundColor: behindColor,
    transform: [{ rotate: '45deg' }],
    [vertical]: -size / 2,
    [horizontal]: -size / 2,
  };
  // Diagonal runs from the top edge to the side edge; the "\" corners rotate
  // the opposite way from the "/" ones.
  const along: ViewStyle = {
    position: 'absolute',
    width: cut * Math.SQRT2,
    height: hairline,
    backgroundColor: borderColor,
    transform: [{ rotate: vertical === 'top' ? '-45deg' : '45deg' }],
    [vertical]: cut / 2 - hairline / 2,
    [horizontal]: cut / 2 - (cut * Math.SQRT2) / 2,
  };
  return (
    <>
      <View pointerEvents="none" style={eraser} />
      <View pointerEvents="none" style={along} />
    </>
  );
}

export function Surface(props: {
  children?: React.ReactNode;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
  shadow?: HardShadow | null;
  /** Diagonal length of the HUD corner cut; 0 keeps square corners. */
  cut?: number;
  /** Colour of whatever sits behind the panel, used to notch cut corners. */
  behindColor?: string;
  /** Fantasy's inner double frame. */
  insetFrame?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const shadow = props.shadow ?? null;
  const cut = props.cut ?? 0;

  return (
    <View style={[styles.wrapper, props.style]}>
      {shadow && (shadow.dx !== 0 || shadow.dy !== 0) ? (
        <View
          pointerEvents="none"
          style={[
            styles.shadowLayer,
            {
              left: shadow.dx,
              top: shadow.dy,
              right: shadow.dx > 0 ? 0 : -shadow.dx,
              bottom: shadow.dy > 0 ? 0 : -shadow.dy,
              backgroundColor: shadow.color,
              borderRadius: props.radius,
            },
          ]}
        />
      ) : null}

      <View
        style={[
          styles.content,
          shadow ? { marginRight: shadow.dx, marginBottom: shadow.dy } : null,
          {
            backgroundColor: props.backgroundColor,
            borderColor: props.borderColor,
            borderWidth: props.borderWidth,
            borderRadius: cut > 0 ? 0 : props.radius,
          },
          props.contentStyle,
        ]}>
        {props.insetFrame ? (
          <View
            pointerEvents="none"
            style={[
              styles.insetFrame,
              {
                borderColor: props.borderColor,
                borderWidth: props.borderWidth,
                borderRadius: Math.max(0, props.radius - props.borderWidth),
                // The visible gap is one full border thickness; deriving it from
                // the token keeps fantasy's double rule proportional.
                top: props.borderWidth * 2,
                left: props.borderWidth * 2,
                right: props.borderWidth * 2,
                bottom: props.borderWidth * 2,
              },
            ]}
          />
        ) : null}

        {props.children}

        {cut > 0
          ? ([
              ['top', 'left'],
              ['top', 'right'],
              ['bottom', 'left'],
              ['bottom', 'right'],
            ] as const).map(([vertical, horizontal]) => (
              <CutCorner
                key={`${vertical}-${horizontal}`}
                cut={cut}
                borderWidth={props.borderWidth}
                borderColor={props.borderColor}
                behindColor={props.behindColor ?? props.backgroundColor}
                vertical={vertical}
                horizontal={horizontal}
              />
            ))
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  shadowLayer: { position: 'absolute' },
  content: { position: 'relative', overflow: 'hidden' },
  insetFrame: { position: 'absolute' },
});
