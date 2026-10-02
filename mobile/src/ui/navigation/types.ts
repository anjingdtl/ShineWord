/**
 * Route contract for the app shell.
 *
 * P2 replaces the old `useState<Screen>` union with a real navigator: the three
 * top-level intents are tabs, while opening a campaign and playing a turn stay
 * full-screen stack pages so they keep the system back stack and stay
 * immersive (plan §2).
 */
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ThemeId } from '../theme/tokens';
export type RootStackParamList = {
  /** Bottom-tab shell: 书库 / 战役 / 我的. */
  Tabs: NavigatorScreenParams<RootTabParamList> | undefined;
  /** One project's workspace: build tasks + links to the world panels. */
  ProjectHub: {
    worldId: string;
    title: string;
    campaignId?: string;
    branchId?: string;
  };
  WriterStyle: { worldId: string; title: string };
  /** Per-world detail with sub-tabs (资料 / 三宝书 / 审查 / 世界包). */
  WorldDetail: {
    worldId: string;
    title: string;
    /** Branch whose discoveries filter the player view of the books. */
    campaignId?: string;
    branchId?: string;
    /** Sub-tab to open on mount; defaults to 资料. */
    initialTab?: WorldTab;
  };
  /** Opening wizard, full screen (no tabs). */
  Opening: { worldId: string; title: string };
  /** Play screen, full screen (no tabs). */
  Play: { campaignId: string; branchId: string };
  /** Temporary P1/P2 inspection harness for the four skins. */
  ThemeGallery: undefined;
};

export type WorldTab = 'overview' | 'books' | 'review' | 'package';

export const WORLD_TABS: ReadonlyArray<{ key: WorldTab; label: string }> = [
  { key: 'overview', label: '资料' },
  { key: 'books', label: '三宝书' },
  { key: 'review', label: '审查' },
  { key: 'package', label: '世界包' },
];

export type RootTabParamList = {
  Library: undefined;
  Campaigns: undefined;
  Profile: undefined;
};

/**
 * A tab screen can reach both its sibling tabs and the full-screen stack pages,
 * so its navigation type is the composition of the two.
 */
export type AppTabNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<RootTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

/** Lets `useNavigation()` infer the root param list without generics. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export type { ThemeId };
