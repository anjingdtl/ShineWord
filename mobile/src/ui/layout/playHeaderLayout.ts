export type PlayHeaderMode = 'inline' | 'stacked';

export interface PlayHeaderViewport {
  width: number;
  height: number;
  fontScale: number;
}

/** Give long campaign titles a full-width row on narrow, short, or large-text screens. */
export function playHeaderMode(viewport: PlayHeaderViewport): PlayHeaderMode {
  if (viewport.width < 380 || viewport.height < 600 || viewport.fontScale >= 1.3) return 'stacked';
  return 'inline';
}
