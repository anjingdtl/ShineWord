/**
 * 书库 Tab — the PROJECT LIST (task §16-§22).
 *
 * The top level manages projects only: search, compact project cards, import.
 * Everything build-related (task cards, three books, review, packages, perf
 * stats) lives inside the Project Hub; nothing global is piled onto this page
 * anymore. After an import the user lands straight in the new project's hub.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  importPortableWorldPackageFile,
} from '../../runtime';
import { pickNovelFile, pickTextRef } from '../../fileBridge';
import { importNovelUnified } from '../../sourceImport';
import { deleteProjectNow, findActiveProjectRuns, stopAndDeleteProject } from '../../projectDeletion';
import { refreshProjectBuildStatusFast, filterProjects, type ProjectStatusProjection, getWorldTitle } from '../../projectLibrary';
import { createLibraryRefreshController, refreshLibraryFull } from '../../projectLibraryRefresh';
import { ProjectActionsMenu } from '../features/library/ProjectActionsMenu';
import { listOpenBuildTasks } from '../../buildTasks';
import versionJson from '../../version.json';
import { recoverBuildTasks, startOrResumeBuild } from '../../buildWatchdog';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { TextField } from '../components/TextField';
import { typeStyle } from '../components/typography';
import { ProjectCard } from '../features/library/ProjectCard';
import {
  DeleteProjectDialog,
  type DeleteProjectPhase,
} from '../features/library/DeleteProjectDialog';
import { useTheme } from '../theme/ThemeContext';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList } from '../navigation/types';

export function LibraryScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, error, setError } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [projects, setProjects] = useState<ProjectStatusProjection[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Import-in-flight transient status (parse progress); kept minimal because
  // the DB-backed task card inside the project owns the build phase.
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectStatusProjection | null>(null);
  const [deletePhase, setDeletePhase] = useState<DeleteProjectPhase>('confirm');
  const [deleteBuilding, setDeleteBuilding] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<ProjectStatusProjection | null>(null);
  const projectsRef = useRef(projects);
  const refreshController = useMemo(() => createLibraryRefreshController({
    full: () => profile ? refreshLibraryFull(profile) : Promise.resolve([]),
    fast: refreshProjectBuildStatusFast,
    getProjects: () => projectsRef.current,
    apply: next => { projectsRef.current = next; setProjects(next); setProjectsLoaded(true); },
    onError: e => { setError(e instanceof Error ? e.message : String(e)); setProjectsLoaded(true); },
  }), [profile, setError]);
  const refresh = refreshController.refreshFull;

  useFocusEffect(useCallback(() => {
    void refreshController.focus();
    (async () => {
      try { await recoverBuildTasks(await listOpenBuildTasks(), profile); }
      catch { /* the hub offers manual resume */ }
    })();
    return () => refreshController.blur();
  }, [refreshController, profile]));

  const visible = useMemo(() => filterProjects(projects, query), [projects, query]);

  const openProject = useCallback((project: ProjectStatusProjection) => {
    navigation.navigate('ProjectHub', {
      worldId: project.worldId,
      title: project.title,
      campaignId: project.campaign?.campaignId,
      branchId: project.campaign?.branchId,
    });
  }, [navigation]);

  const primaryAction = useCallback((project: ProjectStatusProjection) => {
    if (project.campaign) {
      navigation.navigate('Play', {
        campaignId: project.campaign.campaignId,
        branchId: project.campaign.branchId,
      });
      return;
    }
    navigation.navigate('Opening', { worldId: project.worldId, title: project.title });
  }, [navigation]);

  async function importNovel() {
    if (busy || !profile) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setImportMessage(null);
    try {
      const picked = await pickTextRef();
      if (!picked) return;
      const imported = await importNovelUnified(
        picked.uri,
        picked.name,
        profile,
        'progressive',
        p => {
          if (p.phase === 'importing') setImportMessage(p.message ?? null);
        },
      );
      void (async () => {
        for (const runId of imported.runIds) {
          await startOrResumeBuild(runId, profile);
        }
        await refresh();
      })().catch(e => setError(e instanceof Error ? e.message : String(e)));
      // Same-source re-import intentionally reuses the EXISTING world for
      // identical bytes (sourceImport reusedSource): the project the user
      // lands in is the world that owns the source, NOT a new project named
      // after the picked file. Saying "已创建项目" here lied about what
      // actually happened (long-run 2026-10-05 BUG-IMPORT-DEDUP-1).
      const landedTitle = await getWorldTitle(imported.worldId)
        .then(title => title ?? picked.name.replace(/\.txt$/i, ''))
        .catch(() => picked.name.replace(/\.txt$/i, ''));
      setNotice(imported.reusedSource
        ? `该小说已存在项目「${landedTitle}」：同源文件继续在原项目上构建（本次 ${imported.chapterCount} 章）。`
        : `已创建项目「${landedTitle}」：${imported.chapterCount} 章。构建在项目内进行，完成后即可开局。`);
      setImportMessage(null);
      await refresh();
      // Task §21: land in the fresh project's hub; its build progress lives
      // there, not in the global list.
      navigation.navigate('ProjectHub', {
        worldId: imported.worldId,
        title: landedTitle,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setImportMessage(null);
      // Capability-source governance failures read as opaque English from the
      // domain layer; point the user at the exact profile fields to fix.
      setError(
        /contextWindow is unknown|contextWindow must be a positive integer|maxOutputTokens must be a positive integer|model budget leaves (less than|no room)/.test(detail)
          ? '当前 API 配置的模型能力声明不足（上下文窗口/最大输出 Token），无法开始构建。请到「我的」选择模型预设，或展开高级模型设置调大这两项后保存，再重新导入。'
          : detail.slice(0, 300),
      );
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
      setNotice(`已导入世界包「${imported.title}」r${imported.revision}。包内不含小说原文，已校验并创建独立项目。`);
      await refresh();
      navigation.navigate('ProjectHub', { worldId: imported.worldId, title: imported.title });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function requestDelete(project: ProjectStatusProjection) {
    setDeleteTarget(project);
    setDeletePhase('confirm');
    setDeleteError(null);
    try {
      const active = await findActiveProjectRuns(project.worldId);
      setDeleteBuilding(active.length > 0);
    } catch {
      setDeleteBuilding(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeletePhase(deleteBuilding ? 'stopping' : 'deleting');
    try {
      if (deleteBuilding) {
        await stopAndDeleteProject(deleteTarget.worldId);
      } else {
        await deleteProjectNow(deleteTarget.worldId);
      }
      setDeleteTarget(null);
      setDeleteBuilding(false);
      await refresh();
    } catch (e) {
      setDeletePhase('error');
      setDeleteError(e instanceof Error ? e.message : String(e));
      // Re-check whether the build is still active so a retry offers the
      // right mode.
      try {
        const active = await findActiveProjectRuns(deleteTarget.worldId);
        setDeleteBuilding(active.length > 0);
      } catch { /* keep the current mode */ }
    }
  }

  return (
    <ScreenShell>
      <Header
        title="书库"
        subtitle="把小说变成可以进入的世界"
        actions={
          <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
            <Button label="＋ 导入小说" variant="chip" onPress={importNovel} disabled={busy} />
            <Button label="导入世界包" variant="chip" onPress={importWorldPackage} disabled={busy} />
          </View>
        }
      />
      <ScrollView refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />} style={styles.scroll} contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}>
        {projects.length > 0 ? (
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder="搜索项目"
            tone="base"
            accessibilityLabel="搜索项目"
          />
        ) : null}

        {notice ? <StatusBanner tone="success" message={notice} /> : null}
        {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}
        {importMessage ? <StatusBanner tone="info" message={importMessage} /> : null}
        {!projectsLoaded && projects.length === 0 ? <StatusBanner tone="info" message="正在读取项目…" /> : null}

        {projectsLoaded && projects.length === 0 && !busy && !error ? (
          <EmptyState
            title="还没有项目"
            description="导入一本小说开始创建互动世界"
            action={<Button label="导入小说" variant="primary" onPress={importNovel} disabled={busy} />}
          />
        ) : (
          visible.map(project => (
            <ProjectCard
              key={project.worldId}
              project={project}
              onOpenProject={() => openProject(project)}
              onPrimary={() => primaryAction(project)}
              onMenu={() => setMenuTarget(project)}
            />
          ))
        )}
        {projects.length > 0 && visible.length === 0 ? (
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted, textAlign: 'center' }]}>
            没有匹配的项目
          </Text>
        ) : null}

        <View style={styles.credit}>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted, textAlign: 'center' }]}>
            作者：ShineHe
          </Text>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted, textAlign: 'center' }]}>
            Shine-TRPG {versionJson.versionName}
          </Text>
        </View>
      </ScrollView>

      <ProjectActionsMenu
        visible={menuTarget !== null}
        title={menuTarget?.title ?? ''}
        onCancel={() => setMenuTarget(null)}
        onDelete={() => {
          const target = menuTarget;
          setMenuTarget(null);
          if (target) void requestDelete(target);
        }}
      />
      <DeleteProjectDialog
        visible={deleteTarget !== null}
        title={deleteTarget?.title ?? ''}
        building={deleteBuilding}
        phase={deletePhase}
        errorMessage={deleteError}
        onCancel={() => {
          if (deletePhase === 'stopping' || deletePhase === 'deleting') return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  credit: { alignItems: 'center', gap: 2, paddingTop: 12 },
});
