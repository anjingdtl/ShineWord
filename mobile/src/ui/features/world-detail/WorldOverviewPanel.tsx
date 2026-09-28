/**
 * WorldOverviewPanel — 世界详情 · 资料 (plan §10.1).
 *
 * Shows the stored world facts (publication revision, ruleset version, builder
 * status, linked campaign) plus the world skin override and the campaign entry
 * point. No derived metric is invented here.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { worldBuildStatusLabel, worldStatusLine } from '../worldStatus';
import { WorldThemeOverrideCard } from './WorldThemeOverrideCard';
import type { WorldLibraryEntry, WorldPreparationView } from '../../../worldImport';

export interface WorldSetupSummary {
  packageRevision: number | null;
  rulesetVersion: string;
}

export function WorldOverviewPanel(props: {
  worldId: string;
  title: string;
  campaignId?: string;
  branchId?: string;
  setup: WorldSetupSummary | null;
  entry: WorldLibraryEntry | null;
  preparation: WorldPreparationView | null;
  refinementBusy: boolean;
  refinementMessage: string | null;
  onFullRefine: () => void;
  onCreateCampaign: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { setup, entry } = props;
  const preparation = props.preparation;
  const bookLabels = {
    player_handbook: '玩家手册',
    gm_guide: '城主指南',
    monster_manual: '怪物图鉴',
  } as const;
  const stateLabel = (book: NonNullable<typeof preparation>['books'][number]): string => {
    if (book.state === 'organized') return `已整理 · ${book.sourceEntryCount} 条原著关联资料`;
    if (book.state === 'unorganized') return '已发现资料，尚未整理到书中';
    return preparation?.fullSourceComplete
      ? '全文抽取与范围整理已完成；当前玩家视角没有可见条目'
      : '当前玩家视角未发现；未整理原文仍未知';
  };
  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <SectionHeader title={props.title} subtitle="世界资料概览" />
        <View style={{ gap: theme.space.xs }}>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
            三宝书：{setup?.packageRevision != null ? `已发布 r${setup.packageRevision}` : '尚未发布'}
          </Text>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
            规则版本：{setup?.rulesetVersion || '未知'}
          </Text>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
            构建状态：{entry ? worldStatusLine(entry) : '读取中…'}
          </Text>
          {entry && entry.packageRevision < 1 ? (
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              当前构建阶段：{worldBuildStatusLabel(entry.buildStatus)}（在书库重新导入同一文件可续建）
            </Text>
          ) : null}
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
            {props.campaignId
              ? `关联战役 ${props.campaignId}${props.branchId ? ` · 分支 ${props.branchId}` : ''}：三宝书按该战役已发现内容过滤。`
              : '暂无关联战役：三宝书按「未发现即隐藏」显示。'}
          </Text>
          {entry && entry.openReviewIssues > 0 ? (
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semantic.warn }]}>
              ▲ 待审核 {entry.openReviewIssues} 项（见「审查」页）。
            </Text>
          ) : null}
        </View>
        <View style={{ marginTop: theme.space.lg }}>
          <Button
            label="创建战役"
            onPress={props.onCreateCampaign}
            disabled={!setup || setup.packageRevision === null}
            block
            testID="world-create-campaign"
          />
        </View>
      </Card>

      <Card>
        <SectionHeader title="三宝书准备情况" subtitle="状态只表示当前可见资料范围" />
        {preparation ? (
          <View style={{ gap: theme.space.sm }}>
            {preparation.books.map(book => (
              <View key={book.book} style={{ gap: theme.space.xs }}>
                <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, fontWeight: '700' }]}>
                  {bookLabels[book.book]}：{stateLabel(book)}
                </Text>
                {book.state === 'unorganized' ? (
                  <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                    当前已抽取事实中有 {preparation.unmappedFactCount} 条尚未映射。
                  </Text>
                ) : null}
              </View>
            ))}
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              {preparation.sourceAvailable
                ? `本地原文 ${preparation.sourceChunkCount} 块 · 已抽取 ${preparation.extractedChunkCount} · 待处理 ${preparation.pendingChunkCount} · 失败 ${preparation.failedChunkCount}。`
                : '本机没有可继续读取的流式原文。'}
              {preparation.fullSourceComplete
                ? ' 全文抽取与范围发布校验已完成；此页仍按玩家可见范围显示。'
                : ' 当前是有界开局范围，不能据此断言原著未提及。'}
              {props.campaignId && preparation.latestPackageRevision !== preparation.packageRevision
                ? ` 世界当前最新包为 r${preparation.latestPackageRevision ?? '—'}；本战役仍固定使用 r${preparation.packageRevision}。`
                : ''}
            </Text>
            {props.refinementMessage ? (
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
                {props.refinementMessage}
              </Text>
            ) : null}
            {preparation.sourceAvailable && !preparation.latestFullSourceComplete ? (
              <View style={{ marginTop: theme.space.sm, gap: theme.space.xs }}>
                <Button
                  label={props.refinementBusy ? '全量精编进行中…' : '可选：全量精编三宝书'}
                  onPress={props.onFullRefine}
                  disabled={props.refinementBusy}
                  block
                  testID="world-full-refine"
                />
                <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                  会按当前手机模型预算逐组扫描全部本地原文，可能产生较多请求和等待；不会在开局时自动启动。
                  {props.campaignId ? '已创建战役继续锁定原包；全量包仅用于后续新战役。' : ''}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
            正在读取三书整理范围与原文处理进度…
          </Text>
        )}
      </Card>

      <WorldThemeOverrideCard worldId={props.worldId} />

      <Card>
        <SectionHeader title="这个世界的四个视图" />
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          资料 = 概览与主题；三宝书 = 玩家手册 / 城主指南 / 怪物图鉴（含编辑模式）；
          审查 = 冲突与映射裁定；世界包 = 导出可移植世界包 ZIP（不含小说原文）。
        </Text>
      </Card>
    </View>
  );
}
