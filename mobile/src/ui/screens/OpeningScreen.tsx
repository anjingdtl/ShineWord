/**
 * 开局向导 — full-screen stack page (plan §11).
 *
 * P3.6 rebuilds the P2 single-scroll form into the four-step wizard:
 *   01 世界起点 → 02 我的角色 → 03 同伴 → 04 确认开局
 *
 * Business behaviour is unchanged: the same `session.getWorldSetup` projection,
 * the same anchor re-projection when the selected anchor changes, and the same
 * `createCampaign` call with identical arguments. After creation the wizard is
 * replaced by the play screen, so Back can never return to a finished wizard.
 * No `legacyStyles` import remains.
 */
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompanionDirective } from '../../../../src/domain/characters/card';
import { recommendOpeningLoadout } from '../../../../src/application/campaign/openingRecommendation';
import { suggestOpeningGoals } from '../../../../src/application/campaign/openingGoalSuggestions';
import { getSegmentReadiness } from '../../segmentRuntime';
import { prepareCampaignPlan, readReadyProposal, adoptCampaignPlan, restoreCampaignPreparation, resumeCampaignPreparation,
  previewCampaignPreparationReplay, confirmAndResumeCampaignPreparationReplay, cancelCampaignPreparation,
  type ProposalView, type PreparePlanInput } from '../../campaignPlanning';
import { CampaignProposalCard, PlanningStatus } from '../features/opening/CampaignProposalCard';
import { buildProvider, createSession } from '../../runtime';
import { getDatabaseRuntime } from '../../database';
import { nativeSha256 } from '../../nativeCrypto';
import { findLocalOpeningSource } from '../../../../src/application/worldPackage/openingRecovery';
import { importNovelForOpeningStreaming } from '../../sourceImport';
import { startOrResumeBuild } from '../../buildWatchdog';
import { pickTextRef } from '../../fileBridge';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { ProgressSteps } from '../components/ProgressSteps';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { StepCharacter } from '../features/opening/StepCharacter';
import { StepCompanions } from '../features/opening/StepCompanions';
import { StepConfirm } from '../features/opening/StepConfirm';
import { StepWorldStart } from '../features/opening/StepWorldStart';
import { QuickOpeningConfirm } from '../features/opening/QuickOpeningConfirm';
import { QuickOpeningIdentity } from '../features/opening/QuickOpeningIdentity';
import { WIZARD_STEPS, type OpeningWorldSetup } from '../features/opening/openingModel';
import { useTheme } from '../theme/ThemeContext';
import { THEMES } from '../theme/tokens';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList } from '../navigation/types';

export function OpeningScreen(): React.JSX.Element {
  const { theme, themeId } = useTheme();
  const { profile } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Opening'>>();
  const { worldId, title } = route.params;

  const [advancedWizard, setAdvancedWizard] = useState(false);
  const [step, setStep] = useState(0);
  const [quickStep, setQuickStep] = useState(0);
  const [quickAdvancedOpen, setQuickAdvancedOpen] = useState(false);
  const [quickRecommendationsInitialized, setQuickRecommendationsInitialized] = useState(false);
  const [setup, setSetup] = useState<OpeningWorldSetup | null>(null);
  const [name, setName] = useState('');
  const [characterDescription, setCharacterDescription] = useState('');
  const [kind, setKind] = useState<'original' | 'canon'>('original');
  const [canonEntityId, setCanonEntityId] = useState<string>('');
  const [points, setPoints] = useState<Record<string, number>>({
    physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1,
  });
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const [anchorEventId, setAnchorEventId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [companions, setCompanions] = useState<string[]>([]);
  const [companionDirectives, setCompanionDirectives] = useState<Record<string, CompanionDirective>>({});
  const [goal, setGoal] = useState('');
  const [goalSuggestions, setGoalSuggestions] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planningPhase, setPlanningPhase] = useState<string | null>(null);
  const planningScroll = React.useRef<ScrollView>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  useEffect(() => {
    if (planningPhase || proposal || error) planningScroll.current?.scrollTo({ y: 0, animated: true });
  }, [planningPhase, proposal, error]);
  const pendingCreate = React.useRef<PreparePlanInput | null>(null);
  const planningSetupId = React.useRef<string | null>(null);
  const selectionBinding = React.useRef<string | null>(null);
  const actionInFlight = React.useRef(false);
  const replayDialogOpen = React.useRef(false);
  const [lengthPreference, setLengthPreference] = useState<'short' | 'medium' | 'long'>('medium');
  const [noPackage, setNoPackage] = useState(false);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setNoPackage(false);
    setSetup(null);
    setAnchorEventId('');
    setLocationId('');
    setCanonEntityId('');
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const worldSetup = await session.getWorldSetup(worldId);
        if (cancelled) return;
        if (worldSetup.packageRevision === null) {
          setNoPackage(true);
          return;
        }
        setSetup(worldSetup);
        const restored = await restoreCampaignPreparation(worldId, profile);
        if (cancelled) return;
        if (restored) {
          const input = { ...restored.input, worldTitle: title };
          pendingCreate.current = input;
          planningSetupId.current = restored.setupId;
          setName(input.protagonist.name); setKind(input.protagonist.kind);
          setCanonEntityId(input.protagonist.canonEntityId ?? '');
          setCharacterDescription(input.protagonist.description ?? '');
          if (input.protagonist.attributes) setPoints(input.protagonist.attributes);
          setChosenSkills([...input.protagonistSkills]); setQuickAdvancedOpen(true);
          setGoal(input.goal); setLengthPreference(input.lengthPreference ?? 'medium');
          setAnchorEventId(input.anchor.anchorEventId ?? ''); setLocationId(input.anchor.locationId);
          setCompanions(input.companions.map(c => c.templateId));
          setCompanionDirectives(Object.fromEntries(input.companions.map(c => [c.templateId, (c.directive ?? 'protect') as CompanionDirective])));
          setQuickRecommendationsInitialized(true); setQuickStep(1);
          setProposal(restored.proposal); setPlanningPhase(restored.phase); setPlanningError(restored.error ?? null);
          return;
        }
        const firstAnchor = worldSetup.anchorEvents[0];
        if (firstAnchor) setAnchorEventId(firstAnchor.eventId);
        if (worldSetup.locations.length > 0) setLocationId(worldSetup.locations[0]);
        const firstCanon = worldSetup.canonCharacters[0];
        if (firstCanon) setCanonEntityId(firstCanon.entityId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, profile]);

  const selectionKey = JSON.stringify({ name, kind, canonEntityId, characterDescription, points, chosenSkills,
    anchorEventId, locationId, companions, companionDirectives, goal, lengthPreference, advancedWizard, quickAdvancedOpen });
  useEffect(() => {
    if (!planningSetupId.current) return;
    if (selectionBinding.current === null) { selectionBinding.current = selectionKey; return; }
    if (selectionBinding.current === selectionKey) return;
    const staleSetup = planningSetupId.current;
    planningSetupId.current = null; selectionBinding.current = null; pendingCreate.current = null;
    setProposal(null); setPlanningPhase(null);
    void cancelCampaignPreparation(staleSetup).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [selectionKey]);

  useEffect(() => {
    if (!profile) return;
    const anchorOrder = setup?.anchorEvents.find(event => event.eventId === anchorEventId)?.worldTimeOrder;
    if (anchorOrder === undefined) return;
    let cancelled = false;
    const queueController = new AbortController();
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const anchored = await session.getWorldSetup(worldId, anchorOrder);
        if (cancelled) return;
        setSetup(current => current ? { ...anchored, anchorEvents: current.anchorEvents } : anchored);
        if (!anchored.locations.includes(locationId) && anchored.locations[0]) setLocationId(anchored.locations[0]);
        setCompanions(current => current.filter(id => anchored.companionTemplates.some(template => template.entryId === id)));
        // Product ask 2026-10-01 #3: two AI-proposed goals over the world
        // package for the chosen anchor; the third option is the player's
        // own words. Pure enhancement - failures resolve to no suggestions.
        const runtime = await getDatabaseRuntime();
        const revision = anchored.packageRevision;
        const published = revision === null ? null : await runtime.worldStore.getWorldPackage(worldId, revision);
        if (cancelled || !published || published.manifest.status !== 'published') return;
        const goals = await suggestOpeningGoals(await buildProvider(profile), {
          worldTitle: title,
          anchorTitle: setup?.anchorEvents.find(event => event.eventId === anchorEventId)?.title ?? '开局时刻',
          locationName: anchored.locations[0],
          characterNames: anchored.canonCharacters.slice(0, 6).map(character => character.name),
          playerName: name.trim() || (kind === 'original' ? '旅人' : '原著人物'),
        }, { worldId, packageRevision: published.manifest.revision, packageContentHash: published.manifest.contentHash,
          anchorEventId, profile, sha256Hex: nativeSha256.sha256Hex,
          queueSignal: queueController.signal,
          isCurrent: async () => !cancelled && Boolean(await runtime.worldStore.getWorld(worldId)),
        });
        if (!cancelled) setGoalSuggestions(goals);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; queueController.abort(); };
    // The selected anchor controls which time-bounded facts can enter the opening projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, anchorEventId, profile]);

  const spentTotal = Object.values(points).reduce((sum, value) => sum + (value - 1), 0);

  function bump(key: string, delta: number) {
    setPoints(previous => {
      const next = { ...previous };
      const value = (next[key] ?? 1) + delta;
      if (value < 1 || value > 3) return previous;
      if (delta > 0 && spentTotal >= 4) return previous;
      next[key] = value;
      return next;
    });
  }

  function toggleSkill(entryId: string) {
    setChosenSkills(previous => {
      if (previous.includes(entryId)) return previous.filter(id => id !== entryId);
      if (previous.length >= 3) return previous;
      return [...previous, entryId];
    });
  }

  function toggleCompanion(entryId: string) {
    setCompanions(previous => {
      if (previous.includes(entryId)) return previous.filter(id => id !== entryId);
      if (previous.length >= 2) return previous; // plan default: at most 2 companions
      return [...previous, entryId];
    });
  }

  const anchorEvent = setup?.anchorEvents.find(event => event.eventId === anchorEventId);
  const recommendation = recommendOpeningLoadout(setup?.skills ?? []);
  const quickIdentityReady = kind === 'canon' ? canonEntityId !== '' : name.trim().length > 0;
  const advancedCharacterReady = kind === 'canon' ? canonEntityId !== '' : chosenSkills.length > 0;
  const quickStartReady = quickIdentityReady && setup?.packageRevision != null && (setup?.locations.length ?? 0) > 0;
  const advancedStartReady = advancedCharacterReady && setup?.packageRevision != null && (setup?.locations.length ?? 0) > 0;
  const stepReady = [
    setup !== null && (setup.anchorEvents.length === 0 || anchorEventId !== '') && locationId !== '',
    advancedCharacterReady,
    true,
    advancedStartReady,
  ];
  const canAdvance = stepReady[step] ?? false;

  async function repairOpening() {
    if (!profile || busy) return;
    setBusy(true);
    setError(null);
    try {
      const runtime = await getDatabaseRuntime();
      const session = await createSession(profile, await buildProvider(profile));
      const local = await findLocalOpeningSource({ worldStore: runtime.worldStore, worldId,
        getSetup: id => session.getWorldSetup(id) });
      if (local) {
        navigation.replace('Opening', { worldId: local.worldId, title: local.title });
        return;
      }
      const picked = await pickTextRef();
      if (!picked) return;
      const imported = await importNovelForOpeningStreaming(picked.uri, picked.name, profile,
        progress => setRepairMessage(progress.message ?? '正在补齐世界资料…'));
      for (const runId of imported.runIds) {
        void startOrResumeBuild(runId, profile, { resume: true })
          .catch(e => setError(e instanceof Error ? e.message : String(e)));
      }
      // The library owns controls/progress until complete analysis publishes.
      navigation.popTo('Tabs', { screen: 'Library' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function initializeQuickRecommendations() {
    if (quickRecommendationsInitialized) return;
    setPoints(recommendation.attributes);
    setChosenSkills(recommendation.initialSkills);
    setQuickRecommendationsInitialized(true);
  }

  /** Gathers wizard inputs into ONE plan-input object shared by generate/adopt. */
  async function collectPlanInput(): Promise<PreparePlanInput> {
    const session = await createSession(profile!, await buildProvider(profile!));
    const selectedAnchor = setup?.anchorEvents.find(event => event.eventId === anchorEventId);
    const worldSetup = await session.getWorldSetup(worldId, selectedAnchor?.worldTimeOrder);
    if (worldSetup.packageRevision === null) throw new Error('世界包尚未发布。');
    if (worldSetup.locations.length === 0) throw new Error('这个世界没有可用的开局地点（场景条目缺失）。');
    const chosenLocation = locationId || worldSetup.locations[0];
    const anchor = worldSetup.anchorEvents.find(event => event.eventId === anchorEventId);
    if (setup?.anchorEvents.length && !anchor) throw new Error('开局锚点不在已发布原著事件中。');
    const invalidCompanion = companions.find(id => !worldSetup.companionTemplates.some(template => template.entryId === id));
    if (invalidCompanion) throw new Error(`所选同伴 ${invalidCompanion} 在当前开局锚点不可招募。`);
    const actorName = kind === 'canon'
      ? worldSetup.canonCharacters.find(character => character.entityId === canonEntityId)?.name ?? '无名旅人'
      : name.trim() || '无名旅人';
    const quickLoadout = !advancedWizard;
    const recommended = recommendOpeningLoadout(worldSetup.skills);
    const characterAttributes = quickLoadout && !quickAdvancedOpen ? recommended.attributes : points;
    const characterSkills = quickLoadout && !quickAdvancedOpen ? recommended.initialSkills : chosenSkills;
    const runtime = await getDatabaseRuntime();
    const certification = await getSegmentReadiness(worldId);
    if (certification && !certification.availableArtifacts.length) throw new Error('开局资料尚未通过证据与行动依赖验证，请查看项目构建状态。');
    const published = await runtime.worldStore.getWorldPackage(worldId, worldSetup.packageRevision);
    if (!published) throw new Error('已发布世界包读取失败。');
    return {
      profile: profile!,
      worldId,
      worldTitle: title,
      packageRevision: worldSetup.packageRevision,
      packageContentHash: published.manifest.contentHash,
      anchor: {
        worldTimeOrder: anchor?.worldTimeOrder ?? 1,
        ...(anchor?.eventId ? { anchorEventId: anchor.eventId } : {}),
        locationId: chosenLocation,
      },
      anchorTitle: anchor ? `序${anchor.worldTimeOrder} · ${anchor.title}` : '时间原点',
      protagonist: {
        actorId: 'actor-player',
        kind,
        name: actorName,
        ...(kind === 'canon' ? { canonEntityId } : {}),
        ...(characterDescription.trim() ? { description: characterDescription.trim() } : {}),
        ...(kind === 'original' ? { attributes: characterAttributes, initialSkills: characterSkills } : {}),
      },
      protagonistSkills: characterSkills,
      companions: companions.map((templateId, index) => ({
        actorId: `actor-ally-${index + 1}`,
        templateId,
        directive: companionDirectives[templateId] ?? 'protect',
      })),
      goal: goal.trim(),
      lengthPreference,
      goalSuggestions,
      // Extra creation fields ride along for adoption (kept out of intent).
      ...({} as Record<string, never>),
    } satisfies PreparePlanInput;
  }

  /** P9 two-phase start: generate the campaign proposal (real phases). */
  async function create() {
    if (!profile || busy || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    setPlanningError(null);
    setProposal(null);
    try {
      const input = await collectPlanInput();
      pendingCreate.current = input;
      selectionBinding.current = selectionKey;
      setPlanningPhase('preparing');
      const result = await prepareCampaignPlan(input, phase => setPlanningPhase(phase), id => { planningSetupId.current = id; });
      if (planningSetupId.current !== result.setupId) return;
      if (result.phase === 'ready') {
        const view = await readReadyProposal(result.setupId);
        if (!view) throw new Error('提案已生成但读取失败，请重新生成。');
        setProposal(view);
      } else {
        setPlanningError(result.error ?? null);
        setPlanningPhase(result.phase);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlanningPhase(null);
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  /** One click adopts the ready proposal atomically (A09 idempotent). */
  function discardPreparation() {
    const id = planningSetupId.current;
    planningSetupId.current = null; pendingCreate.current = null; selectionBinding.current = null;
    setProposal(null); setPlanningPhase(null); setPlanningError(null);
    if (id) void cancelCampaignPreparation(id).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }

  async function resumePreparation() {
    if (!pendingCreate.current || !planningSetupId.current || busy || actionInFlight.current) return;
    actionInFlight.current = true; setBusy(true); setPlanningError(null);
    try {
      const result = await resumeCampaignPreparation(planningSetupId.current, pendingCreate.current, setPlanningPhase);
      setProposal(result.proposal); setPlanningPhase(result.phase); setPlanningError(result.error ?? null);
    }
    catch (e) { setPlanningError(e instanceof Error ? e.message : String(e)); setPlanningPhase('failed'); }
    finally { actionInFlight.current = false; setBusy(false); }
  }

  async function requestUnknownReplayConfirmation() {
    const setupId = planningSetupId.current;
    if (!profile || !pendingCreate.current || !setupId || busy || actionInFlight.current || replayDialogOpen.current) return;
    actionInFlight.current = true; setBusy(true); setPlanningError(null);
    try {
      const preview = await previewCampaignPreparationReplay(setupId, profile);
      if (!preview.approvalFingerprint) throw new Error('无法核对这次规划的冻结材料和请求账本。');
      replayDialogOpen.current = true;
      const titleText = preview.alreadyApproved ? '继续已批准的关联规划？' : '确认创建关联规划？';
      const message = preview.alreadyApproved
        ? '先前的确认记录仍与当前模型配置和冻结材料匹配。继续只运行已关联任务；如果该关联任务本身结果未知，不会再次自动发送。'
        : `原请求结果未知，可能已经计费。当前冻结材料、配置和存档状态匹配，可再使用 ${preview.remainingPhysicalRequestBudget} 个计划内物理请求。确认会保留原未知记录并追加审批审计；只有确认后才会派发。`;
      Alert.alert(titleText, message, [
        { text: '取消', style: 'cancel', onPress: () => { replayDialogOpen.current = false; } },
        { text: preview.alreadyApproved ? '继续已批准任务' : '确认并继续', onPress: () => {
          replayDialogOpen.current = false;
          void (async () => {
            if (actionInFlight.current) return;
            actionInFlight.current = true; setBusy(true);
            try {
              const result = await confirmAndResumeCampaignPreparationReplay(setupId, preview.approvalFingerprint!,
                pendingCreate.current!, setPlanningPhase);
              setProposal(result.proposal); setPlanningPhase(result.phase); setPlanningError(result.error ?? null);
            } catch (e) {
              setPlanningError(e instanceof Error ? e.message : String(e)); setPlanningPhase('failed');
            } finally { actionInFlight.current = false; setBusy(false); }
          })();
        } },
      ]);
    } catch (e) {
      setPlanningError(e instanceof Error ? e.message : String(e));
    } finally {
      actionInFlight.current = false; setBusy(false);
    }
  }

  async function startAdventure() {
    if (!profile || busy || actionInFlight.current || !proposal || !pendingCreate.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const input = pendingCreate.current;
      const session = await createSession(profile, await buildProvider(profile));
      const worldSetup = await session.getWorldSetup(worldId);
      const quickLoadout = !advancedWizard;
      const recommended = recommendOpeningLoadout(worldSetup.skills);
      const characterAttributes = quickLoadout && !quickAdvancedOpen ? recommended.attributes : points;
      const characterSkills = quickLoadout && !quickAdvancedOpen ? recommended.initialSkills : chosenSkills;
      const campaignId = `camp-${Date.now().toString(36)}`;
      const adopted = await adoptCampaignPlan({
        profile,
        setupId: proposal.setupId,
        candidateId: proposal.candidateId,
        campaignId,
        title: `${title} · ${input.protagonist.name}`,
        worldId,
        packageRevision: input.packageRevision,
        anchor: input.anchor,
        protagonist: {
          actorId: 'actor-player',
          kind: input.protagonist.kind,
          name: input.protagonist.name,
          description: input.protagonist.description,
          ...(input.protagonist.kind === 'original'
            ? {
                attributes: {
                  physique: input.protagonist.attributes?.physique ?? characterAttributes.physique,
                  agility: input.protagonist.attributes?.agility ?? characterAttributes.agility,
                  insight: input.protagonist.attributes?.insight ?? characterAttributes.insight,
                  knowledge: input.protagonist.attributes?.knowledge ?? characterAttributes.knowledge,
                  willpower: input.protagonist.attributes?.willpower ?? characterAttributes.willpower,
                  social: input.protagonist.attributes?.social ?? characterAttributes.social,
                },
                initialSkills: input.protagonist.initialSkills ?? characterSkills,
              }
            : { canonEntityId: input.protagonist.canonEntityId }),
        },
        companions: input.companions,
      });
      navigation.replace('Play', { campaignId: adopted.campaignId, branchId: adopted.branchId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  if (noPackage) {
    return (
      <ScreenShell bottom>
        <Header title={`开局 · ${title}`} onBack={() => navigation.goBack()} />
        <View style={{ padding: theme.space.lg, gap: theme.space.md }}>
          <StatusBanner
            tone="warning"
            title="还没有已发布的三宝书"
            message="这个世界尚未完成构建与映射发布，无法创建战役。"
          />
          <Button label="返回" variant="secondary" onPress={() => navigation.goBack()} block />
        </View>
      </ScreenShell>
    );
  }

  const actorName = kind === 'canon'
    ? (setup?.canonCharacters.find(c => c.entityId === canonEntityId)?.name ?? (name.trim() || '无名旅人'))
    : name.trim() || '无名旅人';
  const locationLabel = setup?.locationOptions.find(option => option.locationId === locationId)?.name
    ?? (locationId ? '已选开局地点' : '');
  const quickSteps = ['身份与姓名', '确认开局'];
  const quickAnchorLabel = anchorEvent ? `序${anchorEvent.worldTimeOrder} · ${anchorEvent.title}` : '时间原点';

  function switchToAdvancedWizard() {
    setAdvancedWizard(true);
    setStep(0);
  }

  function toggleQuickAdvanced() {
    initializeQuickRecommendations();
    setQuickAdvancedOpen(value => !value);
  }

  function advanceQuickStep() {
    if (quickStep === 0) {
      initializeQuickRecommendations();
      setQuickStep(1);
    }
  }

  return (
    <ScreenShell bottom>
      <Header
        title={`开局 · ${title}`}
        subtitle={advancedWizard
          ? `${step + 1} / ${WIZARD_STEPS.length} 自定义 · ${WIZARD_STEPS[step]}`
          : `${quickStep + 1} / 2 ${quickSteps[quickStep]}`}
        onBack={() => {
          if (advancedWizard) {
            if (step > 0) setStep(step - 1);
            else setAdvancedWizard(false);
          } else if (quickStep > 0) setQuickStep(0);
          else navigation.goBack();
        }}
      />

      <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.md }}>
        <ProgressSteps
          steps={advancedWizard ? WIZARD_STEPS : quickSteps}
          current={advancedWizard ? step : quickStep}
          onStepPress={index => advancedWizard ? setStep(index) : setQuickStep(index)}
        />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={theme.space.sm} style={{ flex: 1 }}><ScrollView
        ref={planningScroll}
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl }}>
        {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}
        {planningPhase && !proposal ? <PlanningStatus phase={planningPhase} error={planningError ?? undefined} /> : null}
        {proposal ? (
          <CampaignProposalCard
            proposal={proposal}
            busy={busy}
            onStart={startAdventure}
            onRegenerate={discardPreparation}
            onEditIntent={discardPreparation} />
        ) : null}
        {planningPhase && !proposal && planningSetupId.current ? <View style={{ gap: theme.space.sm }}>
          {!busy ? <Button label="恢复已保存的规划" variant="secondary" onPress={resumePreparation} testID="campaign-resume-preparation" /> : null}
          {planningPhase === 'outcome_unknown' && profile && !busy ? <Button label="核对并确认关联重试" variant="secondary"
            onPress={requestUnknownReplayConfirmation} testID="campaign-confirm-unknown-replay" /> : null}
          <Button label="取消这次规划" variant="secondary" onPress={discardPreparation} testID="campaign-cancel-preparation" />
        </View> : null}
        {(!advancedWizard && quickStep === 1) || (advancedWizard && step === 3) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
          {(['short','medium','long'] as const).map(length => <Button key={length} label={length === 'short' ? '短篇冒险' : length === 'long' ? '长篇冒险' : '中篇冒险'}
            variant="chip" selected={lengthPreference === length} disabled={busy} onPress={() => setLengthPreference(length)} testID={`campaign-length-${length}`} />)}
        </View> : null}
        {setup && setup.locations.length === 0 ? (
          <View style={{ gap: theme.space.sm }}>
            <StatusBanner tone="warning" title="需要补齐原著开局资料"
              message={repairMessage ?? '旧世界包缺少可用地点或原著证据。可使用本地同一原著的完整资料；若没有，请选择原 TXT 重新构建。已有世界和存档会保留。'} />
            <Button label={busy ? '正在检查资料…' : '补齐开局资料'} onPress={repairOpening}
              disabled={busy} block testID="opening-repair" />
          </View>
        ) : null}

        {advancedWizard ? (
          <>
            {step === 0 ? (
              <StepWorldStart
                setup={setup}
                anchorEventId={anchorEventId}
                locationId={locationId}
                onSelectAnchor={setAnchorEventId}
                onSelectLocation={setLocationId}
              />
            ) : null}

            {step === 1 ? (
              <StepCharacter
                setup={setup}
                kind={kind}
                onKindChange={setKind}
                name={name}
                onNameChange={setName}
                points={points}
                onBump={bump}
                spentTotal={spentTotal}
                chosenSkills={chosenSkills}
                onToggleSkill={toggleSkill}
                canonEntityId={canonEntityId}
                onSelectCanon={setCanonEntityId}
              />
            ) : null}

            {step === 2 ? (
              <StepCompanions
                setup={setup}
                companions={companions}
                directives={companionDirectives}
                onToggle={toggleCompanion}
                onDirective={(entryId, directive) =>
                  setCompanionDirectives(previous => ({ ...previous, [entryId]: directive }))
                }
              />
            ) : null}

            {step === 3 ? (
              <StepConfirm
                worldTitle={title}
                setup={setup}
                anchorLabel={quickAnchorLabel}
                location={locationId}
                locationLabel={locationLabel}
                kind={kind}
                actorName={actorName}
                points={points}
                chosenSkills={chosenSkills}
                companions={companions}
                directives={companionDirectives}
                goal={goal}
                onGoalChange={setGoal}
                goalSuggestions={goalSuggestions}
                themeLabel={THEMES[themeId].label}
                busy={busy}
                canStart={advancedStartReady}
                onStart={create}
              />
            ) : null}
          </>
        ) : quickStep === 0 ? (
          <QuickOpeningIdentity
            setup={setup}
            kind={kind}
            onKindChange={nextKind => {
              setKind(nextKind);
              if (nextKind === 'canon' && setup?.canonCharacters[0]) {
                setCanonEntityId(setup.canonCharacters[0].entityId);
              }
            }}
            name={name}
            onNameChange={setName}
            canonEntityId={canonEntityId}
            onSelectCanon={setCanonEntityId}
            onAdvanced={switchToAdvancedWizard}
          />
        ) : (
          <QuickOpeningConfirm
            worldTitle={title}
            setup={setup}
            anchorLabel={quickAnchorLabel}
            locationLabel={locationLabel}
            kind={kind}
            actorName={actorName}
            characterDescription={characterDescription}
            onCharacterDescriptionChange={setCharacterDescription}
            goal={goal}
            onGoalChange={setGoal}
            goalSuggestions={goalSuggestions}
            loadout={quickAdvancedOpen ? { attributes: points as typeof recommendation.attributes, initialSkills: chosenSkills } : recommendation}
            companions={companions}
            directives={companionDirectives}
            onToggleCompanion={toggleCompanion}
            onDirective={(entryId, directive) =>
              setCompanionDirectives(previous => ({ ...previous, [entryId]: directive }))
            }
            advancedOpen={quickAdvancedOpen}
            onToggleAdvanced={toggleQuickAdvanced}
            advancedChildren={(
              <View style={{ gap: theme.space.md }}>
                <StepWorldStart
                  setup={setup}
                  anchorEventId={anchorEventId}
                  locationId={locationId}
                  onSelectAnchor={setAnchorEventId}
                  onSelectLocation={setLocationId}
                />
                {kind === 'original' ? (
                  <StepCharacter
                    setup={setup}
                    kind={kind}
                    onKindChange={setKind}
                    name={name}
                    onNameChange={setName}
                    points={points}
                    onBump={bump}
                    spentTotal={spentTotal}
                    chosenSkills={chosenSkills}
                    onToggleSkill={toggleSkill}
                    canonEntityId={canonEntityId}
                    onSelectCanon={setCanonEntityId}
                    showIdentityFields={false}
                  />
                ) : null}
              </View>
            )}
          />
        )}
      </ScrollView></KeyboardAvoidingView>

      {advancedWizard && step < WIZARD_STEPS.length - 1 ? (
        <View
          style={{
            flexDirection: 'row',
            gap: theme.space.sm,
            paddingHorizontal: theme.space.lg,
            paddingBottom: theme.space.md,
            paddingTop: theme.space.sm,
            borderTopWidth: theme.border.hairline,
            borderTopColor: theme.border.color,
            backgroundColor: theme.bg.base,
          }}>
          <Button
            label="上一步"
            variant="secondary"
            onPress={() => setStep(current => Math.max(0, current - 1))}
            disabled={step === 0}
            style={{ flex: 1 }}
          />
          <Button
            label="下一步"
            onPress={() => setStep(current => Math.min(WIZARD_STEPS.length - 1, current + 1))}
            disabled={!canAdvance}
            style={{ flex: 1 }}
            testID="opening-next"
          />
        </View>
      ) : null}

      {!advancedWizard ? (
        <View
          style={{
            flexDirection: 'row',
            gap: theme.space.sm,
            paddingHorizontal: theme.space.lg,
            paddingBottom: theme.space.md,
            paddingTop: theme.space.sm,
            borderTopWidth: theme.border.hairline,
            borderTopColor: theme.border.color,
            backgroundColor: theme.bg.base,
          }}>
          {quickStep === 1 ? (
            <Button
              label="上一步"
              variant="secondary"
              onPress={() => setQuickStep(0)}
              style={{ flex: 1 }}
            />
          ) : null}
          <Button
            label={quickStep === 0 ? '下一步' : busy ? '正在开始…' : '开始故事'}
            onPress={quickStep === 0 ? advanceQuickStep : create}
            disabled={quickStep === 0 ? !quickIdentityReady : busy || !quickStartReady || proposal !== null || planningPhase === 'preparing' || planningPhase === 'planning' || planningPhase === 'validating'}
            style={{ flex: 1 }}
            testID={quickStep === 0 ? 'opening-next' : 'quick-opening-start'}
          />
        </View>
      ) : null}
    </ScreenShell>
  );
}
