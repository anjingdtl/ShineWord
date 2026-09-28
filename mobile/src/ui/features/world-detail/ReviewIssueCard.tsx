/**
 * ReviewIssueCard — one mapping/review issue as a readable card (plan §10.3).
 *
 * The headline is a human summary; the raw `detailJson` is folded behind
 * 「技术详情」 so the queue reads as a work list instead of a JSON dump. Both
 * resolution actions are unchanged (`resolveReviewIssue`).
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import type { ReviewIssueView } from '../../../runtime';

const SEVERITY_LABEL: Record<string, string> = {
  blocking: '阻塞',
  major: '重要',
  minor: '提示',
};

const SEVERITY_GLYPH: Record<string, string> = {
  blocking: '⛔',
  major: '▲',
  minor: '·',
};

/** First human-readable field of the detail payload, if any. */
function summarize(detailJson: string): string {
  try {
    const parsed = JSON.parse(detailJson) as Record<string, unknown>;
    for (const key of ['message', 'summary', 'title', 'reason', 'detail']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return JSON.stringify(parsed);
  } catch {
    return detailJson;
  }
}

export function ReviewIssueCard(props: {
  issue: ReviewIssueView;
  busy?: boolean;
  onResolve: (resolution: 'resolved' | 'waived') => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [showDetail, setShowDetail] = useState(false);
  const { issue } = props;
  const severity = SEVERITY_LABEL[issue.severity] ?? issue.severity;
  const glyph = SEVERITY_GLYPH[issue.severity] ?? '·';
  const summary = summarize(issue.detailJson);

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
        <Text
          style={[
            typeStyle(theme, theme.type.label),
            {
              color:
                issue.severity === 'blocking'
                  ? theme.semantic.bad
                  : issue.severity === 'major'
                    ? theme.semantic.warn
                    : theme.onRaised.secondary,
            },
          ]}>
          {glyph} {severity}
        </Text>
        <Text
          numberOfLines={1}
          style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary, flex: 1 }]}>
          {issue.kind} · {issue.issueId}
        </Text>
      </View>

      <Text
        style={[
          typeStyle(theme, theme.type.small),
          { color: theme.onRaised.primary, marginTop: theme.space.sm },
        ]}>
        {summary.length > 240 ? `${summary.slice(0, 240)}…` : summary}
      </Text>

      <View style={[styles.row, { gap: theme.space.sm, marginTop: theme.space.md }]}>
        <Button
          label="按事实解决"
          variant="secondary"
          onPress={() => props.onResolve('resolved')}
          disabled={props.busy === true}
          testID={`review-resolve-${issue.issueId}`}
        />
        <Button
          label="豁免并允许发布"
          variant="secondary"
          onPress={() => props.onResolve('waived')}
          disabled={props.busy === true}
          testID={`review-waive-${issue.issueId}`}
        />
        <Button
          label={showDetail ? '收起技术详情' : '技术详情'}
          variant="chip"
          onPress={() => setShowDetail(previous => !previous)}
        />
      </View>

      {showDetail ? (
        <Text
          style={[
            typeStyle(theme, theme.type.caption),
            {
              color: theme.onRaised.secondary,
              fontFamily: theme.font.numeric,
              marginTop: theme.space.md,
            },
          ]}>
          {issue.detailJson}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = {
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' } as const,
};