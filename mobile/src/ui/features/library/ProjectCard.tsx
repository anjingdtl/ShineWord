/**
 * ProjectCard — one compact row of the project list (task §17).
 *
 * The top-level library shows PROJECTS, not build tasks: title, chapter
 * count, aggregate status, last update and the two intents that matter -
 * enter the project workspace, or jump straight into the adventure when one
 * exists. Build details live inside the project, behind the ⋯ menu.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import { PROJECT_STATUS_LABEL, type ProjectStatusProjection } from '../../../projectLibrary';

export function ProjectCard(props: {
  project: ProjectStatusProjection;
  onOpenProject: () => void;
  onPrimary: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { project } = props;
  const statusLabel = PROJECT_STATUS_LABEL[project.buildStatus] ?? project.buildStatus;
  const primaryLabel = project.campaign ? '继续冒险' : project.playable ? '开始冒险' : null;

  const statusColor = project.buildStatus === 'playable'
    ? theme.accentText
    : project.buildStatus === 'building'
      ? theme.text.primary
      : project.buildStatus === 'attention' || project.buildStatus === 'review'
        ? theme.text.primary
        : theme.onRaised.secondary;

  return (
    <Card radiusSize="sm">
      <View style={styles.headRow}>
        <Text
          style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary, flex: 1 }]}
          numberOfLines={1}>
          {project.title}
        </Text>
        <Button
          label="⋯"
          variant="chip"
          onPress={props.onDelete}
          accessibilityLabel="项目操作"
          testID={`project-menu-${project.worldId}`}
        />
      </View>
      <View style={[styles.meta, { gap: theme.space.sm, marginTop: theme.space.xs }]}>
        <Text style={[typeStyle(theme, theme.type.caption), { color: statusColor }]}>
          {`状态：${statusLabel}`}
        </Text>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          {`${project.chapterCount} 章 · 更新于 ${project.updatedAt.slice(0, 10)}`}
        </Text>
      </View>
      {project.activeRun && project.activeRun.total > 0 ? (
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary, marginTop: theme.space.xs }]}>
          {`LLM：${project.activeRun.done} / ${project.activeRun.total} 批 · 后台继续构建世界资料`}
        </Text>
      ) : null}
      <View style={[styles.actions, { marginTop: theme.space.md, gap: theme.space.sm }]}>
        <Button label="进入项目" variant="secondary" onPress={props.onOpenProject} />
        {primaryLabel ? (
          <Button label={primaryLabel} variant="primary" onPress={props.onPrimary} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
