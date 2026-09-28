/**
 * 游玩页 — full-screen stack page (plan §2/§15/§17).
 *
 * P4.2 extracts every business function into `usePlayController` (plan §17):
 * this screen now only holds route context, the controller and the (still
 * P2-shaped) presentation, which the following P4 stages replace piece by
 * piece. The world's own skin is applied through `ThemeScope`, so a world theme
 * override reaches the play screen too (plan §14).
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompanionDirective } from '../../../../src/domain/characters/card';
import { ScreenShell } from '../components/ScreenShell';
import { ActionComposer } from '../features/play/ActionComposer';
import { NarrativeFeed } from '../features/play/NarrativeFeed';
import { PlayHeader } from '../features/play/PlayHeader';
import { useContextualActions } from '../features/play/hooks/useContextualActions';
import { usePlayController } from '../features/play/hooks/usePlayController';
import { ThemeScope, useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';
import { styles } from './legacyStyles';

const DIRECTIVES: ReadonlyArray<{ value: CompanionDirective; label: string }> = [
  { value: 'follow', label: '跟随' },
  { value: 'support', label: '支援' },
  { value: 'protect', label: '保护' },
  { value: 'conserve', label: '节省资源' },
  { value: 'retreat', label: '撤退' },
];

export function PlayScreen(): React.JSX.Element {
  const { themeIdForWorld } = useTheme();
  const controller = usePlayController();
  return (
    <ThemeScope themeId={themeIdForWorld(controller.projection?.worldId ?? null)}>
      <PlayScreenBody controller={controller} />
    </ThemeScope>
  );
}

function PlayScreenBody(props: { controller: ReturnType<typeof usePlayController> }): React.JSX.Element {
  const { theme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    campaignId,
    branchId,
    projection: view,
    turns,
    intent,
    setIntent,
    busy,
    error,
    notice,
    encounter,
    encounterTemplates,
    encounterTemplateId,
    setEncounterTemplateId,
    recruitmentOptions,
    rejoinOptions,
    combat,
    submit,
    rest,
    rewind,
    exportSave,
    trainSkill,
    partyCall,
    encounterCall,
  } = props.controller;

  const player = view?.player ?? null;
  const partyMembers = view?.party ?? [];
  const roster = [...(player ? [player] : []), ...partyMembers];
  // Local derivation only — no LLM is asked for what the client can compute.
  const quickActions = useContextualActions({ projection: view, encounter });

  return (
    <ScreenShell bottom>
      <PlayHeader
        title={view?.title ?? campaignId}
        branchLabel={branchId}
        locationLabel={player?.locationId ?? ''}
        clockSeconds={view?.clockSeconds ?? null}
        stateVersion={view?.stateVersion ?? null}
        onBack={() => navigation.goBack()}
        busy={busy}
      />

      <View style={{ paddingHorizontal: theme.space.lg }}>
        {encounter && encounter.status === 'active' ? (
          <View style={[styles.encounterCard, { marginTop: theme.space.md }]}>
            <Text style={styles.cardTitle}>
              战斗 · 第 {encounter.round} 轮 · 行动者：{combat.currentActor?.name ?? '?'}
              {encounter.currentActorIsPlayer ? '（你）' : '（自动）'}
            </Text>
            <View style={styles.row}>
              {encounter.actors.map(actor => (
                <Text key={actor.actorId} style={actor.side === 'party' ? styles.tag : styles.dice}>
                  {actor.name} {actor.hp}/{actor.maxHp}@{actor.zoneId}
                  {actor.conditions.includes('disabled') ? ' 失能' : ''}
                </Text>
              ))}
            </View>
            {encounter.pendingActorIds.length > 0 ? (
              <Text style={styles.muted}>
                等待下一轮加入：
                {encounter.pendingActorIds
                  .map(id => roster.find(card => card.actorId === id)?.name ?? id)
                  .join('、')}
              </Text>
            ) : null}
            {encounter.lastAction ? <Text style={styles.bodyText}>{encounter.lastAction}</Text> : null}
            {encounter.lastDice ? <Text style={styles.dice}>{encounter.lastDice}</Text> : null}
            <View style={styles.row}>
              {encounter.currentActorIsPlayer ? (
                <>
                  {combat.target ? (
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => encounterCall(s => s.encounterAttack({
                        campaignId, branchId,
                        encounterId: encounter.encounterId, targetId: combat.target!.actorId,
                        requestId: combat.requestId('attack', combat.target!.actorId),
                      }))}>
                      <Text style={styles.secondaryText}>攻击 {combat.target.name}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {combat.disabledAlly ? (
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => encounterCall(s => s.encounterRescue({
                        campaignId, branchId,
                        encounterId: encounter.encounterId, targetId: combat.disabledAlly!.actorId,
                        requestId: combat.requestId('rescue', combat.disabledAlly!.actorId),
                      }))}>
                      <Text style={styles.secondaryText}>援救 {combat.disabledAlly.name}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.secondary}
                    disabled={busy}
                    onPress={() => encounterCall(s => s.encounterPassTurn({
                      campaignId, branchId, encounterId: encounter.encounterId,
                      requestId: combat.requestId('pass'),
                    }))}>
                    <Text style={styles.secondaryText}>跳过（戒备）</Text>
                  </TouchableOpacity>
                  {combat.dashZones.map(zone => (
                    <TouchableOpacity
                      key={`dash-${zone.zoneId}`}
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => encounterCall(s => s.encounterDash({
                        campaignId, branchId,
                        encounterId: encounter.encounterId, toZoneId: zone.zoneId,
                        requestId: combat.requestId('dash', zone.zoneId),
                      }))}>
                      <Text style={styles.secondaryText}>疾行→{zone.zoneId}（消耗主要行动）</Text>
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                <TouchableOpacity
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => encounterCall(s => s.encounterNpcTurn({
                    campaignId, branchId, encounterId: encounter.encounterId,
                    requestId: combat.requestId('npc'),
                  }))}>
                  <Text style={styles.secondaryText}>推进自动角色行动</Text>
                </TouchableOpacity>
              )}
              {combat.movementOptions.map(({ actor, zone }) => (
                <TouchableOpacity
                  key={`move-${actor.actorId}-${zone.zoneId}`}
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => encounterCall(s => s.encounterMove({
                    campaignId, branchId,
                    encounterId: encounter.encounterId, actorId: actor.actorId, toZoneId: zone.zoneId,
                    requestId: combat.requestId('move', `${actor.actorId}:${zone.zoneId}`, actor.actorId),
                  }))}>
                  <Text style={styles.secondaryText}>{actor.name} 移动→{zone.zoneId}（本轮标准移动）</Text>
                </TouchableOpacity>
              ))}
              {combat.joinable.map(companion => (
                <TouchableOpacity
                  key={`join-${companion.actorId}`}
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => encounterCall(s => s.encounterQueueJoin({
                    campaignId, branchId,
                    encounterId: encounter.encounterId, actorId: companion.actorId,
                    requestId: combat.requestId('join', companion.actorId, companion.actorId),
                  }))}>
                  <Text style={styles.secondaryText}>{companion.name} 下一轮加入</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.secondary}
                disabled={busy}
                onPress={() => encounterCall(s => s.encounterRetreat({
                  campaignId, branchId, encounterId: encounter.encounterId,
                  requestId: combat.requestId('retreat'),
                }))}>
                <Text style={styles.secondaryText}>撤退</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : encounter ? (
          <View style={[styles.encounterCard, { marginTop: theme.space.md }]}>
            <Text style={styles.cardTitle}>
              战斗结束（
              {encounter.status === 'resolved' ? '胜利' : encounter.status === 'escaped' ? '撤离' : '溃败'}）
            </Text>
            {encounter.lastAction ? <Text style={styles.bodyText}>{encounter.lastAction}</Text> : null}
          </View>
        ) : encounterTemplates.length > 0 ? (
          <View style={[styles.encounterCard, { marginTop: theme.space.md }]}>
            <Text style={styles.cardTitle}>遭遇（测试入口）</Text>
            <View style={styles.row}>
              {encounterTemplates.map(template => (
                <TouchableOpacity
                  key={template.entryId}
                  style={[styles.secondary, encounterTemplateId === template.entryId && styles.secondaryActive]}
                  onPress={() => setEncounterTemplateId(template.entryId)}>
                  <Text style={styles.secondaryText}>{template.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.secondary}
              disabled={busy}
              onPress={() => encounterCall(s => s.beginEncounter({
                campaignId, branchId,
                hostiles: [{ templateId: encounterTemplateId, count: 1 }],
                requestId: combat.requestId('begin', encounterTemplateId),
              }))}>
              <Text style={styles.secondaryText}>进入遭遇</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {player && view ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>队伍、招募与通信</Text>
            {partyMembers.map(member => {
              const groupId = member.groupId;
              return (
                <View key={member.actorId} style={styles.card}>
                  <Text style={styles.bodyText}>
                    {member.name} · {groupId === 'main' ? '主队' : `分队 ${groupId}`}
                    {member.lifeStatus === 'critical' ? ' · 濒危待援救/处置' : ''}
                    {member.conditions.includes('disabled') ? ' · 失能' : ''}
                  </Text>
                  {groupId !== 'main' ? (
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => partyCall(s => s.rejoinCompanion({
                        campaignId, branchId, actorId: member.actorId,
                      }))}>
                      <Text style={styles.secondaryText}>重入主队</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.row}>
                      {DIRECTIVES.map(directive => (
                        <TouchableOpacity
                          key={directive.value}
                          style={[styles.secondary, member.companionDirective === directive.value && styles.secondaryActive]}
                          disabled={busy}
                          onPress={() => partyCall(s => s.setCompanionDirective({
                            campaignId, branchId, actorId: member.actorId, directive: directive.value,
                          }))}>
                          <Text style={styles.secondaryText}>{directive.label}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        style={styles.secondary}
                        disabled={busy}
                        onPress={() => partyCall(s => s.splitCompanions({
                          campaignId, branchId,
                          actorIds: [member.actorId], groupId: `group-${Date.now().toString(36)}`,
                        }))}>
                        <Text style={styles.secondaryText}>分队</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondary}
                        disabled={busy}
                        onPress={() => partyCall(s => s.leaveCompanion({
                          campaignId, branchId, actorId: member.actorId,
                        }))}>
                        <Text style={styles.secondaryText}>退出队伍</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {view.discoveries.map(discovery => (
                    <TouchableOpacity
                      key={`${member.actorId}-${discovery.entryId}`}
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => partyCall(s => s.shareKnowledge({
                        campaignId, branchId,
                        sourceActorId: player.actorId, recipientActorId: member.actorId,
                        entryId: discovery.entryId, channel: 'conversation',
                      }))}>
                      <Text style={styles.secondaryText}>当面分享已知信息：{discovery.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })}
            {recruitmentOptions.map(option => (
              <View key={option.actorId} style={styles.row}>
                <Text style={styles.bodyText}>{option.name}</Text>
                <TouchableOpacity
                  style={styles.secondary}
                  disabled={busy || !option.eligible}
                  onPress={() => partyCall(s => s.recruitCompanion({
                    campaignId, branchId, actorId: option.actorId, directive: 'follow',
                  }))}>
                  <Text style={styles.secondaryText}>{option.eligible ? '招募' : option.reason ?? '暂不可招募'}</Text>
                </TouchableOpacity>
              </View>
            ))}
            {rejoinOptions
              .filter(option => !roster.some(card => card.actorId === option.actorId))
              .map(option => (
                <View key={`rejoin-${option.actorId}`} style={styles.row}>
                  <Text style={styles.bodyText}>{option.name}（离队）</Text>
                  <TouchableOpacity
                    style={styles.secondary}
                    disabled={busy || !option.eligible}
                    onPress={() => partyCall(s => s.rejoinCompanion({
                      campaignId, branchId, actorId: option.actorId,
                    }))}>
                    <Text style={styles.secondaryText}>{option.eligible ? '重新招募' : option.reason ?? '暂不可重入'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            {view.inventory.map(item => (
              <View key={item.itemId} style={styles.row}>
                <Text style={styles.muted}>
                  {item.name} · {item.ownerName} · {item.source?.kind ?? '来源未记录'}:{item.source?.sourceId ?? '—'}
                </Text>
                {roster.filter(card => card.actorId !== item.ownerActorId).map(card => (
                  <TouchableOpacity
                    key={`${item.itemId}-${card.actorId}`}
                    style={styles.secondary}
                    disabled={busy}
                    onPress={() => partyCall(s => s.transferItem({
                      campaignId, branchId,
                      itemId: item.itemId, fromActorId: item.ownerActorId, toActorId: card.actorId,
                    }))}>
                    <Text style={styles.secondaryText}>交给 {card.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <NarrativeFeed turns={turns} goal={view?.goal ?? ''} busy={busy} />

      <View style={{ paddingHorizontal: theme.space.lg }}>
        {player && view ? (
          <View style={styles.row}>
            {view.skills
              .filter(skill => skill.actorId === player.actorId)
              .map(skill => (
                <TouchableOpacity key={skill.skillId} onPress={() => trainSkill(skill.skillId)} disabled={busy}>
                  <Text style={styles.tag}>
                    {skill.name}·{skill.rank}（训练）
                  </Text>
                </TouchableOpacity>
              ))}
            {partyMembers.map(member => (
              <Text key={member.actorId} style={styles.dice}>同伴:{member.name}</Text>
            ))}
            <Text style={styles.tag}>
              HP {player.resources.hp ?? '?'} · 体力 {player.resources.stamina ?? '?'}
              {player.lifeStatus === 'critical'
                ? ' · 濒危待援救/处置'
                : player.lifeStatus === 'dead'
                  ? ' · 已结束'
                  : ''}
              {player.conditions.includes('disabled') ? ' · 失能' : ''}
            </Text>
          </View>
        ) : null}
        {notice ? <Text style={styles.resumed}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.row}>
          <TouchableOpacity style={styles.secondary} onPress={() => rest('short')} disabled={busy}>
            <Text style={styles.secondaryText}>短休</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => rest('long')} disabled={busy}>
            <Text style={styles.secondaryText}>长休</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={rewind} disabled={busy}>
            <Text style={styles.secondaryText}>回退</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={exportSave} disabled={busy}>
            <Text style={styles.secondaryText}>导出存档</Text>
          </TouchableOpacity>
        </View>

        <ActionComposer
          value={intent}
          onChangeText={setIntent}
          onSubmit={submit}
          busy={busy}
          quickActions={quickActions}
        />
      </View>
    </ScreenShell>
  );
}