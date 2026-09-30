/**
 * 书库 Tab — world management: import a novel, build the three books, import a
 * portable world package (plan §7).
 *
 * P3.2 keeps the P2 data flow unchanged (same bridge calls, same
 * refresh-on-focus behaviour) and moves every piece of presentation into
 * `features/library`; the screen only assembles data and routes. No
 * `legacyStyles` import remains.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  buildProvider,
  createSession,
  importPortableWorldPackageFile,
  type CampaignListItem,
} from '../../runtime';
import { pickNovelFile, pickTextRef } from '../../fileBridge';
import { importNovelUnified, pauseRun, cancelRun } from '../../sourceImport';
import versionJson from '../../version.json';
import type { BuildMode } from '../features/library/ImportNovelCard';
import { isTaskListDynamic, listOpenBuildTasks, type BuildTaskView } from '../../buildTasks';
import { recoverBuildTasks, startOrResumeBuild } from '../../buildWatchdog';
import {
  listWorlds,
  type WorldBuildProgress,
  type WorldLibraryEntry,
} from '../../worldImport';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBanner } from '../components/StatusBanner';
import { typeStyle } from '../components/typography';
import { BuildStatusCard } from '../features/library/BuildStatusCard';
import { BuildTaskCard } from '../features/library/BuildTaskCard';
import { ImportNovelCard } from '../features/library/ImportNovelCard';
import { WorldList } from '../features/library/WorldList';
import { useTheme } from '../theme/ThemeContext';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList } from '../navigation/types';

export function LibraryScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, error, setError } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [worlds, setWorlds] = useState<WorldLibraryEntry[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<WorldBuildProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buildMode, setBuildMode] = useState<BuildMode>('progressive');
  const [tasks, setTasks] = useState<BuildTaskView[]>([]);
  const [taskBusy, setTaskBusy] = useState(false);
  const focusedRef = useRef(true);
  const previousTasksRef = useRef<BuildTaskView[]>([]);

  const refresh = useCallback(async () => {
    if (!profile) return;
    try {
      setTasks(await listOpenBuildTasks().catch(() => []));
      setWorlds(await listWorlds());
      // The campaign list is still loaded here because a world card links to
      // its books with the branch that filters discovered entries.
      const session = await createSession(profile, await buildProvider(profile));
      const campaignList = await session.listCampaigns();
      const withBranches: CampaignListItem[] = [];
      for (const campaign of campaignList) {
        const branches = await session.listBranches(campaign.campaignId);
        for (const branch of branches) {
          withBranches.push({ ...campaign, branchId: branch.branchId });
        }
      }
      setCampaigns(withBranches);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profile, setError]);

  /** Light-weight task-only refresh; local SQLite only, no provider calls. */
  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await listOpenBuildTasks());
    } catch {
      // polling is best-effort; the next focus refresh recovers
    }
  }, []);

  // Finished runs disappear from the open-task query. Refresh the published
  // world at that boundary so its opening button works without leaving the
  // library, including when the headless service finishes after startup.
  useEffect(() => {
    const currentIds = new Set(tasks.map(task => task.runId));
    const finished = previousTasksRef.current.some(task => !currentIds.has(task.runId));
    previousTasksRef.current = tasks;
    if (finished) void refresh();
  }, [tasks, refresh]);

  // Task-list auto refresh (real-device P0-2/§4): while any task is dynamic
  // (running / control requested / waiting / retryable) the open tasks are
  // re-queried every ~1.5s so pause/stop/progress surface without a manual
  // pull. Stops on blur and when every task goes static.
  useEffect(() => {
    if (!focusedRef.current || !isTaskListDynamic(tasks)) return;
    const timer = setInterval(() => {
      if (!focusedRef.current) return;
      void refreshTasks();
    }, 1_500);
    return () => clearInterval(timer);
  }, [tasks, refreshTasks]);

  // Re-query whenever the tab regains focus. A build can fail after the world
  // row was already created, so the list must not depend on a full app restart
  // to show the world (and its review queue) the user was just told about.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      refresh();
      // App-open recovery (P4): runs interrupted by system recycling (not
      // user force-stop, which cannot run code until the user reopens) resume
      // through the same service entry. User-paused/needs-review runs wait
      // for an explicit tap.
      (async () => {
        try {
          const open = await listOpenBuildTasks();
          await recoverBuildTasks(open, profile);
        } catch {
          // recovery is best-effort; the task card still offers manual resume
        }
      })();
      return () => {
        focusedRef.current = false;
      };
    }, [refresh, profile]),
  );

  /** Existing campaign for a world; a branch is always playable. */
  const campaignFor = useCallback(
    (worldId: string): { campaignId: string; branchId: string } | null => {
      const found = campaigns.find(campaign => campaign.worldId === worldId);
      if (!found?.branchId) return null;
      return { campaignId: found.campaignId, branchId: found.branchId };
    },
    [campaigns],
  );

  async function resumeTask(runId: string) {
    if (taskBusy || !profile) return;
    setTaskBusy(true);
    try {
      // An explicit resume clears any stale pause/stop request BEFORE waking
      // an executor, so the coordinator never re-interrupts immediately.
      // C5 + real-device P0-2: prefer the dataSync foreground service, then
      // VERIFY it actually started (execution evidence in SQLite). Fall back
      // to inline execution when it did not; the run lease guarantees a
      // single executor either way.
      // Inline fallback can outlive this tap by minutes. Keep task controls
      // available while its persisted progress is polled by the card list.
      void startOrResumeBuild(runId, profile, { resume: true })
        .then(refresh)
        .catch(e => setError(e instanceof Error ? e.message : String(e)));
      await refreshTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskBusy(false);
    }
  }

  async function importAndBuild() {
    if (busy || !profile) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      // Unified build (P3): staged streaming import + persistent 30/30/40
      // stage plan. Progressive queues only S1 (later stages wait for
      // narrative triggers); full queues every stage. Both run through the
      // same dataSync foreground service entry.
      const picked = await pickTextRef();
      if (!picked) return;
      const imported = await importNovelUnified(
        picked.uri,
        picked.name,
        profile,
        buildMode,
        p => {
          setProgress(p);
          if (p.phase === 'importing') setPreview(p.message ?? null);
        },
      );
      // Real-device P0-2: a successful startForegroundService call proves
      // nothing - verify execution evidence and fall back inline if the
      // headless runner never wakes up.
      void (async () => {
        for (const runId of imported.runIds) {
          await startOrResumeBuild(runId, profile);
        }
        await refresh();
      })().catch(e => setError(e instanceof Error ? e.message : String(e)));
      const stageText = imported.stages.map(stage => `S${stage.index + 1}≈${Math.round(stage.ratio * 100)}%`).join(' / ');
      setNotice(`已导入 ${imported.chapterCount} 章、${imported.chunkCount} 块；阶段计划 ${stageText}。${
        imported.strategy === 'progressive'
          ? '循序构建：首个阶段（约前 30%）构建发布后即可开局；后续阶段由剧情推进触发。'
          : '完整构建：全书构建完成并发布后开局。'
      }构建进度以任务卡和世界状态为准。`);
      // From here the DB-backed task card owns live build progress. The
      // parser's last 0/N callback is not a snapshot of the running service.
      setProgress(null);
      setPreview(null);
      await refresh();
    } catch (e) {
      const detail = e instanceof Error
        ? `${e.message}\n${e.stack ?? ''}`
        : typeof e === 'object' && e !== null
          ? JSON.stringify(e)
          : String(e);
      setProgress({ phase: 'failed', message: detail.slice(0, 500) });
      setError(detail.slice(0, 300));
    } finally {
      setBusy(false);
    }
  }

  async function importWorldPackage() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      const imported = await importPortableWorldPackageFile(picked.bytes);
      setNotice(`已导入世界包「${imported.title}」r${imported.revision}。包内不含小说原文，已校验并创建独立世界。`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell>
      <Header
        title="书库"
        subtitle="把小说变成可以进入的世界"
        actions={
          <Button
            label="导入世界包"
            variant="chip"
            onPress={importWorldPackage}
            disabled={busy}
          />
        }
      />
      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}>
        {tasks.length > 0 ? (
          tasks.map(task => (
            <BuildTaskCard
              key={task.runId}
              task={task}
              busy={taskBusy}
              onResume={runId => resumeTask(runId)}
              onPause={runId => {
                pauseRun(runId);
                // Immediate feedback: the poll lands within ~1.5s, an eager
                // task query makes "暂停请求中" appear right away.
                void refreshTasks();
              }}
              onCancel={runId => {
                void cancelRun(runId).then(refreshTasks);
              }}
            />
          ))
        ) : null}
        <ImportNovelCard
          busy={busy}
          mode={buildMode}
          onModeChange={setBuildMode}
          onImportNovel={importAndBuild}
          onImportPackage={importWorldPackage}
        />

        {notice ? <StatusBanner tone="success" message={notice} /> : null}
        {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}

        {progress ? (
          <BuildStatusCard progress={progress} summary={null} preview={preview} />
        ) : null}

        <View>
          <SectionHeader
            title="我的世界"
            tone="base"
            subtitle={worlds.length > 0 ? `已导入 ${worlds.length} 部` : undefined}
          />
          <WorldList
            worlds={worlds}
            busy={busy}
            campaignFor={campaignFor}
            onOpenDetail={world => {
              const campaign = campaignFor(world.worldId);
              navigation.navigate('WorldDetail', {
                worldId: world.worldId,
                title: world.title,
                campaignId: campaign?.campaignId,
                branchId: campaign?.branchId,
              });
            }}
            onPrimary={world => {
              const campaign = campaignFor(world.worldId);
              if (campaign) {
                navigation.navigate('Play', { campaignId: campaign.campaignId, branchId: campaign.branchId });
                return;
              }
              navigation.navigate('Opening', { worldId: world.worldId, title: world.title });
            }}
            onOpenReview={world => {
              const campaign = campaignFor(world.worldId);
              navigation.navigate('WorldDetail', {
                worldId: world.worldId,
                title: world.title,
                campaignId: campaign?.campaignId,
                branchId: campaign?.branchId,
                initialTab: 'review',
              });
            }}
          />
        </View>

        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted }]}>
          三宝书与审核队列在世界详情内；战役、分支与存档在「战役」页。
        </Text>

        <View style={styles.credit}>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted, textAlign: 'center' }]}>
            作者：ShineHe
          </Text>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted, textAlign: 'center' }]}>
            Shine-TRPG {versionJson.versionName}
          </Text>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  credit: { alignItems: 'center', gap: 2, paddingTop: 12 },
});
