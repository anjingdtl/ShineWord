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
import { ScrollView, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompanionDirective } from '../../../../src/domain/characters/card';
import { createCampaign } from '../../../../src/application/campaign/createCampaign';
import { buildProvider, createSession } from '../../runtime';
import { getDatabaseRuntime } from '../../database';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { ProgressSteps } from '../components/ProgressSteps';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { StepCharacter } from '../features/opening/StepCharacter';
import { StepCompanions } from '../features/opening/StepCompanions';
import { StepConfirm } from '../features/opening/StepConfirm';
import { StepWorldStart } from '../features/opening/StepWorldStart';
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

  const [step, setStep] = useState(0);
  const [setup, setSetup] = useState<OpeningWorldSetup | null>(null);
  const [name, setName] = useState('');
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noPackage, setNoPackage] = useState(false);

  useEffect(() => {
    if (!profile) return;
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

  useEffect(() => {
    if (!profile) return;
    const anchorOrder = setup?.anchorEvents.find(event => event.eventId === anchorEventId)?.worldTimeOrder;
    if (anchorOrder === undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const anchored = await session.getWorldSetup(worldId, anchorOrder);
        if (cancelled) return;
        setSetup(current => current ? { ...anchored, anchorEvents: current.anchorEvents } : anchored);
        if (!anchored.locations.includes(locationId) && anchored.locations[0]) setLocationId(anchored.locations[0]);
        setCompanions(current => current.filter(id => anchored.companionTemplates.some(template => template.entryId === id)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
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
  const characterReady = kind === 'canon' ? canonEntityId !== '' : chosenSkills.length > 0;
  const startReady = characterReady && setup?.packageRevision != null;
  const stepReady = [
    setup !== null && (setup.anchorEvents.length === 0 || anchorEventId !== '') && locationId !== '',
    characterReady,
    true,
    startReady,
  ];
  const canAdvance = stepReady[step] ?? false;

  async function create() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(profile, await buildProvider(profile));
      const selectedAnchor = setup?.anchorEvents.find(event => event.eventId === anchorEventId);
      const worldSetup = await session.getWorldSetup(worldId, selectedAnchor?.worldTimeOrder);
      if (worldSetup.packageRevision === null) throw new Error('世界包尚未发布。');
      if (worldSetup.locations.length === 0) throw new Error('这个世界没有可用的开局地点（场景条目缺失）。');
      const chosenLocation = locationId || worldSetup.locations[0];
      const anchor = worldSetup.anchorEvents.find(event => event.eventId === anchorEventId);
      if (setup?.anchorEvents.length && !anchor) throw new Error('开局锚点不在已发布原著事件中。');
      const invalidCompanion = companions.find(id => !worldSetup.companionTemplates.some(template => template.entryId === id));
      if (invalidCompanion) throw new Error(`所选同伴 ${invalidCompanion} 在当前开局锚点不可招募。`);
      const actorName = name.trim() || '无名旅人';
      const campaignId = `camp-${Date.now().toString(36)}`;
      const runtime = await getDatabaseRuntime();
      await createCampaign({
        db: runtime.db,
        worldStore: runtime.worldStore,
        campaignId,
        title: `${title} · ${actorName}`,
        worldId,
        packageRevision: worldSetup.packageRevision,
        anchor: {
          // The anchor is a REAL point in the story (G02), not a placeholder.
          worldTimeOrder: anchor?.worldTimeOrder ?? 1,
          anchorEventId: anchor?.eventId,
          locationId: chosenLocation,
        },
        protagonist: {
          actorId: 'actor-player',
          kind,
          name: kind === 'canon'
            ? (worldSetup.canonCharacters.find(c => c.entityId === canonEntityId)?.name ?? actorName)
            : actorName,
          ...(kind === 'original'
            ? {
                attributes: {
                  physique: points.physique,
                  agility: points.agility,
                  insight: points.insight,
                  knowledge: points.knowledge,
                  willpower: points.willpower,
                  social: points.social,
                },
                initialSkills: chosenSkills,
              }
            : { canonEntityId }),
        },
        companions: companions.map((templateId, index) => ({
          actorId: `actor-ally-${index + 1}`,
          templateId,
          directive: companionDirectives[templateId] ?? 'protect',
        })),
        goal: goal.trim() || '在开局锚点处开始一段冒险',
        createdAt: new Date().toISOString(),
      });
      // replace() keeps the wizard out of the back stack: Back from 游玩页
      // returns to the world/campaign context that started the wizard,
      // never to a finished wizard (plan §11.6).
      navigation.replace('Play', { campaignId, branchId: `${campaignId}-main` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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

  return (
    <ScreenShell bottom>
      <Header
        title={`开局 · ${title}`}
        subtitle={`${step + 1} / ${WIZARD_STEPS.length} ${WIZARD_STEPS[step]}`}
        onBack={() => (step > 0 ? setStep(step - 1) : navigation.goBack())}
      />

      <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.md }}>
        <ProgressSteps
          steps={WIZARD_STEPS}
          current={step}
          onStepPress={index => setStep(index)}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl }}>
        {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}

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
            anchorLabel={anchorEvent ? `序${anchorEvent.worldTimeOrder} · ${anchorEvent.title}` : '时间原点'}
            location={locationId}
            kind={kind}
            actorName={actorName}
            points={points}
            chosenSkills={chosenSkills}
            companions={companions}
            directives={companionDirectives}
            goal={goal}
            onGoalChange={setGoal}
            themeLabel={THEMES[themeId].label}
            busy={busy}
            canStart={startReady}
            onStart={create}
          />
        ) : null}
      </ScrollView>

      {step < WIZARD_STEPS.length - 1 ? (
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
    </ScreenShell>
  );
}