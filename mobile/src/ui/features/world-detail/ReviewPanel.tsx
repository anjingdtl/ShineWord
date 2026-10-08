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
import { listReviewIssues, resolveReviewIssue, resolveCanonFactConflict, rejectMappingConstraint, decideSituationReview,
  type SituationReviewPreview, type ReviewIssueView } from '../../../runtime';
import { ReviewIssueCard } from './ReviewIssueCard';
import { CanonConflictCard } from './CanonConflictCard';
import { MappingConstraintCard } from './MappingConstraintCard';
import { MissingSituationCard } from './MissingSituationCard';

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

  async function resolve(issueId: string, resolution: 'resolved' | 'waived', remember: boolean) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await resolveReviewIssue(props.worldId, issueId, resolution, remember);
      setNotice(`已${resolution === 'waived' ? '豁免' : '解决'} ${issueId}。${remember ? '相同问题将自动采用本次策略。' : ''}返回项目可继续构建。`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolveFact(factId: string, resolution: 'complementary' | 'unverified') {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await resolveCanonFactConflict(props.worldId, factId, resolution);
      setNotice('已保存事实审查决定与原文证据；全部处理后返回项目继续构建。');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function rejectConstraint(issue: ReviewIssueView) {
    if (busy) return;
    setError(null); setNotice(null); setBusy(true);
    try {
      await rejectMappingConstraint(props.worldId, issue.issueId, issue.detailJson);
      setNotice('已拒绝这条规则，原著事实已保留。返回项目继续构建后，新版本会排除该提案。');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function decideSituation(preview: SituationReviewPreview, decision: 'publish' | 'reject') {
    if (busy) return;
    setError(null); setNotice(null); setBusy(true);
    try {
      await decideSituationReview(props.worldId, preview.issueId, preview.proofHash, decision);
      setNotice(decision === 'publish' ? '已验证并发布新的局面补充档案，可在战役安全边界采用。'
        : '已拒绝这份局面提案并保存证据绑定的决定，原著事实和已发布档案保留。');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ gap: theme.space.md }}>
      <SectionHeader
        title="审查队列"
        tone="base"
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
        issues.map(issue => issue.kind === 'canon_conflict' && issue.conflicts?.length ? (
          <View key={issue.issueId} style={{ gap: theme.space.md }}>
            {issue.conflicts.map(conflict => (
              <CanonConflictCard key={conflict.factId} conflict={conflict} busy={busy}
                onResolve={resolution => void resolveFact(conflict.factId, resolution)} />
            ))}
          </View>
        ) : issue.kind === 'mapping_constraint' ? (
          <MappingConstraintCard key={issue.issueId} issue={issue} busy={busy} onReject={() => void rejectConstraint(issue)} />
        ) : issue.kind === 'situation_dangling_reference' ? (
          <MissingSituationCard key={issue.issueId} worldId={props.worldId} issue={issue} busy={busy}
            onDecide={(preview, decision) => void decideSituation(preview, decision)} />
        ) : (
          <ReviewIssueCard
            key={issue.issueId}
            issue={issue}
            busy={busy}
            onResolve={(resolution, remember) => void resolve(issue.issueId, resolution, remember)}
          />
        ))
      )}
    </View>
  );
}
