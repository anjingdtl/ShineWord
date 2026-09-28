/**
 * 游玩页 — full-screen stack page (plan §2/§15/§17).
 *
 * The screen is a thin composition: route context → controller → features.
 * Business behaviour lives in `usePlayController`; every visual block lives in
 * `features/play`. What is still P2-shaped here (the party/recruitment block and
 * the rest/rewind/export row) is replaced by the party panels (P4.9) and the
 * game menu (P4.10).
 */
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompanionDirective } from '../../../../src/domain/characters/card';
import { ScreenShell } from '../components/ScreenShell';
import { ActionComposer } from '../features/play/ActionComposer';
import { NarrativeFeed } from '../features/play/NarrativeFeed';
import { PartyStrip } from '../features/play/PartyStrip';
import { PlayHeader } from '../features/play/PlayHeader';
import { CompanionCharacterSheet } from '../features/play/character/CompanionCharacterSheet';
import { NpcCharacterSheet } from '../features/play/character/NpcCharacterSheet';
import { PlayerCharacterSheet } from '../features/play/character/PlayerCharacterSheet';
import { EncounterHud, EncounterStarter } from '../features/play/encounter/EncounterHud';
import { PlayPanel } from '../features/play/panels/PlayPanel';
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
  const { height: windowHeight } = useWindowDimensions();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const controller = props.controller;
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
    recruitmentOptions,
    rejoinOptions,
    submit,
    rest,
    rewind,
    exportSave,
    trainSkill,
    partyCall,
  } = controller;

  const player = view?.player ?? null;
  const partyMembers = view?.party ?? [];
  const roster = [...(player ? [player] : []), ...partyMembers];
  // Local derivation only — no LLM is asked for what the client can compute.
  const quickActions = useContextualActions({ projection: view, encounter });
  // Which actor's character sheet is open (null = closed).
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const sheetActor = roster.find(member => member.actorId === sheetActorId) ?? null;
  // NPC / creature sheets use the safe public projection and load on demand.
  const [npcActorId, setNpcActorId] = useState<string | null>(null);
  const npcActor = encounter?.actors.find(actor => actor.actorId === npcActorId) ?? null;

  const openActorCard = (actorId: string): void => {
    if (roster.some(member => member.actorId === actorId)) setSheetActorId(actorId);
    else setNpcActorId(actorId);
  };

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

      {/* The combat HUD and the legacy party block live in a bounded scroll
          area so the narrative feed always keeps its reading space; a tall
          encounter can never squeeze the story out of the screen. */}
      <View style={{ paddingHorizontal: theme.space.lg }}>
        <ScrollView
          style={{ maxHeight: windowHeight * 0.5 }}
          contentContainerStyle={{ gap: theme.space.md, paddingTop: theme.space.md }}
          nestedScrollEnabled>
          <EncounterHud controller={controller} onSelectActor={openActorCard} />
          {!encounter ? <EncounterStarter controller={controller} /> : null}

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
        </ScrollView>
      </View>

      <NarrativeFeed turns={turns} goal={view?.goal ?? ''} busy={busy} />

      <PartyStrip
        members={roster}
        playerActorId={player?.actorId ?? null}
        onSelect={setSheetActorId}
        busy={busy}
      />

      <View style={{ paddingHorizontal: theme.space.lg }}>
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

      <PlayPanel
        visible={sheetActor !== null}
        title={sheetActor?.name ?? ''}
        subtitle={
          sheetActor
            ? `${sheetActor.kind === 'companion' ? '同伴' : '角色'} · ${
                sheetActor.groupId === 'main' ? '主队' : `分队 ${sheetActor.groupId}`
              }`
            : undefined
        }
        onClose={() => setSheetActorId(null)}>
        {sheetActor && view ? (
          sheetActor.actorId === view.player?.actorId ? (
            <PlayerCharacterSheet projection={view} busy={busy} onTrain={trainSkill} />
          ) : (
            <CompanionCharacterSheet
              projection={view}
              actor={sheetActor}
              busy={busy}
              onSetDirective={directive =>
                partyCall(s => s.setCompanionDirective({
                  campaignId, branchId, actorId: sheetActor.actorId, directive,
                }))
              }
            />
          )
        ) : null}
      </PlayPanel>

      <PlayPanel
        visible={npcActorId !== null}
        title={npcActor?.name ?? '角色'}
        subtitle="公开投影 · 未探明内容保持隐藏"
        onClose={() => setNpcActorId(null)}>
        {npcActorId ? (
          <NpcCharacterSheet
            campaignId={campaignId}
            branchId={branchId}
            actorId={npcActorId}
            side={npcActor?.side}
          />
        ) : null}
      </PlayPanel>
    </ScreenShell>
  );
}