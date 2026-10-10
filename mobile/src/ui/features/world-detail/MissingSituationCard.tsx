import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { prepareSituationReview, type ReviewIssueView, type SituationReviewPreview } from '../../../runtime';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

export function MissingSituationCard(props: { worldId: string; issue: ReviewIssueView; busy: boolean;
  onDecide: (preview: SituationReviewPreview, decision: 'publish' | 'reject') => void }): React.JSX.Element {
  const { theme } = useTheme();
  const [preview, setPreview] = useState<SituationReviewPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setPreview(null); setError(null);
    prepareSituationReview(props.worldId, props.issue.issueId).then(value => { if (active) setPreview(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [props.worldId, props.issue.issueId, props.issue.detailJson, refresh]);
  const textStyle = [typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }];
  const raw = preview?.review.proposal;
  return <Card><View style={{ gap: theme.space.sm }}>
    <Text style={[typeStyle(theme, theme.type.label), { color: theme.semanticText.warn }]}>未发布的局面提案</Text>
    {!preview && !error ? <Text style={textStyle}>正在核对已完成的提案、原著证据和内容依赖……</Text> : null}
    {error ? <Text style={textStyle}>{error}</Text> : null}
    {preview ? <>
      <Text style={textStyle}>{String(raw?.title ?? '局面提案')}</Text>
      <Text style={textStyle}>{String(raw?.summary ?? '')}</Text>
      <Text style={textStyle}>GM 说明：{String(raw?.gmBrief ?? '无额外说明')}</Text>
      {Array.isArray(raw?.methods) ? raw.methods.map((method, index) => {
        if (!method || typeof method !== 'object' || Array.isArray(method)) return null;
        const value = method as Record<string, unknown>;
        const firstStep = value.firstStep as { intent?: unknown } | undefined;
        return <Text key={index} style={textStyle}>{String(value.title ?? '方法')}：{String(value.goal ?? '')}
          {'\n'}{String(firstStep?.intent ?? '')}{'\n'}取舍：{String(value.tradeoffs ?? '未说明')}</Text>;
      }) : null}
      <Text style={textStyle}>提案引用的原著证据</Text>
      {preview.review.evidence.map(({ factId, fact }) => <View key={factId} style={{ gap: theme.space.xs }}>
        {fact?.sources.length ? fact.sources.map((source, index) => <Text key={index} style={textStyle}>“{source.quote}”</Text>)
          : <Text style={textStyle}>缺少可核对的原文证据。</Text>}
      </View>)}
      {preview.warnings.length > 0 ? <View style={{ gap: theme.space.xs }}>
        <Text style={textStyle}>已安全移除未解析的可选角色引用，局面方法仍保留：</Text>
        {preview.warnings.map((warning, index) => <Text key={index} style={textStyle}>· {warning}</Text>)}
      </View> : null}
      <Text style={textStyle}>{preview.ready ? '依赖与发布验证已通过。请核对上述内容，再决定是否补充发布。'
        : '当前提案尚未通过发布验证，可刷新核对或拒绝这份提案。'}</Text>
      <Text style={textStyle}>补充发布会生成新的档案，在战役安全边界采用。拒绝只记住这份提案及证据，内容变化时重新审查。</Text>
      <Button label="已核对内容，补充发布" variant="primary" disabled={props.busy || !preview.ready}
        onPress={() => props.onDecide(preview, 'publish')} testID={`review-publish-${props.issue.issueId}`} />
      <Button label="拒绝这个局面" variant="secondary" disabled={props.busy}
        onPress={() => props.onDecide(preview, 'reject')} testID={`review-reject-${props.issue.issueId}`} />
      <Button label={detail ? '收起技术详情' : '技术详情'} variant="chip" onPress={() => setDetail(value => !value)} />
      {detail ? <Text style={textStyle}>{JSON.stringify({ errors: preview.errors, proposal: raw })}</Text> : null}
    </> : null}
    <Button label="重新核对" variant="chip" disabled={props.busy} onPress={() => setRefresh(value => value + 1)} />
  </View></Card>;
}
