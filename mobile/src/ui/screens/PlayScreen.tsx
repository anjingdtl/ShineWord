/** Text-first play surface: story, at most three direct choices, and free input. */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { Button } from '../components/Button';
import { typeStyle } from '../components/typography';
import { ActionChoices, type ActionChoice } from '../features/play/ActionChoices';
import { GuidanceCard } from '../features/play/GuidanceCard';
import { ActionComposer } from '../features/play/ActionComposer';
import { NarrativeFeed } from '../features/play/NarrativeFeed';
import { PlayHeader } from '../features/play/PlayHeader';
import { GameInfoPanel } from '../features/play/panels/GameInfoPanel';
import { GameMenu } from '../features/play/panels/GameMenu';
import { PlayPanel } from '../features/play/panels/PlayPanel';
import { useContextualActions } from '../features/play/hooks/useContextualActions';
import { usePlayController } from '../features/play/hooks/usePlayController';
import { ThemeScope, useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

type InfoTab = 'character' | 'party' | 'quests' | 'items' | 'knowledge';

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
  const controller = props.controller;
  const {
    campaignId, branchId, projection: view, turns, intent, setIntent, busy, error, notice,
    encounter, sceneEncounterOptions, submit, trainSkill, partyCall, encounterCall,
  } = controller;
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>('character');
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [scenePickerOpen, setScenePickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // First-session guide (product ask #4): once per device, dismissed by
  // "开始游玩" or implicitly after the first committed turn.
  const [guideVisible, setGuideVisible] = useState(false);
  const guideHidden = turns.length > 0;

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem('shineword.play.guide.v1').then(flag => {
      if (!cancelled && flag === null) setGuideVisible(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const dismissGuide = (): void => {
    setGuideVisible(false);
    void AsyncStorage.setItem('shineword.play.guide.v1', 'seen').catch(() => undefined);
  };

  // P7: the newest committed turn's guidance drives the actionable path
  // card; older turns keep their guidance as history inside the feed data.
  const latestGuidance = turns.length > 0 ? turns[turns.length - 1].guidance : undefined;
  const choices = useContextualActions({
    projection: view,
    encounter,
    sceneEncounters: sceneEncounterOptions,
  });

  const openInfo = (tab: InfoTab): void => {
    setInfoTab(tab);
    setInfoOpen(true);
  };

  const attackTarget = (targetActorId: string): void => {
    if (!encounter) return;
    setTargetPickerOpen(false);
    void controller.checkAttackTarget(encounter.encounterId, targetActorId).then(availability => {
      if (!availability.allowed) {
        controller.setError(availability.explanation ?? '当前规则条件不允许攻击。');
        return;
      }
      return encounterCall(session => session.encounterAttack({
        campaignId,
        branchId,
        encounterId: encounter.encounterId,
        targetId: targetActorId,
        requestId: controller.combat.requestId('attack', targetActorId),
      }));
    }).catch(e => controller.setError(e instanceof Error ? e.message : String(e)));
  };

  const onChoose = (choice: ActionChoice): void => {
    switch (choice.kind) {
      case 'act':
        void submit(choice.intent);
        return;
      case 'inspect':
        if (choice.target === 'knowledge') openInfo('knowledge');
        else if (choice.target === 'quests') openInfo('quests');
        else if (choice.target === 'combatants') setTargetPickerOpen(true);
        else if (choice.target === 'scene_encounters') setScenePickerOpen(true);
        else openInfo('character');
        return;
      case 'start_encounter':
        void controller.beginSceneEncounter(choice.sceneEntryId);
        return;
      case 'attack':
        attackTarget(choice.targetActorId);
        return;
      case 'rescue':
        if (!encounter) return;
        void encounterCall(session => session.encounterRescue({
          campaignId,
          branchId,
          encounterId: encounter.encounterId,
          targetId: choice.targetActorId,
          requestId: controller.combat.requestId('rescue', choice.targetActorId),
        }));
        return;
      case 'retreat':
        if (!encounter) return;
        void encounterCall(session => session.encounterRetreat({
          campaignId,
          branchId,
          encounterId: encounter.encounterId,
          requestId: controller.combat.requestId('retreat'),
        }));
    }
  };

  const hostiles = encounter?.actors.filter(actor => actor.side === 'hostile' && actor.hp > 0) ?? [];
  const recovery = controller.recovery;
  const recoveryLocked = !!recovery && (recovery.frozen || recovery.unknownAttemptIds.length > 0);

  return (
    <ScreenShell bottom>
      <PlayHeader
        title={view?.title ?? '故事'}
        clockSeconds={view?.clockSeconds ?? null}
        onBack={() => navigation.popTo('Tabs', { screen: 'Campaigns' })}
        onMenu={() => setMenuOpen(true)}
        busy={busy}
      />

      <NarrativeFeed
        turns={turns}
        goal={view?.goal ?? ''}
        busy={busy}
        guideVisible={guideVisible && !guideHidden}
        onDismissGuide={dismissGuide}
      />

      <View style={{ paddingHorizontal: theme.space.lg, gap: theme.space.xs }}>
        {recoveryLocked ? <>
          <StatusBanner tone="info" title="有一回合尚未完成" message={recovery.unknownAttemptIds.length
            ? '上次云端生成结果未知，可能已经计费。重试会发送新的生成请求；已保存的行动与骰点将继续沿用。'
            : '已保存原行动与检定结果，可继续完成这一回合。'} />
          <Button label={recovery.unknownAttemptIds.length ? '确认重试这一回合' : '继续未完成的回合'}
            onPress={() => void controller.recoverTurn()} disabled={busy || !recovery.intent} testID="play-recover-turn" />
        </> : null}
        {notice ? <StatusBanner tone="info" message={notice} /> : null}
        {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}
      </View>

      {latestGuidance && encounter?.status !== 'active' ? (
        <GuidanceCard
          guidance={latestGuidance}
          currentStateVersion={view?.stateVersion}
          disabled={busy || recoveryLocked}
          onSubmitStep={controller.submitGuidanceStep}
          onPrefillIntent={value => controller.setIntent(value)}
        />
      ) : null}
      <ActionChoices choices={choices} disabled={busy || recoveryLocked} onChoose={onChoose} />
      <ActionComposer
        value={intent}
        onChangeText={setIntent}
        onSubmit={() => void submit()}
        busy={busy}
        blocked={recoveryLocked}
        encounterActive={encounter?.status === 'active'}
      />

      <PlayPanel
        visible={targetPickerOpen}
        title="选择攻击目标"
        subtitle="选择目标后先检查射程与行动资格，再执行攻击。"
        onClose={() => setTargetPickerOpen(false)}>
        {hostiles.length > 0 ? (
          <View style={{ gap: theme.space.sm }}>
            {hostiles.map(actor => (
              <Button
                key={actor.actorId}
                label={`攻击 ${actor.name}`}
                block
                disabled={busy}
                onPress={() => attackTarget(actor.actorId)}
                accessibilityLabel={`选择攻击目标：${actor.name}`}
                testID={`target-choice-${actor.actorId}`}
              />
            ))}
          </View>
        ) : (
          <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.secondary }]}>
            当前没有可选择的敌对目标。
          </Text>
        )}
      </PlayPanel>

      <PlayPanel
        visible={scenePickerOpen}
        title="当前场景的冲突"
        subtitle="只列出世界包明确标记的场景与角色资格。"
        onClose={() => setScenePickerOpen(false)}>
        {sceneEncounterOptions.length > 0 ? (
          <View style={{ gap: theme.space.sm }}>
            {sceneEncounterOptions.map(option => (
              <Button
                key={option.sceneEntryId}
                label={`进入冲突：${option.sceneName}`}
                block
                disabled={busy}
                onPress={() => {
                  setScenePickerOpen(false);
                  void controller.beginSceneEncounter(option.sceneEntryId);
                }}
              />
            ))}
          </View>
        ) : (
          <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.secondary }]}>
            当前地点没有公开且明确标记的冲突资格，暂不提供遭遇入口。
          </Text>
        )}
      </PlayPanel>

      <GameInfoPanel
        controller={controller}
        visible={infoOpen}
        initialTab={infoTab}
        onClose={() => setInfoOpen(false)}
      />

      <GameMenu
        controller={controller}
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenInfo={() => {
          setMenuOpen(false);
          openInfo('character');
        }}
        onExit={() => {
          setMenuOpen(false);
          navigation.popTo('Tabs', { screen: 'Campaigns' });
        }}
      />
    </ScreenShell>
  );
}
