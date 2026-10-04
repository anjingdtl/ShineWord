/**
 * TurnCard — one committed turn as 选择 → 结果 → 故事.
 *
 * The card never invents content: the roll strip only appears when the turn
 * actually has a persisted roll, and the narrative text is whatever the
 * narrator stored. Choice and result come from the frozen player contract
 * and historical snapshots; internal setup rows are absent from the feed.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { RollStrip } from './RollStrip';
import type { TurnView } from '../../../runtime';

export function TurnCard(props: { turn: TurnView }): React.JSX.Element {
  const { theme } = useTheme();
  const { turn } = props;
  return (
    <View style={styles.wrapper}>
      <Card ornament={theme.ornament.corner !== 'hud'}>
        <View style={{ gap: theme.space.md }}>
          {turn.choice ? (
            <View style={{ gap: theme.space.xs }}>
              <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
                你的选择
              </Text>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
                {turn.choice}
              </Text>
            </View>
          ) : null}
          {turn.result ? (
            <View style={{ gap: theme.space.xs }}>
              <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
                行动结果
              </Text>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
                {turn.result}
              </Text>
              {turn.resultDetails ? (
                <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                  {turn.resultDetails}
                </Text>
              ) : null}
              {turn.roll ? <RollStrip roll={turn.roll} /> : null}
            </View>
          ) : null}
          {turn.text ? (
            <View style={{ gap: theme.space.sm,
              ...(turn.choice || turn.result ? { paddingTop: theme.space.sm,
                borderTopWidth: theme.border.hairline, borderTopColor: theme.border.color } : {}) }}>
              <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.secondary }]}>
                故事
              </Text>
              <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
                {turn.text}
              </Text>
            </View>
          ) : null}
          {turn.resumed ? (
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semanticText.info }]}>
              ⟲ 接续了上次的行动
            </Text>
          ) : null}
        </View>
      </Card>

      {/* Skin-specific narrative framing (plan §26). */}
      {theme.id === 'ink' ? (
        <View
          pointerEvents="none"
          style={[
            styles.inkRule,
            { backgroundColor: theme.accent.secondary, borderRadius: theme.radius.sm },
          ]}
        />
      ) : null}
      {theme.id === 'manga' ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: theme.space.xl,
            bottom: -9,
            width: theme.space.lg,
            height: theme.space.lg,
            backgroundColor: theme.bg.raised,
            borderRightWidth: theme.effects.cardBorderWidth,
            borderBottomWidth: theme.effects.cardBorderWidth,
            borderColor: theme.border.color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  inkRule: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2 },
});
