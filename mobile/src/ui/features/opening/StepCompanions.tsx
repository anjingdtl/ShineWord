/**
 * StepCompanions — 03 同伴 (plan §11.4).
 *
 * At most two companions from the anchor's templates; each selected companion
 * exposes the five rule-domain directives. Choosing none is allowed.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Chip } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { SectionHeader } from '../../components/SectionHeader';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { ChoiceCard } from './ChoiceCard';
import { COMPANION_DIRECTIVES, MAX_COMPANIONS, type OpeningWorldSetup } from './openingModel';
import type { CompanionDirective } from '../../../../src/domain/characters/card';

export function StepCompanions(props: {
  setup: OpeningWorldSetup | null;
  companions: string[];
  directives: Record<string, CompanionDirective>;
  onToggle: (entryId: string) => void;
  onDirective: (entryId: string, directive: CompanionDirective) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const templates = props.setup?.companionTemplates ?? [];

  return (
    <View style={{ gap: theme.space.md }}>
      <SectionHeader
        title="同伴"
        subtitle={
          templates.length > 0
            ? `最多 ${MAX_COMPANIONS} 名 · 已选 ${props.companions.length}`
            : '可选'
        }
      />
      {templates.length === 0 ? (
        <EmptyState
          compact
          title="这个世界没有可招募的同伴"
          description="你可以独自开始冒险；游戏内仍可按剧情招募。"
        />
      ) : (
        <View style={{ gap: theme.space.sm }}>
          {templates.map(template => {
            const selected = props.companions.includes(template.entryId);
            const directive = props.directives[template.entryId] ?? 'protect';
            return (
              <ChoiceCard
                key={template.entryId}
                title={template.name}
                selected={selected}
                onPress={() => props.onToggle(template.entryId)}
                description={template.description}
                testID={`companion-${template.entryId}`}>
                {selected ? (
                  <View style={{ gap: theme.space.xs, marginTop: theme.space.xs }}>
                    <Text style={[typeStyle(theme, theme.type.label), { color: theme.text.secondary }]}>
                      当前指令
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                      {COMPANION_DIRECTIVES.map(option => (
                        <Chip
                          key={option.value}
                          label={option.label}
                          selected={directive === option.value}
                          onPress={() => props.onDirective(template.entryId, option.value)}
                          testID={`directive-${template.entryId}-${option.value}`}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </ChoiceCard>
            );
          })}
        </View>
      )}
      <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted }]}>
        同伴指令在游戏中可随时调整（队伍面板），这里只是初始设定。
      </Text>
    </View>
  );
}