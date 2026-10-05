import { getDatabaseRuntime } from '../../../../database';
import { StatusBanner } from '../../../components/StatusBanner';
/**
 * GameInfoPanel — the tabbed game information sheet (plan §24).
 *
 * Five tabs, all reading the same projection: 角色 (player + every visible
 * actor, with the matching character sheet inline), 队伍, 任务, 物品, 知识.
 *
 * Naming note: the plan's §4 listing gives a `PlayPanel.tsx` inside `panels/`,
 * while §20.2 explicitly allows the modal sheet carrier to be called
 * `PlayPanel`. This implementation keeps `PlayPanel` as the carrier (§20.2) and
 * names the tabbed host `GameInfoPanel`, so the two never collide.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';
import { CompanionCharacterSheet } from '../character/CompanionCharacterSheet';
import { NpcCharacterSheet } from '../character/NpcCharacterSheet';
import { PlayerCharacterSheet } from '../character/PlayerCharacterSheet';
import { InventoryPanel } from './InventoryPanel';
import { KnowledgePanel } from './KnowledgePanel';
import { PartyPanel } from './PartyPanel';
import { PlayPanel } from './PlayPanel';
import { QuestPanel } from './QuestPanel';
import type { PlayController } from '../hooks/usePlayController';

const TABS = [
  { value: 'character' as const, label: '角色' },
  { value: 'party' as const, label: '队伍' },
  { value: 'quests' as const, label: '任务' },
  { value: 'items' as const, label: '物品' },
  { value: 'knowledge' as const, label: '知识' },
];

type PanelTab = (typeof TABS)[number]['value'];

export function GameInfoPanel(props: {
  controller: PlayController;
  visible: boolean;
  initialTab?: PanelTab;
  onClose: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [memoryStatus, setMemoryStatus] = useState('');
  const [memoryBlocked, setMemoryBlocked] = useState(false);
  const [memoryUnknownIds, setMemoryUnknownIds] = useState<readonly string[]>([]);
  const [tab, setTab] = useState<PanelTab>('character');
  const [actorId, setActorId] = useState<string | null>(null);
  const { projection, encounter, busy, trainSkill, partyCall, campaignId, branchId } = props.controller;

  useEffect(() => {
    if (!props.visible || !projection) return;
    let active = true;
    const load = async () => {
      try {
        const runtime = await getDatabaseRuntime();
        const rows = await runtime.db.queryAll<{status:string;n:number}>('SELECT status,COUNT(*) n FROM frozen_turn_postprocess_outbox WHERE branch_id=? GROUP BY status',[branchId]);
        const count = (status:string) => rows.find(r => r.status===status)?.n ?? 0;
        const checkpoint = await runtime.storyMemory.getState(branchId);
        const unknownAttempts = await runtime.db.queryAll<{attempt_id:string}>(`SELECT attempt_id FROM llm_request_attempts WHERE branch_id=?
          AND request_kind IN ('memory_checkpoint','memory_repair') AND status='outcome_unknown' AND replay_approved_at IS NULL ORDER BY started_at`, [branchId]);
        const through = checkpoint?.throughStateVersion ?? 0;
        const unknown = count('outcome_unknown'), blocked = count('blocked'), running=count('running'), pending=count('pending')+count('retryable_failed');
        if (active) {
          setMemoryBlocked(unknown+blocked>0);
          setMemoryUnknownIds(unknown > 0 ? unknownAttempts.map(a => a.attempt_id) : []);
          setMemoryStatus(`故事记忆已覆盖 ${through}/${projection.stateVersion} 回合。`
            + (running ? ` 正在整理 ${running} 项。` : '') + (pending ? ` 待整理 ${pending} 项；近期经历仍由已提交记录补足。` : '')
            + (unknown ? ` ${unknown} 项请求结果未知，已停止自动重发；可能已计费。` : '')
            + (blocked ? ` ${blocked} 项整理受阻，保留原检查点与已提交故事。` : ''));
        }
      } catch { if (active) { setMemoryBlocked(true);setMemoryStatus('故事记忆校验未通过，未标记为整理完成。'); } }
    };
    void load();const timer=setInterval(() => { void load(); },3000);
    return () => { active=false;clearInterval(timer); };
  }, [props.visible, branchId, projection?.stateVersion]);

  const roster = [
    ...(projection?.player ? [projection.player] : []),
    ...(projection?.party ?? []),
  ];
  const encounterActors = (encounter?.actors ?? []).filter(
    actor => !roster.some(member => member.actorId === actor.actorId),
  );
  useEffect(() => {
    if (props.visible) setTab(props.initialTab ?? 'character');
  }, [props.visible, props.initialTab]);
  const selectedActor =
    roster.find(member => member.actorId === actorId) ??
    null;
  const selectedCombatant = encounterActors.find(actor => actor.actorId === actorId) ?? null;

  return (
    <PlayPanel
      visible={props.visible}
      title="游戏信息"
      subtitle={projection ? `v${projection.stateVersion} · 世界包 r${projection.packageRevision}` : undefined}
      onClose={props.onClose}
      tabs={
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={setTab}
          compact
          testID="game-info-tab"
        />
      }>
      {memoryStatus ? <View testID="story-memory-status"><StatusBanner tone={memoryBlocked ? 'warning' : 'info'} message={memoryStatus} /></View> : null}
      {memoryUnknownIds.length ? <Button label="恢复未知结果的记忆整理" disabled={busy} testID="story-memory-replay"
        onPress={() => Alert.alert('确认再次发送记忆请求', '先前请求可能已经计费。恢复会再次发送请求，原账本保留，累计最多三次物理请求。', [
          { text: '暂不恢复', style: 'cancel' },
          { text: '确认恢复', onPress: () => { void props.controller.retryStoryMemory(memoryUnknownIds); } },
        ])} /> : null}
      {tab === 'character' ? (
        <View style={{ gap: theme.space.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
            {roster.map(member => (
              <Button
                key={member.actorId}
                label={member.name}
                variant="chip"
                selected={actorId === member.actorId}
                onPress={() => setActorId(member.actorId)}
                testID={`info-actor-${member.actorId}`}
              />
            ))}
            {encounterActors.map(actor => (
              <Button
                key={actor.actorId}
                label={actor.name}
                variant="chip"
                selected={actorId === actor.actorId}
                onPress={() => setActorId(actor.actorId)}
                testID={`info-actor-${actor.actorId}`}
              />
            ))}
          </View>

          {selectedActor && projection ? (
            selectedActor.actorId === projection.player?.actorId ? (
              <PlayerCharacterSheet projection={projection} busy={busy} onTrain={trainSkill} />
            ) : (
              <CompanionCharacterSheet
                projection={projection}
                actor={selectedActor}
                busy={busy}
                onSetDirective={directive =>
                  partyCall(s => s.setCompanionDirective({
                    campaignId, branchId, actorId: selectedActor.actorId, directive,
                  }))
                }
              />
            )
          ) : selectedCombatant ? (
            <NpcCharacterSheet
              campaignId={campaignId}
              branchId={branchId}
              actorId={selectedCombatant.actorId}
              side={selectedCombatant.side}
            />
          ) : (
            <Card>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
                选择一位角色查看其角色卡。敌对与中立角色只显示公开投影，未探明内容会保持隐藏。
              </Text>
            </Card>
          )}
        </View>
      ) : null}

      {tab === 'party' ? <PartyPanel controller={props.controller} /> : null}
      {tab === 'quests' ? <QuestPanel quests={projection?.quests ?? []} /> : null}
      {tab === 'items' ? <InventoryPanel controller={props.controller} /> : null}
      {tab === 'knowledge' ? <KnowledgePanel discoveries={projection?.discoveries ?? []} /> : null}
    </PlayPanel>
  );
}
