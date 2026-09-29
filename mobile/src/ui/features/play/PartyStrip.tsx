/**
 * PartyStrip — the compact party row between the narrative feed and the
 * composer (plan §20.1).
 *
 * Each tile carries the actor's mark, HP and stamina, and non-colour markers for
 * critical / disabled states plus the companion directive. Tapping a tile opens
 * that actor's character sheet; the strip itself performs no game action.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ActorUiProjection } from '../../../../../src/application/campaign/playProjection';
import type { CompanionDirective } from '../../../../../src/domain/characters/card';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

const DIRECTIVE_MARK: Record<CompanionDirective, string> = {
  follow: '跟',
  support: '援',
  protect: '护',
  conserve: '省',
  retreat: '退',
};

function ratio(current: number | undefined, max: number | undefined): number {
  if (!max || max <= 0 || current === undefined) return 0;
  return Math.max(0, Math.min(1, current / max));
}

export function PartyStrip(props: {
  /** Player first, then companions (order comes from the projection). */
  members: ActorUiProjection[];
  playerActorId: string | null;
  onSelect: (actorId: string) => void;
  busy?: boolean;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  if (props.members.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: theme.space.md,
        paddingHorizontal: theme.space.lg,
        paddingVertical: theme.space.sm,
      }}
      style={{ backgroundColor: theme.bg.base }}>
      {props.members.map(member => {
        const hp = ratio(member.resources.hp, member.resourceMax.hp);
        const stamina = ratio(member.resources.stamina, member.resourceMax.stamina);
        const isPlayer = member.actorId === props.playerActorId;
        const critical = member.lifeStatus === 'critical';
        const disabled = member.conditions.includes('disabled');
        return (
          <Pressable
            key={member.actorId}
            onPress={() => props.onSelect(member.actorId)}
            disabled={props.busy}
            // The tile is as wide as its 32dp avatar; the strip's 12dp gap is
            // left intact so the horizontal slop reaches the 44dp floor without
            // overlapping the next tile (plan §4).
            hitSlop={{
              top: 0,
              bottom: 0,
              left: Math.ceil((theme.touch.min - theme.space.xxl) / 2),
              right: Math.ceil((theme.touch.min - theme.space.xxl) / 2),
            }}
            accessibilityRole="button"
            accessibilityLabel={`${member.name}${isPlayer ? '（你）' : ''}，气血 ${member.resources.hp ?? '?'}/${member.resourceMax.hp ?? '?'}，体力 ${member.resources.stamina ?? '?'}/${member.resourceMax.stamina ?? '?'}${critical ? '，濒危' : ''}${disabled ? '，失能' : ''}`}
            testID={`party-member-${member.actorId}`}
            style={({ pressed }) => [
              styles.tile,
              { gap: theme.space.xs, opacity: pressed ? 0.85 : 1 },
            ]}>
            <View
              style={[
                styles.avatar,
                {
                  borderColor: isPlayer ? theme.accent.primary : theme.border.colorStrong,
                  backgroundColor: theme.bg.raised,
                  borderRadius: theme.radius.pill,
                  width: theme.space.xxl,
                  height: theme.space.xxl,
                },
              ]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
                {member.name.slice(0, 1)}
              </Text>
              {member.companionDirective ? (
                <View
                  style={{
                    position: 'absolute',
                    right: -4,
                    bottom: -4,
                    width: theme.space.lg,
                    height: theme.space.lg,
                    borderRadius: theme.radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.accent.secondary,
                  }}>
                  <Text style={[typeStyle(theme, theme.type.micro), { color: theme.bg.base }]}>
                    {DIRECTIVE_MARK[member.companionDirective]}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={{ width: theme.space.xxl }}>
              <View
                style={{
                  height: 3,
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundColor: theme.bar.track,
                  marginBottom: 2,
                }}>
                <View style={{ width: `${hp * 100}%`, height: '100%', backgroundColor: theme.semantic.good }} />
              </View>
              <View
                style={{
                  height: 3,
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundColor: theme.bar.track,
                }}>
                <View style={{ width: `${stamina * 100}%`, height: '100%', backgroundColor: theme.bar.fillAlt }} />
              </View>
            </View>
            <Text
              numberOfLines={1}
              style={[typeStyle(theme, theme.type.micro), { color: theme.text.secondary }]}>
              {isPlayer ? '你' : member.name}
              {critical ? ' ⚠危' : disabled ? ' ⛔失能' : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center' },
  avatar: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});