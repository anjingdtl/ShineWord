/**
 * P9 campaign progress card (plan §13): compact mainline truth from the
 * runtime — current objective, latest committed progress, expandable
 * completed stages. No fabricated percentages; no hidden stages; no
 * "没有变化" spam when nothing moved (the card simply shows the goal).
 */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { textStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { createReadOnlySession } from '../../../runtime';
import { Button } from '../../components/Button';

export interface CampaignProgressData {
  status: string;
  longTermGoal: string;
  currentObjective: string;
  completedStages: Array<{ nodeId: string; title: string; resolution?: string }>;
  recentProgress: Array<{ text: string; atStateVersion: number }>;
  pendingConsequences: string[];
  preparationNotice?: string | null;
  ending: { title: string; outcomeKind: string } | null;
}

/** Loads the progress projection whenever the committed version changes. */
export function useCampaignProgress(campaignId: string, branchId: string, stateVersion: number | undefined): CampaignProgressData | null {
  const [progress, setProgress] = useState<CampaignProgressData | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await createReadOnlySession();
        const data = await session.getCampaignProgress(campaignId, branchId);
        if (!cancelled) setProgress(data);
      } catch {
        if (!cancelled) setProgress(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, branchId, stateVersion]);
  return progress;
}

export function CampaignProgressCard(props: {
  progress: CampaignProgressData | null;
  expanded: boolean;
  onToggle: () => void;
  busy?: boolean;
  onPauseResume?: () => void;
  onAdjustGoal?: () => void;
  onReplan?: () => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  const progress = props.progress;
  if (!progress) return null;
  const latest = progress.recentProgress[progress.recentProgress.length - 1];
  return (
    <View
      testID="campaign-progress-card"
      accessibilityLabel="战役主线"
      style={{ padding: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1,
        borderColor: theme.border.color, backgroundColor: theme.bg.raised, gap: theme.space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={textStyle(theme, theme.type.title, theme.onRaised.primary)} numberOfLines={1}>战役主线</Text>
        <Text style={textStyle(theme, theme.type.caption, theme.onRaised.secondary)} onPress={props.onToggle}>{props.expanded ? '收起' : '展开'}</Text>
      </View>
      <Text style={textStyle(theme, theme.type.body, theme.onRaised.primary)} numberOfLines={2}>
        {['active','paused'].includes(progress.status) ? `${progress.status === 'paused' ? '主线已暂停 · ' : ''}${progress.currentObjective}` : `战役已结束 · ${progress.ending?.title ?? progress.status}`}
      </Text>
      {latest ? (
        <Text style={textStyle(theme, theme.type.caption, theme.onRaised.secondary)} numberOfLines={2}>最近进展：{latest.text}</Text>
      ) : null}
      {progress.preparationNotice ? <Text style={textStyle(theme, theme.type.caption, theme.onRaised.secondary)}>{progress.preparationNotice}</Text> : null}
      {props.expanded ? (
        <View style={{ gap: theme.space.xs }}>
          <Text style={textStyle(theme, theme.type.caption, theme.onRaised.secondary)}>长期目标：{progress.longTermGoal}</Text>
          {progress.completedStages.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Text style={textStyle(theme, theme.type.caption, theme.onRaised.secondary)}>阶段结果</Text>
              {progress.completedStages.map(stage => (
                <Text key={stage.nodeId} style={textStyle(theme, theme.type.body, theme.onRaised.primary)}>
                  {stage.resolution === 'pressure_deadline_passed' ? '⚠' : '✓'} {stage.title}{stage.resolution
                    ? `（${stage.resolution === 'pressure_deadline_passed' ? '期限已过，目标结果需复核' : stage.resolution}）` : ''}
                </Text>
              ))}
            </View>
          ) : null}
          {progress.pendingConsequences.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Text style={textStyle(theme, theme.type.caption, theme.onRaised.secondary)}>待回应的后果</Text>
              {progress.pendingConsequences.map((text, index) => (
                <Text key={String(index)} style={textStyle(theme, theme.type.body, theme.onRaised.primary)} numberOfLines={2}>· {text}</Text>
              ))}
            </View>
          ) : null}
          {['active','paused'].includes(progress.status) ? <View style={{ gap: theme.space.sm }}>
            <Button label={progress.status === 'paused' ? '继续主线' : '暂时搁置主线'} variant="secondary" disabled={props.busy} onPress={props.onPauseResume} testID="campaign-pause-resume" />
            <Button label="调整冒险目标" variant="secondary" disabled={props.busy} onPress={props.onAdjustGoal} testID="campaign-change-goal" />
            <Button label="准备后续主线" variant="secondary" disabled={props.busy} onPress={props.onReplan} testID="campaign-replan" />
          </View> : null}
        </View>
      ) : null}
    </View>
  );
}
