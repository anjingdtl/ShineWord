/**
 * Touch-target policy helpers.
 *
 * Several skins want visually compact controls (a 34dp comic chip, a 30dp
 * icon button) while §4 of the redesign plan still demands a 44dp touch
 * target. Rather than inflating the pixels — which would break the prototype's
 * look — the shortfall is added as `hitSlop`, computed from tokens so no
 * component invents a magic number.
 */
import { useMemo } from 'react';
import { useTheme } from '../theme/ThemeContext';

export interface HitSlop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Symmetric vertical padding that pads `visualHeight` up to the touch floor. */
export function useVerticalHitSlop(visualHeight: number): HitSlop {
  const { theme } = useTheme();
  const pad = Math.max(0, Math.ceil((theme.touch.min - visualHeight) / 2));
  return useMemo(() => ({ top: pad, bottom: pad, left: pad, right: 0 }), [pad]);
}
