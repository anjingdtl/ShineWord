/**
 * BuildTaskCard — a persisted build run rendered from the database (closeout
 * C4, plan §8). Every number on this card is a committed DB counter, so it
 * survives page exits and process restarts; there is no timer-driven or
 * synthetic percentage. Failed runs surface their error class and the first
 * blocked units so the user knows exactly what a retry will redo.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar } from '../../components/Bar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import type { BuildTaskView } from '../../../buildTasks';
import { RUN_STATUS_LABEL, taskProgressLine } from '../../../buildTasks';

export function BuildTaskCard(props: {
  task: BuildTaskView;
  onResume: (runId: string) => void;
  onPause: (runId: string) => void;
  busy: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const task = props.task;
  const ratio = task.unitsTotal > 0 ? task.unitsDone / task.unitsTotal : 0;
  const canResume = task.status !== 'running' || task.leaseHeld === false;
  const isRunning = task.status === 'running';
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
          {RUN_STATUS_LABEL[task.status] ?? task.status}
        </Text>
      </View>
      <Bar
        ratio={ratio}
        label="进度"
        valueText={`${task.unitsDone}/${task.unitsTotal}`}
        accessibilityLabel={`构建进度 ${task.unitsDone} of ${task.unitsTotal} 组`}
      />
      <Text style={[styles.line, { color: theme.text.secondary }]} numberOfLines={1}>
        {taskProgressLine(task)}
      </Text>
      {task.lastErrorCode ? (
        <Text style={[styles.error, { color: theme.text.secondary }]} numberOfLines={2}>
          {`${task.lastErrorCode}: ${task.lastErrorMessage ?? ''}`.slice(0, 160)}
        </Text>
      ) : null}
      <View style={[styles.actions, { gap: theme.space.sm, marginTop: theme.space.sm }]}>
        {isRunning ? (
          <Button label="暂停" onPress={() => props.onPause(task.runId)} disabled={props.busy} />
        ) : null}
        {canResume ? (
          <Button label={task.unitsDone > 0 ? '继续构建' : '开始构建'} onPress={() => props.onResume(task.runId)} disabled={props.busy} />
        ) : null}
        <Button
          label={expanded ? '收起明细' : '失败明细'}
          variant="secondary"
          onPress={() => setExpanded(value => !value)}
        />
      </View>
      {expanded ? <View style={styles.detail}><Text style={[styles.detailText, { color: theme.text.secondary }]}>
        {`runId: ${task.runId}\n组完成 ${task.unitsDone}/${task.unitsTotal} · 失败计数 ${task.unitsFailed}\n更新于 ${task.updatedAt}`}
      </Text></View> : null}
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
