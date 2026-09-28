/**
 * CombatActions — the encounter actions of the current turn (plan §23.3).
 *
 * Every button calls an existing Session method through the controller
 * (`encounterAttack` / `encounterRescue` / `encounterPassTurn` / `encounterMove`
 * / `encounterDash` / `encounterQueueJoin` / `encounterRetreat` /
 * `encounterNpcTurn`). No rule is re-implemented here: the component only
 * decides which affordances to show, using the derivations the controller
 * exposes (`combat.*`) and the real action-economy flags on the view.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import type { PlayController } from '../hooks/usePlayController';

export function CombatActions(props: { controller: PlayController }): React.JSX.Element | null {
  const { theme } = useTheme();
  const {
    campaignId,
    branchId,
    encounter,
    busy,
    combat,
    encounterCall,
  } = props.controller;
  if (!encounter || encounter.status !== 'active') return null;

  const attack = combat.target;
  const rescue = combat.disabledAlly;

  return (
    <View style={{ gap: theme.space.md }}>
      <View style={{ gap: theme.space.xs }}>
        <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
          当前行动
        </Text>
        <View style={[styles.wrap, { gap: theme.space.sm }]}>
          {encounter.currentActorIsPlayer ? (
            <>
              {attack ? (
                <Button
                  label={`攻击 ${attack.name}`}
                  onPress={() => encounterCall(s => s.encounterAttack({
                    campaignId,
                    branchId,
                    encounterId: encounter.encounterId,
                    targetId: attack.actorId,
                    requestId: combat.requestId('attack', attack.actorId),
                  }))}
                  disabled={busy}
                  testID="combat-attack"
                />
              ) : null}
              {rescue ? (
                <Button
                  label={`援救 ${rescue.name}`}
                  variant="secondary"
                  onPress={() => encounterCall(s => s.encounterRescue({
                    campaignId,
                    branchId,
                    encounterId: encounter.encounterId,
                    targetId: rescue.actorId,
                    requestId: combat.requestId('rescue', rescue.actorId),
                  }))}
                  disabled={busy}
                  testID="combat-rescue"
                />
              ) : null}
              <Button
                label="戒备（跳过）"
                variant="secondary"
                onPress={() => encounterCall(s => s.encounterPassTurn({
                  campaignId,
                  branchId,
                  encounterId: encounter.encounterId,
                  requestId: combat.requestId('pass'),
                }))}
                disabled={busy}
                testID="combat-pass"
              />
              {combat.dashZones.map(zone => (
                <Button
                  key={`dash-${zone.zoneId}`}
                  label={`疾行→${zone.zoneId}（消耗主要行动）`}
                  variant="secondary"
                  onPress={() => encounterCall(s => s.encounterDash({
                    campaignId,
                    branchId,
                    encounterId: encounter.encounterId,
                    toZoneId: zone.zoneId,
                    requestId: combat.requestId('dash', zone.zoneId),
                  }))}
                  disabled={busy}
                />
              ))}
            </>
          ) : (
            <Button
              label="推进自动角色行动"
              onPress={() => encounterCall(s => s.encounterNpcTurn({
                campaignId,
                branchId,
                encounterId: encounter.encounterId,
                requestId: combat.requestId('npc'),
              }))}
              disabled={busy}
              testID="combat-npc-turn"
            />
          )}
          <Button
            label="撤退"
            variant="secondary"
            onPress={() => encounterCall(s => s.encounterRetreat({
              campaignId,
              branchId,
              encounterId: encounter.encounterId,
              requestId: combat.requestId('retreat'),
            }))}
            disabled={busy}
            testID="combat-retreat"
          />
        </View>
      </View>

      {combat.movementOptions.length > 0 ? (
        <View style={{ gap: theme.space.xs }}>
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
            本轮标准移动
          </Text>
          <View style={[styles.wrap, { gap: theme.space.sm }]}>
            {combat.movementOptions.map(({ actor, zone }) => (
              <Button
                key={`move-${actor.actorId}-${zone.zoneId}`}
                label={`${actor.name} 移动→${zone.zoneId}`}
                variant="chip"
                onPress={() => encounterCall(s => s.encounterMove({
                  campaignId,
                  branchId,
                  encounterId: encounter.encounterId,
                  actorId: actor.actorId,
                  toZoneId: zone.zoneId,
                  requestId: combat.requestId('move', `${actor.actorId}:${zone.zoneId}`, actor.actorId),
                }))}
                disabled={busy}
              />
            ))}
          </View>
        </View>
      ) : null}

      {combat.joinable.length > 0 ? (
        <View style={{ gap: theme.space.xs }}>
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
            下一轮加入
          </Text>
          <View style={[styles.wrap, { gap: theme.space.sm }]}>
            {combat.joinable.map(companion => (
              <Button
                key={`join-${companion.actorId}`}
                label={`${companion.name} 加入战斗`}
                variant="chip"
                onPress={() => encounterCall(s => s.encounterQueueJoin({
                  campaignId,
                  branchId,
                  encounterId: encounter.encounterId,
                  actorId: companion.actorId,
                  requestId: combat.requestId('join', companion.actorId, companion.actorId),
                }))}
                disabled={busy}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});