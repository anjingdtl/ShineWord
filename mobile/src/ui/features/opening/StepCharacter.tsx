/**
 * StepCharacter — 02 我的角色 (plan §11.3).
 *
 * 原创角色: name, free-point budget, six attributes as `AttributePips`, up to
 * three starting skills (each showing its attribute, d6 die and whether an
 * untrained attempt is allowed).
 * 原著角色: card selection from the canon characters the world setup exposes —
 * the player projection only, never future or GM-only material.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DieBadge } from '../../components/Bar';
import { EmptyState } from '../../components/EmptyState';
import { SectionHeader } from '../../components/SectionHeader';
import { SegmentedControl } from '../../components/SegmentedControl';
import { TextField } from '../../components/TextField';
import { AttributePips } from '../../components/PipTrack';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { ChoiceCard } from './ChoiceCard';
import {
  ATTRIBUTES,
  FREE_POINT_BUDGET,
  MAX_SKILLS,
  attributeLabel,
  type OpeningWorldSetup,
} from './openingModel';

const ORIGIN_OPTIONS = [
  { value: 'original' as const, label: '原创角色' },
  { value: 'canon' as const, label: '原著角色' },
];

export function StepCharacter(props: {
  setup: OpeningWorldSetup | null;
  kind: 'original' | 'canon';
  onKindChange: (kind: 'original' | 'canon') => void;
  name: string;
  onNameChange: (value: string) => void;
  points: Record<string, number>;
  onBump: (key: string, delta: number) => void;
  spentTotal: number;
  chosenSkills: string[];
  onToggleSkill: (entryId: string) => void;
  canonEntityId: string;
  onSelectCanon: (entityId: string) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const remaining = FREE_POINT_BUDGET - props.spentTotal;

  return (
    <View style={{ gap: theme.space.md }}>
      <SegmentedControl
        options={ORIGIN_OPTIONS}
        value={props.kind}
        onChange={props.onKindChange}
        testID="opening-origin"
      />

      {props.kind === 'canon' ? (
        <View>
          <SectionHeader title="原著角色" subtitle="从这个世界可扮演的人物中选择" />
          {props.setup && props.setup.canonCharacters.length > 0 ? (
            <View style={{ gap: theme.space.sm }}>
              {props.setup.canonCharacters.slice(0, 20).map(character => (
                <ChoiceCard
                  key={character.entityId}
                  title={character.name}
                  selected={props.canonEntityId === character.entityId}
                  onPress={() => props.onSelectCanon(character.entityId)}
                  description="按锚点之前的原著证据推导属性与技能；不显示未来剧情与主持人资料。"
                  testID={`canon-${character.entityId}`}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              compact
              title="没有可扮演的原著人物"
              description="这个世界包未提供可扮演的原著角色记录，请改选原创角色。"
            />
          )}
        </View>
      ) : (
        <>
          <Card>
            <SectionHeader title="角色" subtitle="原创角色：属性与技能由你在开局时决定" />
            <TextField
              label="姓名"
              value={props.name}
              onChangeText={props.onNameChange}
              placeholder="角色姓名（留空则为「无名旅人」）"
              testID="opening-name"
            />
          </Card>

          <Card>
            <SectionHeader
              title="六属性"
              subtitle={`自由点剩余 ${remaining} / ${FREE_POINT_BUDGET}（每项 1～3）`}
            />
            <View style={{ gap: theme.space.sm }}>
              {ATTRIBUTES.map(attribute => {
                const value = props.points[attribute.key] ?? 1;
                return (
                  <View
                    key={attribute.key}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
                    <Text
                      style={[
                        typeStyle(theme, theme.type.small),
                        { color: theme.onRaised.primary, width: theme.space.xxl + theme.space.xs },
                      ]}>
                      {attribute.label}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <AttributePips value={value} />
                    </View>
                    <Button
                      label="−"
                      variant="chip"
                      onPress={() => props.onBump(attribute.key, -1)}
                      disabled={value <= 1}
                      accessibilityLabel={`${attribute.label} 减 1`}
                      testID={`attr-minus-${attribute.key}`}
                    />
                    <Text
                      style={[
                        typeStyle(theme, theme.type.small),
                        {
                          color: theme.onRaised.primary,
                          width: theme.space.lg,
                          textAlign: 'center',
                          fontFamily: theme.font.numeric,
                        },
                      ]}>
                      {value}
                    </Text>
                    <Button
                      label="＋"
                      variant="chip"
                      onPress={() => props.onBump(attribute.key, 1)}
                      disabled={value >= 3 || remaining <= 0}
                      accessibilityLabel={`${attribute.label} 加 1`}
                      testID={`attr-plus-${attribute.key}`}
                    />
                  </View>
                );
              })}
            </View>
          </Card>

          <View>
            <SectionHeader
              title="初始技能"
              subtitle={`已选 ${props.chosenSkills.length} / ${MAX_SKILLS} · 入门骰为 d6`}
            />
            {props.setup && props.setup.skills.length > 0 ? (
              <View style={{ gap: theme.space.sm }}>
                {props.setup.skills.map(skill => (
                  <ChoiceCard
                    key={skill.entryId}
                    title={skill.name}
                    description={`关联属性：${attributeLabel(skill.attribute)} · 允许无训练尝试：${
                      skill.allowUntrained ? '是' : '否'
                    }`}
                    selected={props.chosenSkills.includes(skill.entryId)}
                    onPress={() => props.onToggleSkill(skill.entryId)}
                    testID={`skill-${skill.entryId}`}>
                    <DieBadge sides={6} />
                  </ChoiceCard>
                ))}
              </View>
            ) : (
              <EmptyState
                compact
                title="这个世界包没有技能条目"
                description="开局将不带技能；游戏内仍可通过训练成长。"
              />
            )}
          </View>
        </>
      )}
    </View>
  );
}