/**
 * 战役 Tab — everything about playing: the campaign/branch list and save
 * import/export (plan §2).
 *
 * P2 port of the campaign section of the old LibraryScreen, plus the save
 * import that used to sit next to the world import. Branch forks (rewind) stay
 * inside the play screen, which owns the branch identity.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Swords } from 'lucide-react-native';
import {
  buildProvider,
  createSession,
  importCampaignSave,
  type CampaignListItem,
} from '../../runtime';
import { pickNovelFile } from '../../fileBridge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { useTheme } from '../theme/ThemeContext';
import { useAppSession } from '../state/AppSessionContext';
import type { AppTabNavigation } from '../navigation/types';
import { styles } from './legacyStyles';

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === undefined) break;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] ?? 0 & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | (((bytes[i + 1] ?? 0) & 0x3f) << 6) | ((bytes[i + 2] ?? 0) & 0x3f));
      i += 3;
    } else {
      const cp = ((b & 0x07) << 18) | (((bytes[i + 1] ?? 0) & 0x3f) << 12) | (((bytes[i + 2] ?? 0) & 0x3f) << 6) | ((bytes[i + 3] ?? 0) & 0x3f);
      const offset = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 4;
    }
  }
  return out;
}

export function CampaignsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile, error, setError } = useAppSession();
  const navigation = useNavigation<AppTabNavigation>();
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile) return;
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const campaignList = await session.listCampaigns();
      // Every branch of every campaign is playable (rewind creates branches;
      // the list shows them all instead of only the main branch).
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
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      // Saves are UTF-8 JSON; decode the raw bytes before validation.
      const restored = await importCampaignSave(decodeUtf8(picked.bytes));
      setNotice(`存档已导入为新的战役（${restored.campaignId}）。点击它即可继续游戏。`);
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
        title="战役"
        subtitle="进行中战役 · 分支 · 存档"
        actions={<Button label="导入存档" variant="chip" onPress={importSave} disabled={busy} />}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: theme.space.lg }}>
        {notice ? <View style={styles.card}><Text style={styles.bodyText}>{notice}</Text></View> : null}

        <Text style={styles.sectionTitle}>我的战役</Text>
        {campaigns.length === 0 ? (
          <EmptyState
            title="还没有战役"
            description="在「书库」里选择一部小说，点「创建战役」开始一局。"
            icon={<Swords size={28} color={theme.text.secondary} strokeWidth={1.6} />}
            action={
              <Button label="去书库" onPress={() => navigation.navigate('Library')} variant="secondary" />
            }
          />
        ) : null}
        {campaigns.map(campaign => (
          <TouchableOpacity
            key={`${campaign.campaignId}:${campaign.branchId}`}
            style={styles.card}
            onPress={() =>
              navigation.navigate('Play', {
                campaignId: campaign.campaignId,
                branchId: campaign.branchId ?? `${campaign.campaignId}-main`,
              })
            }>
            <Text style={styles.cardTitle}>{campaign.title}</Text>
            <Text style={styles.muted}>{campaign.branchId} · {campaign.status}</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.row}>
          <Text style={styles.muted}>
            分支回退与存档导出在游玩页内执行；一个战役可以有多个分支，每个分支独立存档。
          </Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </ScreenShell>
  );
}
