/**
 * ZoneTrack — the distance bands of the scene (plan §23.2).
 *
 * Pure presentation of `zones`, each actor's `zoneId` and the scene exits: no
 * map engine, no path-finding — movement itself stays an engine action.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EncounterView } from '../../../../runtime';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';

export function ZoneTrack(props: { encounter: EncounterView }): React.JSX.Element {
  const { theme } = useTheme();
  const { encounter } = props;
  const current = encounter.actors.find(actor => actor.actorId === encounter.currentActorId);

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>
        距离带
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.sm }}>
        {encounter.zones.map((zone, index) => {
          const occupants = encounter.actors.filter(actor => actor.zoneId === zone.zoneId);
          const reachable = current
            ? zone.zoneId !== current.zoneId && zone.exits.includes(current.zoneId)
            : false;
          return (
            <React.Fragment key={zone.zoneId}>
              {index > 0 ? (
                <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>─────</Text>
              ) : null}
              <View
                style={[
                  styles.zone,
                  {
                    gap: theme.space.xs,
                    paddingHorizontal: theme.space.sm,
                    paddingVertical: theme.space.xs,
                    minWidth: 96,
                    borderRadius: theme.radius.md,
                    borderWidth: reachable ? theme.border.hairline + 1 : theme.border.hairline,
                    borderColor: reachable ? theme.accent.secondary : theme.border.color,
                    backgroundColor: theme.bg.overlay,
                  },
                ]}>
                <Text style={[typeStyle(theme, theme.type.caption), { color: theme.accentText }]}>
                  {zone.zoneId}
                  {reachable ? ' · 可达' : ''}
                </Text>
                {occupants.length === 0 ? (
                  <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
                    空
                  </Text>
                ) : (
                  occupants.map(actor => (
                    <Text
                      key={actor.actorId}
                      numberOfLines={1}
                      style={[
                        typeStyle(theme, theme.type.micro),
                        {
                          color:
                            actor.side === 'hostile'
                              ? theme.semantic.bad
                              : actor.side === 'party'
                                ? theme.semantic.good
                                : theme.onRaised.secondary,
                        },
                      ]}>
                      {actor.name}
                      {actor.actorId === encounter.currentActorId ? ' ▶' : ''}
                    </Text>
                  ))
                )}
              </View>
            </React.Fragment>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { alignItems: 'flex-start' },
});