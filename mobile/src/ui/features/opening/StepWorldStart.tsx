/**
 * StepWorldStart — 01 世界起点 (plan §11.2).
 *
 * Original-story anchors and the selectable locations, each as a card with its
 * real summary text from the published package. No invented scene data.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBanner } from '../../components/StatusBanner';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { ChoiceCard } from './ChoiceCard';
import type { OpeningWorldSetup } from './openingModel';

export function StepWorldStart(props: {
  setup: OpeningWorldSetup | null;
  anchorEventId: string;
  locationId: string;
  onSelectAnchor: (eventId: string) => void;
  onSelectLocation: (location: string) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { setup } = props;

  if (!setup) {
    return (
      <Card>
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          加载世界资料…
        </Text>
      </Card>
    );
  }

  const anchor = setup.anchorEvents.find(event => event.eventId === props.anchorEventId);

  return (
    <View style={{ gap: theme.space.md }}>
      <View>
        <SectionHeader
          title="原著事件锚点"
          subtitle={setup.anchorEvents.length > 0 ? '从原著的哪个时刻进入故事' : undefined}
        />
        {setup.anchorEvents.length === 0 ? (
          <EmptyState
            compact
            title="这个世界没有原著事件锚点"
            description="将从时间原点开始，地点与人物按世界资料投影。"
          />
        ) : (
          <View style={{ gap: theme.space.sm }}>
            {setup.anchorEvents.map(event => (
              <ChoiceCard
                key={event.eventId}
                title={`序${event.worldTimeOrder} · ${event.title}`}
                selected={props.anchorEventId === event.eventId}
                onPress={() => props.onSelectAnchor(event.eventId)}
                description={event.summary}
                testID={`anchor-${event.eventId}`}
              />
            ))}
          </View>
        )}
      </View>

      <View>
        <SectionHeader title="开局地点" subtitle="锚点处可用的场景" />
        {setup.locations.length === 0 ? (
          <StatusBanner
            tone="error"
            title="缺少场景条目"
            message="这个世界包没有可用的开局地点，暂时无法创建战役。"
          />
        ) : (
          <View style={{ gap: theme.space.sm }}>
            {setup.locations.slice(0, 12).map(location => (
              <ChoiceCard
                key={location}
                title={location}
                selected={props.locationId === location}
                onPress={() => props.onSelectLocation(location)}
                testID={`location-${location}`}
              />
            ))}
          </View>
        )}
      </View>

      {anchor ? (
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted }]}>
          当前锚点：{anchor.title}（世界时间序 {anchor.worldTimeOrder}）
        </Text>
      ) : null}
    </View>
  );
}