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
  subscribeGuidanceUpdates,
  loadPlayRecovery,
  savePlayIntentDraft,
  clearPlayIntentDraft,
  acknowledgePlayReplay,
  acknowledgeMemoryReplay,
  type PlayRecovery,
  type EncounterView,
  type TurnView,
} from '../../../../runtime';
import { setPlayScreenActivity } from '../../../../llmScheduler';
import { maintainSegmentContent, getSegmentReadiness, releaseRewoundSegmentDemands } from '../../../../segmentRuntime';
import { tryActivateStagePackages, checkStageTriggers } from '../../../../sourceImport';
import type { SceneEncounterOption } from '../../../../../../src/application/campaign/session';
import type { GuidanceStepView, TurnGuidanceV1 } from '../../../../../../src/application/guidance/types';
import type { PlayTurnOptions } from '../../../../../../src/application/campaign/session';
import type { CampaignPlanUnknownReplayPreview } from '../../../../../../src/application/campaignPlan/unknownReplayRecovery';
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
  guidance: TurnGuidanceV1 | null;
  campaignId: string;
  branchId: string;
  projection: PlayUiProjection | null;
  turns: TurnView[];
  intent: string;
  setIntent: (value: string) => void;
  busy: boolean;
  recovery: PlayRecovery | null;
  recoverTurn: () => Promise<void>;
  retryStoryMemory: (attemptIds: readonly string[]) => Promise<void>;
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
  /** P7: submit a guidance step's first action with staleness re-validation. */
  submitGuidanceStep: (step: import('../../../../../../src/application/guidance/types').GuidanceStepView) => void;
  /** P7 §8.3: attach guidance after NPC automatic steps reach a player boundary. */
  attachNpcBoundaryGuidance: () => Promise<void>;
  submit: (intentOverride?: string) => Promise<void>;
  rest: (kind: 'short' | 'long') => Promise<void>;
  rewind: () => Promise<void>;
  exportSave: () => Promise<void>;
  trainSkill: (skillId: string) => Promise<void>;
  /** Party / recruitment actions that only need a session call. */
  partyCall: (action: (session: Awaited<ReturnType<typeof createSession>>) => Promise<void>) => Promise<void>;
  previewReplanReplay: () => Promise<CampaignPlanUnknownReplayPreview>;
  confirmReplanReplay: (approvalFingerprint: string) => Promise<void>;
  /** Encounter actions that return the updated encounter view. */
  encounterCall: (work: (session: Awaited<ReturnType<typeof createSession>>) => Promise<EncounterView>) => Promise<void>;
  beginSceneEncounter: (sceneEntryId: string) => Promise<void>;
  checkAttackTarget: (encounterId: string, targetActorId: string) => Promise<{ allowed: boolean; explanation: string | null }>;
}

export function usePlayController(): PlayController {
  useEffect(() => { setPlayScreenActivity(true); return () => setPlayScreenActivity(false); }, []);
  const { profile } = useAppSession();
  const route = useRoute<RouteProp<RootStackParamList, 'Play'>>();
  const { campaignId, branchId } = route.params;

  const [projection, setProjection] = useState<PlayUiProjection | null>(null);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [guidance, setGuidance] = useState<TurnGuidanceV1 | null>(null);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<PlayRecovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [encounter, setEncounter] = useState<EncounterView | null>(null);
  const [sceneEncounterOptions, setSceneEncounterOptions] = useState<SceneEncounterOption[]>([]);
  const [recruitmentOptions, setRecruitmentOptions] = useState<PlayController['recruitmentOptions']>([]);
  const [rejoinOptions, setRejoinOptions] = useState<PlayController['rejoinOptions']>([]);
  const actionInFlight = useRef(false);
  const autoNpcRunning = useRef(false);
  const replanRunning = useRef(false);
  const mounted = useRef(true);
  const activeBranch = useRef(branchId);
  activeBranch.current = branchId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refreshSeq = useRef(0);
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
    // Overlapping refreshes (mount, submit, recovery interval) read at
    // different commit points; a stale read landing last would clobber the
    // fresh one. Serialize: only the newest-started refresh may apply state.
    const seq = ++refreshSeq.current;
    try {
      // Management/adoption and the opening create decision points even when
      // they have no narrative card. Derive their choices locally, without HTTP.
      const session = await createReadOnlySession();
      const nextGuidance = await session.ensureDecisionPointGuidance({ campaignId, branchId,
        sourceTurnId: 'refresh-current', localOnly: true });
      const [nextProjection, history, nextSceneEncounters, pending] = await Promise.all([
        getPlayUiProjection(campaignId, branchId),
        loadHistory(branchId),
        createReadOnlySession().then(session => session.getCurrentSceneEncounterOptions(campaignId, branchId)),
        loadPlayRecovery(campaignId, branchId),
      ]);
      if (seq !== refreshSeq.current) return;
      setProjection(nextProjection);
      setTurns(history);
      setGuidance(nextGuidance?.decisionPoint.stateVersion === nextProjection.stateVersion ? nextGuidance : null);
      setSceneEncounterOptions(nextSceneEncounters);
      setRecovery(pending);
      if (pending?.intent && !actionInFlight.current) setIntent(previous => previous || pending.intent);
    } catch (e) {
      if (seq !== refreshSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [campaignId, branchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Local commit triggers enqueue jobs. Only those jobs dispatch a planner;
  // ordinary turns have no extra model call and remain usable while it runs.
  useEffect(() => {
    if (!profile || busy || recovery || !projection || replanRunning.current || !foreground.current) return;
    replanRunning.current = true;
    void (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const status = await session.runCampaignReplan(campaignId, branchId, { automatic: true });
        if (status === 'adopted' && mounted.current && activeBranch.current === branchId) {
          setNotice('后续主线已根据最新局势准备。'); await refresh();
        }
      } catch {
        if (mounted.current && activeBranch.current === branchId) setNotice('后续主线准备尚未完成，可以继续探索或在主线面板恢复。');
      } finally { replanRunning.current = false; }
    })();
  }, [profile, campaignId, branchId, projection?.stateVersion, busy, recovery, foregroundEpoch, refresh]);

  // Returning to the foreground can coincide with a turn that finished in the
  // background (recovery/service completion); re-read the feed then too.
  useEffect(() => {
    if (foregroundEpoch > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foregroundEpoch]);

  // Between-turn stage maintenance (unified P3): every committed turn ends at
  // a safe boundary, so pending stage packages activate here and the next
  // stage's proximity/dependency triggers evaluate. The anchor is derived
  // from the campaign's locked opening plus the player's CURRENT scene
  // location (deriveNarrativeAnchorCp) - travelling into later-book geography
  // moves it; long stays never sweep stages. Stage work runs in the dataSync
  // service; play never waits on it (missing content shows as "资料准备中",
  // never as invented narrative).
  useEffect(() => {
    const worldId = projection?.worldId;
    if (!worldId) return;
    let cancelled = false;
    (async () => {
      try {
        if (await getSegmentReadiness(worldId)) {
          await maintainSegmentContent({ worldId, campaignId, branchId, stateVersion: projection!.stateVersion,
            locationId: projection?.player?.locationId ?? null });
          return;
        }
        await tryActivateStagePackages(worldId);
        await checkStageTriggers({
          worldId,
          campaignId,
          anchorLocationId: projection?.player?.locationId ?? null,
        });
      } catch {
        // Stage maintenance must never block or crash play.
      }
      void cancelled;
    })();
    return () => { cancelled = true; };
  }, [projection?.worldId, projection?.stateVersion, projection?.player?.locationId, campaignId]);

  useEffect(() => {
    if (!projection || !recovery?.intent || busy) return;
    let active = true;
    const timer = setInterval(() => {
      if (!foreground.current || actionInFlight.current) return;
      void maintainSegmentContent({ worldId: projection.worldId, campaignId, branchId, stateVersion: projection.stateVersion,
        locationId: projection.player?.locationId ?? null, intent: recovery.intent ?? undefined }).then(result => {
        if (active && !result.pending) { setNotice('资料已就绪，可以继续已保留的原行动。'); void refresh(); }
      }).catch(() => { /* persisted task diagnostics remain available in the project */ });
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [projection?.worldId, projection?.stateVersion, recovery?.intent, busy, campaignId, branchId, refresh]);

  useEffect(() => {
    if (!profile) return;
    void (async () => { const session = await createSession(profile, await buildProvider(profile));
      await session.resumePostProcessing(branchId); })().catch(() => { /* durable outbox owns diagnostics */ });
  }, [campaignId, branchId, profile]);

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
      if (latest.stateVersion > initial.stateVersion && (latest.status !== 'active' || latest.currentActorIsPlayer)) {
        await session.ensureDecisionPointGuidance({ campaignId, branchId, sourceTurnId: `auto-${latest.stateVersion}` });
      }
      return latest;
    } finally {
      autoNpcRunning.current = false;
    }
  }, [campaignId, branchId]);

  /**
   * P7 §8.3: when automatic actors finished and it is the player's move
   * again, attach guidance to that decision point (local first; the session
   * may upgrade it asynchronously). Failure never blocks play.
   */
  const attachNpcBoundaryGuidance = useCallback(async (): Promise<void> => {
    if (!profile) return;
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const summary = await session.getSummary(campaignId, branchId);
      await session.ensureDecisionPointGuidance({
        campaignId,
        branchId,
        sourceTurnId: `auto-${summary.state.stateVersion}`,
        committedEvents: [{ eventType: 'npc_auto_boundary', payload: {} }],
      });
      await refresh();
    } catch {
      // Guidance is derived content; keep playing without it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, branchId, profile]);

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

  async function submit(intentOverride?: string, approveRecovery = false, guidanceChoice?: PlayTurnOptions['guidanceChoice']) {
    if (actionInFlight.current || busy || !profile) return;
    const fromComposer = intentOverride === undefined;
    const value = (intentOverride ?? intent).trim();
    if (!value) return;
    actionInFlight.current = true;
    if (fromComposer) setIntent('');
    setBusy(true);
    setError(null);
    const activeEncounter = encounter?.status === 'active' ? encounter : null;
    setNotice('正在展开你的行动…');
    try {
      let draftVersion: number | null = null;
      if (!activeEncounter) {
        const pending = await loadPlayRecovery(campaignId, branchId);
        if (pending?.unknownAttemptIds.length) {
          if (!approveRecovery) throw new Error('上次生成结果未知，请使用「确认重试这一回合」恢复原行动。');
          await acknowledgePlayReplay(campaignId, branchId, pending.expectedStateVersion, pending.unknownAttemptIds);
        }
        draftVersion = await savePlayIntentDraft(campaignId, branchId, value);
      }
      const session = await createSession(profile, await buildProvider(profile));
      if (guidanceChoice) await session.assertGuidanceChoiceCurrent(branchId, guidanceChoice, value);
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
          setNotice('同伴与对手正在行动…');
          const latest = await progressAutomaticActors(session, view);
          setEncounter(latest);
          if (latest.currentActorIsPlayer || latest.status !== 'active') setNotice(null);
        }
        await refresh();
        return;
      }
      if (projection) {
        const prepared = await maintainSegmentContent({ worldId: projection.worldId, campaignId, branchId,
          stateVersion: projection.stateVersion, locationId: projection.player?.locationId ?? null, intent: value,
          publishedChoice: guidanceChoice });
        if (prepared.pending) { setNotice(prepared.message); await refresh(); return; }
      }
      const result = await session.playTurn({ campaignId, branchId, intent: value, guidanceChoice });
      if (draftVersion !== null) await clearPlayIntentDraft(branchId, draftVersion);
      setIntent(previous => previous === value ? '' : previous);
      setNotice(null);
      // Use the persisted projection immediately, including choice/result;
      // avoid flashing a narration-only row before history refreshes.
      await refresh();
      if (result.resumed) setTurns(previous => previous.map(turn =>
        turn.turnId === result.turnId ? { ...turn, resumed: true } : turn));
    } catch (e) {
      // A failed submit restores the intent so nothing the player typed is lost.
      if (fromComposer) setIntent(value);
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('这条路径已失效')) {
        const currentSession = await createSession(profile, await buildProvider(profile));
        const refreshed = await currentSession.ensureDecisionPointGuidance({ campaignId, branchId, sourceTurnId: 'refresh-current', localOnly: true }).catch(() => null);
        setNotice(refreshed ? '已更新当前局面的路径，请重新选择第一步。' : null);
        setError(refreshed ? null : message);
      } else {
        setNotice(null);
        setError(message === 'Network request failed' ? '网络连接失败。行动已保留，联网后可重试。' : message);
      }
      await refresh();
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeGuidanceUpdates(updatedBranch => {
      if (!cancelled && updatedBranch === branchId && foreground.current) void refresh();
    }).then(dispose => { if (cancelled) dispose(); else unsubscribe = dispose; }).catch(() => undefined);
    return () => { cancelled = true; unsubscribe?.(); };
  }, [branchId, refresh]);

  async function recoverTurn() {
    if (!recovery?.intent) return;
    await submit(recovery.intent, true);
  }

  function pendingTurnBlocksAction(): boolean {
    if (actionInFlight.current || busy) return true;
    if (recovery && (recovery.frozen || recovery.unknownAttemptIds.length > 0)) {
      setError('请先恢复未完成的回合，再进行其他行动。');
      return true;
    }
    return false;
  }

  async function partyCall(action: (session: Awaited<ReturnType<typeof createSession>>) => Promise<void>) {
    if (!profile || actionInFlight.current || pendingTurnBlocksAction()) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      await action(session);
      void session.resumePostProcessing(branchId).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await refresh();
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function encounterCall(work: (session: Awaited<ReturnType<typeof createSession>>) => Promise<EncounterView>) {
    if (!profile || pendingTurnBlocksAction()) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const view = await work(session);
      void session.resumePostProcessing(branchId).catch(() => undefined);
      setEncounter(view);
      if (view.status === 'active' && !view.currentActorIsPlayer) {
        setNotice('同伴与对手正在行动…');
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

  async function rest(kind: 'short' | 'long', guidanceChoice?: PlayTurnOptions['guidanceChoice']) {
    if (!profile || pendingTurnBlocksAction()) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const result = await session.rest({ campaignId, branchId, kind, guidanceChoice });
      setNotice(
        kind === 'short'
          ? `短休完成（推进 ${Math.round(result.clockSecondsAdvanced / 60)} 分钟）`
          : `长休完成（推进 ${Math.round(result.clockSecondsAdvanced / 3600)} 小时）`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function rewind() {
    if (pendingTurnBlocksAction()) return;
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
      await releaseRewoundSegmentDemands(projection.worldId, campaignId, branchId);
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
    if (!projection?.player || !profile || pendingTurnBlocksAction()) return;
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

  /**
   * P7: submit one guidance step's FIRST action. The click re-validates the
   * decision point against the live branch state — a stale path (NPC moved
   * the world, branch switched) never auto-executes. Multi-clicks collapse
   * into the existing actionInFlight gate.
   */
  const submitGuidanceStep = (step: GuidanceStepView): void => {
    if (busy || actionInFlight.current) return;
    if (!guidance) return;
    if (guidance.decisionPoint.branchId !== branchId
      || guidance.decisionPoint.stateVersion !== projection?.stateVersion) {
      setNotice('局面已经变化，这条路径不再直接可用；请参考最新建议或自由描述行动。');
      void refresh();
      return;
    }
    if (step.availability !== 'available') {
      setIntent(step.firstStepIntent);
      setNotice('这条路还差一步准备；已把第一步填入输入框，可先补齐条件或修改后提交。');
      return;
    }
    const choice = { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef };
    if (step.actionId === 'short_rest') { void rest('short', choice); return; }
    void submit(step.firstStepIntent, false, choice);
  };

  async function retryStoryMemory(attemptIds: readonly string[]) {
    if (!profile || busy || actionInFlight.current) return;
    setBusy(true);
    try {
      await acknowledgeMemoryReplay(campaignId, branchId, attemptIds);
      const session = await createSession(profile, await buildProvider(profile));
      await session.resumePostProcessing(branchId);
      setNotice('已处理本次记忆恢复请求；覆盖进度以游戏信息中的实际状态为准。');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function previewReplanReplay(): Promise<CampaignPlanUnknownReplayPreview> {
    if (!profile) throw new Error('请先配置模型后再核对主线恢复。');
    const session = await createSession(profile, await buildProvider(profile));
    // This is a read-only ledger/freeze inspection. Do not run the general
    // post-processing sweep here: it may dispatch unrelated memory requests.
    return session.previewCampaignReplanReplay(campaignId, branchId);
  }

  async function confirmReplanReplay(approvalFingerprint: string): Promise<void> {
    if (!profile || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      await session.confirmCampaignReplanReplay(campaignId, branchId, approvalFingerprint);
      setNotice('关联主线规划已通过稳定边界采用。');
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  return {
    campaignId,
    branchId,
    projection,
    turns,
    guidance,
    intent,
    setIntent,
    busy,
    recovery,
    recoverTurn,
    retryStoryMemory,
    submitGuidanceStep,
    attachNpcBoundaryGuidance,
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
    previewReplanReplay,
    confirmReplanReplay,
    encounterCall,
    beginSceneEncounter,
    checkAttackTarget,
  };
}
