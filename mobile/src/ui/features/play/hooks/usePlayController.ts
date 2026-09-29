/**
 * usePlayController — every play-screen behaviour, zero presentation (plan §17).
 *
 * The controller owns: projection load, history load, turn submission, rest,
 * rewind, save export, training, party actions and encounter actions, plus the
 * busy / error / notice state. It deliberately:
 *   · draws no UI,
 *   · keeps no authoritative state (the branch snapshot is the truth),
 *   · does not re-implement Session logic — every action calls the same
 *     `CampaignSession` method the P2 screen called, with identical arguments.
 *
 * Combat affordances (`combat.*`) are local derivations of the encounter view,
 * so the UI never asks an LLM for something the client can compute (plan §31).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { PlayUiProjection } from '../../../../../../src/application/campaign/playProjection';
import { proposeEncounterIntent } from '../../../../../../src/application/campaign/encounterIntent';
import {
  buildProvider,
  createSession,
  exportCampaignSave,
  loadHistory,
  getInteractionOperationJournal,
  createReadOnlySession,
  type EncounterView,
  type TurnView,
} from '../../../../runtime';
import type { SceneEncounterOption } from '../../../../../../src/application/campaign/session';
import { getPlayUiProjection } from '../../../../playProjection';
import { createExportFile, writeExportFile } from '../../../../fileBridge';
import { useAppSession } from '../../../state/AppSessionContext';
import type { RootStackParamList } from '../../../navigation/types';

type EncounterActor = EncounterView['actors'][number];
type EncounterZone = EncounterView['zones'][number];

export interface PlayCombatView {
  /** First living hostile — the default attack target. */
  target: EncounterActor | null;
  /** Party member in the `disabled` condition — the default rescue target. */
  disabledAlly: EncounterActor | null;
  currentActor: EncounterActor | null;
  /** Standard moves available to party actors this round. */
  movementOptions: Array<{ actor: EncounterActor; zone: EncounterZone }>;
  /** Dash destinations for the player's current turn. */
  dashZones: EncounterZone[];
  /** Companions outside the encounter that may join next round. */
  joinable: Array<{ actorId: string; name: string }>;
  /** Deterministic idempotency key builder (same shape as P2). */
  requestId: (action: string, subject?: string, actorId?: string) => string;
}

export interface PlayController {
  campaignId: string;
  branchId: string;
  projection: PlayUiProjection | null;
  turns: TurnView[];
  intent: string;
  setIntent: (value: string) => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  encounter: EncounterView | null;
  sceneEncounterOptions: SceneEncounterOption[];
  recruitmentOptions: Array<{ actorId: string; name: string; eligible: boolean; reason: string | null }>;
  rejoinOptions: Array<{ actorId: string; name: string; eligible: boolean; reason: string | null }>;
  combat: PlayCombatView;
  refresh: () => Promise<void>;
  submit: (intentOverride?: string) => Promise<void>;
  rest: (kind: 'short' | 'long') => Promise<void>;
  rewind: () => Promise<void>;
  exportSave: () => Promise<void>;
  trainSkill: (skillId: string) => Promise<void>;
  /** Party / recruitment actions that only need a session call. */
  partyCall: (action: (session: Awaited<ReturnType<typeof createSession>>) => Promise<void>) => Promise<void>;
  /** Encounter actions that return the updated encounter view. */
  encounterCall: (work: (session: Awaited<ReturnType<typeof createSession>>) => Promise<EncounterView>) => Promise<void>;
  beginSceneEncounter: (sceneEntryId: string) => Promise<void>;
  checkAttackTarget: (encounterId: string, targetActorId: string) => Promise<{ allowed: boolean; explanation: string | null }>;
}

export function usePlayController(): PlayController {
  const { profile } = useAppSession();
  const route = useRoute<RouteProp<RootStackParamList, 'Play'>>();
  const { campaignId, branchId } = route.params;

  const [projection, setProjection] = useState<PlayUiProjection | null>(null);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [encounter, setEncounter] = useState<EncounterView | null>(null);
  const [sceneEncounterOptions, setSceneEncounterOptions] = useState<SceneEncounterOption[]>([]);
  const [recruitmentOptions, setRecruitmentOptions] = useState<PlayController['recruitmentOptions']>([]);
  const [rejoinOptions, setRejoinOptions] = useState<PlayController['rejoinOptions']>([]);
  const actionInFlight = useRef(false);
  const autoNpcRunning = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const [foregroundEpoch, setForegroundEpoch] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (state === 'active') setForegroundEpoch(value => value + 1);
    });
    return () => subscription.remove();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextProjection, history, nextSceneEncounters] = await Promise.all([
        getPlayUiProjection(campaignId, branchId),
        loadHistory(branchId),
        createReadOnlySession().then(session => session.getCurrentSceneEncounterOptions(campaignId, branchId)),
      ]);
      setProjection(nextProjection);
      setTurns(history);
      setSceneEncounterOptions(nextSceneEncounters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [campaignId, branchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Recruitment eligibility is derived from current location, quests and
  // relationships, so it re-reads after every committed state change.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const options = await session.getRecruitmentOptions(campaignId, branchId);
        const rejoin = await session.getRejoinOptions(campaignId, branchId);
        if (!cancelled) {
          setRecruitmentOptions(options);
          setRejoinOptions(rejoin);
        }
      } catch {
        if (!cancelled) {
          setRecruitmentOptions([]);
          setRejoinOptions([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, branchId, projection?.stateVersion, profile]);

  const progressAutomaticActors = useCallback(async (
    session: Awaited<ReturnType<typeof createSession>>,
    initial: EncounterView,
  ): Promise<EncounterView> => {
    if (autoNpcRunning.current || initial.status !== 'active') return initial;
    autoNpcRunning.current = true;
    let latest = initial;
    try {
      const journal = await getInteractionOperationJournal();
      const resumable = await journal.getResumableOperation(campaignId, branchId);
      if (latest.currentActorIsPlayer && !resumable) return latest;
      const operationId = resumable?.operationId ?? `auto:${initial.encounterId}:${initial.stateVersion}`;
      const result = await journal.run({
        operationId,
        campaignId,
        branchId,
        kind: 'encounter_auto',
        expectedStateVersion: initial.stateVersion,
        nextAction: async (_stepIndex, _stateVersion, replayPreparedStep) => {
          const current = await session.getActiveEncounter(campaignId, branchId);
          if (!current || current.encounterId !== initial.encounterId || current.status !== 'active') {
            latest = current ?? latest;
            return null;
          }
          latest = current;
          if (!replayPreparedStep && current.currentActorIsPlayer) return null;
          return { encounterId: initial.encounterId };
        },
        actionKind: () => 'npc_turn',
        executeAction: async (action, requestId, fenceToken) => {
          latest = await session.encounterNpcTurn({
            campaignId,
            branchId,
            encounterId: action.encounterId,
            requestId,
            fenceToken,
          });
          setEncounter(latest);
          return {
            stateVersion: latest.stateVersion,
            continue: latest.status === 'active' && !latest.currentActorIsPlayer,
          };
        },
        pauseRequested: () => !foreground.current,
      });
      if (result.pauseReason === 'step_limit' || result.pauseReason === 'wall_clock') {
        setNotice('自动行动已暂停，可继续写下自己的行动。');
      }
      return latest;
    } finally {
      autoNpcRunning.current = false;
    }
  }, [campaignId, branchId]);

  // Kill-process recovery: an ACTIVE encounter restores and completes any
  // pending NPC decisions from its durable child request ids.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const active = await session.getActiveEncounter(campaignId, branchId);
        if (!cancelled && active) {
          setEncounter(active);
          if (active.status === 'active' && !active.currentActorIsPlayer) {
            setBusy(true);
            const latest = await progressAutomaticActors(session, active);
            if (!cancelled) {
              setEncounter(latest);
              await refresh();
            }
          }
        }
      } catch {
        // No encounter or a transient read error: the panel simply stays closed.
        if (!cancelled) setError('无法恢复当前遭遇；战役存档保持不变。');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, branchId, profile, progressAutomaticActors, refresh]);

  // AppState only requests a resume after a system pause. It never selects or
  // executes a player action.
  useEffect(() => {
    if (foregroundEpoch === 0 || !foreground.current || !profile || !encounter
      || encounter.status !== 'active' || encounter.currentActorIsPlayer || autoNpcRunning.current) return;
    let cancelled = false;
    setBusy(true);
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const latest = await progressAutomaticActors(session, encounter);
        if (!cancelled) {
          setEncounter(latest);
          await refresh();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [foregroundEpoch, profile, encounter?.encounterId, encounter?.status, encounter?.currentActorIsPlayer,
    progressAutomaticActors, refresh]);

  async function submit(intentOverride?: string) {
    if (actionInFlight.current || busy || !profile) return;
    const fromComposer = intentOverride === undefined;
    const value = (intentOverride ?? intent).trim();
    if (!value) return;
    actionInFlight.current = true;
    if (fromComposer) setIntent('');
    setBusy(true);
    setError(null);
    const activeEncounter = encounter?.status === 'active' ? encounter : null;
    setNotice(activeEncounter ? '识别战斗行动…' : '拟定检定…');
    try {
      const session = await createSession(profile, await buildProvider(profile));
      if (activeEncounter) {
        const proposal = proposeEncounterIntent(value, activeEncounter);
        if (proposal.kind === 'clarify') {
          if (fromComposer) setIntent(value);
          setError(proposal.explanation);
          setNotice(null);
          return;
        }
        const requestId = combatRequestId(`text-${proposal.kind}`,
          proposal.kind === 'attack' || proposal.kind === 'rescue' ? proposal.targetActorId : '');
        let view: EncounterView;
        if (proposal.kind === 'attack') {
          const availability = await session.getPlayerAttackAvailability({
            campaignId, branchId, encounterId: activeEncounter.encounterId, targetId: proposal.targetActorId,
          });
          if (!availability.allowed) throw new Error(availability.explanation ?? '当前规则条件不允许攻击。');
          view = await session.encounterAttack({
            campaignId, branchId, encounterId: activeEncounter.encounterId,
            targetId: proposal.targetActorId, requestId,
          });
        } else if (proposal.kind === 'rescue') {
          view = await session.encounterRescue({
            campaignId, branchId, encounterId: activeEncounter.encounterId,
            targetId: proposal.targetActorId, requestId,
          });
        } else if (proposal.kind === 'retreat') {
          view = await session.encounterRetreat({
            campaignId, branchId, encounterId: activeEncounter.encounterId, requestId,
          });
        } else {
          view = await session.encounterPassTurn({
            campaignId, branchId, encounterId: activeEncounter.encounterId, requestId,
          });
        }
        setEncounter(view);
        if (view.status === 'active' && !view.currentActorIsPlayer) {
          setNotice('同伴与对手正在按规则行动…');
          const latest = await progressAutomaticActors(session, view);
          setEncounter(latest);
          if (latest.currentActorIsPlayer || latest.status !== 'active') setNotice(null);
        }
        await refresh();
        return;
      }
      const result = await session.playTurn({ campaignId, branchId, intent: value });
      const turnView: TurnView = { ...result, mechanicalOnly: false };
      // The turn is already committed; merge it into the feed by id so a
      // resumed turn never duplicates (plan §18.3).
      setTurns(previous =>
        previous.some(item => item.turnId === turnView.turnId)
          ? previous.map(item => (item.turnId === turnView.turnId ? { ...item } : item))
          : [...previous, turnView],
      );
      setNotice(null);
      await refresh();
    } catch (e) {
      // A failed submit restores the intent so nothing the player typed is lost.
      if (fromComposer) setIntent(value);
      setError(e instanceof Error ? e.message : String(e));
      setNotice(null);
    } finally {
      actionInFlight.current = false;
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

  async function encounterCall(work: (session: Awaited<ReturnType<typeof createSession>>) => Promise<EncounterView>) {
    if (!profile || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const view = await work(session);
      setEncounter(view);
      if (view.status === 'active' && !view.currentActorIsPlayer) {
        setNotice('同伴与对手正在按规则行动…');
        const latest = await progressAutomaticActors(session, view);
        setEncounter(latest);
        if (latest.currentActorIsPlayer || latest.status !== 'active') setNotice(null);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function beginSceneEncounter(sceneEntryId: string) {
    if (!profile) return;
    const requestId = `${branchId.slice(-18)}:${projection?.stateVersion ?? 0}:begin:${sceneEntryId.slice(-24)}`;
    await encounterCall(session => session.beginSceneEncounter({ campaignId, branchId, sceneEntryId, requestId }));
  }

  async function checkAttackTarget(encounterId: string, targetActorId: string) {
    const session = await createReadOnlySession();
    return session.getPlayerAttackAvailability({ campaignId, branchId, encounterId, targetId: targetActorId });
  }

  async function rest(kind: 'short' | 'long') {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const result = await session.rest({ campaignId, branchId, kind });
      setNotice(
        kind === 'short'
          ? `短休完成（推进 ${Math.round(result.clockSecondsAdvanced / 60)} 分钟）`
          : `长休完成（推进 ${Math.round(result.clockSecondsAdvanced / 3600)} 小时）`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rewind() {
    if (!projection || !profile) return;
    const target = projection.stateVersion - 1;
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

  async function exportSave() {
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

  async function trainSkill(skillId: string) {
    if (!projection?.player || !profile) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      // The engine queries REAL training conditions (stamina, rank, policy);
      // the UI no longer asserts them (P2 acceptance A02).
      const result = await session.trainSkill({
        campaignId,
        branchId,
        actorId: projection.player.actorId,
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

  // ---- local combat derivations (no LLM, no rules duplication) ----

  const target = encounter?.actors.find(actor => actor.side === 'hostile' && actor.hp > 0) ?? null;
  const disabledAlly = encounter?.actors.find(actor => actor.side === 'party' && actor.conditions.includes('disabled')) ?? null;
  const currentActor = encounter?.actors.find(actor => actor.actorId === encounter.currentActorId) ?? null;
  const movementOptions = encounter
    ? encounter.actors
        .filter(actor =>
          actor.side === 'party' && actor.hp > 0 && !actor.conditions.includes('disabled') &&
          !actor.movedThisRound && (actor.actorId === encounter.currentActorId || actor.actedThisRound))
        .flatMap(actor => encounter.zones
          .filter(zone => zone.zoneId !== actor.zoneId && zone.exits.includes(actor.zoneId))
          .map(zone => ({ actor, zone })))
    : [];
  const dashZones = encounter?.currentActorIsPlayer && currentActor && currentActor.hp > 0 &&
    !currentActor.conditions.includes('disabled') && !currentActor.actedThisRound
    ? encounter.zones.filter(zone => zone.zoneId !== currentActor.zoneId && zone.exits.includes(currentActor.zoneId))
    : [];
  const joinable = encounter && projection
    ? [...(projection.player ? [projection.player] : []), ...projection.party]
        .filter(actor => actor.controller === 'companion'
          && !encounter.actors.some(entry => entry.actorId === actor.actorId)
          && !encounter.pendingActorIds.includes(actor.actorId))
        .map(actor => ({ actorId: actor.actorId, name: actor.name }))
    : [];

  function combatRequestId(action: string, subject = '', actorId = encounter?.currentActorId ?? 'start'): string {
    const version = encounter?.stateVersion ?? projection?.stateVersion ?? 0;
    return `${branchId.slice(-16)}:${version}:${actorId.slice(-16)}:${action}:${subject.slice(-16)}`;
  }

  return {
    campaignId,
    branchId,
    projection,
    turns,
    intent,
    setIntent,
    busy,
    error,
    notice,
    setError,
    setNotice,
    encounter,
    sceneEncounterOptions,
    recruitmentOptions,
    rejoinOptions,
    combat: {
      target,
      disabledAlly,
      currentActor,
      movementOptions,
      dashZones,
      joinable,
      requestId: combatRequestId,
    },
    refresh,
    submit,
    rest,
    rewind,
    exportSave,
    trainSkill,
    partyCall,
    encounterCall,
    beginSceneEncounter,
    checkAttackTarget,
  };
}
