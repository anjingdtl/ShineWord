/**
 * P9 opening proposal card (plan §13): shows the REAL generation phase and,
 * when ready, the player-safe proposal (goal, pitch, tone, first-stage
 * problem). Placeholder/failed states are honest — a proposal that did not
 * pass local gates can never be started here.
 */
import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { StatusBanner } from '../../components/StatusBanner';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import type { ProposalView } from '../../../campaignPlanning';

const PHASE_ORDER = ['preparing', 'planning', 'validating', 'ready'] as const;
const PHASE_LABELS: Record<string, string> = {
  preparing: '准备相关资料',
  planning: '规划冒险',
  validating: '校验可玩性',
  ready: '已准备好',
  failed: '提案未能生成',
  outcome_unknown: '云端结果未知',
};

export function PlanningStatus({ phase, error }: { phase: string; error?: string }): React.JSX.Element {
  const { theme } = useTheme();
  const pending = phase === 'preparing' || phase === 'planning' || phase === 'validating';
  const currentIndex = PHASE_ORDER.indexOf(phase as typeof PHASE_ORDER[number]);
  return (
    <View
      testID="campaign-planning-status"
      style={{ padding: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1,
        borderColor: theme.border.color, backgroundColor: theme.bg.raised, gap: theme.space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        {pending ? <ActivityIndicator size="small" /> : null}
        <Text style={typeStyle(theme, theme.type.title)}>{pending ? '正在准备这次冒险' : PHASE_LABELS[phase] ?? phase}</Text>
      </View>
      <View style={{ gap: 4 }}>
        {PHASE_ORDER.map(key => {
          const stepIndex = PHASE_ORDER.indexOf(key);
          const state = !pending && phase !== 'ready' ? 'pending'
            : stepIndex < currentIndex || phase === 'ready' ? 'done'
            : stepIndex === currentIndex ? 'active' : 'pending';
          const marker = state === 'done' ? '✓' : state === 'active' ? '•' : '·';
          return (
            <View key={key} style={{ flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' }}>
              <Text style={[typeStyle(theme, theme.type.body), { color: state === 'active' ? theme.text.primary : theme.text.secondary }]}>{marker}</Text>
              <Text style={[typeStyle(theme, theme.type.body), { opacity: state === 'pending' ? 0.5 : 1 }]}>{PHASE_LABELS[key]}</Text>
            </View>
          );
        })}
      </View>
      {phase === 'failed' ? (
        <StatusBanner tone="error" title="提案校验未通过" message={error ?? '生成的内容没有通过本地可玩性检查。'} />
      ) : null}
      {phase === 'outcome_unknown' ? (
        <StatusBanner tone="warning" title="云端结果未知" message={error ?? '请求结果未知，可能已经计费；不会自动重发。'} />
      ) : null}
    </View>
  );
}

export function CampaignProposalCard(props: {
  proposal: ProposalView;
  busy: boolean;
  onStart: () => void;
  onRegenerate: () => void;
  onEditIntent: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      testID="campaign-proposal-card"
      style={{ padding: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1,
        borderColor: theme.border.colorStrong, backgroundColor: theme.bg.raised, gap: theme.space.sm }}>
      <Text style={typeStyle(theme, theme.type.title)}>这次冒险</Text>
      <ProposalRow label="核心目标" value={props.proposal.longTermGoal} />
      <ProposalRow label="故事基调" value={`${props.proposal.tone} · ${lengthLabel(props.proposal.lengthPreference)}`} />
      <ProposalRow label="冒险引子" value={props.proposal.publicPitch} multiline />
      {props.proposal.firstStageObjective ? (
        <ProposalRow label="第一个问题" value={`${props.proposal.firstStageTitle}：${props.proposal.firstStageObjective}`} multiline />
      ) : null}
      <View style={{ marginTop: theme.space.xs, gap: theme.space.sm }}>
        <Button label={props.busy ? '正在开始…' : '开始冒险'} onPress={props.onStart} disabled={props.busy} block testID="campaign-adopt" />
        <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
          <Button label="重新生成" variant="secondary" onPress={props.onRegenerate} disabled={props.busy} style={{ flex: 1 }} />
          <Button label="修改意图" variant="secondary" onPress={props.onEditIntent} disabled={props.busy} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}

function lengthLabel(value: string): string {
  if (value === 'short') return '短篇';
  if (value === 'long') return '长篇';
  return '中篇';
}

function ProposalRow(props: { label: string; value: string; multiline?: boolean }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[typeStyle(theme, theme.type.caption), { opacity: 0.75 }]}>{props.label}</Text>
      <Text style={typeStyle(theme, theme.type.body)} numberOfLines={props.multiline ? undefined : 2}>
        {props.value}
      </Text>
    </View>
  );
}
