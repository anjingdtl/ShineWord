/**
 * KnowledgePanel — 知识 (plan §24.5).
 *
 * The entries the player knows, each tagged with how it was learned
 * (witnessed / told / inferred). The source badge carries its own glyph so the
 * distinction never depends on colour alone.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { DiscoveryView } from '../../../../../../src/application/campaign/playProjection';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { SectionHeader } from '../../../components/SectionHeader';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';

const KNOWN_VIA: Record<DiscoveryView['knownVia'], { label: string; glyph: string }> = {
  witnessed: { label: '亲眼所见', glyph: '👁' },
  told: { label: '他人告知', glyph: '☞' },
  inferred: { label: '自行推断', glyph: '⟳' },
};

export function KnowledgePanel(props: { discoveries: DiscoveryView[] }): React.JSX.Element {
  const { theme } = useTheme();
  if (props.discoveries.length === 0) {
    return (
      <EmptyState
        title="还没有已知条目"
        description="在剧情中获得的知识会按来源记录在这里。"
      />
    );
  }
  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <SectionHeader title="已知条目" subtitle={`${props.discoveries.length} 条`} />
        {props.discoveries.map(discovery => {
          const via = KNOWN_VIA[discovery.knownVia] ?? { label: discovery.knownVia, glyph: '·' };
          return (
            <View key={discovery.entryId} style={{ gap: theme.space.xs, marginBottom: theme.space.md }}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
                {discovery.title}
              </Text>
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                {via.glyph} {via.label} · v{discovery.knownAtStateVersion}
              </Text>
            </View>
          );
        })}
      </Card>
    </View>
  );
}