/**
 * App shell.
 *
 * P1/P2 of the UI revamp reduced this file from ~1950 lines of screens and a
 * shared StyleSheet to the four providers plus the profile gate. Every screen
 * now lives under `src/ui/screens`, the navigator under `src/ui/navigation`,
 * and the theme under `src/ui/theme`; the bridge layer (`./src/*.ts`) and the
 * rule domain (`../src`) are untouched.
 *
 * The gate is deliberately kept: the app is useless without an OpenAI-compatible
 * endpoint, so first-run shows the profile form instead of an empty navigator.
 */
import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/ui/theme';
import { typeStyle } from './src/ui/components/typography';
import { ScreenShell } from './src/ui/components/ScreenShell';
import { AppSessionProvider, useAppSession } from './src/ui/state/AppSessionContext';
import { AppNavigator } from './src/ui/navigation/AppNavigator';
import { FirstRunScreen } from './src/ui/screens/ProfileScreen';

export default function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AppSessionProvider>
          <AppRoot />
        </AppSessionProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

function AppRoot(): React.JSX.Element {
  const { loading, profile } = useAppSession();
  if (loading) return <BootstrapScreen />;
  if (!profile) return <FirstRunScreen />;
  return <AppNavigator />;
}

function BootstrapScreen(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <ScreenShell>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.md }}>
        <ActivityIndicator color={theme.accent.primary} />
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.text.secondary }]}>
          正在初始化 ShineWord…
        </Text>
      </View>
    </ScreenShell>
  );
}
