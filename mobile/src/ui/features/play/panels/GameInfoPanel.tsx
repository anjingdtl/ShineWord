/**
 * GameInfoPanel — the tabbed game information sheet (plan §24).
 *
 * Five tabs, all reading the same projection: 角色 (player + every visible
 * actor, with the matching character sheet inline), 队伍, 任务, 物品, 知识.
 *
 * Naming note: the plan's §4 listing gives a `PlayPanel.tsx` inside `panels/`,
 * while §20.2 explicitly allows the modal sheet carrier to be called
 * `PlayPanel`. This implementation keeps `PlayPanel` as the carrier (§20.2) and
 * names the tabbed host `GameInfoPanel`, so the two never collide.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SegmentedControl } from '../../components/SegmentedControl';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { CompanionCharacterSheet } from '../character/CompanionCharacterSheet';
import { NpcCharacterSheet } from '../character/NpcCharacterSheet';
import { PlayerCharacterSheet } from '../character/PlayerCharacterSheet';
import { InventoryPanel } from './InventoryPanel';
import { KnowledgePanel } from './KnowledgePanel';
import { PartyPanel } from './PartyPanel';
import { PlayPanel } from './PlayPanel';
import { QuestPanel } from './QuestPanel';
import type { PlayController } from '../hooks/usePlayController';

const TABS = [
  { value: 'character' as const, label: '角色' },
  { value: 'party' as const, label: '队伍' },
  { value: 'quests' as const, label: '任务' },
  { value: 'items' as const, label: '物品' },
  { value: 'knowledge' as const, label: '知识' },
];

type PanelTab = (typeof TABS)[number]['value'];

export function GameInfoPanel(props: {
  controller: PlayController;
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [tab, setTab] = useState<PanelTab>('character');
  const [actorId, setActorId] = useState<string | null>(null);
  const { projection, encounter, busy, trainSkill, partyCall, campaignId, branchId } = props.controller;

  const roster = [
    ...(projection?.player ? [projection.player] : []),
    ...(projection?.party ?? []),
  ];
  const encounterActors = (encounter?.actors ?? []).filter(
    actor => !roster.some(member => member.actorId === actor.actorId),
  );
  const selectedActor =
    roster.find(member => member.actorId === actorId) ??
    null;
  const selectedCombatant = encounterActors.find(actor => actor.actorId === actorId) ?? null;

  return (
    <PlayPanel
      visible={props.visible}
      title="游戏信息"
      subtitle={projection ? `v${projection.stateVersion} · 世界包 r${projection.packageRevision}` : undefined}
      onClose={props.onClose}
      tabs={
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={setTab}
          compact
          testID="game-info-tab"
        />
      }>
      {tab === 'character' ? (
        <View style={{ gap: theme.space.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
            {roster.map(member => (
              <Button
                key={member.actorId}
                label={member.name}
                variant="chip"
                selected={actorId === member.actorId}
                onPress={() => setActorId(member.actorId)}
                testID={`info-actor-${member.actorId}`}
              />
            ))}
            {encounterActors.map(actor => (
              <Button
                key={actor.actorId}
                label={actor.name}
                variant="chip"
                selected={actorId === actor.actorId}
                onPress={() => setActorId(actor.actorId)}
                testID={`info-actor-${actor.actorId}`}
              />
            ))}
          </View>

          {selectedActor && projection ? (
            selectedActor.actorId === projection.player?.actorId ? (
              <PlayerCharacterSheet projection={projection} busy={busy} onTrain={trainSkill} />
            ) : (
              <CompanionCharacterSheet
                projection={projection}
                actor={selectedActor}
                busy={busy}
                onSetDirective={directive =>
                  partyCall(s => s.setCompanionDirective({
                    campaignId, branchId, actorId: selectedActor.actorId, directive,
                  }))
                }
              />
            )
          ) : selectedCombatant ? (
            <NpcCharacterSheet
              campaignId={campaignId}
              branchId={branchId}
              actorId={selectedCombatant.actorId}
              side={selectedCombatant.side}
            />
          ) : (
            <Card>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
                选择一位角色查看其角色卡。敌对与中立角色只显示公开投影，未探明内容会保持隐藏。
              </Text>
            </Card>
          )}
        </View>
      ) : null}

      {tab === 'party' ? <PartyPanel controller={props.controller} /> : null}
      {tab === 'quests' ? <QuestPanel quests={projection?.quests ?? []} /> : null}
      {tab === 'items' ? <InventoryPanel controller={props.controller} /> : null}
      {tab === 'knowledge' ? <KnowledgePanel discoveries={projection?.discoveries ?? []} /> : null}
    </PlayPanel>
  );
}