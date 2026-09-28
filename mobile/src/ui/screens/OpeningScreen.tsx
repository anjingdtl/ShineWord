/**
 * 开局向导 — full-screen stack page (plan §2: 沉浸流程, no tabs).
 *
 * Ported verbatim from App.tsx's `OpeningScreen`; the only changes are the
 * themed page frame/header and navigation (`onBack` → `goBack`, `onCreated` →
 * `replace('Play')` so the wizard leaves no dead entry in the back stack).
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompanionDirective } from '../../../../src/domain/characters/card';
import { createCampaign } from '../../../../src/application/campaign/createCampaign';
import { buildProvider, createSession } from '../../runtime';
import { getDatabaseRuntime } from '../../database';
import { Header } from '../components/Header';
import { ScreenShell } from '../components/ScreenShell';
import { useTheme } from '../theme/ThemeContext';
import { useAppSession } from '../state/AppSessionContext';
import type { RootStackParamList } from '../navigation/types';
import { styles } from './legacyStyles';

const ATTRIBUTES: Array<{ key: string; label: string }> = [
  { key: 'physique', label: '体魄' },
  { key: 'agility', label: '敏捷' },
  { key: 'insight', label: '洞察' },
  { key: 'knowledge', label: '学识' },
  { key: 'willpower', label: '意志' },
  { key: 'social', label: '交涉' },
];

interface WorldSetup {
  packageRevision: number | null;
  rulesetVersion: string;
  skills: Array<{ entryId: string; name: string; attribute: string; allowUntrained: boolean }>;
  lore: Array<{ name: string; text: string }>;
  anchorEvents: Array<{ eventId: string; title: string; summary: string; worldTimeOrder: number }>;
  locations: string[];
  canonCharacters: Array<{ entityId: string; name: string }>;
  companionTemplates: Array<{ entryId: string; name: string; description: string }>;
  encounterTemplates: Array<{ entryId: string; name: string }>;
}

export function OpeningScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAppSession();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Opening'>>();
  const { worldId, title } = route.params;

  const [setup, setSetup] = useState<WorldSetup | null>(null);
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

  const spentTotal = ATTRIBUTES.reduce((sum, attr) => sum + (points[attr.key] - 1), 0);

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
      const anchorEvent = worldSetup.anchorEvents.find(event => event.eventId === anchorEventId);
      if (setup?.anchorEvents.length && !anchorEvent) throw new Error('开局锚点不在已发布原著事件中。');
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
          worldTimeOrder: anchorEvent?.worldTimeOrder ?? 1,
          anchorEventId: anchorEvent?.eventId,
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
      navigation.replace('Play', { campaignId, branchId: `${campaignId}-main` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const anchorEvent = setup?.anchorEvents.find(event => event.eventId === anchorEventId);
  return (
    <ScreenShell bottom>
      <Header
        title={`开局 · ${title}`}
        subtitle="时间地点 → 角色 → 同伴 → 确认开局"
        onBack={() => navigation.goBack()}
      />
      {noPackage ? (
        <View style={{ padding: theme.space.lg }}>
          <View style={styles.card}>
            <Text style={styles.bodyText}>这个世界还没有已发布的三宝书。请先在世界构建中完成映射与发布。</Text>
          </View>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={{ padding: theme.space.lg }}>
          {setup ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>开局时间点（原著走向）</Text>
              {setup.anchorEvents.length === 0 ? (
                <Text style={styles.muted}>这个世界没有原著事件锚点，将从时间原点开始。</Text>
              ) : (
                setup.anchorEvents.map(event => (
                  <TouchableOpacity key={event.eventId} style={styles.row} onPress={() => setAnchorEventId(event.eventId)}>
                    <Text style={anchorEventId === event.eventId ? styles.entryName : styles.bodyText}>
                      {anchorEventId === event.eventId ? '☑' : '☐'} 序{event.worldTimeOrder} · {event.title}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
              {anchorEvent ? <Text style={styles.muted}>{anchorEvent.summary.slice(0, 120)}</Text> : null}
              <Text style={styles.cardTitle}>开局地点</Text>
              {setup.locations.length === 0 ? (
                <Text style={styles.danger}>世界包缺少场景地点条目。</Text>
              ) : (
                setup.locations.slice(0, 12).map(location => (
                  <TouchableOpacity key={location} style={styles.row} onPress={() => setLocationId(location)}>
                    <Text style={locationId === location ? styles.entryName : styles.bodyText}>
                      {locationId === location ? '☑' : '☐'} {location}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          ) : (
            <Text style={styles.muted}>加载世界资料…</Text>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>角色类型</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.secondary, kind === 'original' && styles.secondaryActive]}
                onPress={() => setKind('original')}>
                <Text style={styles.secondaryText}>原创角色</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondary, kind === 'canon' && styles.secondaryActive]}
                onPress={() => setKind('canon')}>
                <Text style={styles.secondaryText}>原著角色</Text>
              </TouchableOpacity>
            </View>
            {kind === 'canon' ? (
              setup && setup.canonCharacters.length > 0 ? (
                setup.canonCharacters.slice(0, 20).map(character => (
                  <TouchableOpacity key={character.entityId} style={styles.row} onPress={() => setCanonEntityId(character.entityId)}>
                    <Text style={canonEntityId === character.entityId ? styles.entryName : styles.bodyText}>
                      {canonEntityId === character.entityId ? '☑' : '☐'} {character.name}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.danger}>这个世界没有可扮演的原著人物记录。</Text>
              )
            ) : (
              <View>
                <Text style={styles.muted}>原著角色按锚点前的证据推导属性与技能；强角色可作为高难度开局。</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="角色姓名（原创角色）"
                  placeholderTextColor="#6f7b86"
                />
                <Text style={styles.muted}>自由属性点：已用 {spentTotal}/4（每项 1~3）</Text>
                {ATTRIBUTES.map(attr => (
                  <View key={attr.key} style={styles.row}>
                    <Text style={styles.attrLabel}>{attr.label}</Text>
                    <TouchableOpacity style={styles.step} onPress={() => bump(attr.key, -1)}>
                      <Text style={styles.secondaryText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.attrValue}>{points[attr.key]}</Text>
                    <TouchableOpacity style={styles.step} onPress={() => bump(attr.key, 1)}>
                      <Text style={styles.secondaryText}>+</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <Text style={styles.cardTitle}>初始技能（选 3 项，入门 d6）</Text>
                {setup?.skills.map(skill => (
                  <TouchableOpacity key={skill.entryId} style={styles.row} onPress={() => toggleSkill(skill.entryId)}>
                    <Text style={chosenSkills.includes(skill.entryId) ? styles.entryName : styles.bodyText}>
                      {chosenSkills.includes(skill.entryId) ? '☑' : '☐'} {skill.name}
                    </Text>
                    <Text style={styles.muted}>（允许无训练尝试：{skill.allowUntrained ? '是' : '否'}）</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {setup && setup.companionTemplates.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>同伴（最多 2 名）</Text>
              {setup.companionTemplates.map(template => (
                <View key={template.entryId}>
                  <TouchableOpacity style={styles.row} onPress={() => toggleCompanion(template.entryId)}>
                    <Text style={companions.includes(template.entryId) ? styles.entryName : styles.bodyText}>
                      {companions.includes(template.entryId) ? '☑' : '☐'} {template.name}
                    </Text>
                  </TouchableOpacity>
                  {companions.includes(template.entryId) ? (
                    <View style={styles.row}>
                      {([
                        ['follow', '跟随'], ['support', '支援'], ['protect', '保护'], ['conserve', '节省资源'], ['retreat', '撤退'],
                      ] as Array<[CompanionDirective, string]>).map(([directive, label]) => (
                        <TouchableOpacity key={directive} style={styles.step}
                          onPress={() => setCompanionDirectives(previous => ({ ...previous, [template.entryId]: directive }))}>
                          <Text style={(companionDirectives[template.entryId] ?? 'protect') === directive ? styles.entryName : styles.muted}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>主目标</Text>
            <TextInput
              style={styles.input}
              value={goal}
              onChangeText={setGoal}
              multiline
              placeholder="这次冒险要达成什么？"
              placeholderTextColor="#6f7b86"
            />
          </View>

          <TouchableOpacity
            style={styles.primary}
            onPress={create}
            disabled={busy || (kind === 'original' && chosenSkills.length === 0) || (kind === 'canon' && !canonEntityId)}>
            <Text style={styles.primaryText}>
              {busy ? '创建中…' : `确认开局（锁定世界包 r${setup?.packageRevision ?? '?'} · 规则 ${setup?.rulesetVersion || 'V0.2'}）`}
            </Text>
          </TouchableOpacity>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </ScreenShell>
  );
}
