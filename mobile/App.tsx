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
  exportCampaignSave,
  getCampaignState,
  importCampaignSave,
  loadHistory,
  listReviewIssues,
  resolveReviewIssue,
  loadWorldPackageDraft,
  saveWorldPackageDraft,
  validateWorldPackageDraft,
  publishWorldPackageDraft,
  exportPortableWorldPackage,
  importPortableWorldPackageFile,
  type CampaignListItem,
  type CampaignPlayState,
  type EncounterView,
  type ReviewIssueView,
  type TurnView,
} from './src/runtime';
import { pickNovelFile, createExportFile, createExportBytesFile, writeExportFile, writeExportBytes } from './src/fileBridge';
import {
  buildWorldOnDevice,
  listWorlds,
  type WorldBuildProgress,
  type WorldLibraryEntry,
} from './src/worldImport';
import { assembleBook } from '../src/application/worldPackage/publish';
import type { BookSection, ContentEntry } from '../src/domain/content/types';
import type { CompanionDirective } from '../src/domain/characters/card';
import { createCampaign } from '../src/application/campaign/createCampaign';
import { getDatabaseRuntime } from './src/database';

type Screen =
  | { name: 'settings' }
  | { name: 'library' }
  | { name: 'books'; worldId: string; title: string; campaignId?: string; branchId?: string }
  | { name: 'opening'; worldId: string; title: string }
  | { name: 'play'; campaignId: string; branchId: string }
  | { name: 'review'; worldId: string; title: string };

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

function assembleBookViews(
  entries: ContentEntry[],
  sections: BookSection[],
  includeGm: boolean,
  discoveredEntryIds: Set<string>,
): BookView[] {
  return (['player_handbook', 'gm_guide', 'monster_manual'] as const).map(book => ({
    book,
    bookTitle: BOOK_TITLES[book] ?? book,
    groups: assembleBook({ entries, sections }, book, {
      includeGm,
      ...(includeGm ? {} : { knowledge: { discoveredEntryIds } }),
    }).map(group => ({
      title: group.section.title,
      entries: group.entries.map(entry => {
        const definition = entry.definition as { name?: string; text?: string; description?: string; title?: string };
        return {
          id: entry.entryId,
          name: definition.name ?? definition.title ?? entry.entryId,
          text: definition.text ?? definition.description ?? '',
          provenance: PROVENANCE_LABELS[entry.provenance.kind] ?? entry.provenance.kind,
        };
      }),
    })),
  }));
}

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
        onOpenBooks={(worldId, title, campaignId, branchId) => setScreen({ name: 'books', worldId, title, campaignId, branchId })}
        onOpenOpening={(worldId, title) => setScreen({ name: 'opening', worldId, title })}
        onOpenPlay={(campaignId, branchId) => setScreen({ name: 'play', campaignId, branchId })}
        onOpenReview={(worldId, title) => setScreen({ name: 'review', worldId, title })}
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
        campaignId={screen.campaignId}
        branchId={screen.branchId}
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
  if (screen.name === 'review') {
    return (
      <ReviewScreen
        worldId={screen.worldId}
        title={screen.title}
        onBack={() => setScreen({ name: 'library' })}
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
  onOpenBooks: (worldId: string, title: string, campaignId?: string, branchId?: string) => void;
  onOpenOpening: (worldId: string, title: string) => void;
  onOpenPlay: (campaignId: string, branchId: string) => void;
  onOpenReview: (worldId: string, title: string) => void;
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
        picked.base64,
      );
      setBuilt(
        summary.needsRetry
          ? `${summary.title}：抽取未完成（失败 ${summary.failedChunks} 块），未发布三宝书；再次导入同文件可续建。`
          : `${summary.title}：${summary.chapterCount} 章 · 实体 ${summary.entityCount} · 事实 ${summary.factCount}` +
            ` · 三宝书 r${summary.packageRevision}${summary.resumed ? '（续建完成）' : ''}` +
            (summary.reviewIssues > 0 ? ` · 待审核 ${summary.reviewIssues} 项` : ''),
      );
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

  async function importSave() {
    if (busy) return;
    setBusy(true);
    props.setError(null);
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      // Saves are UTF-8 JSON; decode the raw bytes before validation.
      const restored = await importCampaignSave(decodeUtf8(picked.bytes));
      setBuilt(`存档已导入为新的战役（${restored.campaignId}）。从「我的战役」中选择它继续游戏。`);
      await refresh();
    } catch (e) {
      props.setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importWorldPackage() {
    if (busy) return;
    setBusy(true);
    props.setError(null);
    try {
      const picked = await pickNovelFile();
      if (!picked) return;
      const imported = await importPortableWorldPackageFile(picked.bytes);
      setBuilt(`已导入世界包「${imported.title}」r${imported.revision}。包内不含小说原文，已校验并创建独立世界。`);
      await refresh();
    } catch (e) {
      props.setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportWorldPackage(worldId: string) {
    if (busy) return;
    setBusy(true);
    props.setError(null);
    try {
      const archive = await exportPortableWorldPackage(worldId);
      const uri = await createExportBytesFile(
        `shineword-${worldId}-r${archive.revision}.shineword-world.zip`,
        'application/zip',
      );
      if (!uri) return;
      await writeExportBytes(uri, archive.bytes);
      setBuilt(`已导出「${archive.title}」r${archive.revision} 世界包 ZIP。这个包包含三宝书与规则，不包含小说原文。`);
    } catch (e) {
      props.setError(e instanceof Error ? e.message : String(e));
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
        <TouchableOpacity style={styles.secondary} onPress={importSave} disabled={busy}>
          <Text style={styles.secondaryText}>导入存档（.shineword-save.json）</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={importWorldPackage} disabled={busy}>
          <Text style={styles.secondaryText}>导入世界包（.shineword-world.zip）</Text>
        </TouchableOpacity>
        {progress ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {progress.phase === 'importing' && '解析原文…'}
              {progress.phase === 'extracting' && '抽取与映射…'}
              {progress.phase === 'done' && '构建完成'}
              {progress.phase === 'failed' && '构建未完成'}
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
              <TouchableOpacity style={styles.secondary} onPress={() => {
                const activeBranch = campaigns.find(campaign => campaign.worldId === world.worldId);
                props.onOpenBooks(world.worldId, world.title, activeBranch?.campaignId, activeBranch?.branchId);
              }}>
                <Text style={styles.secondaryText}>三宝书</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => props.onOpenOpening(world.worldId, world.title)}>
                <Text style={styles.secondaryText}>创建战役</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => props.onOpenReview(world.worldId, world.title)}>
                <Text style={styles.secondaryText}>审核队列</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => exportWorldPackage(world.worldId)} disabled={busy}>
                <Text style={styles.secondaryText}>导出世界包 ZIP</Text>
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

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === undefined) break;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] ?? 0 & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | (((bytes[i + 1] ?? 0) & 0x3f) << 6) | ((bytes[i + 2] ?? 0) & 0x3f));
      i += 3;
    } else {
      const cp = ((b & 0x07) << 18) | (((bytes[i + 1] ?? 0) & 0x3f) << 12) | (((bytes[i + 2] ?? 0) & 0x3f) << 6) | ((bytes[i + 3] ?? 0) & 0x3f);
      const offset = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 4;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Books (三宝书阅读)：玩家视图按知识过滤；编辑模式独立进入
// ---------------------------------------------------------------------------

function BooksScreen(props: {
  profile: ApiProfile;
  worldId: string;
  title: string;
  campaignId?: string;
  branchId?: string;
  onBack: () => void;
}): React.JSX.Element {
  const [books, setBooks] = useState<BookView[]>([]);
  const [activeBook, setActiveBook] = useState<string>('player_handbook');
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [discoveredEntryIds, setDiscoveredEntryIds] = useState<Set<string>>(new Set());
  const [packageEntries, setPackageEntries] = useState<ContentEntry[]>([]);
  const [baseEntries, setBaseEntries] = useState<ContentEntry[]>([]);
  const [packageSections, setPackageSections] = useState<BookSection[]>([]);
  const [packageRevision, setPackageRevision] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [editorDefinition, setEditorDefinition] = useState('');
  const [editorVisibility, setEditorVisibility] = useState<ContentEntry['visibility']>('public');
  const [editorDiff, setEditorDiff] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(props.profile, await buildProvider(props.profile));
        const setup = await session.getWorldSetup(props.worldId);
        const campaignState = props.campaignId && props.branchId
          ? await getCampaignState(props.campaignId, props.branchId)
          : null;
        const packageRevision = editMode ? setup.packageRevision : campaignState?.packageRevision ?? setup.packageRevision;
        const discoveries = new Set(campaignState?.discoveredEntryIds ?? []);
        if (packageRevision === null) {
          setError('这个世界还没有已发布的三宝书。请先完成世界构建与映射。');
          return;
        }
        if (cancelled) return;
        setDiscoveredEntryIds(discoveries);
        // Assemble all three books from the same revision (single source).
        // The DEFAULT view is the player view: GM entries stay out and
        // discoverable entries stay hidden until an in-play discovery record
        // exists (A06). The full edit view is a separate explicit mode.
        const runtime = await getDatabaseRuntime();
        const pkg = await runtime.worldStore.getWorldPackage(props.worldId, packageRevision);
        if (!pkg || cancelled) return;
        let nextEntries = pkg.entries;
        let nextSections = pkg.sections;
        if (editMode) {
          const draft = await loadWorldPackageDraft(props.worldId);
          if (draft && draft.baseRevision === packageRevision) {
            try {
              const parsed = JSON.parse(draft.draftJson) as { entries?: ContentEntry[]; sections?: BookSection[] };
              if (Array.isArray(parsed.entries) && Array.isArray(parsed.sections)) {
                nextEntries = parsed.entries;
                nextSections = parsed.sections;
              }
            } catch {
              setEditorStatus('已保存的草稿无法读取，原发布版本仍安全保留。');
            }
          } else if (draft) {
            setEditorStatus(`发现基于 r${draft.baseRevision} 的旧草稿；当前发布版本是 r${packageRevision}，需要人工核对后再编辑。`);
          }
        }
        setPackageEntries(nextEntries);
        setBaseEntries(pkg.entries);
        setPackageSections(nextSections);
        setPackageRevision(packageRevision);
        const nextSelected = nextEntries.find(entry => entry.entryId === selectedEntryId) ?? nextEntries[0] ?? null;
        setSelectedEntryId(nextSelected?.entryId ?? null);
        if (nextSelected) {
          setEditorDefinition(JSON.stringify(nextSelected.definition, null, 2));
          setEditorVisibility(nextSelected.visibility);
        }
        setBooks(assembleBookViews(nextEntries, nextSections, editMode, discoveries));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.worldId, props.campaignId, props.branchId, editMode]);

  const current = books.find(book => book.book === activeBook);
  const selectedEntry = packageEntries.find(entry => entry.entryId === selectedEntryId) ?? null;

  function selectDraftEntry(entry: ContentEntry) {
    setSelectedEntryId(entry.entryId);
    setEditorDefinition(JSON.stringify(entry.definition, null, 2));
    setEditorVisibility(entry.visibility);
    setEditorDiff(null);
    setEditorStatus(null);
  }

  async function saveEntryDraft(publishAfterSave = false) {
    if (!selectedEntry || packageRevision === null) return;
    setEditorBusy(true);
    setEditorStatus(null);
    try {
      const definition = JSON.parse(editorDefinition) as unknown;
      if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
        throw new Error('条目定义必须是 JSON 对象。');
      }
      const nextEntries = packageEntries.map(entry => entry.entryId === selectedEntry.entryId
        ? { ...entry, definition, visibility: editorVisibility }
        : entry);
      const draft = { worldId: props.worldId, baseRevision: packageRevision, entries: nextEntries, sections: packageSections };
      await saveWorldPackageDraft(draft);
      setPackageEntries(nextEntries);
      setBooks(assembleBookViews(nextEntries, packageSections, editMode, discoveredEntryIds));
      const validation = validateWorldPackageDraft({ worldId: props.worldId, revision: packageRevision, entries: nextEntries, sections: packageSections });
      if (!publishAfterSave) {
        setEditorStatus(validation.ok
          ? `草稿已保存（基于 r${packageRevision}）；已通过结构验证，可检查差异或继续编辑。`
          : `草稿已保存；发现 ${validation.errors.length} 个验证错误，修复后才能发布。`);
        return;
      }
      if (!validation.ok) {
        setEditorStatus(`验证未通过，不能发布：\n${validation.errors.map(message => `• ${message}`).join('\n')}`);
        return;
      }
      const result = await publishWorldPackageDraft({ ...draft });
      setEditorStatus(`已发布不可变新版本 r${result.manifest.revision}（${result.manifest.contentHash.slice(0, 12)}…）。现有战役继续锁定原版本。`);
      setEditMode(false);
    } catch (e) {
      setEditorStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setEditorBusy(false);
    }
  }

  function showEntryDiff() {
    if (!selectedEntry) return;
    const before = baseEntries.find(entry => entry.entryId === selectedEntry.entryId);
    const after = packageEntries.find(entry => entry.entryId === selectedEntry.entryId);
    try {
      setEditorDiff(JSON.stringify({
        entryId: selectedEntry.entryId,
        before: before ? { visibility: before.visibility, definition: before.definition } : null,
        draft: after ? { visibility: editorVisibility, definition: JSON.parse(editorDefinition) } : null,
      }, null, 2));
    } catch (e) {
      setEditorStatus(e instanceof Error ? e.message : String(e));
    }
  }

  function validateDraft() {
    if (packageRevision === null || !selectedEntry) return;
    try {
      const definition = JSON.parse(editorDefinition) as unknown;
      const entries = packageEntries.map(entry => entry.entryId === selectedEntry.entryId
        ? { ...entry, definition, visibility: editorVisibility }
        : entry);
      const validation = validateWorldPackageDraft({ worldId: props.worldId, revision: packageRevision, entries, sections: packageSections });
      setEditorStatus(validation.ok
        ? `验证通过：${validation.entryCount} 个条目，${validation.warnings.length} 条提示。`
        : `验证失败：\n${validation.errors.map(message => `• ${message}`).join('\n')}`);
    } catch (e) {
      setEditorStatus(e instanceof Error ? e.message : String(e));
    }
  }

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
        <TouchableOpacity
          style={[styles.secondary, editMode && styles.secondaryActive]}
          onPress={() => setEditMode(previous => !previous)}>
          <Text style={styles.secondaryText}>{editMode ? '编辑模式（含全部资料）' : '切换编辑模式'}</Text>
        </TouchableOpacity>
      </View>
      {!editMode ? (
        <Text style={styles.muted}>
          {props.branchId
            ? `玩家视图：已按当前战役知识过滤（已发现 ${discoveredEntryIds.size} 项）。`
            : '玩家视图：当前没有关联战役，未发现内容与主持人资料已隐藏。'}
        </Text>
      ) : (
        <Text style={styles.danger}>编辑模式：显示完整资料（含秘密）。你的角色知识仍由游戏内记录决定。</Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView style={styles.scroll}>
        {editMode ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>世界编辑草稿 · 基于 r{packageRevision ?? '?'}</Text>
            <Text style={styles.muted}>修改只写入草稿。验证通过后发布不可变新版本；已运行战役继续使用锁定版本。</Text>
            <View style={styles.row}>
              {packageEntries.map(entry => (
                <TouchableOpacity
                  key={entry.entryId}
                  style={[styles.secondary, selectedEntryId === entry.entryId && styles.secondaryActive]}
                  onPress={() => selectDraftEntry(entry)}>
                  <Text style={styles.secondaryText}>{entry.entryId}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {selectedEntry ? (
              <>
                <Text style={styles.tag}>{selectedEntry.kind} · {selectedEntry.entryId}</Text>
                <TextInput
                  style={[styles.input, { minHeight: 170, textAlignVertical: 'top' }]}
                  value={editorDefinition}
                  onChangeText={setEditorDefinition}
                  editable={!editorBusy}
                  autoCapitalize="none"
                  multiline
                  placeholder="条目定义 JSON"
                  placeholderTextColor="#6f7b86"
                />
                <View style={styles.row}>
                  {(['public', 'discoverable', 'gm'] as const).map(visibility => (
                    <TouchableOpacity
                      key={visibility}
                      style={[styles.secondary, editorVisibility === visibility && styles.secondaryActive]}
                      onPress={() => setEditorVisibility(visibility)}>
                      <Text style={styles.secondaryText}>{visibility}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.secondary} onPress={showEntryDiff} disabled={editorBusy}>
                    <Text style={styles.secondaryText}>检查差异</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondary} onPress={() => saveEntryDraft(false)} disabled={editorBusy}>
                    <Text style={styles.secondaryText}>{editorBusy ? '保存中…' : '保存草稿并验证'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondary} onPress={validateDraft} disabled={editorBusy}>
                    <Text style={styles.secondaryText}>验证当前草稿</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primary} onPress={() => saveEntryDraft(true)} disabled={editorBusy}>
                    <Text style={styles.primaryText}>验证并发布新版本</Text>
                  </TouchableOpacity>
                </View>
                {editorStatus ? <Text style={editorStatus.includes('失败') || editorStatus.includes('错误') ? styles.error : styles.resumed}>{editorStatus}</Text> : null}
                {editorDiff ? <Text style={styles.bodyText}>{editorDiff}</Text> : null}
              </>
            ) : <Text style={styles.muted}>当前世界包没有可编辑条目。</Text>}
          </View>
        ) : null}
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
// Review queue (审核队列，P2-5 / G05)
// ---------------------------------------------------------------------------

function ReviewScreen(props: { worldId: string; title: string; onBack: () => void }): React.JSX.Element {
  const [issues, setIssues] = useState<ReviewIssueView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIssues(await listReviewIssues(props.worldId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.worldId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function resolve(issueId: string, resolution: 'resolved' | 'waived') {
    setError(null);
    try {
      await resolveReviewIssue(props.worldId, issueId, resolution);
      setNotice(`已${resolution === 'waived' ? '豁免' : '解决'} ${issueId}。重新构建/映射后将以新版本发布。`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <Header title={`${props.title} · 审核队列`} subtitle="冲突与映射问题在此裁定" onBack={props.onBack} />
      <ScrollView style={styles.scroll}>
        {issues.length === 0 ? <Text style={styles.muted}>没有待处理的审核问题。</Text> : null}
        {issues.map(issue => (
          <View key={issue.issueId} style={styles.card}>
            <Text style={styles.cardTitle}>
              {issue.severity === 'blocking' ? '⛔ ' : issue.severity === 'major' ? '⚠️ ' : '· '}
              {issue.issueId}（{issue.kind}）
            </Text>
            <Text style={styles.bodyText}>{issue.detailJson.slice(0, 300)}</Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.secondary} onPress={() => resolve(issue.issueId, 'resolved')}>
                <Text style={styles.secondaryText}>按事实解决</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => resolve(issue.issueId, 'waived')}>
                <Text style={styles.secondaryText}>豁免并允许发布</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {notice ? <Text style={styles.resumed}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Opening wizard (开局向导，G02)
// ---------------------------------------------------------------------------

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
}

function OpeningScreen(props: {
  profile: ApiProfile;
  worldId: string;
  title: string;
  onBack: () => void;
  onCreated: (campaignId: string, branchId: string) => void;
}): React.JSX.Element {
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
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(props.profile, await buildProvider(props.profile));
        const worldSetup = await session.getWorldSetup(props.worldId);
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

  function toggleCompanion(entryId: string) {
    setCompanions(previous => {
      if (previous.includes(entryId)) return previous.filter(id => id !== entryId);
      if (previous.length >= 2) return previous; // plan default: at most 2 companions
      return [...previous, entryId];
    });
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
      const worldSetup = await session.getWorldSetup(props.worldId);
      if (worldSetup.packageRevision === null) throw new Error('世界包尚未发布。');
      if (worldSetup.locations.length === 0) throw new Error('这个世界没有可用的开局地点（场景条目缺失）。');
      const chosenLocation = locationId || worldSetup.locations[0];
      const anchorEvent = worldSetup.anchorEvents.find(event => event.eventId === anchorEventId);
      const actorName = name.trim() || '无名旅人';
      const campaignId = `camp-${Date.now().toString(36)}`;
      const runtime = await getDatabaseRuntime();
      await createCampaign({
        db: runtime.db,
        worldStore: runtime.worldStore,
        campaignId,
        title: `${props.title} · ${actorName}`,
        worldId: props.worldId,
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
      props.onCreated(campaignId, `${campaignId}-main`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const anchorEvent = setup?.anchorEvents.find(event => event.eventId === anchorEventId);
  return (
    <SafeAreaView style={styles.page}>
      <Header title={`开局 · ${props.title}`} subtitle="时间地点 → 角色 → 同伴 → 确认开局" onBack={props.onBack} />
      {noPackage ? (
        <View style={styles.card}>
          <Text style={styles.bodyText}>这个世界还没有已发布的三宝书。请先在世界构建中完成映射与发布。</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll}>
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
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Play (剧情页 + 遭遇面板 + 存档导出)
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
  const [encounter, setEncounter] = useState<EncounterView | null>(null);
  const [encounterTemplates, setEncounterTemplates] = useState<Array<{ entryId: string; name: string }>>([]);
  const [encounterTemplateId, setEncounterTemplateId] = useState<string>('');

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

  // Kill-process recovery: an ACTIVE encounter restores its panel on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(props.profile, await buildProvider(props.profile));
        const active = await session.getActiveEncounter(props.campaignId, props.branchId);
        if (!cancelled && active) setEncounter(active);
      } catch {
        // No encounter or a transient read error: the panel simply stays closed.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.campaignId, props.branchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(props.profile, await buildProvider(props.profile));
        const setup = await session.getWorldSetup(state?.worldId ?? '');
        if (!cancelled && setup.companionTemplates.length > 0) {
          setEncounterTemplates(setup.companionTemplates.map(t => ({ entryId: t.entryId, name: t.name })));
          setEncounterTemplateId(prev => prev || setup.companionTemplates[0].entryId);
        }
      } catch {
        // Encounter templates are optional; ignore load failures here.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.worldId]);

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
      setNotice(`已从版本 ${result.stateVersion} 创建分支 ${result.branchId}（回到书架后可继续游玩该分支）`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function trainSkill(skillId: string) {
    if (!state?.playerCard) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
      // The engine queries REAL training conditions (stamina, rank, policy);
      // the UI no longer asserts them (P2 acceptance A02).
      const result = await session.trainSkill({
        campaignId: props.campaignId,
        branchId: props.branchId,
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
      const { json } = await exportCampaignSave(props.campaignId, props.branchId);
      const uri = await createExportFile(`shineword-${props.campaignId}-${props.branchId}.shineword-save.json`);
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
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(props.profile, await buildProvider(props.profile));
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
    return `${props.branchId.slice(-16)}:${version}:${actorId.slice(-16)}:${action}:${subject.slice(-16)}`;
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
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity onPress={props.onBack}>
          <Text style={styles.link}>← 书架</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.titleSmall}>{state?.title ?? props.campaignId}</Text>
          <Text style={styles.muted}>
            {state ? `v${state.stateVersion} · ${state.locationId} · 世界钟 ${Math.round(state.clockMinutes)} 分` : '加载中…'}
          </Text>
        </View>
      </View>

      {encounter && encounter.status === 'active' ? (
        <View style={styles.encounterCard}>
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
                      campaignId: props.campaignId, branchId: props.branchId,
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
                      campaignId: props.campaignId, branchId: props.branchId,
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
                    campaignId: props.campaignId, branchId: props.branchId, encounterId: encounter.encounterId,
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
                      campaignId: props.campaignId, branchId: props.branchId,
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
                  campaignId: props.campaignId, branchId: props.branchId, encounterId: encounter.encounterId,
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
                  campaignId: props.campaignId, branchId: props.branchId,
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
                  campaignId: props.campaignId, branchId: props.branchId,
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
                campaignId: props.campaignId, branchId: props.branchId, encounterId: encounter.encounterId,
                requestId: combatRequestId('retreat'),
              }))}>
              <Text style={styles.secondaryText}>撤退</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : encounter ? (
        <View style={styles.encounterCard}>
          <Text style={styles.cardTitle}>战斗结束（{encounter.status === 'resolved' ? '胜利' : encounter.status === 'escaped' ? '撤离' : '溃败'}）</Text>
          {encounter.lastAction ? <Text style={styles.bodyText}>{encounter.lastAction}</Text> : null}
        </View>
      ) : encounterTemplates.length > 0 ? (
        <View style={styles.encounterCard}>
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
              campaignId: props.campaignId, branchId: props.branchId,
              hostiles: [{ templateId: encounterTemplateId, count: 1 }],
              requestId: combatRequestId('begin', encounterTemplateId),
            }))}>
            <Text style={styles.secondaryText}>进入遭遇</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
            <TouchableOpacity key={skillId} onPress={() => trainSkill(skillId)} disabled={busy}>
              <Text style={styles.tag}>{skillId}·{rank}（训练）</Text>
            </TouchableOpacity>
          ))}
          {state.cards.filter(card => card.controller === 'companion').map(card => (
            <Text key={card.actorId} style={styles.dice}>同伴:{card.name}</Text>
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
  danger: { color: '#ffce7a', fontSize: 12, lineHeight: 19, marginTop: 4 },
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
  encounterCard: {
    backgroundColor: '#13203a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
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
