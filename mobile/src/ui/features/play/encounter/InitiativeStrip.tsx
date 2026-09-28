/**
 * InitiativeStrip — the turn order of the encounter (plan §23.1).
 *
 * Reads `currentActorId`, `actors` and `round`; the exporter of the order is the
 * encounter itself (`initiative`), so the UI never sorts or re-derives turns.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EncounterView } from '../../../../runtime';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

export function InitiativeStrip(props: { encounter: EncounterView }): React.JSX.Element {
  const { theme } = useTheme();
  const byId = new Map(props.encounter.actors.map(actor => [actor.actorId, actor]));
  return (
    <View style={{ gap: theme.space.xs }}>
      <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>
        行动顺序 · 第 {props.encounter.round} 轮
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.xs }}>
        {props.encounter.initiative.map(actorId => {
          const actor = byId.get(actorId);
          const current = actorId === props.encounter.currentActorId;
          const living = (actor?.hp ?? 0) > 0;
          return (
            <View
              key={actorId}
              style={[
                styles.chip,
                {
                  paddingHorizontal: theme.space.sm,
                  paddingVertical: theme.space.xs,
                  borderRadius: theme.radius.pill,
                  borderWidth: theme.border.hairline,
                  borderColor: current ? theme.accent.primary : theme.border.color,
                  backgroundColor: current ? theme.bg.overlay : 'transparent',
                  opacity: living ? 1 : 0.45,
                },
              ]}>
              <Text
                style={[
                  typeStyle(theme, theme.type.caption),
                  {
                    color: current ? theme.accentText : theme.text.secondary,
                    fontWeight: current ? '700' : '400',
                  },
                ]}>
                {current ? '▶ ' : ''}
                {actor?.name ?? actorId}
                {actor?.side === 'hostile' ? '（敌）' : actor?.actedThisRound ? ' ✓' : ''}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
});