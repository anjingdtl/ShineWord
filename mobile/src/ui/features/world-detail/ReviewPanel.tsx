/**
 * ReviewPanel — 世界详情 · 审查 (plan §10.3).
 *
 * Re-reads the open queue on every focus (the queue is the fix-it surface for a
 * blocked build) and renders each issue as a readable card. Resolution actions
 * call the same `resolveReviewIssue` bridge as before.
 */
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { EmptyState } from '../../components/EmptyState';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBanner } from '../../components/StatusBanner';
import { useTheme } from '../../theme/ThemeContext';
import { listReviewIssues, resolveReviewIssue, type ReviewIssueView } from '../../../runtime';
import { ReviewIssueCard } from './ReviewIssueCard';

export function ReviewPanel(props: { worldId: string }): React.JSX.Element {
  const { theme } = useTheme();
  const [issues, setIssues] = useState<ReviewIssueView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setIssues(await listReviewIssues(props.worldId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.worldId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function resolve(issueId: string, resolution: 'resolved' | 'waived') {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await resolveReviewIssue(props.worldId, issueId, resolution);
      setNotice(`已${resolution === 'waived' ? '豁免' : '解决'} ${issueId}。重新构建/映射后将以新版本发布。`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: theme.space.md }}>
      <SectionHeader
        title="审查队列"
        subtitle={issues.length > 0 ? `待处理 ${issues.length} 项` : '没有待处理的审核问题'}
      />
      {notice ? <StatusBanner tone="success" message={notice} /> : null}
      {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}
      {issues.length === 0 ? (
        <EmptyState
          title="没有待处理的审核问题"
          description="映射过程中记录的冲突会出现在这里；解决或豁免后才能发布新版本。"
        />
      ) : (
        issues.map(issue => (
          <ReviewIssueCard
            key={issue.issueId}
            issue={issue}
            busy={busy}
            onResolve={resolution => resolve(issue.issueId, resolution)}
          />
        ))
      )}
    </View>
  );
}