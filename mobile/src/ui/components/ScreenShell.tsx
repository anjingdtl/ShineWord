/**
 * ScreenShell — the themed page frame every screen sits in.
 *
 * Two jobs: paint the skin's page background and apply the safe-area inset that
 * the hidden navigation header would otherwise have handled. `bottom` is for
 * full-screen stack pages whose last row would slide under the gesture bar.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

export function ScreenShell(props: {
  children?: React.ReactNode;
  /** Reserve the bottom inset as well (full-screen stack pages). */
  bottom?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: theme.bg.base,
          paddingTop: insets.top,
          paddingBottom: props.bottom ? insets.bottom : 0,
        },
        props.style,
      ]}>
      {props.children}
    </View>
  );
}
