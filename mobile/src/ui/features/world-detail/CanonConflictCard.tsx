import React from 'react';
import { Text, View } from 'react-native';
import type { CanonConflictView } from '../../../runtime';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

function describe(value: Record<string, unknown>): string {
  return Object.values(value).map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('；');
}

export function CanonConflictCard(props: {
  conflict: CanonConflictView;
  busy: boolean;
  onResolve: (resolution: 'complementary' | 'unverified') => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const fact = props.conflict;
  const body = [typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }];
  return (
    <Card>
      <SectionHeader title={`${fact.subjectName} · 事实核对`} subtitle="不同描述可能是补充，也可能相互矛盾，请对照原文。" />
      <View style={{ gap: theme.space.sm }}>
        {fact.existing.map((existing, index) => (
          <View key={index} style={{ gap: theme.space.xs }}>
            <Text style={body}>{`已有描述：${describe(existing.value)}`}</Text>
            <Text style={body}>{`原文依据：${existing.quotes.join(' / ') || '暂无'}`}</Text>
          </View>
        ))}
        <Text style={body}>{`待核对描述：${describe(fact.value)}`}</Text>
        <Text style={body}>{`原文依据：${fact.quotes.join(' / ') || '暂无'}`}</Text>
        <Text style={body}>两条信息可以同时成立时保留为补充事实；尚不能确认时转为待核实资料，暂不用于世界映射。</Text>
        <Button label="按补充事实保留" block disabled={props.busy || fact.quotes.length === 0}
          testID={`conflict-keep-${fact.factId}`} onPress={() => props.onResolve('complementary')} />
        <Button label="转为待核实资料" block variant="secondary" disabled={props.busy}
          testID={`conflict-unverified-${fact.factId}`} onPress={() => props.onResolve('unverified')} />
      </View>
    </Card>
  );
}
