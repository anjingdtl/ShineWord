/**
 * ImportNovelCard — 书库 primary action: pick a TXT and start the unified
 * build, plus the portable world-package import (plan §7.2/§7.3).
 *
 * The two product build modes (unified P3): 循序构建 first builds the opening
 * stage (~30%, chapter-aligned) through the FULL quality pipeline and later
 * stages wait for narrative triggers; 完整构建 covers the whole book before
 * the world opens. No bounded-opening shortcut is offered for these worlds.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SegmentedControl } from '../../components/SegmentedControl';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';

export type BuildMode = 'progressive' | 'full';

export function ImportNovelCard(props: {
  busy: boolean;
  mode: BuildMode;
  onModeChange: (mode: BuildMode) => void;
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
            {props.mode === 'progressive'
              ? '先完整构建前 30% 再开局，后续阶段由剧情触发'
              : '全书构建完成并发布后开局'}
          </Text>
        </View>
      </View>
      <View style={{ height: theme.space.md }} />
      <SegmentedControl
        options={[
          { value: 'progressive', label: '循序构建' },
          { value: 'full', label: '完整构建' },
        ]}
        value={props.mode}
        onChange={value => props.onModeChange(value as BuildMode)}
        testID="library-build-mode"
      />
      <View style={{ height: theme.space.md }} />
      <Button
        label={props.busy ? '导入并排队构建中…' : props.mode === 'progressive' ? '选择 TXT 并循序构建' : '选择 TXT 并完整构建'}
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
