/**
 * EncounterHud — the combat HUD that replaces the old text-and-buttons debug
 * panel (plan §23).
 *
 * Composition: round header + initiative order + distance bands + combatant
 * cards + the current turn's actions. Everything is read from the persisted
 * encounter view; the HUD itself has no rules.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Card } from '../../../components/Card';
import { SectionHeader } from '../../../components/SectionHeader';
import { StatusBanner } from '../../../components/StatusBanner';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';
import { CombatActions } from './CombatActions';
import { CombatantCard } from './CombatantCard';
import { InitiativeStrip } from './InitiativeStrip';
import { ZoneTrack } from './ZoneTrack';
import type { PlayController } from '../hooks/usePlayController';

const STATUS_LABEL: Record<string, string> = {
  active: '进行中',
  resolved: '胜利',
  escaped: '撤离',
  defeated: '溃败',
};

export function EncounterHud(props: {
  controller: PlayController;
  onSelectActor: (actorId: string) => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  const { encounter, busy } = props.controller;
  if (!encounter) return null;

  if (encounter.status !== 'active') {
    return (
      <Card>
        <SectionHeader
          title={`战斗结束 · ${STATUS_LABEL[encounter.status] ?? encounter.status}`}
          subtitle={`第 ${encounter.round} 轮`}
        />
        {encounter.lastAction ? (
          <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
            {encounter.lastAction}
          </Text>
        ) : null}
        {encounter.lastDice ? (
          <Text
            style={[
              typeStyle(theme, theme.type.caption),
              { color: theme.onRaised.secondary, fontFamily: theme.font.numeric },
            ]}>
            {encounter.lastDice}
          </Text>
        ) : null}
      </Card>
    );
  }

  const current = encounter.actors.find(actor => actor.actorId === encounter.currentActorId);

  return (
    <Card>
      <SectionHeader
        title={`战斗 · 第 ${encounter.round} 轮`}
        subtitle={`当前行动：${current?.name ?? '—'}${encounter.currentActorIsPlayer ? '（你）' : '（自动）'}`}
      />

      <View style={{ gap: theme.space.md }}>
        <InitiativeStrip encounter={encounter} />
        <ZoneTrack encounter={encounter} />

        <View style={{ gap: theme.space.xs }}>
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
            场上角色（点按查看角色卡）
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.sm }}>
            {encounter.actors.map(actor => (
              <CombatantCard
                key={actor.actorId}
                actor={actor}
                isCurrent={actor.actorId === encounter.currentActorId}
                onSelect={props.onSelectActor}
              />
            ))}
          </ScrollView>
        </View>

        {encounter.pendingActorIds.length > 0 ? (
          <StatusBanner
            tone="info"
            message={`等待下一轮加入：${encounter.pendingActorIds.join('、')}`}
          />
        ) : null}

        {encounter.lastAction ? (
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
            {encounter.lastAction}
            {encounter.lastDice ? ` · ${encounter.lastDice}` : ''}
          </Text>
        ) : null}

        <CombatActions controller={props.controller} />
        {busy ? (
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
            正在结算遭遇行动…
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
