/**
 * CombatantCard — one participant in the encounter HUD (plan §23).
 *
 * Shows only what the encounter view exposes (name, side, HP, zone, conditions)
 * and opens the matching character sheet on tap: party members use their card,
 * hostile/neutral actors use the safe public projection.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { EncounterView } from '../../../../runtime';
import { Bar } from '../../components/Bar';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

type EncounterActor = EncounterView['actors'][number];

const SIDE_LABEL: Record<EncounterActor['side'], string> = {
  party: '队',
  hostile: '敌',
  neutral: '中',
};

export function CombatantCard(props: {
  actor: EncounterActor;
  isCurrent: boolean;
  onSelect: (actorId: string) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { actor } = props;
  const sideColor =
    actor.side === 'party'
      ? theme.semantic.good
      : actor.side === 'hostile'
        ? theme.semantic.bad
        : theme.semantic.info;

  return (
    <Pressable
      onPress={() => props.onSelect(actor.actorId)}
      accessibilityRole="button"
      accessibilityLabel={`${actor.name}，${SIDE_LABEL[actor.side]}方，气血 ${actor.hp}/${actor.maxHp}，位置 ${actor.zoneId}`}
      testID={`combatant-${actor.actorId}`}
      style={({ pressed }) => [
        styles.card,
        {
          width: 132,
          gap: theme.space.xs,
          padding: theme.space.sm,
          borderRadius: theme.radius.md,
          borderWidth: props.isCurrent ? theme.border.hairline + 1 : theme.border.hairline,
          borderColor: props.isCurrent ? theme.accent.primary : theme.border.color,
          backgroundColor: theme.bg.raised,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <View style={[styles.row, { gap: theme.space.xs }]}>
        <Text style={[typeStyle(theme, theme.type.micro), { color: sideColor }]}>
          {SIDE_LABEL[actor.side]}
        </Text>
        <Text
          numberOfLines={1}
          style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.primary, flex: 1 }]}>
          {actor.name}
        </Text>
        {props.isCurrent ? (
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.accentText }]}>▶</Text>
        ) : null}
      </View>
      <Bar ratio={actor.maxHp > 0 ? actor.hp / actor.maxHp : 0} valueText={`${actor.hp}/${actor.maxHp}`} />
      <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
        {actor.zoneId}
        {actor.actedThisRound ? ' · 已行动' : ''}
        {actor.movedThisRound ? ' · 已移动' : ''}
        {actor.conditions.includes('disabled') ? ' · ⛔失能' : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: { flexDirection: 'row', alignItems: 'center' },
});