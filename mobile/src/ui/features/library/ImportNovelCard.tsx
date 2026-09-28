/**
 * ImportNovelCard — 书库 primary action: pick a TXT and start the on-device
 * build, plus the portable world-package import (plan §7.2/§7.3).
 *
 * The default path builds an explicitly partial playable opening. Full-novel
 * refinement is an optional later action; import does not silently queue it.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';

export function ImportNovelCard(props: {
  busy: boolean;
  onImportNovel: () => void;
  onImportPackage: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Card>
      <View style={[styles.head, { gap: theme.space.md }]}>
        <View
          style={{
            width: theme.space.xxl,
            height: theme.space.xxl,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.md,
            borderWidth: theme.border.hairline,
            borderColor: theme.border.colorStrong,
            backgroundColor: theme.bg.overlay,
          }}>
          <Text style={[typeStyle(theme, theme.type.heading), { color: theme.accentText }]}>＋</Text>
        </View>
        <View style={styles.headText}>
          <Text style={[typeStyle(theme, theme.type.heading), { color: theme.onRaised.primary }]}>
            导入小说 TXT
          </Text>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
            先整理开局，完整小说随探索补齐
          </Text>
        </View>
      </View>
      <View style={{ height: theme.space.md }} />
      <Button
        label={props.busy ? '准备开局中…' : '选择 TXT 并快速开局'}
        onPress={props.onImportNovel}
        disabled={props.busy}
        block
        testID="library-import-novel"
      />
      <View style={{ height: theme.space.sm }} />
      <Button
        label="导入世界包"
        variant="secondary"
        onPress={props.onImportPackage}
        disabled={props.busy}
        block
        testID="library-import-package"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  headText: { flex: 1 },
});
