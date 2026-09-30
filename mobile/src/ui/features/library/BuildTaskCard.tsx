/**
 * BuildTaskCard — a persisted build run rendered from the database (closeout
 * C4, plan §8). Every number on this card is a committed DB counter (or a
 * live COUNT over world_build_units), so it survives page exits and process
 * restarts; there is no timer-driven or synthetic percentage and no fake ETA.
 *
 * Real-device P0-4/P1-5: the action row is driven by the full control state
 * (status + pauseRequested/cancelRequested + lease), not the status column
 * alone; "停止构建" persists stopped_user and never removes the run or its
 * completed units; retry counters are derived live so a 69-unit run with 176
 * historical failed attempts renders "待重试 ≤69", with the cumulative count
 * reserved for the expanded detail.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar } from '../../components/Bar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import type { BuildTaskView } from '../../../buildTasks';
import {
  formatActivityClock,
  listFailedUnits,
  taskActivityLine,
  taskProgressLine,
  taskStatusLabel,
} from '../../../buildTasks';

export function BuildTaskCard(props: {
  task: BuildTaskView;
  onResume: (runId: string) => void;
  onPause: (runId: string) => void;
  onCancel: (runId: string) => void;
  busy: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [failedUnits, setFailedUnits] = useState<Array<{
    unitId: string; status: string; errorCode: string | null; errorMessage: string | null; attempt: number;
  }>>([]);
  const task = props.task;
  const ratio = task.unitsTotal > 0 ? task.unitsDone / task.unitsTotal : 0;
  const isRunning = task.status === 'running';
  const stopping = isRunning && task.cancelRequested;
  const pausing = isRunning && task.pauseRequested && !stopping;
  // Resume while running is allowed when the user wants to undo a just-made
  // pause request, or when no live lease protects another executor.
  const canResume = !isRunning || pausing || task.leaseHeld === false;
  const activityLine = taskActivityLine(task);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    listFailedUnits(task.runId)
      .then(units => { if (!cancelled) setFailedUnits(units); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [expanded, task.runId, task.lastActivityAt]);

  return (
    <Card>
      <View style={styles.headerRow}>
        <Text
          style={[styles.title, { color: theme.text.primary }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {task.title}
        </Text>
        <Text style={[styles.status, { color: theme.text.secondary }]}>
          {taskStatusLabel(task)}
        </Text>
      </View>
      <Bar
        ratio={ratio}
        label="进度"
        valueText={`${task.unitsDone}/${task.unitsTotal}`}
        accessibilityLabel={`构建进度 ${task.unitsDone} of ${task.unitsTotal} 组`}
      />
      <Text style={[styles.line, { color: theme.text.secondary }]} numberOfLines={2}>
        {taskProgressLine(task)}
      </Text>
      {pausing ? (
        <Text style={[styles.line, { color: theme.text.secondary }]} numberOfLines={1}>
          正在等待当前模型请求结束后暂停，可撤销
        </Text>
      ) : null}
      {stopping ? (
        <Text style={[styles.line, { color: theme.text.secondary }]} numberOfLines={1}>
          正在等待当前模型请求结束后停止
        </Text>
      ) : null}
      {activityLine ? (
        <Text style={[styles.line, { color: theme.text.secondary }]} numberOfLines={1}>
          {activityLine}
        </Text>
      ) : null}
      {task.lastErrorCode ? (
        <Text style={[styles.error, { color: theme.text.secondary }]} numberOfLines={2}>
          {`${task.lastErrorCode}: ${task.lastErrorMessage ?? ''}`.slice(0, 160)}
        </Text>
      ) : null}
      <View style={[styles.actions, { gap: theme.space.sm, marginTop: theme.space.sm }]}>
        {isRunning && !pausing && !stopping ? (
          <Button label="暂停" onPress={() => props.onPause(task.runId)} disabled={props.busy} />
        ) : null}
        {task.status !== 'canceled' && task.status !== 'completed'
          && task.status !== 'failed_terminal' && !stopping ? (
          <Button
            label="停止构建"
            variant="secondary"
            onPress={() => props.onCancel(task.runId)}
            disabled={props.busy}
            testID={`task-stop-${task.runId}`}
          />
        ) : null}
        {canResume ? (
          <Button
            label={pausing ? '撤销暂停' : task.unitsDone > 0 ? '继续构建' : '开始构建'}
            onPress={() => props.onResume(task.runId)}
            disabled={props.busy}
            testID={`task-resume-${task.runId}`}
          />
        ) : null}
        <Button
          label={expanded ? '收起明细' : '查看明细'}
          variant="secondary"
          onPress={() => setExpanded(value => !value)}
        />
      </View>
      {expanded ? (
        <View style={styles.detail}>
          <Text style={[styles.detailText, { color: theme.text.secondary }]}>
            {[
              `runId: ${task.runId}`,
              `状态: ${taskStatusLabel(task)} · 完成 ${task.unitsDone}/${task.unitsTotal} 组`,
              `处理中 ${task.unitsRunning} · 待重试 ${task.unitsRetryable} · 排队 ${task.unitsQueued}`,
              `累计失败尝试 ${task.unitsFailed} 次（历史计数，非当前待重试组数）`,
              task.lastErrorCode ? `最近错误: ${task.lastErrorCode} ${task.lastErrorMessage ?? ''}`.slice(0, 160) : null,
              `最近活动: ${formatActivityClock(task.lastActivityAt) || task.lastActivityAt}`,
            ].filter(Boolean).join('\n')}
          </Text>
          {failedUnits.length > 0 ? (
            <Text style={[styles.detailText, { color: theme.text.secondary, marginTop: 6 }]}>
              {`最近失败组：\n${failedUnits.map(unit =>
                `${unit.unitId} · 第 ${unit.attempt} 次尝试 · ${unit.errorCode ?? 'unknown'}${unit.errorMessage ? ` · ${unit.errorMessage.slice(0, 80)}` : ''}`,
              ).join('\n')}`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  status: { fontSize: 12 },
  line: { fontSize: 13 },
  error: { fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  detail: { marginTop: 6 },
  detailText: { fontSize: 11 },
});
