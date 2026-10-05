/**
 * AvatarCard — the app-level avatar picker on the 我的 screen (plan §6.1).
 *
 * Structure clones the proven ThemeSkinCard: Card + SectionHeader + a tile
 * grid with radio semantics and an accent outline on the selection. Tiles are
 * grouped by theme tabs (order = THEME_ORDER; the initial tab recommends the
 * current skin's theme but does not follow later reskins) and two gender rows
 * of five 56dp circular tiles. Selection is outlined *and* badged so it never
 * relies on colour alone (§30).
 */
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { SegmentedControl } from '../../components/SegmentedControl';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { THEME_ORDER, type ThemeId } from '../../theme/tokens';
import {
  AVATAR_PRESETS,
  AVATAR_THEME_LABEL,
  findAvatar,
  type AvatarGender,
  type AvatarPreset,
  type AvatarThemeId,
} from './avatarRegistry';
import { useAvatar } from './AvatarContext';

/** Plan §6.1 fixes the tile diameter at 56dp (not a space-token step). */
const TILE_SIZE = 56;

const GENDER_ROWS: ReadonlyArray<readonly [AvatarGender, string]> = [
  ['m', '男'],
  ['f', '女'],
];

export function AvatarCard(): React.JSX.Element {
  const { theme, themeId } = useTheme();
  const { avatarId, setAvatarId } = useAvatar();
  // Initial tab only — a later skin change must not yank the grid around.
  const [activeTheme, setActiveTheme] = useState<AvatarThemeId>(themeId);
  const avatar = findAvatar(avatarId);

  return (
    <Card>
      <SectionHeader
        title="玩家头像"
        subtitle={`当前：${avatar ? avatar.label : '默认字牌（未设置）'}`}
      />
      <SegmentedControl
        testID="avatar-theme-tabs"
        options={THEME_ORDER.map((id: ThemeId) => ({ value: id, label: AVATAR_THEME_LABEL[id] }))}
        value={activeTheme}
        onChange={setActiveTheme}
      />
      {GENDER_ROWS.map(([gender, genderLabel]) => (
        <View key={gender} style={{ marginTop: theme.space.md, gap: theme.space.xs }}>
          <Text style={[typeStyle(theme, theme.type.label), { color: theme.onRaised.secondary }]}>
            {genderLabel}
          </Text>
          <View style={[styles.row, { gap: theme.space.xs }]}>
            {AVATAR_PRESETS.filter(preset => preset.theme === activeTheme && preset.gender === gender).map(
              preset => (
                <AvatarTile
                  key={preset.id}
                  preset={preset}
                  selected={preset.id === avatarId}
                  onSelect={() => setAvatarId(preset.id)}
                />
              ),
            )}
          </View>
        </View>
      ))}
      <Pressable
        onPress={() => setAvatarId(null)}
        accessibilityRole="radio"
        accessibilityState={{ selected: avatarId === null }}
        accessibilityLabel={`不使用头像（默认字牌）${avatarId === null ? '（当前）' : ''}`}
        testID="avatar-option-none"
        style={({ pressed }) => [
          styles.noneRow,
          {
            marginTop: theme.space.md,
            minHeight: theme.touch.min,
            borderRadius: theme.radius.md,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          {avatarId === null ? '✓ ' : '○ '}
          不使用头像（默认字牌）
        </Text>
      </Pressable>
    </Card>
  );
}

function AvatarTile(props: { preset: AvatarPreset; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const { theme } = useTheme();
  const { preset, selected } = props;
  return (
    <Pressable
      onPress={props.onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${preset.label}${selected ? '（当前）' : ''}`}
      testID={`avatar-option-${preset.id}`}
      style={({ pressed }) => [
        styles.tile,
        {
          padding: theme.space.xs,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <View
        style={[
          styles.tileImage,
          {
            width: TILE_SIZE,
            height: TILE_SIZE,
            borderRadius: theme.radius.pill,
            borderColor: selected ? theme.accent.primary : theme.border.color,
            borderWidth: selected ? theme.border.hairline + 1 : theme.border.hairline,
          },
        ]}>
        <Image source={preset.source} style={styles.tileImageContent} resizeMode="cover" />
      </View>
      {selected ? (
        <View
          pointerEvents="none"
          style={[
            styles.badge,
            {
              right: -theme.space.xs,
              bottom: -theme.space.xs,
              width: theme.space.lg,
              height: theme.space.lg,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.accent.secondary,
            },
          ]}>
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.bg.base }]}>✓</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  tileImage: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tileImageContent: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noneRow: { alignItems: 'center', justifyContent: 'center' },
});
