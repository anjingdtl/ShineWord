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
 *
 * P3.1: the loading screen is now the branded splash lockup (plan §6.3).
 */
import React from 'react';
import { ActivityIndicator, Button, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/ui/theme';
import { typeStyle } from './src/ui/components/typography';
import { ScreenShell } from './src/ui/components/ScreenShell';
import { BrandLockup } from './src/ui/brand';
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
  const { loading, profile, databaseError, createFreshDatabase } = useAppSession();
  if (loading) return <BootstrapScreen />;
  if (databaseError) return <ScreenShell><View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
    <Text accessibilityRole="header">需要新的开发数据基线</Text>
    <Text>{databaseError}</Text>
    <Button title="创建新的开发数据库" onPress={() => { void createFreshDatabase(); }} />
  </View></ScreenShell>;
  if (!profile) return <FirstRunScreen />;
  return <AppNavigator />;
}

/**
 * Branded bootstrap: mark, product name and the loading line. No fake progress
 * bar — the app is either still reading storage or already past this screen
 * (plan §6.3).
 */
function BootstrapScreen(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <ScreenShell>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.xl }}>
        <BrandLockup />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          <ActivityIndicator color={theme.accent.primary} />
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.text.secondary }]}>
            正在载入世界…
          </Text>
        </View>
      </View>
    </ScreenShell>
  );
}
