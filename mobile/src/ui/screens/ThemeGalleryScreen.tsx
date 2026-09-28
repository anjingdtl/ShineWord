/**
 * ThemeGalleryScreen — a temporary inspection harness (P1 deliverable).
 *
 * It is deliberately NOT wired into the product navigation: it exists so the
 * four skins can be eyeballed side by side and screenshotted into
 * `docs/reviews/ui/`. It reaches the app through a hidden long-press entry on
 * the settings title and is removed once P5 polish lands.
 *
 * Every component below is rendered exactly as the product will render it —
 * this screen contains no styling of its own beyond layout.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChapterDivider, BackgroundPattern, ScanlineOverlay, useTheme } from '../theme';
import { ScreenShell } from '../components/ScreenShell';
import { THEME_ORDER, type ThemeId } from '../theme/tokens';
import {
  AttributePips,
  Bar,
  Button,
  Card,
  Chip,
  DieBadge,
  EmptyState,
  Header,
  PipTrack,
  typeStyle,
} from '../components';

export function ThemeGalleryScreen(props: { onClose: () => void }): React.JSX.Element {
  const { theme, themeId, setThemeId } = useTheme();

  return (
    <ScreenShell>
      <BackgroundPattern />
      <ScanlineOverlay />

      <Header
        title={`主题自检 · ${theme.label}`}
        subtitle="P1 组件库目检台（临时页面）"
        onBack={props.onClose}
        backLabel="‹ 关闭"
      />

      <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl }} style={styles.scroll}>
        {/* ---- switcher: four skins ---- */}
        <View style={[styles.section, { padding: theme.space.lg, gap: theme.space.sm }]}>
          <Text style={[typeStyle(theme, theme.type.label), { color: theme.text.secondary }]}>
            切换皮肤
          </Text>
          <View style={[styles.wrap, { gap: theme.space.sm }]}>
            {THEME_ORDER.map((id: ThemeId) => (
              <Chip
                key={id}
                label={`${THEME_ORDER.indexOf(id) + 1} · ${id}`}
                selected={id === themeId}
                onPress={() => setThemeId(id)}
                testID={`theme-chip-${id}`}
              />
            ))}
          </View>
        </View>

        <ChapterDivider label="BUTTON" />

        <View style={[styles.section, { padding: theme.space.lg, gap: theme.space.md }]}>
          <Text style={[typeStyle(theme, theme.type.heading), { color: theme.accentText }]}>
            按钮 · 三态 + 按压反馈
          </Text>
          <Button label="主要行动" variant="primary" onPress={() => undefined} block />
          <View style={[styles.wrap, { gap: theme.space.sm }]}>
            <Button label="次要" variant="secondary" onPress={() => undefined} />
            <Button label="已选中" variant="secondary" selected onPress={() => undefined} />
            <Button label="禁用" variant="secondary" disabled />
          </View>
          <View style={[styles.wrap, { gap: theme.space.sm }]}>
            <Chip label="普通选项" onPress={() => undefined} />
            <Chip label="高亮建议" hot onPress={() => undefined} />
            <Chip label="已选" selected onPress={() => undefined} />
          </View>
        </View>

        <ChapterDivider label="CARD" />

        <View style={[styles.section, { padding: theme.space.lg, gap: theme.space.md }]}>
          <Card ornament>
            <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
              叙事卡 · 四角花
            </Text>
            <Text
              style={[
                typeStyle(theme, theme.type.body),
                { color: theme.onRaised.primary, marginTop: theme.space.sm },
              ]}>
              雨敲在青瓦上，碎成一片白噪音。你推门进去时，管家正把一封火漆信往袖子里塞——这是正文样张，用于核对行高与对比度。
            </Text>
          </Card>
          <Card tone="overlay">
            <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
              overlay 卡片：骰点条 / 内嵌块
            </Text>
          </Card>
          <Card onPress={() => undefined}>
            <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
              可点击卡片（按压有反馈）
            </Text>
          </Card>
        </View>

        <ChapterDivider label="PIP / BAR / DIE" />

        <View style={[styles.section, { padding: theme.space.lg, gap: theme.space.md }]}>
          <Card>
            <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
              属性 pip（1–3）
            </Text>
            <View style={{ gap: theme.space.sm, marginTop: theme.space.sm }}>
              {[3, 2, 2, 1].map((value, index) => (
                <View key={index} style={[styles.row, { gap: theme.space.sm }]}>
                  <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
                    {'体魄 敏捷 洞察 学识'.split(' ')[index]}
                  </Text>
                  <AttributePips value={value} />
                </View>
              ))}
              <View style={[styles.row, { gap: theme.space.sm }]}>
                <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
                  半格
                </Text>
                <PipTrack total={10} on={7} half />
              </View>
            </View>
          </Card>

          <Card>
            <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
              资源条
            </Text>
            <View style={{ marginTop: theme.space.md }}>
              <Bar label="气血" ratio={0.7} valueText="7/10" />
              <Bar label="体力" variant="alt" ratio={1} valueText="10/10" />
            </View>
          </Card>

          <Card>
            <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
              骰面徽章 d4–d12
            </Text>
            <View style={[styles.wrap, { gap: theme.space.sm, marginTop: theme.space.sm }]}>
              {[4, 6, 8, 10, 12].map(sides => (
                <DieBadge key={sides} sides={sides} />
              ))}
            </View>
          </Card>
        </View>

        <ChapterDivider label="EMPTY" />

        <View style={[styles.section, { padding: theme.space.lg, gap: theme.space.md }]}>
          <EmptyState
            title="还没有导入小说"
            description="点击上方按钮导入 TXT，系统会构建三宝书并生成规则。"
            action={<Button label="导入小说 TXT" onPress={() => undefined} />}
          />
        </View>

        <ChapterDivider />

        <View style={[styles.section, { padding: theme.space.lg }]}>
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted }]}>
            皮肤 id：{theme.id} · 圆角基准 {theme.radius.md}dp · 触控下限 {theme.touch.min}dp ·
            {' '}
            {theme.effects.scanlines ? '扫描线开' : '扫描线关'}
          </Text>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  section: { width: '100%' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
