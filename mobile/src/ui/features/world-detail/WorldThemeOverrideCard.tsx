/**
 * WorldThemeOverrideCard — the world-level skin override (plan §10.1).
 *
 * Writes through the P1 storage (`worldId -> themeId`, key
 * `shineword.ui.worldTheme`) and shows which skin currently takes effect while
 * the world pages are open. Choosing 跟随全局 clears the override.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { SectionHeader } from '../../components/SectionHeader';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { THEMES, THEME_ORDER, type ThemeId } from '../../theme/tokens';

export function WorldThemeOverrideCard(props: { worldId: string }): React.JSX.Element {
  const { theme, globalThemeId, worldThemeMap, setWorldThemeId, themeIdForWorld } = useTheme();
  const override = worldThemeMap[props.worldId] ?? null;
  const effective = themeIdForWorld(props.worldId);

  return (
    <Card>
      <SectionHeader
        title="世界主题"
        subtitle={`当前生效：${THEMES[effective].label}（${override ? '世界覆盖' : '跟随全局'}）`}
      />
      <View style={[styles.wrap, { gap: theme.space.sm }]}>
        <Chip
          label="跟随全局"
          selected={override === null}
          onPress={() => setWorldThemeId(props.worldId, null)}
          testID="world-theme-follow"
        />
        {THEME_ORDER.map((id: ThemeId) => (
          <Chip
            key={id}
            label={THEMES[id].name}
            selected={override === id}
            onPress={() => setWorldThemeId(props.worldId, id)}
            testID={`world-theme-${id}`}
          />
        ))}
      </View>
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, marginTop: theme.space.md },
        ]}>
        世界主题只影响这个世界的页面（资料 / 三宝书 / 审查 / 世界包，游玩页随 P4 接入）；
        全局皮肤仍是「{THEMES[globalThemeId].label}」，其他页面不受影响。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});