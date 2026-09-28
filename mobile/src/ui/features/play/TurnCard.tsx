/**
 * TurnCard — one committed turn as 检定 → 剧情 (plan §18.1).
 *
 * The card never invents content: the roll strip only appears when the turn
 * actually has a persisted roll, and the narrative text is whatever the
 * narrator stored. The player's intent is deliberately absent because the
 * history table does not store it (plan §18.1: 不伪造).
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { RollStrip } from './RollStrip';
import type { TurnView } from '../../../runtime';

export function TurnCard(props: { turn: TurnView; index: number }): React.JSX.Element {
  const { theme } = useTheme();
  const { turn } = props;
  return (
    <Card ornament={theme.ornament.corner !== 'hud'}>
      <View style={{ gap: theme.space.sm }}>
        <Text
          style={[
            typeStyle(theme, theme.type.micro),
            { color: theme.text.muted, fontFamily: theme.font.numeric },
          ]}>
          第 {props.index + 1} 回合 · v{turn.stateVersion}
        </Text>
        {turn.roll ? <RollStrip roll={turn.roll} /> : null}
        <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
          {turn.text}
        </Text>
        {turn.resumed ? (
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semantic.info }]}>
            ⟲ 已从本地断点恢复（复用同一骰点）
          </Text>
        ) : null}
      </View>
    </Card>
  );
}