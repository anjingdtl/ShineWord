/**
 * Chip — a selectable pill. Thin wrapper over `Button variant="chip"` so the
 * pill only has one implementation; provided separately because suggestion
 * strips and filter rows read better with a purpose-named component.
 */
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Button } from './Button';

export function Chip(props: {
  label: string;
  onPress?: () => void;
  /** Highlight style — used by the quick-suggestion strip's first option. */
  hot?: boolean;
  selected?: boolean;
  disabled?: boolean;
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <Button
      label={props.label}
      onPress={props.onPress}
      variant="chip"
      hot={props.hot}
      selected={props.selected}
      disabled={props.disabled}
      leading={props.leading}
      style={props.style}
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
    />
  );
}
