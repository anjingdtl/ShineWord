/**
 * 世界详情 — the sub-tab host that absorbs the old Books and Review screens
 * (plan §2: both stop being sibling "island" pages).
 *
 * P2 wires the tabs and ports the two bodies; the 资料 and 世界包 tabs are new
 * but thin — the overview only surfaces data the library card already showed,
 * and the package tab is the export action that used to live on that card.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { buildProvider, createSession } from '../../runtime';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from '../components/typography';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList, WorldTab } from '../navigation/types';
import { WORLD_TABS } from '../navigation/types';
import { styles } from './legacyStyles';
import { WorldDetailBooks } from './WorldDetailBooks';
import { WorldDetailReview } from './WorldDetailReview';
import { exportWorldPackageZip } from './worldPackageExport';

export function WorldDetailScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'WorldDetail'>>();
  const { worldId, title, campaignId, branchId } = route.params;
  const [tab, setTab] = useState<WorldTab>(route.params.initialTab ?? 'overview');
  const [setup, setSetup] = useState<{ packageRevision: number | null; rulesetVersion: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const worldSetup = await session.getWorldSetup(worldId);
        if (!cancelled) {
          setSetup({
            packageRevision: worldSetup.packageRevision,
            rulesetVersion: worldSetup.rulesetVersion,
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, worldId]);

  async function exportPackage() {
    setBusy(true);
    setError(null);
    try {
      setNotice(await exportWorldPackageZip(worldId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell bottom>
      <Header
        title={title}
        subtitle={`三宝书 r${setup?.packageRevision ?? '?'} · 规则 ${setup?.rulesetVersion ?? 'V0.2'}`}
        onBack={() => navigation.goBack()}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: theme.space.lg, paddingTop: theme.space.md }}>
        {WORLD_TABS.map(entry => (
          <TouchableOpacity
            key={entry.key}
            style={[
              styles.secondary,
              tab === entry.key && styles.secondaryActive,
              { paddingVertical: theme.space.sm },
            ]}
            onPress={() => setTab(entry.key)}>
            <Text style={[styles.secondaryText, tab === entry.key ? { color: theme.accentText } : null]}>
              {entry.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flex: 1, paddingHorizontal: theme.space.lg }}>
        {tab === 'overview' ? (
          <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.muted}>
                已发布三宝书 r{setup?.packageRevision ?? '?'} · 规则 {setup?.rulesetVersion ?? 'V0.2'}
              </Text>
              <Text style={styles.muted}>
                {campaignId
                  ? `关联战役 ${campaignId}${branchId ? ` · 分支 ${branchId}` : ''}（三宝书按该战役已发现内容过滤）`
                  : '暂无关联战役：三宝书按「未发现即隐藏」显示。'}
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.primary}
                  onPress={() => navigation.navigate('Opening', { worldId, title })}>
                  <Text style={styles.primaryText}>创建战役</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>这个世界的四个视图</Text>
              <Text style={styles.muted}>
                资料 = 概览；三宝书 = 玩家手册 / 城主指南 / 怪物图鉴（含编辑模式）；审查 = 冲突与映射裁定；
                世界包 = 导出可移植世界包 ZIP（不含小说原文）。
              </Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        ) : null}

        {tab === 'books' ? (
          <WorldDetailBooks worldId={worldId} campaignId={campaignId} branchId={branchId} />
        ) : null}

        {tab === 'review' ? <WorldDetailReview worldId={worldId} /> : null}

        {tab === 'package' ? (
          <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>世界包管理</Text>
              <Text style={styles.muted}>
                导出的是当前已发布的三宝书与规则（不可变版本），不含小说原文。收到该 ZIP 的设备可直接导入并创建独立世界。
              </Text>
            </View>
            <Button
              label={busy ? '导出中…' : '导出世界包 ZIP'}
              onPress={exportPackage}
              disabled={busy}
              block
            />
            <View style={{ height: theme.space.md }} />
            {notice ? (
              <View style={styles.card}>
                <Text style={[typeStyle(theme, theme.type.small), { color: theme.text.primary }]}>{notice}</Text>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        ) : null}
      </View>
    </ScreenShell>
  );
}
