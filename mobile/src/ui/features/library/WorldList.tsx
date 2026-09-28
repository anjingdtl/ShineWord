/**
 * WorldList — 「我的世界」 list plus its empty state (plan §7.3).
 */
import React from 'react';
import { View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../theme/ThemeContext';
import { WorldCard } from './WorldCard';
import type { WorldLibraryEntry } from '../../../worldImport';

export function WorldList(props: {
  worlds: WorldLibraryEntry[];
  campaignFor: (worldId: string) => { campaignId: string; branchId: string } | null;
  busy?: boolean;
  onOpenDetail: (world: WorldLibraryEntry) => void;
  onPrimary: (world: WorldLibraryEntry) => void;
  onOpenReview: (world: WorldLibraryEntry) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  if (props.worlds.length === 0) {
    return (
      <EmptyState
        title="还没有导入小说"
        description="导入一本小说 TXT，应用会在本机抽取人物、事件与规则，并发布三宝书。"
      />
    );
  }
  return (
    <View style={{ gap: theme.space.md }}>
      {props.worlds.map(world => (
        <WorldCard
          key={world.worldId}
          world={world}
          campaign={props.campaignFor(world.worldId)}
          busy={props.busy}
          onOpenDetail={() => props.onOpenDetail(world)}
          onPrimary={() => props.onPrimary(world)}
          onOpenReview={() => props.onOpenReview(world)}
        />
      ))}
    </View>
  );
}