/**
 * 审查 sub-tab of the world detail screen.
 *
 * Ported verbatim from App.tsx's `ReviewScreen` (P2: move only).
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listReviewIssues, resolveReviewIssue, type ReviewIssueView } from '../../runtime';
import { styles } from './legacyStyles';

export function WorldDetailReview(props: { worldId: string }): React.JSX.Element {
  const [issues, setIssues] = useState<ReviewIssueView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIssues(await listReviewIssues(props.worldId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.worldId]);

  // The queue is the fix-it surface for a blocked build, so it re-reads on
  // every focus instead of trusting whatever it loaded the first time.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function resolve(issueId: string, resolution: 'resolved' | 'waived') {
    setError(null);
    try {
      await resolveReviewIssue(props.worldId, issueId, resolution);
      setNotice(`已${resolution === 'waived' ? '豁免' : '解决'} ${issueId}。重新构建/映射后将以新版本发布。`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }}>
      {issues.length === 0 ? <Text style={styles.muted}>没有待处理的审核问题。</Text> : null}
      {issues.map(issue => (
        <View key={issue.issueId} style={styles.card}>
          <Text style={styles.cardTitle}>
            {issue.severity === 'blocking' ? '⛔ ' : issue.severity === 'major' ? '⚠️ ' : '· '}
            {issue.issueId}（{issue.kind}）
          </Text>
          <Text style={styles.bodyText}>{issue.detailJson.slice(0, 300)}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondary} onPress={() => resolve(issue.issueId, 'resolved')}>
              <Text style={styles.secondaryText}>按事实解决</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => resolve(issue.issueId, 'waived')}>
              <Text style={styles.secondaryText}>豁免并允许发布</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {notice ? <Text style={styles.resumed}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}
