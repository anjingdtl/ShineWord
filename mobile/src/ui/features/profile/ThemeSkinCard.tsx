/**
 * ThemeSkinCard — the app-level skin picker (plan §9.1).
 *
 * Productised version of the P1/P2 row: each skin is a selectable tile showing
 * its own name, mood line and palette, so the choice is readable before it is
 * committed. The persisted value and the storage key are unchanged.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { Surface } from '../../components/Surface';
import { SectionHeader } from '../../components/SectionHeader';
import { useTheme } from '../../theme/ThemeContext';
import { THEMES, THEME_ORDER, type ThemeId, type ThemeTokens } from '../../theme/tokens';
import { typeStyle } from '../../components/typography';

function Swatches(props: { palette: ThemeTokens }): React.JSX.Element {
  const { theme } = useTheme();
  const colors = [
    props.palette.bg.base,
    props.palette.bg.raised,
    props.palette.accent.primary,
    props.palette.accent.secondary,
  ];
  return (
    <View style={[styles.swatches, { gap: theme.space.xs }]}>
      {colors.map((color, index) => (
        <View
          // Index key: two token slots can legitimately hold the same colour.
          key={`swatch-${index}`}
          style={{
            width: theme.space.lg,
            height: theme.space.sm,
            backgroundColor: color,
            borderWidth: theme.border.hairline,
            borderColor: theme.border.colorStrong,
            borderRadius: theme.radius.sm,
          }}
        />
      ))}
    </View>
  );
}

export function ThemeSkinCard(): React.JSX.Element {
  const { theme, themeId, setThemeId } = useTheme();
  return (
    <Card>
      <SectionHeader title="主题皮肤" subtitle={`当前：${theme.label} · ${theme.tagline}`} />
      <View style={[styles.grid, { gap: theme.space.sm }]}>
        {THEME_ORDER.map((id: ThemeId) => {
          const option = THEMES[id];
          const selected = id === themeId;
          return (
            <Pressable
              key={id}
              onPress={() => setThemeId(id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`主题 ${option.label}${selected ? '（当前）' : ''}`}
              testID={`theme-skin-${id}`}
              style={styles.tile}>
              <Surface
                backgroundColor={theme.bg.overlay}
                borderColor={selected ? theme.accent.primary : theme.border.color}
                borderWidth={selected ? theme.border.hairline + 1 : theme.border.hairline}
                radius={theme.radius.md}
                style={styles.tileSurface}
                contentStyle={{ padding: theme.space.md, gap: theme.space.xs, borderRadius: theme.radius.md }}>
                <Text
                  style={[
                    typeStyle(theme, theme.type.small),
                    { color: theme.onRaised.primary, fontWeight: selected ? '700' : '500' },
                  ]}>
                  {selected ? '✓ ' : ''}
                  {option.label}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                  {option.tagline}
                </Text>
                <Swatches palette={option} />
              </Surface>
            </Pressable>
          );
        })}
      </View>
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, marginTop: theme.space.md },
        ]}>
        每个世界还可以单独指定皮肤（worldId → 主题）；入口在「世界详情 → 资料」。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { flexGrow: 1, flexBasis: '45%' },
  tileSurface: { alignSelf: 'stretch' },
  swatches: { flexDirection: 'row', alignItems: 'center' },
});