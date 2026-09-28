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
import type { WorldLibraryEntry } from '../../../worldImport';

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
  onCreateCampaign: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { setup, entry } = props;
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