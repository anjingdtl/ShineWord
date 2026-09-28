/**
 * PipTrack — the attribute / practice-point progress rail.
 *
 * `total` segments, the first `on` filled, and an optional `half` segment at
 * index `on` (the prototype's gradient half-pip). Skill practice points use the
 * same rail with `total = PRACTICE_THRESHOLDS[rank] / step` supplied by the
 * caller, which is what keeps the UI aligned with the rule domain.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function PipTrack(props: {
  total: number;
  on: number;
  /** Render the segment after the last filled one as a half fill. */
  half?: boolean;
  /** Overrides the token width; used by the compact skill rows. */
  width?: number;
  height?: number;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const total = Math.max(0, Math.floor(props.total));
  const on = Math.max(0, Math.min(props.on, total));
  const width = props.width ?? theme.pip.width;
  const height = props.height ?? theme.pip.height;

  return (
    <View
      style={[styles.track, { gap: theme.space.xs / 2 }]}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityValue={{ min: 0, max: total, now: on }}>
      {Array.from({ length: total }, (_, index) => {
        const filled = index < on;
        const half = !filled && props.half === true && index === on;
        return (
          <View
            key={index}
            style={{
              width,
              height,
              borderRadius: theme.pip.radius,
              borderWidth: theme.border.hairline,
              borderColor: theme.pip.border,
              backgroundColor: filled ? theme.pip.on : theme.pip.off,
              overflow: 'hidden',
              flexDirection: 'row',
            }}>
            {half ? (
              <>
                <View style={{ flex: 1, backgroundColor: theme.pip.half }} />
                <View style={{ flex: 1, backgroundColor: theme.pip.off }} />
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Convenience rail for six attributes at 1–3, as used on the character card. */
export function AttributePips(props: { value: number; max?: number }): React.JSX.Element {
  return <PipTrack total={props.max ?? 3} on={props.value} />;
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'center' },
});
