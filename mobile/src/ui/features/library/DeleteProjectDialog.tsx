/**
 * DeleteProjectDialog — the two-step destructive confirm (task §25/§26).
 *
 * Plain delete spells out every data category that dies with the project and
 * reassures the user the original TXT on the phone is untouched. A building
 * project swaps the confirm into "stop and delete", which waits for the
 * in-flight paid request to finish before the transactional cascade runs -
 * never a force-delete under a live executor.
 */
import React from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';

const DELETION_TARGETS = [
  '原文解析数据',
  '世界构建数据',
  '构建任务',
  '三宝书',
  '世界包',
  '战役',
  '分支',
  '存档',
  '故事记忆',
  '审查数据',
] as const;

export type DeleteProjectPhase = 'confirm' | 'stopping' | 'deleting' | 'error';

export function DeleteProjectDialog(props: {
  visible: boolean;
  title: string;
  building: boolean;
  phase: DeleteProjectPhase;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { visible, title, building, phase } = props;
  if (!visible) return <></>;
  const busy = phase === 'stopping' || phase === 'deleting';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={busy ? undefined : props.onCancel}>
      <View style={[styles.backdrop, { backgroundColor: theme.bg.sunken }]}>
        <View style={[styles.sheet, { backgroundColor: theme.bg.raised }]}>
          <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
            {building ? '停止并删除项目？' : `删除「${title}」？`}
          </Text>
          {building ? (
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, marginTop: theme.space.sm }]}>
              项目正在构建。需要先安全停止构建再删除。
            </Text>
          ) : (
            <>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, marginTop: theme.space.sm }]}>
                将同时删除本项目的：
              </Text>
              <ScrollView style={styles.list}>
                {DELETION_TARGETS.map(target => (
                  <Text
                    key={target}
                    style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
                    {`- ${target}`}
                  </Text>
                ))}
              </ScrollView>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, marginTop: theme.space.xs }]}>
                不可恢复。
              </Text>
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary, marginTop: theme.space.xs }]}>
                原始手机 TXT 文件不会被删除。
              </Text>
            </>
          )}
          {phase === 'error' && props.errorMessage ? (
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.semanticText.bad, marginTop: theme.space.sm }]}>
              {props.errorMessage}
            </Text>
          ) : null}
          {busy ? (
            <View style={[styles.busy, { marginTop: theme.space.md, gap: theme.space.sm }]}>
              <ActivityIndicator color={theme.accentText} />
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
                {phase === 'stopping' ? '正在等待当前模型请求安全结束…' : '正在删除项目数据…'}
              </Text>
            </View>
          ) : (
            <View style={[styles.actions, { marginTop: theme.space.md, gap: theme.space.sm }]}>
              <Button label="取消" variant="secondary" onPress={props.onCancel} disabled={busy} />
              <Button label={building ? '停止并删除' : '删除项目'} variant="primary" onPress={props.onConfirm} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420, borderRadius: 16, padding: 20 },
  list: { marginTop: 4, maxHeight: 180 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap' },
  busy: { flexDirection: 'row', alignItems: 'center' },
});
