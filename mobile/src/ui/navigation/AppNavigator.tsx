/**
 * The app shell: bottom tabs for the three top-level intents, a native stack
 * for the immersive pages, and the temporary theme gallery.
 *
 * P2 replaces the `useState<Screen>` switch that lived in App.tsx. The decision
 * recorded in the plan (§2) is reflected here: books and the review queue are
 * sub-tabs of a world instead of sibling pages, and playing/opening are
 * full-screen so they keep the system back stack (no header of their own — each
 * screen renders the themed <Header />, which keeps all chrome on tokens).
 */
import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { BookOpen, Swords, User } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from '../components/typography';
import { LibraryScreen } from '../screens/LibraryScreen';
import { CampaignsScreen } from '../screens/CampaignsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { WorldDetailScreen } from '../screens/WorldDetailScreen';
import { OpeningScreen } from '../screens/OpeningScreen';
import { PlayScreen } from '../screens/PlayScreen';
import { ThemeGalleryScreen } from '../screens/ThemeGalleryScreen';
import { buildNavigationTheme } from './navigationTheme';
import type { RootStackParamList, RootTabParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<RootTabParamList>();

function TabsNavigator(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accentText,
        tabBarInactiveTintColor: theme.text.secondary,
        tabBarStyle: {
          backgroundColor: theme.bg.raised,
          borderTopColor: theme.border.color,
          borderTopWidth: theme.border.hairline,
          height: theme.touch.min + theme.space.xl,
          paddingTop: theme.space.xs,
          paddingBottom: theme.space.sm,
        },
        tabBarLabelStyle: typeStyle(theme, theme.type.micro),
        tabBarItemStyle: { paddingVertical: theme.space.xs / 2 },
      }}>
      <Tabs.Screen
        name="Library"
        component={LibraryScreen}
        options={{
          title: '书库',
          tabBarIcon: ({ color, size }) => <BookOpen size={size} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="Campaigns"
        component={CampaignsScreen}
        options={{
          title: '战役',
          tabBarIcon: ({ color, size }) => <Swords size={size} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: '我的',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} strokeWidth={1.8} />,
        }}
      />
    </Tabs.Navigator>
  );
}

/** Route wrapper: the gallery is a page, and closing it pops the stack. */
function ThemeGalleryRoute(): React.JSX.Element {
  const navigation = useNavigation();
  return <ThemeGalleryScreen onClose={() => navigation.goBack()} />;
}

export function AppNavigator(): React.JSX.Element {
  const { theme } = useTheme();
  const navigationTheme = useMemo(() => buildNavigationTheme(theme), [theme]);
  return (
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg.base },
        }}>
        <RootStack.Screen name="Tabs" component={TabsNavigator} />
        <RootStack.Screen name="WorldDetail" component={WorldDetailScreen} />
        <RootStack.Screen name="Opening" component={OpeningScreen} />
        <RootStack.Screen name="Play" component={PlayScreen} />
        <RootStack.Screen name="ThemeGallery" component={ThemeGalleryRoute} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
