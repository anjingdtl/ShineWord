/**
 * QuestPanel — 任务 (plan §24.3).
 *
 * Lists quest progress in the five rule-domain states with their real counters.
 * Nothing is derived: status and counters come straight from the projection.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { QuestProgressView } from '../../../../../src/application/campaign/playProjection';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { SectionHeader } from '../../components/SectionHeader';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

const STATUS_LABEL: Record<QuestProgressView['status'], string> = {
  available: '可接取',
  active: '进行中',
  succeeded: '已完成',
  failed: '已失败',
  abandoned: '已放弃',
};

const STATUS_GLYPH: Record<QuestProgressView['status'], string> = {
  available: '·',
  active: '▶',
  succeeded: '✓',
  failed: '✕',
  abandoned: '—',
};

const STATUS_ORDER: QuestProgressView['status'][] = [
  'active',
  'available',
  'succeeded',
  'failed',
  'abandoned',
];

export function QuestPanel(props: { quests: QuestProgressView[] }): React.JSX.Element {
  const { theme } = useTheme();
  if (props.quests.length === 0) {
    return (
      <EmptyState
        title="还没有任务记录"
        description="任务会在剧情推进或遭遇后由引擎记录。"
      />
    );
  }
  const ordered = [...props.quests].sort(
    (left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status),
  );
  return (
    <View style={{ gap: theme.space.md }}>
      {STATUS_ORDER.map(status => {
        const group = ordered.filter(quest => quest.status === status);
        if (group.length === 0) return null;
        return (
          <Card key={status}>
            <SectionHeader
              title={`${STATUS_GLYPH[status]} ${STATUS_LABEL[status]}`}
              subtitle={`${group.length} 项`}
            />
            {group.map(quest => {
              const counters = Object.entries(quest.counters);
              return (
                <View key={quest.questId} style={{ gap: theme.space.xs, marginBottom: theme.space.sm }}>
                  <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
                    {quest.name}
                  </Text>
                  {counters.length > 0 ? (
                    <Text
                      style={[
                        typeStyle(theme, theme.type.caption),
                        { color: theme.onRaised.secondary, fontFamily: theme.font.numeric },
                      ]}>
                      {counters.map(([key, value]) => `${key} ${value}`).join(' · ')}
                    </Text>
                  ) : null}
                  {quest.completedStateVersion !== null ? (
                    <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
                      结算于 v{quest.completedStateVersion}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </Card>
        );
      })}
    </View>
  );
}