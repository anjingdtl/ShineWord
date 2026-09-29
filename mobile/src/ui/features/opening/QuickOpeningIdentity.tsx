import React from 'react';
import { View } from 'react-native';
import type { OpeningWorldSetup } from './openingModel';
import { Button } from '../../components/Button';
import { ChoiceCard } from './ChoiceCard';
import { SectionHeader } from '../../components/SectionHeader';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StatusBanner } from '../../components/StatusBanner';
import { TextField } from '../../components/TextField';
import { useTheme } from '../../theme/ThemeContext';

export function QuickOpeningIdentity(props: {
  setup: OpeningWorldSetup | null;
  kind: 'original' | 'canon';
  onKindChange: (kind: 'original' | 'canon') => void;
  name: string;
  onNameChange: (name: string) => void;
  canonEntityId: string;
  onSelectCanon: (entityId: string) => void;
  onAdvanced: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const canonCharacters = props.setup?.canonCharacters ?? [];
  const canChooseCanon = canonCharacters.length > 0;
  return (
    <View style={{ gap: theme.space.md }}>
      <SectionHeader title="选择身份" subtitle="先定下这段故事由谁来经历" />
      {canChooseCanon ? (
        <SegmentedControl
          options={[
            { value: 'original', label: '原创旅人' },
            { value: 'canon', label: '原著人物' },
          ]}
          value={props.kind}
          onChange={props.onKindChange}
          testID="quick-opening-origin"
        />
      ) : (
        <StatusBanner
          tone="info"
          title="从原创旅人开始"
          message="当前开局没有公开且可扮演的原著人物，已按世界现有资料提供原创身份。"
        />
      )}

      {props.kind === 'canon' && canChooseCanon ? (
        <View style={{ gap: theme.space.sm }}>
          {canonCharacters.slice(0, 20).map(character => (
            <ChoiceCard
              key={character.entityId}
              title={character.name}
              selected={props.canonEntityId === character.entityId}
              onPress={() => props.onSelectCanon(character.entityId)}
              description="只列出当前开局时刻已公开且可扮演的人物。"
              testID={`quick-canon-${character.entityId}`}
            />
          ))}
        </View>
      ) : (
        <TextField
          label="姓名"
          value={props.name}
          onChangeText={props.onNameChange}
          placeholder="给这位旅人取个名字"
          hint="姓名是原创角色唯一必填的自定义内容；属性、技能和同行者可使用推荐。"
          maxLength={40}
          returnKeyType="done"
          testID="quick-opening-name"
        />
      )}

      <Button
        label="自定义角色与完整开局（4 步）"
        variant="secondary"
        onPress={props.onAdvanced}
        block
        testID="opening-advanced-wizard"
      />
    </View>
  );
}
