/**
 * PartyPanel — 队伍 (plan §24.2).
 *
 * Party lifecycle and knowledge sharing live here instead of on the main play
 * surface: directives, splitting, rejoining, leaving, recruiting and sharing a
 * known entry with a companion. Every action calls the existing Session method.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { CompanionDirective } from '../../../../../../src/domain/characters/card';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { SectionHeader } from '../../../components/SectionHeader';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';
import type { PlayController } from '../hooks/usePlayController';

const DIRECTIVES: ReadonlyArray<{ value: CompanionDirective; label: string }> = [
  { value: 'follow', label: '跟随' },
  { value: 'support', label: '支援' },
  { value: 'protect', label: '保护' },
  { value: 'conserve', label: '节省资源' },
  { value: 'retreat', label: '撤退' },
];

export function PartyPanel(props: { controller: PlayController }): React.JSX.Element {
  const { theme } = useTheme();
  const {
    campaignId,
    branchId,
    projection,
    busy,
    partyCall,
    recruitmentOptions,
    rejoinOptions,
  } = props.controller;

  if (!projection?.player) {
    return (
      <Card>
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          还没有可管理的队伍。
        </Text>
      </Card>
    );
  }
  const player = projection.player;
  const roster = [player, ...projection.party];
  const mainGroup = projection.party.filter(member => member.groupId === 'main');
  const splitGroups = projection.party.filter(member => member.groupId !== 'main');
  const departed = rejoinOptions.filter(option => !roster.some(member => member.actorId === option.actorId));

  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <SectionHeader title="主队" subtitle={`${mainGroup.length + 1} 人（含你）`} />
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
          {player.name}（你）· {player.lifeStatus === 'critical' ? '濒危 · ' : ''}
          {player.conditions.length > 0 ? player.conditions.join('、') : '状态正常'}
        </Text>
        {mainGroup.length === 0 ? (
          <Text
            style={[
              typeStyle(theme, theme.type.caption),
              { color: theme.onRaised.secondary, marginTop: theme.space.xs },
            ]}>
            当前独自行动；可在遭遇或剧情中招募同伴。
          </Text>
        ) : null}
        {mainGroup.map(member => (
          <View key={member.actorId} style={{ marginTop: theme.space.md, gap: theme.space.xs }}>
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
              {member.name}
              {member.lifeStatus === 'critical' ? ' · 濒危待援救/处置' : ''}
              {member.conditions.includes('disabled') ? ' · 失能' : ''}
            </Text>
            <View style={[styles.wrap, { gap: theme.space.sm }]}>
              {DIRECTIVES.map(directive => (
                <Chip
                  key={directive.value}
                  label={directive.label}
                  selected={member.companionDirective === directive.value}
                  disabled={busy}
                  onPress={() => partyCall(s => s.setCompanionDirective({
                    campaignId, branchId, actorId: member.actorId, directive: directive.value,
                  }))}
                  testID={`party-directive-${member.actorId}-${directive.value}`}
                />
              ))}
              <Button
                label="分队"
                variant="chip"
                disabled={busy}
                onPress={() => partyCall(s => s.splitCompanions({
                  campaignId, branchId,
                  actorIds: [member.actorId], groupId: `group-${Date.now().toString(36)}`,
                }))}
              />
              <Button
                label="退出队伍"
                variant="chip"
                disabled={busy}
                onPress={() => partyCall(s => s.leaveCompanion({
                  campaignId, branchId, actorId: member.actorId,
                }))}
                testID={`party-leave-${member.actorId}`}
              />
            </View>
          </View>
        ))}
      </Card>

      {splitGroups.length > 0 ? (
        <Card>
          <SectionHeader title="分队" subtitle={`${splitGroups.length} 人`} />
          {splitGroups.map(member => (
            <View key={member.actorId} style={{ gap: theme.space.xs, marginBottom: theme.space.sm }}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
                {member.name} · {member.groupId}
                {member.lifeStatus === 'critical' ? ' · 濒危' : ''}
              </Text>
              <Button
                label="重入主队"
                variant="secondary"
                disabled={busy}
                onPress={() => partyCall(s => s.rejoinCompanion({
                  campaignId, branchId, actorId: member.actorId,
                }))}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <SectionHeader
          title="知识分享"
          subtitle={`你已知 ${projection.discoveries.length} 条信息`}
        />
        {projection.discoveries.length === 0 || (mainGroup.length === 0 && splitGroups.length === 0) ? (
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
            暂时没有可以当面告知同伴的信息。
          </Text>
        ) : (
          [...mainGroup, ...splitGroups].map(member => (
            <View key={`share-${member.actorId}`} style={{ gap: theme.space.xs, marginBottom: theme.space.sm }}>
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                告知 {member.name}
              </Text>
              <View style={[styles.wrap, { gap: theme.space.sm }]}>
                {projection.discoveries.map(discovery => (
                  <Button
                    key={`${member.actorId}-${discovery.entryId}`}
                    label={discovery.title}
                    variant="chip"
                    disabled={busy}
                    onPress={() => partyCall(s => s.shareKnowledge({
                      campaignId, branchId,
                      sourceActorId: player.actorId, recipientActorId: member.actorId,
                      entryId: discovery.entryId, channel: 'conversation',
                    }))}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </Card>

      {recruitmentOptions.length > 0 || departed.length > 0 ? (
        <Card>
          <SectionHeader title="招募" subtitle="资格由引擎按位置、任务与关系判定" />
          {recruitmentOptions.map(option => (
            <View key={option.actorId} style={[styles.row, { gap: theme.space.sm, marginBottom: theme.space.sm }]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, flex: 1 }]}>
                {option.name}
              </Text>
              <Button
                label={option.eligible ? '招募' : option.reason ?? '暂不可招募'}
                variant={option.eligible ? 'primary' : 'secondary'}
                disabled={busy || !option.eligible}
                onPress={() => partyCall(s => s.recruitCompanion({
                  campaignId, branchId, actorId: option.actorId, directive: 'follow',
                }))}
              />
            </View>
          ))}
          {departed.map(option => (
            <View key={`rejoin-${option.actorId}`} style={[styles.row, { gap: theme.space.sm, marginBottom: theme.space.sm }]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary, flex: 1 }]}>
                {option.name}（离队）
              </Text>
              <Button
                label={option.eligible ? '重新招募' : option.reason ?? '暂不可重入'}
                variant={option.eligible ? 'primary' : 'secondary'}
                disabled={busy || !option.eligible}
                onPress={() => partyCall(s => s.rejoinCompanion({
                  campaignId, branchId, actorId: option.actorId,
                }))}
              />
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const styles = {
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' } as const,
  row: { flexDirection: 'row', alignItems: 'center' } as const,
};