/**
 * WorldBooksPanel — 世界详情 · 三宝书 (plan §10.2).
 *
 * Two explicit modes, never mixed:
 *   · 玩家视图 (default) — player handbook / GM guide / monster manual filtered
 *     to public + discovered entries; GM entries never leave the store.
 *   · 编辑模式 — full data *with* hidden material, guarded by a standing
 *     warning banner, entry picker, visibility control and draft publishing.
 *
 * The view model, projection rules and draft/publish flow are the P2 ones; only
 * the presentation moved onto phase-3 components.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { assembleBook } from '../../../../../src/application/worldPackage/publish';
import type { BookSection, ContentEntry } from '../../../../../src/domain/content/types';
import {
  buildProvider,
  createSession,
  getCampaignState,
  getWorldBookProjection,
  loadWorldPackageDraft,
} from '../../../runtime';
import { getDatabaseRuntime } from '../../../database';
import { useAppSession } from '../../state/AppSessionContext';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { SectionHeader } from '../../components/SectionHeader';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusBanner } from '../../components/StatusBanner';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { WorldBooksEditor } from './WorldBooksEditor';

interface BookView {
  book: BookKey;
  bookTitle: string;
  groups: Array<{ title: string; entries: Array<{ id: string; name: string; text: string; provenance: string }> }>;
}

const BOOK_OPTIONS = [
  { value: 'player_handbook' as const, label: '玩家手册' },
  { value: 'gm_guide' as const, label: '城主指南' },
  { value: 'monster_manual' as const, label: '怪物图鉴' },
];

type BookKey = (typeof BOOK_OPTIONS)[number]['value'];
const BOOK_KEYS: readonly BookKey[] = BOOK_OPTIONS.map(option => option.value);

const MODE_OPTIONS = [
  { value: 'player' as const, label: '玩家视图' },
  { value: 'gm' as const, label: '编辑模式（含秘密）' },
];

const BOOK_TITLES: Record<BookKey, string> = {
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
  return BOOK_KEYS.map(book => ({
    book,
    bookTitle: BOOK_TITLES[book],
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

export function WorldBooksPanel(props: {
  worldId: string;
  campaignId?: string;
  branchId?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { profile } = useAppSession();
  const [mode, setMode] = useState<'player' | 'gm'>('player');
  const [activeBook, setActiveBook] = useState<BookKey>('player_handbook');
  const [books, setBooks] = useState<BookView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [discoveredEntryIds, setDiscoveredEntryIds] = useState<Set<string>>(new Set());
  const [packageEntries, setPackageEntries] = useState<ContentEntry[]>([]);
  const [baseEntries, setBaseEntries] = useState<ContentEntry[]>([]);
  const [packageSections, setPackageSections] = useState<BookSection[]>([]);
  const [packageRevision, setPackageRevision] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [contentInfo, setContentInfo] = useState<string | null>(null);

  const editMode = mode === 'gm';

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
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
          setLoading(false);
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
        if (!editMode) {
          const projection = await getWorldBookProjection({
            worldId: props.worldId,
            packageRevision: revision,
            ...(props.campaignId && props.branchId
              ? { campaignId: props.campaignId, branchId: props.branchId }
              : {}),
          });
          nextEntries = projection.entries;
          nextSections = projection.sections;
          setContentInfo(props.branchId
            ? `战役锁定 r${revision} · 内容增量 ${projection.contentVersion} 版 · ${projection.deltaCount} 包；仅显示当前时间锚点可见资料。`
            : '当前没有战役时间锚点；只显示无时间限制的公开资料。');
        } else {
          setContentInfo(null);
        }
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
              setDraftNotice('已保存的草稿无法读取，原发布版本仍安全保留。');
            }
          } else if (draft) {
            setDraftNotice(`发现基于 r${draft.baseRevision} 的旧草稿；当前发布版本是 r${revision}，需要人工核对后再编辑。`);
          }
        }
        setPackageEntries(nextEntries);
        setBaseEntries(pkg.entries);
        setPackageSections(nextSections);
        setPackageRevision(revision);
        setSelectedEntryId(current => {
          const found = nextEntries.find(entry => entry.entryId === current) ?? nextEntries[0] ?? null;
          return found?.entryId ?? null;
        });
        setBooks(assembleBookViews(nextEntries, nextSections, editMode, discoveries));
        setError(null);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.worldId, props.campaignId, props.branchId, editMode, profile]);

  const current = books.find(book => book.book === activeBook);
  const selectedEntry = packageEntries.find(entry => entry.entryId === selectedEntryId) ?? null;

  return (
    <View style={{ flex: 1, gap: theme.space.md }}>
      <SegmentedControl
        options={MODE_OPTIONS}
        value={mode}
        onChange={setMode}
        testID="books-mode"
      />
      {mode === 'player' ? (
        <StatusBanner
          tone="info"
          message={
            `${props.branchId
              ? `玩家视图：已按当前战役知识过滤（已发现 ${discoveredEntryIds.size} 项）。`
              : '玩家视图：没有关联战役时，未发现内容与主持人资料保持隐藏。'}${contentInfo ? ` ${contentInfo}` : ''} “未发现”只表示当前可见范围没有匹配，不据此断言原著不存在相关内容。`
          }
        />
      ) : (
        <StatusBanner
          tone="warning"
          title="⚠ 世界编辑模式"
          message="当前正在查看完整资料，其中可能包含主持人秘密。你的角色知识仍由游戏内记录决定。"
        />
      )}

      <SegmentedControl
        options={BOOK_OPTIONS}
        value={activeBook}
        onChange={setActiveBook}
        compact
        testID="books-tab"
      />

      {draftNotice ? <StatusBanner tone="warning" message={draftNotice} /> : null}
      {error ? <StatusBanner tone="error" title="三宝书未就绪" message={error} /> : null}

      <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl, gap: theme.space.md }}>
        {editMode && packageRevision !== null ? (
          <WorldBooksEditor
            worldId={props.worldId}
            baseRevision={packageRevision}
            entries={packageEntries}
            sections={packageSections}
            baseEntries={baseEntries}
            selectedEntry={selectedEntry}
            onSelectEntry={entry => setSelectedEntryId(entry.entryId)}
            onEntriesChanged={entries => {
              setPackageEntries(entries);
              setBooks(assembleBookViews(entries, packageSections, true, discoveredEntryIds));
            }}
            onPublished={() => setMode('player')}
          />
        ) : null}

        {current && current.groups.length > 0 ? (
          current.groups.map(group => (
            <Card key={group.title}>
              <SectionHeader
                title={group.title}
                subtitle={group.entries.length > 0 ? `${group.entries.length} 条` : '暂无可见条目'}
                divider={false}
              />
              {group.entries.map(entry => (
                <View
                  key={entry.id}
                  style={{
                    paddingVertical: theme.space.sm,
                    gap: theme.space.xs,
                    borderTopWidth: theme.border.hairline,
                    borderTopColor: theme.border.color,
                  }}>
                  <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, fontWeight: '700' }]}>
                    {entry.name}
                  </Text>
                  {entry.text ? (
                    <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
                      {entry.text}
                    </Text>
                  ) : null}
                  <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                    来源：{entry.provenance}
                  </Text>
                </View>
              ))}
            </Card>
          ))
        ) : null}

        {!loading && current && current.groups.length === 0 && !error ? (
          <EmptyState
            title="本节暂无可见条目"
            description={
              mode === 'player'
                ? '玩家视图只显示公开内容与已在战役中发现的内容。'
                : '该三宝书分类下没有条目。'
            }
          />
        ) : null}
        {loading ? (
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.text.muted }]}>加载中…</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
