/**
 * 游玩页 — full-screen stack page (plan §2/§15/§17).
 *
 * The screen is a thin composition: route context → controller → features.
 * Business behaviour lives in `usePlayController`; every visual block lives in
 * `features/play`. Party management, quests, items and knowledge are no longer
 * on the main surface — they live in the game information sheet (plan §24).
 */
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenShell } from '../components/ScreenShell';
import { ActionComposer } from '../features/play/ActionComposer';
import { NarrativeFeed } from '../features/play/NarrativeFeed';
import { PartyStrip } from '../features/play/PartyStrip';
import { PlayHeader } from '../features/play/PlayHeader';
import { CompanionCharacterSheet } from '../features/play/character/CompanionCharacterSheet';
import { NpcCharacterSheet } from '../features/play/character/NpcCharacterSheet';
import { PlayerCharacterSheet } from '../features/play/character/PlayerCharacterSheet';
import { EncounterHud, EncounterStarter } from '../features/play/encounter/EncounterHud';
import { GameInfoPanel } from '../features/play/panels/GameInfoPanel';
import { PlayPanel } from '../features/play/panels/PlayPanel';
import { useContextualActions } from '../features/play/hooks/useContextualActions';
import { usePlayController } from '../features/play/hooks/usePlayController';
import { ThemeScope, useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';
import { styles } from './legacyStyles';

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
  // The tabbed information sheet (角色 / 队伍 / 任务 / 物品 / 知识).
  const [infoOpen, setInfoOpen] = useState(false);

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
        onMenu={() => setInfoOpen(true)}
        busy={busy}
      />

      {/* The combat HUD lives in a bounded scroll area so the narrative feed
          always keeps its reading space; a tall encounter can never squeeze the
          story out of the screen. */}
      <View style={{ paddingHorizontal: theme.space.lg }}>
        <ScrollView
          style={{ maxHeight: windowHeight * 0.5 }}
          contentContainerStyle={{ gap: theme.space.md, paddingTop: theme.space.md }}
          nestedScrollEnabled>
          <EncounterHud controller={controller} onSelectActor={openActorCard} />
          {!encounter ? <EncounterStarter controller={controller} /> : null}
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

      <GameInfoPanel controller={controller} visible={infoOpen} onClose={() => setInfoOpen(false)} />
    </ScreenShell>
  );
}