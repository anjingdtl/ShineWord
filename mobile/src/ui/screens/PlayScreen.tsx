/**
 * 游玩页 — full-screen stack page (plan §2).
 *
 * Ported verbatim from App.tsx's `PlayScreen`: same turn submission, encounter
 * panel, party controls, rest/rewind/save actions. P2 only swaps the page frame
 * and the top bar for themed equivalents and routes `onBack` through the
 * navigator; the narrative stream and the composer keep their P4 redesign slot.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  buildProvider,
  createSession,
  exportCampaignSave,
  getCampaignState,
  loadHistory,
  type CampaignPlayState,
  type EncounterView,
  type TurnView,
} from '../../runtime';
import { createExportFile, writeExportFile } from '../../fileBridge';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { useTheme } from '../theme/ThemeContext';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList } from '../navigation/types';
import { styles } from './legacyStyles';

export function PlayScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Play'>>();
  const { campaignId, branchId } = route.params;

  const [state, setState] = useState<CampaignPlayState | null>(null);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [encounter, setEncounter] = useState<EncounterView | null>(null);
  const [encounterTemplates, setEncounterTemplates] = useState<Array<{ entryId: string; name: string }>>([]);
  const [encounterTemplateId, setEncounterTemplateId] = useState<string>('');
  const [recruitmentOptions, setRecruitmentOptions] = useState<Array<{
    actorId: string; name: string; eligible: boolean; reason: string | null;
  }>>([]);
  const [rejoinOptions, setRejoinOptions] = useState<Array<{
    actorId: string; name: string; eligible: boolean; reason: string | null;
  }>>([]);

  const refresh = useCallback(async () => {
    try {
      setState(await getCampaignState(campaignId, branchId));
      setTurns(await loadHistory(branchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [campaignId, branchId]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const options = await session.getRecruitmentOptions(campaignId, branchId);
        const rejoin = await session.getRejoinOptions(campaignId, branchId);
        if (!cancelled) { setRecruitmentOptions(options); setRejoinOptions(rejoin); }
      } catch {
        if (!cancelled) { setRecruitmentOptions([]); setRejoinOptions([]); }
      }
    })();
    return () => { cancelled = true; };
    // Refresh after every committed state change; eligibility is derived from current location, quests and relationship.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, branchId, state?.stateVersion, profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Kill-process recovery: an ACTIVE encounter restores its panel on mount.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const active = await session.getActiveEncounter(campaignId, branchId);
        if (!cancelled && active) setEncounter(active);
      } catch {
        // No encounter or a transient read error: the panel simply stays closed.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, branchId, profile]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const setup = await session.getWorldSetup(
          state?.worldId ?? '', state?.anchorWorldTimeOrder ?? undefined, state?.packageRevision,
        );
        if (!cancelled && setup.encounterTemplates.length > 0) {
          setEncounterTemplates(setup.encounterTemplates);
          setEncounterTemplateId(prev => prev || setup.encounterTemplates[0]!.entryId);
        }
      } catch {
        // Encounter templates are optional; ignore load failures here.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.worldId, profile]);

  async function submit() {
    if (!intent.trim() || busy || !profile) return;
    const value = intent.trim();
    setIntent('');
    setBusy(true);
    setError(null);
    setNotice('拟定检定…');
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const result = await session.playTurn({
        campaignId,
        branchId,
        intent: value,
      });
      setTurns(previous =>
        previous.some(item => item.turnId === result.turnId)
          ? previous.map(item => (item.turnId === result.turnId ? { ...result } : item))
          : [...previous, {
              turnId: result.turnId,
              text: result.text,
              grade: result.grade,
              dice: result.dice,
              resumed: result.resumed,
            }],
      );
      setNotice(null);
      await refresh();
    } catch (e) {
      setIntent(value);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function partyCall(action: (session: Awaited<ReturnType<typeof createSession>>) => Promise<void>) {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      await action(session);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rest(kind: 'short' | 'long') {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const result = await session.rest({ campaignId, branchId, kind });
      setNotice(kind === 'short' ? `短休完成（推进 ${Math.round(result.clockSecondsAdvanced / 60)} 分钟）` : `长休完成（推进 ${Math.round(result.clockSecondsAdvanced / 3600)} 小时）`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rewind() {
    if (!state || !profile) return;
    const target = state.stateVersion - 1;
    if (target < 0) {
      setError('还没有可回退的历史版本。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const newBranchId = `${campaignId}-b${Date.now().toString(36)}`;
      const result = await session.rewind({
        campaignId,
        sourceBranchId: branchId,
        atStateVersion: target,
        newBranchId,
      });
      setNotice(`已从版本 ${result.stateVersion} 创建分支 ${result.branchId}（回「战役」页可继续游玩该分支）`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function trainSkill(skillId: string) {
    if (!state?.playerCard || !profile) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      // The engine queries REAL training conditions (stamina, rank, policy);
      // the UI no longer asserts them (P2 acceptance A02).
      const result = await session.trainSkill({
        campaignId,
        branchId,
        actorId: state.playerCard.actorId,
        skillId,
      });
      setNotice(result.advanced
        ? `训练完成：${skillId} 提升至 ${result.nextRank}（消耗 ${Math.round(result.trainingMinutes / 60)} 小时与 ${result.staminaSpent} 体力）`
        : '未达到训练条件。');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportSaveToFile() {
    setBusy(true);
    setError(null);
    try {
      const { json } = await exportCampaignSave(campaignId, branchId);
      const uri = await createExportFile(`shine-trpg-${campaignId}-${branchId}.shineword-save.json`);
      if (!uri) {
        setNotice('已取消导出。');
        return;
      }
      await writeExportFile(uri, json);
      setNotice('存档已导出。可在干净设备导入继续游戏。');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ---- encounter actions (G01) ----

  async function encounterCall(work: (session: Awaited<ReturnType<typeof createSession>>) => Promise<EncounterView>) {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const view = await work(session);
      setEncounter(view);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const encounterTarget = encounter?.actors.find(actor => actor.side === 'hostile' && actor.hp > 0);
  const disabledAlly = encounter?.actors.find(actor => actor.side === 'party' && actor.conditions.includes('disabled'));

  function combatRequestId(action: string, subject = '', actorId = encounter?.currentActorId ?? 'start'): string {
    const version = encounter?.stateVersion ?? state?.stateVersion ?? 0;
    return `${branchId.slice(-16)}:${version}:${actorId.slice(-16)}:${action}:${subject.slice(-16)}`;
  }

  const movablePartyActors = encounter?.actors.filter(actor =>
    actor.side === 'party' && actor.hp > 0 && !actor.conditions.includes('disabled') &&
    !actor.movedThisRound && (actor.actorId === encounter.currentActorId || actor.actedThisRound),
  ) ?? [];
  const movementOptions = movablePartyActors.flatMap(actor => encounter!.zones
    .filter(zone => zone.zoneId !== actor.zoneId && zone.exits.includes(actor.zoneId))
    .map(zone => ({ actor, zone })));
  const currentCombatActor = encounter?.actors.find(actor => actor.actorId === encounter.currentActorId) ?? null;
  const availableCompanions = encounter && state
    ? state.cards.filter(card => card.controller === 'companion'
      && !encounter.actors.some(actor => actor.actorId === card.actorId)
      && !encounter.pendingActorIds.includes(card.actorId))
    : [];
  const dashZones = encounter?.currentActorIsPlayer && currentCombatActor && currentCombatActor.hp > 0 &&
    !currentCombatActor.conditions.includes('disabled') && !currentCombatActor.actedThisRound
    ? encounter.zones.filter(zone => zone.zoneId !== currentCombatActor.zoneId && zone.exits.includes(currentCombatActor.zoneId))
    : [];

  return (
    <ScreenShell bottom>
      <Header
        title={state?.title ?? campaignId}
        subtitle={state ? `v${state.stateVersion} · ${state.locationId} · 世界钟 ${Math.round(state.clockMinutes)} 分` : '加载中…'}
        onBack={() => navigation.goBack()}
        backLabel="‹ 战役"
      />

      {/* Kept as a plain block exactly like the pre-P2 layout: P2 must not
          rearrange the play screen's internals (the narrative stream below owns
          the flexible space). */}
      <View style={{ paddingHorizontal: theme.space.lg }}>
        {encounter && encounter.status === 'active' ? (
          <View style={[styles.encounterCard, { marginTop: theme.space.md }]}>
            <Text style={styles.cardTitle}>
              战斗 · 第 {encounter.round} 轮 · 行动者：{encounter.actors.find(a => a.actorId === encounter.currentActorId)?.name ?? '?'}
              {encounter.currentActorIsPlayer ? '（你）' : '（自动）'}
            </Text>
            <View style={styles.row}>
              {encounter.actors.map(actor => (
                <Text key={actor.actorId} style={actor.side === 'party' ? styles.tag : styles.dice}>
                  {actor.name} {actor.hp}/{actor.maxHp}@{actor.zoneId}{actor.conditions.includes('disabled') ? ' 失能' : ''}
                </Text>
              ))}
            </View>
            {encounter.pendingActorIds.length > 0 ? (
              <Text style={styles.muted}>
                等待下一轮加入：{encounter.pendingActorIds.map(id => state?.cards.find(card => card.actorId === id)?.name ?? id).join('、')}
              </Text>
            ) : null}
            {encounter.lastAction ? <Text style={styles.bodyText}>{encounter.lastAction}</Text> : null}
            {encounter.lastDice ? <Text style={styles.dice}>{encounter.lastDice}</Text> : null}
            <View style={styles.row}>
              {encounter.currentActorIsPlayer ? (
                <>
                  {encounterTarget ? (
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => encounterCall(s => s.encounterAttack({
                        campaignId, branchId,
                        encounterId: encounter.encounterId, targetId: encounterTarget.actorId,
                        requestId: combatRequestId('attack', encounterTarget.actorId),
                      }))}>
                      <Text style={styles.secondaryText}>攻击 {encounterTarget.name}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {disabledAlly ? (
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => encounterCall(s => s.encounterRescue({
                        campaignId, branchId,
                        encounterId: encounter.encounterId, targetId: disabledAlly.actorId,
                        requestId: combatRequestId('rescue', disabledAlly.actorId),
                      }))}>
                      <Text style={styles.secondaryText}>援救 {disabledAlly.name}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.secondary}
                    disabled={busy}
                    onPress={() => encounterCall(s => s.encounterPassTurn({
                      campaignId, branchId, encounterId: encounter.encounterId,
                      requestId: combatRequestId('pass'),
                    }))}>
                    <Text style={styles.secondaryText}>跳过（戒备）</Text>
                  </TouchableOpacity>
                  {dashZones.map(zone => (
                    <TouchableOpacity
                      key={`dash-${zone.zoneId}`}
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => encounterCall(s => s.encounterDash({
                        campaignId, branchId,
                        encounterId: encounter.encounterId, toZoneId: zone.zoneId,
                        requestId: combatRequestId('dash', zone.zoneId),
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
                    requestId: combatRequestId('npc'),
                  }))}>
                  <Text style={styles.secondaryText}>推进自动角色行动</Text>
                </TouchableOpacity>
              )}
              {movementOptions.map(({ actor, zone }) => (
                <TouchableOpacity
                  key={`move-${actor.actorId}-${zone.zoneId}`}
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => encounterCall(s => s.encounterMove({
                    campaignId, branchId,
                    encounterId: encounter.encounterId, actorId: actor.actorId, toZoneId: zone.zoneId,
                    requestId: combatRequestId('move', `${actor.actorId}:${zone.zoneId}`, actor.actorId),
                  }))}>
                  <Text style={styles.secondaryText}>{actor.name} 移动→{zone.zoneId}（本轮标准移动）</Text>
                </TouchableOpacity>
              ))}
              {availableCompanions.map(companion => (
                <TouchableOpacity
                  key={`join-${companion.actorId}`}
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => encounterCall(s => s.encounterQueueJoin({
                    campaignId, branchId,
                    encounterId: encounter.encounterId, actorId: companion.actorId,
                    requestId: combatRequestId('join', companion.actorId, companion.actorId),
                  }))}>
                  <Text style={styles.secondaryText}>{companion.name} 下一轮加入</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.secondary}
                disabled={busy}
                onPress={() => encounterCall(s => s.encounterRetreat({
                  campaignId, branchId, encounterId: encounter.encounterId,
                  requestId: combatRequestId('retreat'),
                }))}>
                <Text style={styles.secondaryText}>撤退</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : encounter ? (
          <View style={[styles.encounterCard, { marginTop: theme.space.md }]}>
            <Text style={styles.cardTitle}>战斗结束（{encounter.status === 'resolved' ? '胜利' : encounter.status === 'escaped' ? '撤离' : '溃败'}）</Text>
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
                requestId: combatRequestId('begin', encounterTemplateId),
              }))}>
              <Text style={styles.secondaryText}>进入遭遇</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {state?.playerCard ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>队伍、招募与通信</Text>
            {state.cards.filter(card => card.kind === 'companion').map(card => {
              const member = state.party.find(item => item.actorId === card.actorId);
              const groupId = member?.groupId ?? 'main';
              return (
                <View key={card.actorId} style={styles.card}>
                  <Text style={styles.bodyText}>
                    {card.name} · {groupId === 'main' ? '主队' : `分队 ${groupId}`}
                    {state.partyStatuses[card.actorId]?.lifeStatus === 'critical' ? ' · 濒危待援救/处置' : ''}
                    {state.partyStatuses[card.actorId]?.conditions.includes('disabled') ? ' · 失能' : ''}
                  </Text>
                  {groupId !== 'main' ? (
                    <TouchableOpacity style={styles.secondary} disabled={busy} onPress={() => partyCall(s => s.rejoinCompanion({
                      campaignId, branchId, actorId: card.actorId,
                    }))}>
                      <Text style={styles.secondaryText}>重入主队</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.row}>
                      {(['follow', 'support', 'protect', 'conserve', 'retreat'] as const).map(directive => (
                        <TouchableOpacity key={directive} style={styles.secondary} disabled={busy}
                          onPress={() => partyCall(s => s.setCompanionDirective({
                            campaignId, branchId, actorId: card.actorId, directive,
                          }))}>
                          <Text style={styles.secondaryText}>{directive}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity style={styles.secondary} disabled={busy} onPress={() => partyCall(s => s.splitCompanions({
                        campaignId, branchId,
                        actorIds: [card.actorId], groupId: `group-${Date.now().toString(36)}`,
                      }))}>
                        <Text style={styles.secondaryText}>分队</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.secondary} disabled={busy} onPress={() => partyCall(s => s.leaveCompanion({
                        campaignId, branchId, actorId: card.actorId,
                      }))}>
                        <Text style={styles.secondaryText}>退出队伍</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {state.discoveredEntryIds.map(entryId => (
                    <TouchableOpacity key={`${card.actorId}-${entryId}`} style={styles.secondary} disabled={busy}
                      onPress={() => partyCall(s => s.shareKnowledge({
                        campaignId, branchId,
                        sourceActorId: state.playerCard!.actorId, recipientActorId: card.actorId,
                        entryId, channel: 'conversation',
                      }))}>
                      <Text style={styles.secondaryText}>当面分享已知信息：{entryId}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })}
            {recruitmentOptions.map(option => (
              <View key={option.actorId} style={styles.row}>
                <Text style={styles.bodyText}>{option.name}</Text>
                <TouchableOpacity style={styles.secondary} disabled={busy || !option.eligible}
                  onPress={() => partyCall(s => s.recruitCompanion({
                    campaignId, branchId, actorId: option.actorId, directive: 'follow',
                  }))}>
                  <Text style={styles.secondaryText}>{option.eligible ? '招募' : option.reason ?? '暂不可招募'}</Text>
                </TouchableOpacity>
              </View>
            ))}
            {rejoinOptions.filter(option => !state.cards.some(card => card.actorId === option.actorId)).map(option => (
              <View key={`rejoin-${option.actorId}`} style={styles.row}>
                <Text style={styles.bodyText}>{option.name}（离队）</Text>
                <TouchableOpacity style={styles.secondary} disabled={busy || !option.eligible}
                  onPress={() => partyCall(s => s.rejoinCompanion({
                    campaignId, branchId, actorId: option.actorId,
                  }))}>
                  <Text style={styles.secondaryText}>{option.eligible ? '重新招募' : option.reason ?? '暂不可重入'}</Text>
                </TouchableOpacity>
              </View>
            ))}
            {state.items.map(item => (
              <View key={item.itemId} style={styles.row}>
                <Text style={styles.muted}>
                  {item.itemId} · {state.cards.find(card => card.actorId === item.ownerActorId)?.name ?? item.ownerActorId} · {item.source?.kind ?? '来源未记录'}:{item.source?.sourceId ?? '—'}
                </Text>
                {state.cards.filter(card => card.actorId !== item.ownerActorId).map(card => (
                  <TouchableOpacity key={`${item.itemId}-${card.actorId}`} style={styles.secondary} disabled={busy}
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

      <FlatList
        style={styles.story}
        data={turns}
        keyExtractor={item => item.turnId}
        contentContainerStyle={{ paddingHorizontal: theme.space.lg }}
        ListEmptyComponent={
          <Text style={styles.muted}>
            {state?.goal
              ? `主目标：${state.goal}\n输入行动，检定由你的角色卡与本地规则决定。`
              : '输入行动开始冒险。'}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.turnId} · {item.grade}</Text>
            {item.dice ? <Text style={styles.dice}>{item.dice}</Text> : null}
            <Text style={styles.bodyText}>{item.text}</Text>
            {item.resumed ? <Text style={styles.resumed}>已从本地断点恢复</Text> : null}
          </View>
        )}
      />

      <View style={{ paddingHorizontal: theme.space.lg }}>
        {state?.playerCard ? (
          <View style={styles.row}>
            {Object.entries(state.playerCard.skills).map(([skillId, rank]) => (
              <TouchableOpacity key={skillId} onPress={() => trainSkill(skillId)} disabled={busy}>
                <Text style={styles.tag}>{skillId}·{rank}（训练）</Text>
              </TouchableOpacity>
            ))}
            {state.cards.filter(card => card.controller === 'companion').map(card => (
              <Text key={card.actorId} style={styles.dice}>同伴:{card.name}</Text>
            ))}
            <Text style={styles.tag}>
              HP {state.playerResources.hp ?? '?'} · 体力 {state.playerResources.stamina ?? '?'}
              {state.playerLifeStatus === 'critical' ? ' · 濒危待援救/处置' : state.playerLifeStatus === 'dead' ? ' · 已结束' : ''}
              {state.playerConditions.includes('disabled') ? ' · 失能' : ''}
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
          <TouchableOpacity style={styles.secondary} onPress={exportSaveToFile} disabled={busy}>
            <Text style={styles.secondaryText}>导出存档</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.composer}>
          <TextInput
            style={[styles.input, styles.composerInput]}
            value={intent}
            onChangeText={setIntent}
            editable={!busy}
            placeholder="输入行动或对话…"
            placeholderTextColor="#6f7b86"
            multiline
          />
          <TouchableOpacity style={styles.primary} onPress={submit} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? '结算中…' : '行动'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}
