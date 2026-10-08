import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { readMappingConstraintReview } from '../../../../../src/application/worldPackage/mappingConstraintReview';
import type { ReviewIssueView } from '../../../runtime';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

export function MappingConstraintCard(props: {
  issue: ReviewIssueView; busy: boolean; onReject: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [showDetail, setShowDetail] = useState(false);
  const detail = readMappingConstraintReview(props.issue.detailJson);
  const textStyle = [typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }];
  return (
    <Card>
      <View style={{ gap: theme.space.sm }}>
        <Text style={[typeStyle(theme, theme.type.label), { color: theme.semanticText.warn }]}>待核对的规则提案</Text>
        <Text style={textStyle}>{String(detail?.proposal.name ?? '规则提案')}</Text>
        <Text style={textStyle}>{String(detail?.proposal.description ?? '')}</Text>
        <Text style={textStyle}>这条提案要求自动限制行动或效果，当前缺少可执行条件，不能作为有效规则发布。</Text>
        <Text style={textStyle}>模型标注：{detail?.proposal.provenanceKind === 'explicit' ? '原文明确记载'
          : detail?.proposal.provenanceKind === 'inferred' ? '推断' : '规则映射或设计补全'}。{String(detail?.proposal.rationale ?? '')}</Text>
        <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.primary }]}>提案引用的原著证据</Text>
        {detail?.evidence.map(({ factId, fact }) => (
          <View key={factId} style={{ gap: theme.space.xs }}>
            {fact?.sources.length ? fact.sources.map((source, index) => (
              <Text key={index} style={textStyle}>“{source.quote}”</Text>
            )) : <Text style={textStyle}>{fact ? JSON.stringify(fact.value) : '引用的事实不存在。'}</Text>}
          </View>
        ))}
        {!detail?.evidence.length ? <Text style={textStyle}>没有可核对的事实引用。</Text> : null}
        <Text style={textStyle}>拒绝后，这条规则不会进入新版本；原著事实和已发布版本保留。决定仅适用于当前提案及证据，内容变化时重新审查。</Text>
        <Button label="拒绝这条规则" variant="secondary" disabled={props.busy || !detail}
          onPress={props.onReject} testID={`review-reject-${props.issue.issueId}`} />
        <Button label={showDetail ? '收起技术详情' : '技术详情'} variant="chip" onPress={() => setShowDetail(value => !value)} />
        {showDetail ? <Text style={textStyle}>{props.issue.detailJson}</Text> : null}
      </View>
    </Card>
  );
}
