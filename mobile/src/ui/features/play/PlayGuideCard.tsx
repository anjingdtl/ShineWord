/**
 * PlayGuideCard — first-session onboarding for the play screen
 * (product ask 2026-10-01 #4: "游玩过程中的系统引导性不足").
 *
 * One dismissable card at the top of the story feed, shown once per device
 * (AsyncStorage flag owned by the caller). It answers the three questions a
 * new player actually has: how do I act, what happens to my action, and
 * where do I see my character/goal. It must NEVER render over an ongoing
 * story - the caller only passes `visible` while no guide-dismiss flag
 * exists.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

const GUIDE_STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: '1 · 行动',
    body: '点输入框上方的建议，或自己写一句想做的事——观察、询问、移动、动手都可以。',
  },
  {
    title: '2 · 结果与故事',
    body: '先看你的选择带来了什么结果，再读接下来的故事。休整等行动会直接显示恢复与耗时。',
  },
  {
    title: '3 · 掌控',
    body: '右上角「☰ 信息」随时查看角色卡、目标与队伍；目标可以在游玩中随时调整。',
  },
];

export function PlayGuideCard(props: {
  onDismiss: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Card>
      <Text style={[typeStyle(theme, theme.type.heading), { color: theme.onRaised.primary }]}>
        怎么玩这一局
      </Text>
      <View style={{ gap: theme.space.sm, marginTop: theme.space.sm }}>
        {GUIDE_STEPS.map(step => (
          <View key={step.title} style={{ gap: theme.space.xs }}>
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, fontWeight: '600' }]}>
              {step.title}
            </Text>
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              {step.body}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: theme.space.md }}>
        <Button
          label="开始游玩"
          onPress={props.onDismiss}
          block
          testID="play-guide-dismiss"
        />
      </View>
    </Card>
  );
}
