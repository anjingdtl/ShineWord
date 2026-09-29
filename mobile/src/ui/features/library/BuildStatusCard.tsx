/**
 * BuildStatusCard — the live import / extraction / mapping state of the current
 * build (plan §7.4).
 *
 * Only values that actually exist are rendered: the progress phase, its
 * message, the real chunk counter when the extractor reports one, and the
 * summary counters returned by `buildWorldOnDevice` (chapters, entities,
 * facts, package revision, review issues). No fabricated percentage or ETA.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar } from '../../components/Bar';
import { Card } from '../../components/Card';
import { StatusBanner } from '../../components/StatusBanner';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import type { BuiltWorldSummary, WorldBuildProgress } from '../../../worldImport';

const PHASE_TITLE: Record<WorldBuildProgress['phase'], string> = {
  importing: '解析原文',
  extracting: '抽取与映射',
  done: '构建完成',
  failed: '构建未完成',
};

export function BuildStatusCard(props: {
  progress: WorldBuildProgress;
  /** Last finished build's real counters; null while none exists. */
  summary: BuiltWorldSummary | null;
  /** Latest extraction line reported by the world builder. */
  preview: string | null;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { progress, summary } = props;
  const total = progress.chunksTotal ?? 0;
  const done = progress.chunksDone ?? 0;

  const facts: string[] = [];
  if (summary) {
    facts.push(`章节 ${summary.chapterCount}`);
    facts.push(`实体 ${summary.entityCount}`);
    facts.push(`事实 ${summary.factCount}`);
    if (summary.packageRevision > 0) facts.push(`三宝书 r${summary.packageRevision}`);
    if (summary.reviewIssues > 0) facts.push(`待审核 ${summary.reviewIssues} 项`);
  }

  return (
    <Card>
      <View style={[styles.head, { gap: theme.space.sm }]}>
        <Text style={[typeStyle(theme, theme.type.heading), { color: theme.onRaised.primary }]}>
          {PHASE_TITLE[progress.phase]}
        </Text>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          构建任务
        </Text>
      </View>

      {total > 0 ? (
        <View style={{ marginTop: theme.space.sm }}>
          <Bar ratio={done / total} label="文本块" valueText={`${done} / ${total}`} />
        </View>
      ) : null}

      {progress.message ? (
        <Text
          style={[
            typeStyle(theme, theme.type.small),
            { color: theme.onRaised.secondary, marginTop: theme.space.xs },
          ]}>
          {progress.message}
        </Text>
      ) : null}
      {props.preview && props.preview !== progress.message ? (
        <Text
          style={[
            typeStyle(theme, theme.type.caption),
            { color: theme.onRaised.secondary, marginTop: theme.space.xs },
          ]}>
          {props.preview}
        </Text>
      ) : null}

      {facts.length > 0 ? (
        <Text
          style={[
            typeStyle(theme, theme.type.caption),
            { color: theme.onRaised.primary, marginTop: theme.space.sm },
          ]}>
          {facts.join(' · ')}
        </Text>
      ) : null}

      {summary?.needsRetry ? (
        <View style={{ marginTop: theme.space.sm }}>
          <StatusBanner
            tone="warning"
            title="抽取未完成"
            message={`仍有 ${summary.failedChunks} 个文本块失败，未发布三宝书；再次导入同一文件可续建。`}
          />
        </View>
      ) : null}
      {summary?.resumed ? (
        <Text
          style={[
            typeStyle(theme, theme.type.caption),
            { color: theme.semanticText.good, marginTop: theme.space.sm },
          ]}>
          ✓ 本次为续建（复用已完成的文本块）
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
});