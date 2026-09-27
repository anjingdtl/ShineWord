import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ApiProfile } from '../src/application/llm/types';
import { loadApiProfile, saveApiProfile } from './src/profileStore';
import { KeychainSecretStore } from './src/secureKeyStore';
import {
  buildProvider,
  createSession,
  getCampaignState,
  loadHistory,
  type CampaignListItem,
  type CampaignPlayState,
  type TurnView,
} from './src/runtime';
import { pickNovelFile } from './src/fileBridge';
import {
  buildWorldOnDevice,
  listWorlds,
  type WorldBuildProgress,
  type WorldLibraryEntry,
} from './src/worldImport';
import { assembleBook } from '../src/application/worldPackage/publish';
import { createCampaign } from '../src/application/campaign/createCampaign';
import { getDatabaseRuntime } from './src/database';

type Screen =
  | { name: 'settings' }
  | { name: 'library' }
  | { name: 'books'; worldId: string; title: string }
  | { name: 'opening'; worldId: string; title: string }
  | { name: 'play'; campaignId: string; branchId: string };

interface BookView {
  book: string;
  bookTitle: string;
  groups: Array<{ title: string; entries: Array<{ id: string; name: string; text: string; provenance: string }> }>;
}

const BOOK_TITLES: Record<string, string> = {
  player_handbook: '玩家手册',
  gm_guide: '城主指南',
  monster_manual: '怪物图鉴',
};

const PROVENANCE_LABELS: Record<string, string> = {
  explicit: '原文',
  inferred: '归纳',
  rule_mapping: '规则映射',
  design_fill: '设计补全',
  user_override: '用户设定',
};

export default function App(): React.JSX.Element {
  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadApiProfile();
        if (!cancelled && saved) setProfile(saved);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>正在初始化 ShineWord…</Text>
      </SafeAreaView>
    );
  }
  if (!profile || screen.name === 'settings') {
    return (
      <SettingsScreen
        profile={profile}
        onSaved={savedProfile => {
          setProfile(savedProfile);
          setScreen({ name: 'library' });
        }}
      />
    );
  }
  if (screen.name === 'library') {
    return (
      <LibraryScreen
        profile={profile}
        error={error}
        setError={setError}
        busy={busy}
        setBusy={setBusy}
        onOpenBooks={(worldId, title) => setScreen({ name: 'books', worldId, title })}
        onOpenOpening={(worldId, title) => setScreen({ name: 'opening', worldId, title })}
        onOpenPlay={(campaignId, branchId) => setScreen({ name: 'play', campaignId, branchId })}
        onOpenSettings={() => setScreen({ name: 'settings' })}
      />
    );
  }
  if (screen.name === 'books') {
    return (
      <BooksScreen
        profile={profile}
        worldId={screen.worldId}
        title={screen.title}
        onBack={() => setScreen({ name: 'library' })}
      />
    );
  }
  if (screen.name === 'opening') {
    return (
      <OpeningScreen
        profile={profile}
        worldId={screen.worldId}
        title={screen.title}
        onBack={() => setScreen({ name: 'library' })}
        onCreated={(campaignId, branchId) => setScreen({ name: 'play', campaignId, branchId })}
      />
    );
  }
  return (
    <PlayScreen
      profile={profile}
      campaignId={screen.campaignId}
      branchId={screen.branchId}
      onBack={() => setScreen({ name: 'library' })}
    />
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsScreen(props: {
  profile: ApiProfile | null;
  onSaved: (profile: ApiProfile) => void;
}): React.JSX.Element {
  const [endpoint, setEndpoint] = useState(props.profile?.endpoint ?? '');
  const [model, setModel] = useState(props.profile?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveApiProfile({ endpoint, model });
      const trimmedKey = apiKey.trim();
      const keyStore = new KeychainSecretStore();
      if (trimmedKey) {
        await keyStore.set(saved.keyRef, trimmedKey);
        setApiKey('');
      } else {
        const existing = await keyStore.get(saved.keyRef);
        if (!existing) throw new Error('请输入 API Key（将只写入系统 Keychain）。');
      }
      props.onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <Text style={styles.title}>ShineWord</Text>
      <Text style={styles.subtitle}>小说三宝书 · 单人跑团战役</Text>
      <TextInput
        style={styles.input}
        value={endpoint}
        onChangeText={setEndpoint}
        autoCapitalize="none"
        placeholder="OpenAI-compatible endpoint"
        placeholderTextColor="#6f7b86"
      />
      <TextInput
        style={styles.input}
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        placeholder="模型名称"
        placeholderTextColor="#6f7b86"
      />
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
        secureTextEntry
        placeholder="API Key（仅写入系统 Keychain）"
        placeholderTextColor="#6f7b86"
      />
      <TouchableOpacity style={styles.primary} onPress={save} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? '保存中…' : '保存并进入书架'}</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Library (世界书架)
// ---------------------------------------------------------------------------

function LibraryScreen(props: {
  profile: ApiProfile;
  error: string | null;
  setError: (e: string | null) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onOpenBooks: (worldId: string, title: string) => void;
  onOpenOpening: (worldId: string, title: string) => void;
  onOpenPlay: (campaignId: string, branchId: string) => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const { profile, busy, setBusy } = props;
  const [worlds, setWorlds] = useState<WorldLibraryEntry[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<WorldBuildProgress | null>(null);
  const [built, setBuilt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWorlds(await listWorlds());
      const session = await createSession(profile, await buildProvider(profile));
      const campaignList = await session.listCampaigns();
      // Every branch of every campaign is playable (rewind creates branches;
      // the bookshelf lists them all instead of only the main branch).
      const withBranches: CampaignListItem[] = [];
      for (const campaign of campaignList) {
        const branches = await session.listBranches(campaign.campaignId);
        for (const branch of branches) {
          withBranches.push({ ...campaign, branchId: branch.branchId });
        }
      }
      setCampaigns(withBranches);
    } catch (e) {
      props.setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function importAndBuild() {
    if (busy) return;
    setBusy(true);
    props.setError(null);
    setBuilt(null);
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      const summary = await buildWorldOnDevice(
        picked.bytes,
        picked.name.replace(/\.txt$/i, ''),
        profile,
        p => {
          setProgress(p);
          if (p.phase === 'extracting') setPreview(p.message ?? null);
        },
      );
      setBuilt(`${summary.title}：${summary.chapterCount} 章 · 实体 ${summary.entityCount} · 事实 ${summary.factCount}${summary.resumed ? '（续建完成）' : ''}`);
      await refresh();
    } catch (e) {
      const detail = e instanceof Error
        ? `${e.message}
${e.stack ?? ''}`
        : typeof e === 'object' && e !== null
          ? JSON.stringify(e)
          : String(e);
      setProgress({ phase: 'failed', message: detail.slice(0, 500) });
      props.setError(detail.slice(0, 300));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <Header title="世界书架" subtitle="导入小说 → 三宝书 → 开局" onSettings={props.onOpenSettings} />
      <ScrollView style={styles.scroll}>
        <TouchableOpacity style={styles.primary} onPress={importAndBuild} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? '构建中…' : '导入小说 TXT 并构建三宝书'}</Text>
        </TouchableOpacity>
        {progress ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {progress.phase === 'importing' && '解析原文…'}
              {progress.phase === 'extracting' && '抽取与映射…'}
              {progress.phase === 'done' && '构建完成'}
              {progress.phase === 'failed' && '构建失败'}
            </Text>
            {progress.message ? <Text style={styles.bodyText}>{progress.message}</Text> : null}
          </View>
        ) : null}
        {preview ? <View style={styles.card}><Text style={styles.bodyText}>{preview}</Text></View> : null}
        {built ? <View style={styles.card}><Text style={styles.bodyText}>{built}</Text></View> : null}

        <Text style={styles.sectionTitle}>已导入小说</Text>
        {worlds.length === 0 ? <Text style={styles.muted}>还没有小说。点击上方按钮导入。</Text> : null}
        {worlds.map(world => (
          <View key={world.worldId} style={styles.card}>
            <Text style={styles.cardTitle}>{world.title}</Text>
            <Text style={styles.muted}>构建状态 {world.buildStatus} · SHA {world.sourceSha256.slice(0, 10)}…</Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.secondary} onPress={() => props.onOpenBooks(world.worldId, world.title)}>
                <Text style={styles.secondaryText}>三宝书</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => props.onOpenOpening(world.worldId, world.title)}>
                <Text style={styles.secondaryText}>创建战役</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>我的战役</Text>
        {campaigns.length === 0 ? <Text style={styles.muted}>还没有战役。在小说下选择「创建战役」。</Text> : null}
        {campaigns.map(campaign => (
          <TouchableOpacity
            key={`${campaign.campaignId}:${campaign.branchId}`}
            style={styles.card}
            onPress={() => props.onOpenPlay(campaign.campaignId, campaign.branchId ?? `${campaign.campaignId}-main`)}>
            <Text style={styles.cardTitle}>{campaign.title}</Text>
            <Text style={styles.muted}>{campaign.branchId} · {campaign.status}</Text>
          </TouchableOpacity>
        ))}
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Books (三宝书阅读)
// ---------------------------------------------------------------------------

function BooksScreen(props: {
  profile: ApiProfile;
  worldId: string;
  title: string;
  onBack: () => void;
}): React.JSX.Element {
  const [books, setBooks] = useState<BookView[]>([]);
  const [activeBook, setActiveBook] = useState<string>('player_handbook');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(props.profile, await buildProvider(props.profile));
        const setup = await session.getWorldSetup(props.worldId);
        if (setup.packageRevision === null) {
          setError('这个世界还没有已发布的三宝书。请先完成世界构建与映射。');
          return;
        }
        // Assemble all three books from the same revision (single source).
        const runtime = await getDatabaseRuntime();
        const pkg = await runtime.worldStore.getWorldPackage(props.worldId, setup.packageRevision);
        if (!pkg || cancelled) return;
        const views: BookView[] = (['player_handbook', 'gm_guide', 'monster_manual'] as const).map(book => ({
          book,
          bookTitle: BOOK_TITLES[book] ?? book,
          groups: assembleBook(pkg, book, { includeGm: true }).map(group => ({
            title: group.section.title,
            entries: group.entries.map(entry => {
              const def = entry.definition as { name?: string; text?: string; description?: string; title?: string };
              return {
                id: entry.entryId,
                name: def.name ?? def.title ?? entry.entryId,
                text: def.text ?? def.description ?? '',
                provenance: PROVENANCE_LABELS[entry.provenance.kind] ?? entry.provenance.kind,
              };
            }),
          })),
        }));
        setBooks(views);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.worldId]);

  const current = books.find(book => book.book === activeBook);
  return (
    <SafeAreaView style={styles.page}>
      <Header title={`${props.title} · 三宝书`} subtitle="同一世界包的三个视图" onBack={props.onBack} />
      <View style={styles.row}>
        {books.map(book => (
          <TouchableOpacity
            key={book.book}
            style={[styles.secondary, activeBook === book.book && styles.secondaryActive]}
            onPress={() => setActiveBook(book.book)}>
            <Text style={styles.secondaryText}>{book.bookTitle}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView style={styles.scroll}>
        {current?.groups.map(group => (
          <View key={group.title} style={styles.card}>
            <Text style={styles.cardTitle}>{group.title}</Text>
            {group.entries.map(entry => (
              <View key={entry.id} style={styles.entryBox}>
                <Text style={styles.entryName}>{entry.name}</Text>
                {entry.text ? <Text style={styles.bodyText}>{entry.text}</Text> : null}
                <Text style={styles.tag}>来源：{entry.provenance}</Text>
              </View>
            ))}
          </View>
        ))}
        {books.length === 0 && !error ? <Text style={styles.muted}>加载中…</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Opening wizard (开局向导)
// ---------------------------------------------------------------------------

const ATTRIBUTES: Array<{ key: string; label: string }> = [
  { key: 'physique', label: '体魄' },
  { key: 'agility', label: '敏捷' },
  { key: 'insight', label: '洞察' },
  { key: 'knowledge', label: '学识' },
  { key: 'willpower', label: '意志' },
  { key: 'social', label: '交涉' },
];

function OpeningScreen(props: {
  profile: ApiProfile;
  worldId: string;
  title: string;
  onBack: () => void;
  onCreated: (campaignId: string, branchId: string) => void;
}): React.JSX.Element {
  const [skills, setSkills] = useState<Array<{ entryId: string; name: string; attribute: string; allowUntrained: boolean }>>([]);
  const [lore, setLore] = useState<Array<{ name: string; text: string }>>([]);
  const [name, setName] = useState('');
  const [points, setPoints] = useState<Record<string, number>>({
    physique: 1, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1,
  });
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const [goal, setGoal] = useState('在开局锚点处开始一段冒险');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noPackage, setNoPackage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(props.profile, await buildProvider(props.profile));
        const setup = await session.getWorldSetup(props.worldId);
        if (cancelled) return;
        if (setup.packageRevision === null) {
          setNoPackage(true);
          return;
        }
        setSkills(setup.skills);
        setLore(setup.lore);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.worldId]);

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

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
      const setup = await session.getWorldSetup(props.worldId);
      if (setup.packageRevision === null) throw new Error('世界包尚未发布。');
      const actorName = name.trim() || '无名旅人';
      const campaignId = `camp-${Date.now().toString(36)}`;
      const runtime = await getDatabaseRuntime();
      await createCampaign({
        db: runtime.db,
        worldStore: runtime.worldStore,
        campaignId,
        title: `${props.title} · ${actorName}`,
        worldId: props.worldId,
        packageRevision: setup.packageRevision,
        anchor: { worldTimeOrder: 1, locationId: 'opening-anchor' },
        protagonist: {
          actorId: 'actor-player',
          kind: 'original',
          name: actorName,
          attributes: {
            physique: points.physique,
            agility: points.agility,
            insight: points.insight,
            knowledge: points.knowledge,
            willpower: points.willpower,
            social: points.social,
          },
          initialSkills: chosenSkills,
        },
        goal: goal.trim(),
        createdAt: new Date().toISOString(),
      });
      props.onCreated(campaignId, `${campaignId}-main`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <Header title={`开局 · ${props.title}`} subtitle="分配属性 → 选 3 项技能 → 确认开局" onBack={props.onBack} />
      {noPackage ? (
        <View style={styles.card}>
          <Text style={styles.bodyText}>这个世界还没有已发布的三宝书。请先在世界构建中完成映射与发布。</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll}>
          {lore.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>世界概览</Text>
              {lore.slice(0, 5).map(item => (
                <Text key={item.name} style={styles.bodyText}>· {item.name}: {item.text}</Text>
              ))}
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>角色卡</Text>
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
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>初始技能（选 3 项，入门 d6）</Text>
            {skills.map(skill => (
              <TouchableOpacity key={skill.entryId} style={styles.row} onPress={() => toggleSkill(skill.entryId)}>
                <Text style={chosenSkills.includes(skill.entryId) ? styles.entryName : styles.bodyText}>
                  {chosenSkills.includes(skill.entryId) ? '☑' : '☐'} {skill.name}
                </Text>
                <Text style={styles.muted}>（允许无训练尝试：{skill.allowUntrained ? '是' : '否'}）</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>主目标</Text>
            <TextInput style={styles.input} value={goal} onChangeText={setGoal} multiline />
          </View>

          <TouchableOpacity style={styles.primary} onPress={create} disabled={busy || chosenSkills.length === 0}>
            <Text style={styles.primaryText}>{busy ? '创建中…' : '确认开局（锁定世界包与规则版本）'}</Text>
          </TouchableOpacity>
          {chosenSkills.length === 0 ? <Text style={styles.muted}>至少选择 1 项初始技能。</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Play (剧情页)
// ---------------------------------------------------------------------------

function PlayScreen(props: {
  profile: ApiProfile;
  campaignId: string;
  branchId: string;
  onBack: () => void;
}): React.JSX.Element {
  const [state, setState] = useState<CampaignPlayState | null>(null);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getCampaignState(props.campaignId, props.branchId));
      setTurns(await loadHistory(props.branchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.campaignId, props.branchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit() {
    if (!intent.trim() || busy) return;
    const value = intent.trim();
    setIntent('');
    setBusy(true);
    setError(null);
    setNotice('拟定检定…');
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
      const result = await session.playTurn({
        campaignId: props.campaignId,
        branchId: props.branchId,
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

  async function rest(kind: 'short' | 'long') {
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
      const result = await session.rest({ campaignId: props.campaignId, branchId: props.branchId, kind });
      setNotice(kind === 'short' ? `短休完成（推进 ${Math.round(result.clockSecondsAdvanced / 60)} 分钟）` : `长休完成（推进 ${Math.round(result.clockSecondsAdvanced / 3600)} 小时）`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rewind() {
    if (!state) return;
    const target = state.stateVersion - 1;
    if (target < 0) {
      setError('还没有可回退的历史版本。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
      const newBranchId = `${props.campaignId}-b${Date.now().toString(36)}`;
      const result = await session.rewind({
        campaignId: props.campaignId,
        sourceBranchId: props.branchId,
        atStateVersion: target,
        newBranchId,
      });
      setNotice(`已从版本 ${result.stateVersion} 创建分支 ${result.branchId}`);
      props.onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function trainStealth() {
    if (!state?.playerCard) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
      const skillId = Object.keys(state.playerCard.skills)[0];
      if (!skillId) {
        setNotice('角色还没有可训练的技能。');
        return;
      }
      const result = await session.trainSkill({
        campaignId: props.campaignId,
        branchId: props.branchId,
        actorId: state.playerCard.actorId,
        skillId,
        conditions: { hasSource: true, hasResources: true, meetsPrerequisites: true },
      });
      setNotice(result.advanced ? `训练完成：${skillId} 提升至 ${result.nextRank}` : '未达到训练条件。');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={props.onBack}>
          <Text style={styles.link}>← 书架</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.titleSmall}>{state?.title ?? props.campaignId}</Text>
          <Text style={styles.muted}>
            {state ? `v${state.stateVersion} · ${state.locationId} · 世界钟 ${state.clockMinutes} 分` : '加载中…'}
          </Text>
        </View>
      </View>

      <FlatList
        style={styles.story}
        data={turns}
        keyExtractor={item => item.turnId}
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

      {state?.playerCard ? (
        <View style={styles.row}>
          {Object.entries(state.playerCard.skills).map(([skillId, rank]) => (
            <Text key={skillId} style={styles.tag}>{skillId}·{rank}</Text>
          ))}
          <Text style={styles.tag}>
            HP {state.playerResources.hp ?? '?'} · 体力 {state.playerResources.stamina ?? '?'}
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
        <TouchableOpacity style={styles.secondary} onPress={trainStealth} disabled={busy}>
          <Text style={styles.secondaryText}>训练</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={rewind} disabled={busy}>
          <Text style={styles.secondaryText}>回退</Text>
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
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function Header(props: { title: string; subtitle?: string; onBack?: () => void; onSettings?: () => void }): React.JSX.Element {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.titleSmall}>{props.title}</Text>
        {props.subtitle ? <Text style={styles.muted}>{props.subtitle}</Text> : null}
      </View>
      {props.onBack ? (
        <TouchableOpacity onPress={props.onBack}>
          <Text style={styles.link}>返回</Text>
        </TouchableOpacity>
      ) : null}
      {props.onSettings ? (
        <TouchableOpacity onPress={props.onSettings}>
          <Text style={styles.link}>设置</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#08141f', padding: 18 },
  center: {
    flex: 1,
    backgroundColor: '#08141f',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: '700' },
  titleSmall: { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#8ea1b2', fontSize: 13, marginTop: 4, marginBottom: 18 },
  sectionTitle: { color: '#d9a441', fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  muted: { color: '#8ea1b2', fontSize: 12, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderColor: '#263a4d',
    backgroundColor: '#0e2030',
    color: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  primary: {
    backgroundColor: '#d9a441',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: '#101820', fontWeight: '700' },
  secondary: {
    borderWidth: 1,
    borderColor: '#3b5568',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginTop: 4,
  },
  secondaryActive: { borderColor: '#d9a441' },
  secondaryText: { color: '#d9a441', fontWeight: '600', fontSize: 13 },
  error: { color: '#ff9b9b', marginTop: 10, lineHeight: 20 },
  link: { color: '#d9a441', fontWeight: '600' },
  story: { flex: 1 },
  card: {
    backgroundColor: '#0e2030',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { color: '#d9a441', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  dice: { color: '#91b6d7', fontSize: 12, marginBottom: 8 },
  bodyText: { color: '#e6edf3', fontSize: 15, lineHeight: 23 },
  resumed: { color: '#79c99e', fontSize: 11, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginVertical: 4, flexWrap: 'wrap' },
  attrLabel: { color: '#e6edf3', width: 48, fontSize: 14 },
  attrValue: { color: '#d9a441', width: 36, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  step: {
    borderWidth: 1,
    borderColor: '#3b5568',
    borderRadius: 8,
    width: 34,
    alignItems: 'center',
    paddingVertical: 4,
    marginHorizontal: 6,
  },
  entryBox: { borderTopWidth: 1, borderTopColor: '#1d3247', paddingVertical: 8 },
  entryName: { color: '#f1f5f9', fontWeight: '700', fontSize: 14 },
  tag: { color: '#79c99e', fontSize: 11, marginRight: 8, marginTop: 4 },
  composer: { paddingTop: 10 },
  composerInput: { minHeight: 62, maxHeight: 120 },
});
