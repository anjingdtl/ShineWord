/**
 * InventoryPanel — 物品 (plan §24.4).
 *
 * Name, current owner and provenance for every item the player can see, plus
 * the transfer action (an item may be handed to another visible actor).
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { SectionHeader } from '../../../components/SectionHeader';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';
import type { PlayController } from '../hooks/usePlayController';

const SOURCE_LABEL: Record<string, string> = {
  starting_loadout: '开局装备',
  recruitment: '招募携带',
  quest_reward: '任务奖励',
  encounter_loot: '遭遇战利品',
  transfer: '队友转交',
};

export function InventoryPanel(props: { controller: PlayController }): React.JSX.Element {
  const { theme } = useTheme();
  const { projection, busy, partyCall, campaignId, branchId } = props.controller;

  if (!projection || projection.inventory.length === 0) {
    return (
      <EmptyState
        title="没有可见的物品"
        description="物品会随开局装备、招募、任务奖励与遭遇战利品出现。"
      />
    );
  }

  const roster = [
    ...(projection.player ? [projection.player] : []),
    ...projection.party,
  ];

  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <SectionHeader title="物品" subtitle={`${projection.inventory.length} 件（跟随当前分支）`} />
        {projection.inventory.map(item => (
          <View key={item.itemId} style={{ gap: theme.space.xs, marginBottom: theme.space.md }}>
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
              {item.name}
            </Text>
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              持有：{item.ownerName} · 来源：
              {item.source ? `${SOURCE_LABEL[item.source.kind] ?? item.source.kind}（${item.source.sourceId}）` : '未记录'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
              {roster
                .filter(member => member.actorId !== item.ownerActorId)
                .map(member => (
                  <Button
                    key={`${item.itemId}-${member.actorId}`}
                    label={`交给 ${member.name}`}
                    variant="chip"
                    disabled={busy}
                    onPress={() => partyCall(s => s.transferItem({
                      campaignId,
                      branchId,
                      itemId: item.itemId,
                      fromActorId: item.ownerActorId,
                      toActorId: member.actorId,
                    }))}
                    testID={`transfer-${item.itemId}-${member.actorId}`}
                  />
                ))}
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}