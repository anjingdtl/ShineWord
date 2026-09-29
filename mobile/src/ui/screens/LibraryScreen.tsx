/**
 * 书库 Tab — world management: import a novel, build the three books, import a
 * portable world package (plan §7).
 *
 * P3.2 keeps the P2 data flow unchanged (same bridge calls, same
 * refresh-on-focus behaviour) and moves every piece of presentation into
 * `features/library`; the screen only assembles data and routes. No
 * `legacyStyles` import remains.
 */
import React, { useCallback, useState } from 'react';
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
import { importNovelUnified, runExtraction, pauseRun, cancelRun } from '../../sourceImport';
import type { BuildMode } from '../features/library/ImportNovelCard';
import { listOpenBuildTasks, type BuildTaskView } from '../../buildTasks';
import { startBuildService } from '../../buildServiceBridge';
import {
  buildWorldOnDevice,
  listWorlds,
  type BuiltWorldSummary,
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
  const [summary, setSummary] = useState<BuiltWorldSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buildMode, setBuildMode] = useState<BuildMode>('progressive');
  const [tasks, setTasks] = useState<BuildTaskView[]>([]);
  const [taskBusy, setTaskBusy] = useState(false);

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

  // Re-query whenever the tab regains focus. A build can fail after the world
  // row was already created, so the list must not depend on a full app restart
  // to show the world (and its review queue) the user was just told about.
  useFocusEffect(
    useCallback(() => {
      refresh();
      // App-open recovery (P4): runs interrupted by system recycling (not
      // user force-stop, which cannot run code until the user reopens) resume
      // through the same service entry. User-paused/needs-review runs wait
      // for an explicit tap.
      (async () => {
        try {
          const open = await listOpenBuildTasks();
          const recoverable = open.filter(task =>
            task.status === 'queued' || task.status === 'running'
            || task.status === 'waiting_network' || task.status === 'failed_retryable');
          for (const task of recoverable) {
            if (task.status === 'running' && task.leaseHeld) continue; // live executor
            await startBuildService(task.runId);
          }
        } catch {
          // recovery is best-effort; the task card still offers manual resume
        }
      })();
    }, [refresh]),
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
      // C5: prefer the dataSync foreground service (headless runner); fall
      // back to inline execution when the service cannot start (e.g. the
      // process is background-restricted). The run lease guarantees a single
      // executor either way.
      const serviceStarted = await startBuildService(runId);
      if (!serviceStarted) {
        await runExtraction(runId, profile, () => undefined);
      }
      await refresh();
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
    setSummary(null);
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
      for (const runId of imported.runIds) {
        const started = await startBuildService(runId);
        if (!started) {
          await runExtraction(runId, profile, () => undefined);
        }
      }
      const stageText = imported.stages.map(stage => `S${stage.index + 1}≈${Math.round(stage.ratio * 100)}%`).join(' / ');
      setPreview(`已导入 ${imported.chapterCount} 章、${imported.chunkCount} 块；阶段计划 ${stageText}。${
        imported.strategy === 'progressive'
          ? '循序构建：首个阶段（约前 30%）构建发布后即可开局；后续阶段由剧情推进触发。'
          : '完整构建：全书构建完成并发布后开局。'
      }任务已在后台排队，可在下方任务卡查看进度。`);
      setSummary({
        worldId: imported.worldId,
        title: picked.name.replace(/\.txt$/i, ''),
        chapterCount: imported.chapterCount,
        chunkCount: imported.chunkCount,
        entityCount: 0,
        factCount: 0,
        eventCount: 0,
        failedChunks: 0,
        rejected: 0,
        resumed: imported.reusedSource,
        packageRevision: 0,
        reviewIssues: 0,
        needsRetry: false,
      });
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
              onPause={runId => { pauseRun(runId); }}
              onCancel={runId => { void cancelRun(runId).then(refresh); }}
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
          <BuildStatusCard progress={progress} summary={summary} preview={preview} />
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
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
});
