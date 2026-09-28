/**
 * 世界详情 — the sub-tab host (资料 / 三宝书 / 审查 / 世界包).
 *
 * P3.5: the tab strip uses the phase-3 `SegmentedControl`, the four bodies live
 * in `features/world-detail`, and the whole page is mounted inside a
 * `ThemeScope` bound to the world's effective skin, so the per-world override
 * stored since P1 finally takes effect here. No `legacyStyles` import remains.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { buildProvider, createSession } from '../../runtime';
import { getWorldEntry, type WorldLibraryEntry } from '../../worldImport';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { SegmentedControl } from '../components/SegmentedControl';
import { StatusBanner } from '../components/StatusBanner';
import { useTheme, ThemeScope } from '../theme/ThemeContext';
import { ReviewPanel } from '../features/world-detail/ReviewPanel';
import { WorldBooksPanel } from '../features/world-detail/WorldBooksPanel';
import { WorldOverviewPanel, type WorldSetupSummary } from '../features/world-detail/WorldOverviewPanel';
import { WorldPackagePanel } from '../features/world-detail/WorldPackagePanel';
import { useAppSession } from '../state/AppSessionContext';
import { WORLD_TABS, type RootStackParamList, type WorldTab } from '../navigation/types';

const TAB_OPTIONS: ReadonlyArray<{ value: WorldTab; label: string }> = WORLD_TABS.map(entry => ({
  value: entry.key,
  label: entry.label,
}));

export function WorldDetailScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<RootStackParamList, 'WorldDetail'>>();
  const { themeIdForWorld } = useTheme();
  return (
    <ThemeScope themeId={themeIdForWorld(route.params.worldId)}>
      <WorldDetailContent />
    </ThemeScope>
  );
}

function WorldDetailContent(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'WorldDetail'>>();
  const { worldId, title, campaignId, branchId } = route.params;
  const [tab, setTab] = useState<WorldTab>(route.params.initialTab ?? 'overview');
  const [setup, setSetup] = useState<WorldSetupSummary | null>(null);
  const [entry, setEntry] = useState<WorldLibraryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const worldSetup = await session.getWorldSetup(worldId);
        const worldEntry = await getWorldEntry(worldId);
        if (cancelled) return;
        setSetup({
          packageRevision: worldSetup.packageRevision,
          rulesetVersion: worldSetup.rulesetVersion,
        });
        setEntry(worldEntry);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, worldId]);

  return (
    <ScreenShell bottom>
      <Header
        title={title}
        subtitle={`三宝书 r${setup?.packageRevision ?? '?'} · 规则 ${setup?.rulesetVersion || '未知'}`}
        onBack={() => navigation.goBack()}
      />
      <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.md }}>
        <SegmentedControl
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          compact
          testID="world-tab"
        />
      </View>

      <View style={{ flex: 1, paddingHorizontal: theme.space.lg, paddingTop: theme.space.md }}>
        {error ? (
          <StatusBanner tone="error" title="世界资料读取失败" message={error} />
        ) : null}

        {tab === 'overview' ? (
          <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl }}>
            <WorldOverviewPanel
              worldId={worldId}
              title={title}
              campaignId={campaignId}
              branchId={branchId}
              setup={setup}
              entry={entry}
              onCreateCampaign={() => navigation.navigate('Opening', { worldId, title })}
            />
          </ScrollView>
        ) : null}

        {tab === 'books' ? (
          <WorldBooksPanel worldId={worldId} campaignId={campaignId} branchId={branchId} />
        ) : null}

        {tab === 'review' ? (
          <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl }}>
            <ReviewPanel worldId={worldId} />
          </ScrollView>
        ) : null}

        {tab === 'package' ? (
          <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl }}>
            <WorldPackagePanel worldId={worldId} />
          </ScrollView>
        ) : null}
      </View>
    </ScreenShell>
  );
}