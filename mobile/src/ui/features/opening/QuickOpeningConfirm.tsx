import React from 'react';
import { Text, View } from 'react-native';
import type { CompanionDirective } from '../../../../../src/domain/characters/card';
import type { RecommendedOpeningLoadout } from '../../../../../src/application/campaign/openingRecommendation';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBanner } from '../../components/StatusBanner';
import { TextField } from '../../components/TextField';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { StepCompanions } from './StepCompanions';
import { ATTRIBUTES, type OpeningWorldSetup } from './openingModel';

export function QuickOpeningConfirm(props: {
  worldTitle: string;
  setup: OpeningWorldSetup | null;
  anchorLabel: string;
  locationLabel: string;
  kind: 'original' | 'canon';
  actorName: string;
  characterDescription: string;
  onCharacterDescriptionChange: (value: string) => void;
  goal: string;
  onGoalChange: (value: string) => void;
  /** AI-proposed goals over the published world package; empty while loading or on failure. */
  goalSuggestions?: readonly string[];
  loadout: RecommendedOpeningLoadout;
  companions: string[];
  directives: Record<string, CompanionDirective>;
  onToggleCompanion: (entryId: string) => void;
  onDirective: (entryId: string, directive: CompanionDirective) => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  advancedChildren?: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();
  const skillNames = props.loadout.initialSkills
    .map(id => props.setup?.skills.find(skill => skill.entryId === id)?.name)
    .filter((name): name is string => Boolean(name));
  const attributes = ATTRIBUTES.map(attribute => `${attribute.label} ${props.loadout.attributes[attribute.key]}`).join(' · ');
  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <SectionHeader title="这段故事从这里开始" subtitle="按当前公开资料生成合法的本地角色建议" />
        <SummaryRow label="世界" value={props.worldTitle} />
        <SummaryRow label="时刻" value={props.anchorLabel} />
        <SummaryRow label="地点" value={props.locationLabel} />
        <SummaryRow label="人物" value={`${props.actorName} · ${props.kind === 'original' ? '原创旅人' : '原著人物'}`} />
        <SummaryRow label="属性" value={props.kind === 'original' ? attributes : '按已公开的原著人物资料生成'} />
        <SummaryRow label="技能" value={props.kind === 'canon' ? '按已公开的原著人物资料生成' : (skillNames.join('、') || '当前没有已公开的可选技能')} />
      </Card>

      {props.kind === 'original' && skillNames.length === 0 ? (
        <StatusBanner
          tone="warning"
          title="此世界暂未提供开局技能"
          message="角色仍可开始故事；技能建议为空，系统不会补造技能。涉及技能的行动会按世界现有规则判断。"
        />
      ) : null}
      {props.setup && props.setup.locations.length === 0 ? (
        <StatusBanner
          tone="error"
          title="缺少可用开局地点"
          message="当前世界包和可见原著资料没有可用地点，暂时无法创建战役。"
        />
      ) : null}

      <Card>
        <SectionHeader title="人物短描述" subtitle="可留空，也可写一句外貌、来历或此刻心情" />
        <TextField
          value={props.characterDescription}
          onChangeText={props.onCharacterDescriptionChange}
          multiline
          minLines={2}
          maxLength={120}
          placeholder="例如：衣角沾着雨水，腰间别着一枚旧木牌"
          hint="最多 120 字；写入新角色资料，可随时在人物页查看。"
          testID="quick-opening-description"
        />
      </Card>

      <Card>
        <SectionHeader title="这次想做什么" subtitle="目标可留空，故事行动中也可以随时调整" />
        {(props.goalSuggestions?.length ?? 0) > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginBottom: theme.space.sm }}>
            {props.goalSuggestions!.map((suggestion, index) => (
              <Chip
                key={suggestion}
                label={suggestion}
                hot={index === 0}
                onPress={() => props.onGoalChange(suggestion)}
                accessibilityLabel={`采用推荐目标：${suggestion}`}
                testID={`quick-opening-goal-suggestion-${index + 1}`}
              />
            ))}
          </View>
        )}
        <TextField
          value={props.goal}
          onChangeText={props.onGoalChange}
          multiline
          minLines={2}
          maxLength={240}
          placeholder={
            (props.goalSuggestions?.length ?? 0) > 0
              ? '点上面的推荐目标，或自己写一句'
              : '可选：例如，弄清门边新留下的脚印'
          }
          testID="quick-opening-goal"
        />
      </Card>

      <StepCompanions
        setup={props.setup}
        companions={props.companions}
        directives={props.directives}
        onToggle={props.onToggleCompanion}
        onDirective={props.onDirective}
      />

      <Button
        label={props.advancedOpen ? '收起自定义属性、技能与开局细节' : '自定义属性、技能与开局细节'}
        variant="secondary"
        onPress={props.onToggleAdvanced}
        block
        testID="quick-opening-advanced-details"
      />
      {props.advancedOpen ? props.advancedChildren : null}

      <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted }]}>
        开始后会进入故事；地点、目标和同行者只写入这次新战役。
      </Text>
    </View>
  );
}

function SummaryRow(props: { label: string; value: string }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.md, paddingVertical: theme.space.xs }}>
      <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary, width: theme.space.xxl + theme.space.sm }]}>
        {props.label}
      </Text>
      <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, flex: 1 }]}>
        {props.value}
      </Text>
    </View>
  );
}
