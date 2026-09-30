/**
 * 世界详情 — the sub-tab host (资料 / 三宝书 / 审查 / 世界包).
 *
 * P3.5: the tab strip uses the phase-3 `SegmentedControl`, the four bodies live
 * in `features/world-detail`, and the whole page is mounted inside a
 * `ThemeScope` bound to the world's effective skin, so the per-world override
 * stored since P1 finally takes effect here. No `legacyStyles` import remains.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { buildProvider, createSession } from '../../runtime';
import { getWorldEntry, getWorldPreparationStatus, type WorldLibraryEntry, type WorldPreparationView } from '../../worldImport';
import { getBuildRunProgress, startFullWorldRefinement, getStagePlanView, switchToFullBuild, type UnifiedImportSummary } from '../../sourceImport';
import { startOrResumeBuild } from '../../buildWatchdog';
import { Header } from '../components/Header';
import { Button } from '../components/Button';
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

const STAGE_STATUS_LABEL: Record<string, string> = {
  untriggered: '未触发', queued: '已排队', building: '构建中', validating: '校验中',
  built: '已构建', pending_activation: '待激活', activated: '已激活',
  waiting_network: '等网络', waiting_unlock: '等解锁', waiting_system: '等系统',
  paused: '已暂停', failed: '失败',
};

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
  const [preparation, setPreparation] = useState<WorldPreparationView | null>(null);
  const [refinementRunId, setRefinementRunId] = useState<string | null>(null);
  const [refinementMessage, setRefinementMessage] = useState<string | null>(null);
  const [refinementBusy, setRefinementBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWorld = useCallback(async () => {
    if (!profile) return;
    const session = await createSession(profile, await buildProvider(profile));
    const worldSetup = await session.getWorldSetup(worldId);
    const worldEntry = await getWorldEntry(worldId);
    const worldPreparation = await getWorldPreparationStatus({
      worldId,
      ...(campaignId && branchId ? { campaignId, branchId } : {}),
    });
    setSetup({
      packageRevision: worldSetup.packageRevision,
      rulesetVersion: worldSetup.rulesetVersion,
    });
    setEntry(worldEntry);
    setPreparation(worldPreparation);
    setError(null);
  }, [profile, worldId, campaignId, branchId]);

  useEffect(() => {
    let cancelled = false;
    refreshWorld().catch(e => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshWorld]);

  useEffect(() => {
    if (!refinementRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (): Promise<void> => {
      try {
        const progress = await getBuildRunProgress(refinementRunId);
        if (cancelled || !progress) return;
        const phaseLabels: Record<string, string> = {
          extracting: '抽取原著', merging: '整理事实', mapping: '映射三宝书',
          validating: '校验三宝书', publishing: '发布三宝书',
        };
        setRefinementMessage(
          `${phaseLabels[progress.phase] ?? progress.phase} ${progress.unitsDone}/${progress.unitsTotal} 组` +
          (progress.unitsFailed > 0 ? ` · ${progress.unitsFailed} 组失败` : ''),
        );
        if (progress.status === 'completed') {
          setRefinementBusy(false);
          setRefinementMessage('全文抽取与三宝书发布完成。');
          await refreshWorld();
          return;
        }
        if (['failed_retryable', 'needs_review', 'failed_terminal', 'canceled', 'paused_user', 'stopped_user', 'paused_system'].includes(progress.status)) {
          setRefinementBusy(false);
          setRefinementMessage(progress.status === 'needs_review'
            ? '全量精编遇到需要人工审查的内容；原开局包仍可继续使用。'
            : `全量精编暂未完成（${progress.lastErrorCode ?? progress.status}）；已保存进度，可稍后重试。`);
          await refreshWorld();
          return;
        }
        timer = setTimeout(() => { void poll(); }, 1500);
      } catch (e) {
        if (!cancelled) {
          setRefinementBusy(false);
          setRefinementMessage(e instanceof Error ? e.message : String(e));
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refinementRunId, refreshWorld]);

  const [stageView, setStageView] = useState<Awaited<ReturnType<typeof getStagePlanView>>>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const view = await getStagePlanView(worldId);
        if (!cancelled) setStageView(view);
      } catch {
        // worlds without a stage plan simply show nothing
      }
    })();
    return () => { cancelled = true; };
  }, [worldId, entry]);

  const switchToFull = useCallback(async () => {
    if (switchBusy) return;
    setSwitchBusy(true);
    setSwitchMessage(null);
    try {
      const runIds = await switchToFullBuild(worldId);
      setSwitchMessage(runIds.length > 0
        ? `已排队 ${runIds.length} 个剩余阶段任务，后台构建中。`
        : '没有待构建的阶段任务。');
      const view = await getStagePlanView(worldId);
      setStageView(view);
    } catch (e) {
      setSwitchMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchBusy(false);
    }
  }, [switchBusy, worldId]);

  const startFullRefinement = useCallback(async () => {
    if (!profile || refinementBusy) return;
    setRefinementBusy(true);
    setRefinementMessage('正在准备全量精编…');
    try {
      const started = await startFullWorldRefinement(worldId, profile);
      setRefinementRunId(started.runId);
      const outcome = await startOrResumeBuild(started.runId, profile, {
        resume: started.resumed,
        onProgress: progress => {
          if (progress.message) setRefinementMessage(progress.message);
        },
      });
      if (outcome === 'service' || outcome === 'active') {
        setRefinementMessage(started.resumed
          ? '正在恢复已保存的全文整理任务…'
          : '全量精编已在后台启动；本页会显示实际任务进度。');
        return;
      }
      const result = await getBuildRunProgress(started.runId);
      await refreshWorld();
      setRefinementBusy(false);
      setRefinementMessage(result?.status === 'completed'
        ? '全文抽取与三宝书发布完成。'
        : '全量精编暂未完成；已保存进度，可稍后重试。');
    } catch (e) {
      setRefinementBusy(false);
      setRefinementMessage(e instanceof Error ? e.message : String(e));
    }
  }, [profile, refinementBusy, worldId, refreshWorld]);

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
            {stageView ? (
              <View style={{ marginBottom: theme.space.md }}>
                <StatusBanner
                  tone="info"
                  title={`阶段计划（${stageView.strategy === 'progressive' ? '循序构建' : '完整构建'}）`}
                  message={`${stageView.stages.map(stage => `S${stage.index + 1}≈${Math.round(stage.ratio * 100)}%:${STAGE_STATUS_LABEL[stage.status] ?? stage.status}`).join('  ·  ')}${switchMessage ? `
${switchMessage}` : ''}`}
                />
                {stageView.strategy === 'progressive' ? (
                  <View style={{ marginTop: theme.space.sm }}>
                    <Button
                      label={switchBusy ? '排队中…' : '转完整构建（补齐剩余阶段）'}
                      variant="secondary"
                      onPress={switchToFull}
                      disabled={switchBusy}
                      block
                      testID="world-switch-full"
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            <WorldOverviewPanel
              worldId={worldId}
              title={title}
              campaignId={campaignId}
              branchId={branchId}
              setup={setup}
              entry={entry}
              preparation={preparation}
              refinementBusy={refinementBusy}
              refinementMessage={refinementMessage}
              onFullRefine={startFullRefinement}
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
