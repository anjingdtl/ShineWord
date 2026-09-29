/**
 * WorldBooksEditor — the GM edit surface of 三宝书 (plan §10.2).
 *
 * The editor still speaks raw entry JSON (the plan explicitly keeps the JSON
 * editor for this phase) but now uses theme components: a multiline
 * `TextField`, an entry picker, a visibility `SegmentedControl`, an explicit
 * diff panel, a publish-risk hint and `StatusBanner` feedback.
 *
 * Write path unchanged: draft -> validate -> publish immutable revision.
 */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { BookSection, ContentEntry } from '../../../../../src/domain/content/types';
import {
  publishWorldPackageDraft,
  saveWorldPackageDraft,
  validateWorldPackageDraft,
} from '../../../runtime';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { SectionHeader } from '../../components/SectionHeader';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusBanner, type StatusTone } from '../../components/StatusBanner';
import { TextField } from '../../components/TextField';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

const VISIBILITY_OPTIONS = [
  { value: 'public' as const, label: 'public' },
  { value: 'discoverable' as const, label: 'discoverable' },
  { value: 'gm' as const, label: 'gm' },
];

interface EditorStatus {
  tone: StatusTone;
  message: string;
}

export function WorldBooksEditor(props: {
  worldId: string;
  baseRevision: number;
  /** Entries of the currently loaded revision (or draft). */
  entries: ContentEntry[];
  sections: BookSection[];
  /** Published entries, used as the "before" side of the diff. */
  baseEntries: ContentEntry[];
  selectedEntry: ContentEntry | null;
  onSelectEntry: (entry: ContentEntry) => void;
  onEntriesChanged: (entries: ContentEntry[]) => void;
  /** Called after a successful publish so the panel can reload the books. */
  onPublished: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const selectedId = props.selectedEntry?.entryId ?? null;
  const [definition, setDefinition] = useState(
    props.selectedEntry ? JSON.stringify(props.selectedEntry.definition, null, 2) : '',
  );
  const [visibility, setVisibility] = useState<ContentEntry['visibility']>(
    props.selectedEntry?.visibility ?? 'public',
  );
  const [diff, setDiff] = useState<string | null>(null);
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form only when a *different* entry is selected; a draft save must
  // not wipe the editor's status line.
  useEffect(() => {
    const entry = props.selectedEntry;
    setDefinition(entry ? JSON.stringify(entry.definition, null, 2) : '');
    setVisibility(entry?.visibility ?? 'public');
    setDiff(null);
    setStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /** Rebuilds the entry list with the editor's current definition/visibility. */
  function withEditedEntry(): { entries: ContentEntry[]; parsed: unknown } {
    const entry = props.selectedEntry;
    if (!entry) throw new Error('请先选择一个条目。');
    const parsed = JSON.parse(definition) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('条目定义必须是 JSON 对象。');
    }
    return {
      parsed,
      entries: props.entries.map(item =>
        item.entryId === entry.entryId ? { ...item, definition: parsed, visibility } : item,
      ),
    };
  }

  async function persist(publishAfterSave: boolean) {
    if (!props.selectedEntry) return;
    setBusy(true);
    setStatus(null);
    try {
      const { entries, parsed } = withEditedEntry();
      const draft = {
        worldId: props.worldId,
        baseRevision: props.baseRevision,
        entries,
        sections: props.sections,
      };
      await saveWorldPackageDraft(draft);
      props.onEntriesChanged(entries);
      const validation = validateWorldPackageDraft({
        worldId: props.worldId,
        revision: props.baseRevision,
        entries,
        sections: props.sections,
      });
      if (!publishAfterSave) {
        setStatus(
          validation.ok
            ? {
                tone: 'success',
                message: `草稿已保存（基于 r${props.baseRevision}）；已通过结构验证，可检查差异或继续编辑。`,
              }
            : {
                tone: 'error',
                message: `草稿已保存；发现 ${validation.errors.length} 个验证错误，修复后才能发布。`,
              },
        );
        return;
      }
      if (!validation.ok) {
        setStatus({
          tone: 'error',
          message: `验证未通过，不能发布：\n${validation.errors.map(message => `• ${message}`).join('\n')}`,
        });
        return;
      }
      const result = await publishWorldPackageDraft({ ...draft });
      setStatus({
        tone: 'success',
        message: `已发布不可变新版本 r${result.manifest.revision}（${result.manifest.contentHash.slice(0, 12)}…）。现有战役继续锁定原版本。`,
      });
      // Keep the parsed definition in sync even though the panel reloads.
      setDefinition(JSON.stringify(parsed, null, 2));
      props.onPublished();
    } catch (e) {
      setStatus({ tone: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  function validateDraft() {
    if (!props.selectedEntry) return;
    try {
      const { entries } = withEditedEntry();
      const validation = validateWorldPackageDraft({
        worldId: props.worldId,
        revision: props.baseRevision,
        entries,
        sections: props.sections,
      });
      setStatus(
        validation.ok
          ? {
              tone: 'success',
              message: `验证通过：${validation.entryCount} 个条目，${validation.warnings.length} 条提示。`,
            }
          : {
              tone: 'error',
              message: `验证失败：\n${validation.errors.map(message => `• ${message}`).join('\n')}`,
            },
      );
    } catch (e) {
      setStatus({ tone: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function showDiff() {
    const entry = props.selectedEntry;
    if (!entry) return;
    try {
      const parsed = JSON.parse(definition) as unknown;
      const before = props.baseEntries.find(item => item.entryId === entry.entryId);
      setDiff(
        JSON.stringify(
          {
            entryId: entry.entryId,
            before: before ? { visibility: before.visibility, definition: before.definition } : null,
            draft: { visibility, definition: parsed },
          },
          null,
          2,
        ),
      );
      setStatus(null);
    } catch (e) {
      setStatus({ tone: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <Card>
      <SectionHeader
        title={`世界编辑草稿 · 基于 r${props.baseRevision}`}
        subtitle="修改只写入草稿；发布后生成不可变新版本，已运行战役继续使用锁定版本。"
      />
      <View style={[styles.wrap, { gap: theme.space.sm }]}>
        {props.entries.map(entry => (
          <Button
            key={entry.entryId}
            label={entry.entryId}
            variant="chip"
            selected={selectedId === entry.entryId}
            onPress={() => props.onSelectEntry(entry)}
            testID={`book-entry-${entry.entryId}`}
          />
        ))}
      </View>

      {props.selectedEntry ? (
        <View style={{ gap: theme.space.md, marginTop: theme.space.md }}>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
            {props.selectedEntry.kind} · {props.selectedEntry.entryId}
          </Text>
          <TextField
            label="条目定义（JSON）"
            value={definition}
            onChangeText={setDefinition}
            multiline
            minLines={9}
            monospace
            disabled={busy}
            autoCapitalize="none"
            autoCorrect={false}
            testID="book-editor-definition"
          />
          <View style={{ gap: theme.space.xs }}>
            <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
              可见性
            </Text>
            <SegmentedControl
              options={VISIBILITY_OPTIONS}
              value={visibility}
              onChange={setVisibility}
              disabled={busy}
              testID="book-editor-visibility"
            />
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              public = 所有玩家可见；discoverable = 战役内发现后解锁；gm = 仅编辑模式可见。
            </Text>
          </View>

          <View style={[styles.wrap, { gap: theme.space.sm }]}>
            <Button label="检查差异" variant="secondary" onPress={showDiff} disabled={busy} />
            <Button
              label={busy ? '保存中…' : '保存草稿并验证'}
              variant="secondary"
              onPress={() => persist(false)}
              disabled={busy}
              testID="book-editor-save-draft"
            />
            <Button label="验证当前草稿" variant="secondary" onPress={validateDraft} disabled={busy} />
            <Button
              label="验证并发布新版本"
              onPress={() => persist(true)}
              disabled={busy}
              testID="book-editor-publish"
            />
          </View>

          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semanticText.warn }]}>
            ▲ 发布风险：新版本会立即成为该世界的最新三宝书；已有战役仍锁定创建时的旧版本。
          </Text>

          {status ? <StatusBanner tone={status.tone} message={status.message} /> : null}

          {diff ? (
            <View
              style={{
                borderWidth: theme.border.hairline,
                borderColor: theme.border.color,
                borderRadius: theme.radius.md,
                padding: theme.space.md,
                backgroundColor: theme.bg.overlay,
              }}>
              <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
                差异（发布版本 → 草稿）
              </Text>
              <Text
                style={[
                  typeStyle(theme, theme.type.caption),
                  { color: theme.onRaised.primary, fontFamily: theme.font.numeric, marginTop: theme.space.sm },
                ]}>
                {diff}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          当前世界包没有可编辑条目。
        </Text>
      )}
    </Card>
  );
}

const styles = {
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' } as const,
};