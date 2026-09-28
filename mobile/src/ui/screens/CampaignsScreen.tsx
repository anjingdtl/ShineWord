/**
 * 战役 Tab — everything about playing: the campaign/branch list and save
 * import (plan §8).
 *
 * P3.3 keeps the P2 data flow (same session calls, same refresh-on-focus
 * behaviour) and moves presentation into `features/campaigns`. A campaign is
 * no longer flattened into one row per branch: the card keeps the campaign
 * identity and shows its branch tree, so a rewind-created branch is visible as
 * a fork of the line it came from. No `legacyStyles` import remains.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { buildProvider, createSession, importCampaignSave } from '../../runtime';
import { pickNovelFile } from '../../fileBridge';
import { decodeUtf8 } from '../../textDecode';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBanner } from '../components/StatusBanner';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { CampaignCard, type CampaignListItemView } from '../features/campaigns/CampaignCard';
import { ImportSaveAction } from '../features/campaigns/ImportSaveAction';
import type { CampaignBranchView } from '../features/campaigns/BranchList';
import { useTheme } from '../theme/ThemeContext';
import { useAppSession } from '../state/AppSessionContext';
import type { AppTabNavigation } from '../navigation/types';

export function CampaignsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, error, setError } = useAppSession();
  const navigation = useNavigation<AppTabNavigation>();
  const [campaigns, setCampaigns] = useState<CampaignListItemView[]>([]);
  const [branches, setBranches] = useState<Record<string, CampaignBranchView[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile) return;
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const campaignList = await session.listCampaigns();
      // Every branch of every campaign is playable (rewind creates siblings;
      // the card shows them as a tree instead of separate campaign rows).
      const byCampaign: Record<string, CampaignBranchView[]> = {};
      for (const campaign of campaignList) {
        byCampaign[campaign.campaignId] = await session.listBranches(campaign.campaignId);
      }
      setCampaigns(campaignList);
      setBranches(byCampaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [profile, setError]);

  // Fresh branch list every time the tab is entered: rewind inside the play
  // screen creates siblings that must appear here immediately.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function importSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      // Saves are UTF-8 JSON; decode the raw bytes before validation.
      const restored = await importCampaignSave(decodeUtf8(picked.bytes));
      setNotice(`存档已导入为新的战役（${restored.campaignId}）。点击它的分支即可继续游戏。`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell>
      <Header title="战役" subtitle="进行中战役 · 分支 · 存档" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}>
        {notice ? <StatusBanner tone="success" message={notice} /> : null}
        {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}

        <ImportSaveAction busy={busy} onImport={importSave} />

        <View>
          <SectionHeader
            title="我的战役"
            subtitle={campaigns.length > 0 ? `${campaigns.length} 场` : undefined}
          />
          {campaigns.length === 0 ? (
            <EmptyState
              title="还没有战役"
              description="在「书库」里选择一部小说，点「开始冒险」创建第一场战役。"
              action={
                <Button
                  label="去书库"
                  onPress={() => navigation.navigate('Library')}
                  variant="secondary"
                />
              }
            />
          ) : (
            <View style={{ gap: theme.space.md }}>
              {campaigns.map(campaign => (
                <CampaignCard
                  key={campaign.campaignId}
                  campaign={campaign}
                  branches={branches[campaign.campaignId] ?? []}
                  busy={busy}
                  onContinue={(branchId: string) =>
                    navigation.navigate('Play', { campaignId: campaign.campaignId, branchId })
                  }
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
});