/**
 * Project Hub — one project's workspace (task §20/§21).
 *
 * The hub owns this project's build surface ONLY: its task cards (pause/
 * resume/stop + advanced batch/chapter/token diagnostics) and the links into
 * the existing world-detail panels (资料 / 三宝书 / 审查 / 世界包), which are
 * reused as-is. Project A's build never renders in Project B's hub.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import {
  isTaskListDynamic,
  listBuildTaskPerfStats,
  listOpenBuildTasksForWorld,
  listBuildTasksForWorld,
  acknowledgeBuildReplay,
  type BuildTaskPerfStats,
  type BuildTaskView,
} from '../../buildTasks';
import { importNovelPartToProject, pauseRun, cancelRun, useCurrentApiForRun } from '../../sourceImport';
import { recoverBuildTasks, startOrResumeBuild } from '../../buildWatchdog';
import { pickTextRef } from '../../fileBridge';
import { deriveProjectStatus, listProjectBuildSummaries, summarizeProjectBuild, PROJECT_STATUS_LABEL, type ProjectBuildSummary } from '../../projectLibrary';
import { ProjectActionsMenu } from '../features/library/ProjectActionsMenu';
import { getSegmentReadiness, retrySegmentPreparation } from '../../segmentRuntime';
import { getWorldEntry } from '../../worldImport';
import { deleteProjectNow, findActiveProjectRuns, stopAndDeleteProject } from '../../projectDeletion';
import { useAppSession } from '../state/AppSessionContext';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBanner } from '../components/StatusBanner';
import { typeStyle } from '../components/typography';
import { BuildTaskCard } from '../features/library/BuildTaskCard';
import {
  DeleteProjectDialog,
  type DeleteProjectPhase,
} from '../features/library/DeleteProjectDialog';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList, WorldTab } from '../navigation/types';

type ProjectHubRoute = RouteProp<RootStackParamList, 'ProjectHub'>;

export function ProjectHubScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, setError } = useAppSession();
  const route = useRoute<ProjectHubRoute>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { worldId, title } = route.params;
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof getSegmentReadiness>>>(null);
  const [tasks, setTasks] = useState<BuildTaskView[]>([]);
  const [perf, setPerf] = useState<BuildTaskPerfStats | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [entry, setEntry] = useState<Awaited<ReturnType<typeof getWorldEntry>>>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deletePhase, setDeletePhase] = useState<DeleteProjectPhase>('confirm');
  const [deleteBuilding, setDeleteBuilding] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const focused = useIsFocused();
  const refreshInFlight = useRef(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [buildSummary, setBuildSummary] = useState<ProjectBuildSummary>(() => summarizeProjectBuild([]));

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const [openTasks, worldEntry, summaries] = await Promise.all([
        listBuildTasksForWorld(worldId), getWorldEntry(worldId), listProjectBuildSummaries([worldId]),
      ]);
      setBuildSummary(summaries.get(worldId)!);
      setTasks(openTasks);
      setReadiness(await getSegmentReadiness(worldId));
      setEntry(worldEntry);
      const runId = openTasks[0]?.runId ?? null;
      setPerf(runId ? await listBuildTaskPerfStats(runId) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { refreshInFlight.current = false; }
  }, [worldId, setError]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      (async () => {
        try {
          if (profile) await recoverBuildTasks(await listOpenBuildTasksForWorld(worldId), profile);
        } catch { /* best-effort */ }
      })();
    }, [refresh, profile, worldId]),
  );

  const [appending, setAppending] = useState(false);

  /** Multi-part append (product ask #2): pick the next book's TXT, import it
   *  into THIS project, and start its whole-source build run. */
  async function appendNextPart() {
    if (appending || !profile) return;
    setAppending(true);
    setError(null);
    try {
      const picked = await pickTextRef();
      if (!picked) return;
      const imported = await importNovelPartToProject(
        picked.uri,
        picked.name,
        worldId,
        profile,
        () => undefined,
      );
      void (async () => {
        for (const runId of imported.runIds) {
          await startOrResumeBuild(runId, profile);
        }
        await refresh();
      })().catch(e => setError(e instanceof Error ? e.message : String(e)));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAppending(false);
    }
  }

  useEffect(() => {
    if (!focused || !isTaskListDynamic(tasks)) return;
    const timer = setInterval(() => void refresh(), 1_500);
    return () => clearInterval(timer);
  }, [focused, tasks, refresh]);

  async function resumeTask(runId: string, currentApi = false) {
    if (taskBusy || !profile) return;
    setTaskBusy(true);
    try {
      const effectiveRunId = currentApi ? await useCurrentApiForRun(runId, profile) : runId;
      void startOrResumeBuild(effectiveRunId, profile, { resume: true })
        .then(refresh)
        .catch(e => setError(e instanceof Error ? e.message : String(e)));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskBusy(false);
    }
  }

  function confirmRequestReplay(task: BuildTaskView) {
    const snapshot = task.replayRecovery;
    if (!snapshot || taskBusy) return;
    const details = snapshot.attempts.map(a => {
      const label = a.requestKind === 'world_extract' ? '事实抽取' : a.requestKind === 'world_mapping' ? '本项目共享映射'
        : a.requestKind === 'registry' ? '人物与地点登记' : a.requestKind === 'timeline' ? '时间线整理' : '构建请求';
      return `${label} · ${new Date(a.startedAt).toLocaleString()} · 输出预算 ${a.wireOutputTokens ?? '未知'} Token`;
    }).join('\n');
    Alert.alert('核实上次模型请求',
      `请先在 API 服务商核实上次请求的结果和计费。允许重试可能产生重复计费。\n\n${details}\n\n仅确认以上 ${snapshot.attemptIds.length} 条尝试。确认后可另行继续构建；后续新的未知结果仍需核实。`, [
        { text: '取消', style: 'cancel' },
        { text: '已核实，允许重试', onPress: () => {
          setTaskBusy(true);
          void acknowledgeBuildReplay(snapshot).catch(e => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => { setTaskBusy(false); void refresh(); });
        } },
      ]);
  }

  const playable = (entry?.packageRevision ?? 0) > 0 && entry?.openingReady === true;
  const projectStatus = PROJECT_STATUS_LABEL[deriveProjectStatus(entry ?? { packageRevision: 0 }, buildSummary)];

  async function requestDelete() {
    setDeleteVisible(true);
    setDeletePhase('confirm');
    setDeleteError(null);
    try {
      const active = await findActiveProjectRuns(worldId);
      setDeleteBuilding(active.length > 0);
    } catch {
      setDeleteBuilding(false);
    }
  }

  async function confirmDelete() {
    setDeleteError(null);
    setDeletePhase(deleteBuilding ? 'stopping' : 'deleting');
    try {
      if (deleteBuilding) {
        await stopAndDeleteProject(worldId);
      } else {
        await deleteProjectNow(worldId);
      }
      setDeleteVisible(false);
      // Task §31: straight back to the project list; the deleted project is
      // gone everywhere (its runs can no longer be recovered or notified).
      if (navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      setDeletePhase('error');
      setDeleteError(e instanceof Error ? e.message : String(e));
      try {
        const active = await findActiveProjectRuns(worldId);
        setDeleteBuilding(active.length > 0);
      } catch { /* keep the current mode */ }
    }
  }

  const openWorldTab = (initialTab?: WorldTab) => {
    navigation.navigate('WorldDetail', {
      worldId,
      title,
      campaignId: route.params.campaignId,
      branchId: route.params.branchId,
      initialTab,
    });
  };

  return (
    <ScreenShell>
      <Header
        title={title}
        subtitle={`项目 · ${projectStatus}`}
        onBack={() => {
          if (navigation.canGoBack()) navigation.goBack();
        }}
        actions={
          <Button label="⋯" variant="chip" onPress={() => setMenuVisible(true)} accessibilityLabel="项目操作" />
        }
      />
      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}>
        <Card>
          <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
            {playable ? '这个世界已经可以开始冒险' : '世界资料构建中，完成后即可开局'}
          </Text>
          <View style={[styles.actions, { marginTop: theme.space.md, gap: theme.space.sm }]}>
            <Button
              label={route.params.campaignId ? '继续冒险' : '开始冒险'}
              variant="primary"
              disabled={!playable}
              onPress={() => {
                if (route.params.campaignId && route.params.branchId) {
                  navigation.navigate('Play', {
                    campaignId: route.params.campaignId,
                    branchId: route.params.branchId,
                  });
                  return;
                }
                navigation.navigate('Opening', { worldId, title });
              }}
            />
            <Button
              label={appending ? '导入中…' : '追加下一部书籍'}
              variant="secondary"
              disabled={appending || !profile}
              onPress={() => void appendNextPart()}
              testID="project-append-part"
            />
          </View>
        </Card>

        {readiness ? <Card>
          <Text style={typeStyle(theme, theme.type.body)}>已就绪资料：{readiness.availableArtifacts.length} 段 · 正在准备：{readiness.segments.filter(s => ['queued','extracting','mapping','validating'].includes(s.status)).length} 段</Text>
          {readiness.pauseReason ? <Text style={typeStyle(theme, theme.type.small)}>整理已暂停，已就绪内容可继续使用。</Text> : null}
          {readiness.diagnostics.length ? <Text style={typeStyle(theme, theme.type.small)}>部分资料需要处理，可在构建任务与审查中查看原因。</Text> : null}
          {readiness.segments.filter(s => s.status === 'failed_retryable' && !s.runIds.length && s.lastErrorCode === 'execution_prepare_failed').map(segment => (
            <View key={segment.intent.segmentId} style={{ gap: theme.space.sm }}>
              <Text style={typeStyle(theme, theme.type.small)}>原著资料准备未完成，请检查原文或重试准备。</Text>
              <Button label="重试准备" disabled={taskBusy || Boolean(readiness.pauseReason)}
                onPress={() => {
                  setTaskBusy(true);
                  void retrySegmentPreparation(worldId, segment.intent.segmentId).catch(e => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => { setTaskBusy(false); void refresh(); });
                }} />
            </View>
          ))}
        </Card> : null}
        <View>
          <SectionHeader
            title="构建任务"
            tone="base"
            subtitle={tasks.length > 0 ? `${tasks.length} 个任务` : '暂无进行中的任务'}
          />
          {tasks.map(task => (
            <View key={task.runId} style={{ marginBottom: theme.space.md }}>
              <BuildTaskCard
                task={task}
                busy={taskBusy}
                onReview={() => openWorldTab('review')}
                onConfirmReplay={() => confirmRequestReplay(task)}
                onResumeCurrentApi={runId => void resumeTask(runId, true)}
                onResume={runId => void resumeTask(runId)}
                onPause={runId => {
                  pauseRun(runId);
                  void refresh();
                }}
                onCancel={runId => {
                  void cancelRun(runId).then(refresh);
                }}
              />
            </View>
          ))}
          {tasks.length === 0 ? (
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
              {playable ? '当前阶段已可游玩，后续资料会随探索逐步补齐。' : '还没有进行中的构建任务；重新导入同一文件可继续构建。'}
            </Text>
          ) : null}
          {perf ? (
            <View style={{ marginTop: theme.space.sm }}>
              <Button
                label={showAdvanced ? '收起高级详情' : '高级详情'}
                variant="chip"
                onPress={() => setShowAdvanced(value => !value)}
              />
              {showAdvanced ? (
                <View style={{ marginTop: theme.space.sm, gap: 2 }}>
                  <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                    {`原著覆盖：${perf.chapterCount} 章`}
                  </Text>
                  <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                    {`LLM：${tasks[0]?.unitsDone ?? 0} / ${tasks[0]?.unitsTotal ?? perf.batchCount} 批`}
                  </Text>
                  <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                    {`章节：${perf.chapterCount} · 原文块：${perf.chunkCount} · LLM 批次：${perf.batchCount}（三者口径不同）`}
                  </Text>
                  {perf.currentBatchChapterRange ? (
                    <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                      {`当前批次章节范围：${perf.currentBatchChapterRange}`}
                    </Text>
                  ) : null}
                  {perf.usage ? (
                    <>
                      <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                        {`LLM 请求 ${perf.usage.requests} 次 · 平均响应 ${perf.usage.avgResponseMs} ms`}
                      </Text>
                      <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                        {`input ${perf.usage.inputTokens} · output ${perf.usage.outputTokens} · reasoning ${perf.usage.reasoningTokens}`}
                      </Text>
                      {perf.usage.cachedInputTokens > 0 ? (
                        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                          {`缓存命中 ${perf.usage.cachedInputTokens}（${Math.round(perf.usage.cachedInputTokens / Math.max(1, perf.usage.inputTokens) * 100)}%）`}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                  {perf.concurrency ? (
                    <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                      {`并发 ${perf.concurrency}`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View>
          <SectionHeader title="项目概览" tone="base" />
          <Button label="叙述风格" onPress={() => navigation.navigate('WriterStyle', { worldId, title })} />
          <View style={[styles.actions, { gap: theme.space.sm, flexWrap: 'wrap' }]}>
            <Button label="资料" variant="secondary" onPress={() => openWorldTab('overview')} />
            <Button label="三宝书" variant="secondary" onPress={() => openWorldTab('books')} />
            <Button label="审查" variant="secondary" onPress={() => openWorldTab('review')} />
            <Button label="世界包" variant="secondary" onPress={() => openWorldTab('package')} />
          </View>
        </View>

        {entry && entry.openReviewIssues > 0 ? (
          <StatusBanner
            tone="warning"
            message={`本世界有 ${entry.openReviewIssues} 条待处理审查问题。`}
          />
        ) : null}
      </ScrollView>

      <ProjectActionsMenu
        visible={menuVisible}
        title={title}
        onCancel={() => setMenuVisible(false)}
        onDelete={() => { setMenuVisible(false); void requestDelete(); }}
      />
      <DeleteProjectDialog
        visible={deleteVisible}
        title={title}
        building={deleteBuilding}
        phase={deletePhase}
        errorMessage={deleteError}
        onCancel={() => {
          if (deletePhase === 'stopping' || deletePhase === 'deleting') return;
          setDeleteVisible(false);
          setDeleteError(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  actions: { flexDirection: 'row' },
});
