/**
 * ImportNovelCard — 书库 primary action: pick a TXT and start the on-device
 * build, plus the portable world-package import (plan §7.2/§7.3).
 *
 * Copy is limited to what the build actually does: extraction, mapping and the
 * three books. No chapter counts, ETA or quality score are shown here.
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
            构建人物、事件、规则与三宝书
          </Text>
        </View>
      </View>
      <View style={{ height: theme.space.md }} />
      <Button
        label={props.busy ? '构建中…' : '选择 TXT 并开始构建'}
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