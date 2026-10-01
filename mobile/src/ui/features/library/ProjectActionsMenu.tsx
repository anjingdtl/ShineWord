import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

/** Selecting the action opens a separate destructive confirmation. */
export function ProjectActionsMenu(props: {
  visible: boolean;
  title: string;
  onDelete: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  if (!props.visible) return <></>;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={[styles.backdrop, { backgroundColor: theme.bg.sunken }]}>
        <View style={[styles.sheet, { backgroundColor: theme.bg.raised, gap: theme.space.md }]}>
          <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
            {`项目操作 · ${props.title}`}
          </Text>
          <Button label="删除项目" variant="secondary" onPress={props.onDelete} testID="project-action-delete" />
          <Button label="取消" variant="chip" onPress={props.onCancel} />
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: 24 },
  sheet: { width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 16, padding: 20 },
});
