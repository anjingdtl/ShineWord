/**
 * 三宝书 sub-tab of the world detail screen.
 *
 * Ported verbatim from App.tsx's `BooksScreen` (P2 is a move, not a redesign):
 * same view model, same player-vs-edit projection rules, same draft/publish
 * flow. Only the page frame and back navigation were removed — the parent
 * screen owns those now.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { assembleBook } from '../../../../src/application/worldPackage/publish';
import type { BookSection, ContentEntry } from '../../../../src/domain/content/types';
import {
  buildProvider,
  createSession,
  getCampaignState,
  loadWorldPackageDraft,
  publishWorldPackageDraft,
  saveWorldPackageDraft,
  validateWorldPackageDraft,
} from '../../runtime';
import { getDatabaseRuntime } from '../../database';
import { useAppSession } from '../state/AppSessionContext';
import { styles } from './legacyStyles';

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

export function WorldDetailBooks(props: {
  worldId: string;
  campaignId?: string;
  branchId?: string;
}): React.JSX.Element {
  const { profile } = useAppSession();
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
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await createSession(profile, await buildProvider(profile));
        const setup = await session.getWorldSetup(props.worldId);
        const campaignState = props.campaignId && props.branchId
          ? await getCampaignState(props.campaignId, props.branchId)
          : null;
        const revision = editMode ? setup.packageRevision : campaignState?.packageRevision ?? setup.packageRevision;
        const discoveries = new Set(campaignState?.discoveredEntryIds ?? []);
        if (revision === null) {
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
        const pkg = await runtime.worldStore.getWorldPackage(props.worldId, revision);
        if (!pkg || cancelled) return;
        let nextEntries = pkg.entries;
        let nextSections = pkg.sections;
        if (editMode) {
          const draft = await loadWorldPackageDraft(props.worldId);
          if (draft && draft.baseRevision === revision) {
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
            setEditorStatus(`发现基于 r${draft.baseRevision} 的旧草稿；当前发布版本是 r${revision}，需要人工核对后再编辑。`);
          }
        }
        setPackageEntries(nextEntries);
        setBaseEntries(pkg.entries);
        setPackageSections(nextSections);
        setPackageRevision(revision);
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
  }, [props.worldId, props.campaignId, props.branchId, editMode, profile]);

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
    <>
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
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }}>
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
    </>
  );
}
