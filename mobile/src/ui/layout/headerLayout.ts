export type HeaderTitleContainerStyle = { width: '100%' } | { flex: 1 };

/** Inline titles share the toolbar row; stacked titles use their own content-sized row. */
export function headerTitleContainerStyle(stacked: boolean): HeaderTitleContainerStyle {
  return stacked ? { width: '100%' } : { flex: 1 };
}
