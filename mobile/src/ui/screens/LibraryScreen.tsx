/**
 * 书库 Tab — world management: import a novel, build the three books, import a
 * portable world package, export it back out (plan §2).
 *
 * P2 port: the JSX and data flow are the ones that used to sit in the campaign
 * section of App.tsx's LibraryScreen; only the navigation calls changed (a
 * `useState<Screen>` setter became a route push) and the page frame/header now
 * come from the theme tokens.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BookOpen, Library as LibraryIcon } from 'lucide-react-native';
import {
  buildProvider,
  createSession,
  importPortableWorldPackageFile,
  type CampaignListItem,
} from '../../runtime';
import { pickNovelFile } from '../../fileBridge';
import {
  buildWorldOnDevice,
  listWorlds,
  type WorldBuildProgress,
  type WorldLibraryEntry,
} from '../../worldImport';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { useTheme } from '../theme/ThemeContext';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList } from '../navigation/types';
import { styles } from './legacyStyles';

export function LibraryScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, error, setError } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [worlds, setWorlds] = useState<WorldLibraryEntry[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<WorldBuildProgress | null>(null);
  const [built, setBuilt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile) return;
    try {
      setWorlds(await listWorlds());
      // The campaign list is still loaded here because the world card links to
      // its books with the branch that filters discovered entries (the old
      // LibraryScreen did exactly this before the split).
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
    }, [refresh]),
  );

  async function importAndBuild() {
    if (busy || !profile) return;
    setBusy(true);
    setError(null);
    setBuilt(null);
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      const summary = await buildWorldOnDevice(
        picked.bytes,
        picked.name.replace(/\.txt$/i, ''),
        profile,
        p => {
          setProgress(p);
          if (p.phase === 'extracting') setPreview(p.message ?? null);
        },
        picked.base64,
      );
      setBuilt(
        summary.needsRetry
          ? `${summary.title}：抽取未完成（失败 ${summary.failedChunks} 块），未发布三宝书；再次导入同文件可续建。`
          : `${summary.title}：${summary.chapterCount} 章 · 实体 ${summary.entityCount} · 事实 ${summary.factCount}` +
              ` · 三宝书 r${summary.packageRevision}${summary.resumed ? '（续建完成）' : ''}` +
              (summary.reviewIssues > 0 ? ` · 待审核 ${summary.reviewIssues} 项` : ''),
      );
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
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      const imported = await importPortableWorldPackageFile(picked.bytes);
      setBuilt(`已导入世界包「${imported.title}」r${imported.revision}。包内不含小说原文，已校验并创建独立世界。`);
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
        subtitle="导入小说 → 三宝书 → 开局"
        actions={
          <Button
            label="导入世界包"
            variant="chip"
            onPress={importWorldPackage}
            disabled={busy}
          />
        }
      />
      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: theme.space.lg }}>
        <Button label={busy ? '构建中…' : '导入小说 TXT 并构建三宝书'} onPress={importAndBuild} disabled={busy} block />
        <View style={{ height: theme.space.md }} />

        {progress ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {progress.phase === 'importing' && '解析原文…'}
              {progress.phase === 'extracting' && '抽取与映射…'}
              {progress.phase === 'done' && '构建完成'}
              {progress.phase === 'failed' && '构建未完成'}
            </Text>
            {progress.message ? <Text style={styles.bodyText}>{progress.message}</Text> : null}
          </View>
        ) : null}
        {preview ? <View style={styles.card}><Text style={styles.bodyText}>{preview}</Text></View> : null}
        {built ? <View style={styles.card}><Text style={styles.bodyText}>{built}</Text></View> : null}

        <Text style={styles.sectionTitle}>已导入小说</Text>
        {worlds.length === 0 ? (
          <EmptyState
            title="还没有导入小说"
            description="点击上方按钮导入 TXT，系统会在本机构建三宝书与规则。"
            icon={<LibraryIcon size={28} color={theme.text.secondary} strokeWidth={1.6} />}
          />
        ) : null}
        {worlds.map(world => (
          <View key={world.worldId} style={styles.card}>
            <Text style={styles.cardTitle}>{world.title}</Text>
            <Text style={styles.muted}>构建状态 {world.buildStatus} · SHA {world.sourceSha256.slice(0, 10)}…</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.secondary}
                onPress={() => {
                  const activeBranch = campaigns.find(campaign => campaign.worldId === world.worldId);
                  navigation.navigate('WorldDetail', {
                    worldId: world.worldId,
                    title: world.title,
                    campaignId: activeBranch?.campaignId,
                    branchId: activeBranch?.branchId,
                  });
                }}>
                <Text style={styles.secondaryText}>详情</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondary}
                onPress={() => navigation.navigate('Opening', { worldId: world.worldId, title: world.title })}>
                <Text style={styles.secondaryText}>创建战役</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondary}
                onPress={() =>
                  navigation.navigate('WorldDetail', {
                    worldId: world.worldId,
                    title: world.title,
                    initialTab: 'review',
                  })
                }>
                <Text style={styles.secondaryText}>审核队列</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View style={styles.row}>
          <BookOpen size={14} color={theme.text.muted} strokeWidth={1.6} />
          <Text style={[styles.muted, { marginLeft: theme.space.sm }]}>
            三宝书与审核队列已并入「详情」的子页签；战役与存档在「战役」页。
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </ScreenShell>
  );
}
