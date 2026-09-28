/**
 * StepConfirm — 04 确认开局 (plan §11.5).
 *
 * The review lists exactly what `createCampaign` will lock in: world, anchor,
 * character (with attributes/skills), companions and their directives, the goal,
 * the world-package revision, the ruleset version and the active skin.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { TextField } from '../../components/TextField';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { ATTRIBUTES, MAX_SKILLS, directiveLabel } from './openingModel';
import type { CompanionDirective } from '../../../../../src/domain/characters/card';
import type { OpeningWorldSetup } from './openingModel';

function Row(props: { label: string; value: string }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.md, paddingVertical: theme.space.xs }}>
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, width: theme.space.xxl + theme.space.sm },
        ]}>
        {props.label}
      </Text>
      <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, flex: 1 }]}>
        {props.value}
      </Text>
    </View>
  );
}

export function StepConfirm(props: {
  worldTitle: string;
  setup: OpeningWorldSetup | null;
  anchorLabel: string;
  location: string;
  kind: 'original' | 'canon';
  actorName: string;
  points: Record<string, number>;
  chosenSkills: string[];
  companions: string[];
  directives: Record<string, CompanionDirective>;
  goal: string;
  onGoalChange: (value: string) => void;
  themeLabel: string;
  busy: boolean;
  canStart: boolean;
  onStart: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const skillNames = props.chosenSkills
    .map(entryId => props.setup?.skills.find(skill => skill.entryId === entryId)?.name ?? entryId)
    .join('、');
  const attributeSummary =
    props.kind === 'canon'
      ? '按锚点之前的原著证据推导'
      : ATTRIBUTES.map(attribute => `${attribute.label} ${props.points[attribute.key] ?? 1}`).join(' · ');
  const companionSummary =
    props.companions.length === 0
      ? '独自开局'
      : props.companions
          .map(entryId => {
            const template = props.setup?.companionTemplates.find(item => item.entryId === entryId);
            return `${template?.name ?? entryId}（${directiveLabel(props.directives[entryId])}）`;
          })
          .join('、');

  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <SectionHeader title="确认开局" subtitle="以下内容将写入新战役" />
        <Row label="世界" value={props.worldTitle} />
        <Row label="起点" value={props.anchorLabel} />
        <Row label="地点" value={props.location || '（未选择）'} />
        <Row
          label="角色"
          value={`${props.actorName} · ${props.kind === 'original' ? '原创角色' : '原著角色'}`}
        />
        <Row label="属性" value={attributeSummary} />
        <Row
          label="技能"
          value={
            props.kind === 'canon'
              ? '按锚点之前的原著证据推导'
              : skillNames || `未选择（最多 ${MAX_SKILLS} 项）`
          }
        />
        <Row label="同伴" value={companionSummary} />
        <Row
          label="世界包"
          value={`r${props.setup?.packageRevision ?? '?'} · 锁定的不可变版本`}
        />
        <Row label="规则" value={props.setup?.rulesetVersion || '未知'} />
        <Row label="主题" value={props.themeLabel} />
      </Card>

      <Card>
        <SectionHeader title="目标" subtitle="这次冒险要达成什么" />
        <TextField
          value={props.goal}
          onChangeText={props.onGoalChange}
          multiline
          minLines={3}
          placeholder="例如：在开局锚点处找到失踪的同伴"
          hint="留空则使用默认目标「在开局锚点处开始一段冒险」。"
          testID="opening-goal"
        />
      </Card>

      <Button
        label={props.busy ? '创建中…' : '开始冒险'}
        onPress={props.onStart}
        disabled={props.busy || !props.canStart}
        block
        testID="opening-start"
      />
      <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted }]}>
        创建后会直接进入游玩页；向导不会留在返回栈里。
      </Text>
    </View>
  );
}