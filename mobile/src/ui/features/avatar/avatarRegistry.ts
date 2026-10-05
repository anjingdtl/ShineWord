/**
 * avatarRegistry — the 40-preset avatar library (plan §4/附录 A).
 *
 * The presets come from the four sprite sheets split by
 * `tools/avatars/split_avatar_sheets.py`. Every entry uses a *literal*
 * `require()` — Metro cannot resolve runtime-built asset paths — ordered by
 * THEME_ORDER, then male/female, then job slot.
 *
 * Avatar themes reuse the skin `ThemeId` vocabulary (plan §2: 四题材与四套
 * 皮肤一一对应), but the avatar itself is app-level identity and never follows
 * a world's ThemeScope.
 */
import type { ImageSourcePropType } from 'react-native';
import type { ThemeId } from '../../theme/tokens';

export type AvatarGender = 'm' | 'f';
export type AvatarThemeId = ThemeId; // ink | fantasy | manga | scifi

export interface AvatarPreset {
  /** Stable id, `{theme}-{gender}-{slot}`, e.g. 'ink-m-1'. */
  id: string;
  theme: AvatarThemeId;
  gender: AvatarGender;
  /** Job slot 1..5, column order in the source sheet. */
  slot: number;
  /** Shared by a11y labels and the picker subtitle, e.g. '东方武侠 · 男 · 侠客'. */
  label: string;
  source: ImageSourcePropType;
}

export const AVATAR_THEME_LABEL: Record<AvatarThemeId, string> = {
  ink: '东方武侠',
  fantasy: '欧洲奇幻',
  manga: '日系二次元',
  scifi: '赛博科幻',
};

export const AVATAR_ROLES: Record<AvatarThemeId, string[]> = {
  ink: ['侠客', '弓手', '谋士', '刺客', '雅士'],
  fantasy: ['骑士', '游侠', '法师', '盗贼', '牧师'],
  manga: ['武士', '游侠', '法师', '忍者', '神官'],
  scifi: ['佣兵', '技师', '骇客', '浪人', '医师'],
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'ink-m-1', theme: 'ink', gender: 'm', slot: 1, label: '东方武侠 · 男 · 侠客', source: require('../../../assets/avatars/ink_m_1.webp') },
  { id: 'ink-m-2', theme: 'ink', gender: 'm', slot: 2, label: '东方武侠 · 男 · 弓手', source: require('../../../assets/avatars/ink_m_2.webp') },
  { id: 'ink-m-3', theme: 'ink', gender: 'm', slot: 3, label: '东方武侠 · 男 · 谋士', source: require('../../../assets/avatars/ink_m_3.webp') },
  { id: 'ink-m-4', theme: 'ink', gender: 'm', slot: 4, label: '东方武侠 · 男 · 刺客', source: require('../../../assets/avatars/ink_m_4.webp') },
  { id: 'ink-m-5', theme: 'ink', gender: 'm', slot: 5, label: '东方武侠 · 男 · 雅士', source: require('../../../assets/avatars/ink_m_5.webp') },
  { id: 'ink-f-1', theme: 'ink', gender: 'f', slot: 1, label: '东方武侠 · 女 · 侠客', source: require('../../../assets/avatars/ink_f_1.webp') },
  { id: 'ink-f-2', theme: 'ink', gender: 'f', slot: 2, label: '东方武侠 · 女 · 弓手', source: require('../../../assets/avatars/ink_f_2.webp') },
  { id: 'ink-f-3', theme: 'ink', gender: 'f', slot: 3, label: '东方武侠 · 女 · 谋士', source: require('../../../assets/avatars/ink_f_3.webp') },
  { id: 'ink-f-4', theme: 'ink', gender: 'f', slot: 4, label: '东方武侠 · 女 · 刺客', source: require('../../../assets/avatars/ink_f_4.webp') },
  { id: 'ink-f-5', theme: 'ink', gender: 'f', slot: 5, label: '东方武侠 · 女 · 雅士', source: require('../../../assets/avatars/ink_f_5.webp') },
  { id: 'fantasy-m-1', theme: 'fantasy', gender: 'm', slot: 1, label: '欧洲奇幻 · 男 · 骑士', source: require('../../../assets/avatars/fantasy_m_1.webp') },
  { id: 'fantasy-m-2', theme: 'fantasy', gender: 'm', slot: 2, label: '欧洲奇幻 · 男 · 游侠', source: require('../../../assets/avatars/fantasy_m_2.webp') },
  { id: 'fantasy-m-3', theme: 'fantasy', gender: 'm', slot: 3, label: '欧洲奇幻 · 男 · 法师', source: require('../../../assets/avatars/fantasy_m_3.webp') },
  { id: 'fantasy-m-4', theme: 'fantasy', gender: 'm', slot: 4, label: '欧洲奇幻 · 男 · 盗贼', source: require('../../../assets/avatars/fantasy_m_4.webp') },
  { id: 'fantasy-m-5', theme: 'fantasy', gender: 'm', slot: 5, label: '欧洲奇幻 · 男 · 牧师', source: require('../../../assets/avatars/fantasy_m_5.webp') },
  { id: 'fantasy-f-1', theme: 'fantasy', gender: 'f', slot: 1, label: '欧洲奇幻 · 女 · 骑士', source: require('../../../assets/avatars/fantasy_f_1.webp') },
  { id: 'fantasy-f-2', theme: 'fantasy', gender: 'f', slot: 2, label: '欧洲奇幻 · 女 · 游侠', source: require('../../../assets/avatars/fantasy_f_2.webp') },
  { id: 'fantasy-f-3', theme: 'fantasy', gender: 'f', slot: 3, label: '欧洲奇幻 · 女 · 法师', source: require('../../../assets/avatars/fantasy_f_3.webp') },
  { id: 'fantasy-f-4', theme: 'fantasy', gender: 'f', slot: 4, label: '欧洲奇幻 · 女 · 盗贼', source: require('../../../assets/avatars/fantasy_f_4.webp') },
  { id: 'fantasy-f-5', theme: 'fantasy', gender: 'f', slot: 5, label: '欧洲奇幻 · 女 · 牧师', source: require('../../../assets/avatars/fantasy_f_5.webp') },
  { id: 'manga-m-1', theme: 'manga', gender: 'm', slot: 1, label: '日系二次元 · 男 · 武士', source: require('../../../assets/avatars/manga_m_1.webp') },
  { id: 'manga-m-2', theme: 'manga', gender: 'm', slot: 2, label: '日系二次元 · 男 · 游侠', source: require('../../../assets/avatars/manga_m_2.webp') },
  { id: 'manga-m-3', theme: 'manga', gender: 'm', slot: 3, label: '日系二次元 · 男 · 法师', source: require('../../../assets/avatars/manga_m_3.webp') },
  { id: 'manga-m-4', theme: 'manga', gender: 'm', slot: 4, label: '日系二次元 · 男 · 忍者', source: require('../../../assets/avatars/manga_m_4.webp') },
  { id: 'manga-m-5', theme: 'manga', gender: 'm', slot: 5, label: '日系二次元 · 男 · 神官', source: require('../../../assets/avatars/manga_m_5.webp') },
  { id: 'manga-f-1', theme: 'manga', gender: 'f', slot: 1, label: '日系二次元 · 女 · 武士', source: require('../../../assets/avatars/manga_f_1.webp') },
  { id: 'manga-f-2', theme: 'manga', gender: 'f', slot: 2, label: '日系二次元 · 女 · 游侠', source: require('../../../assets/avatars/manga_f_2.webp') },
  { id: 'manga-f-3', theme: 'manga', gender: 'f', slot: 3, label: '日系二次元 · 女 · 法师', source: require('../../../assets/avatars/manga_f_3.webp') },
  { id: 'manga-f-4', theme: 'manga', gender: 'f', slot: 4, label: '日系二次元 · 女 · 忍者', source: require('../../../assets/avatars/manga_f_4.webp') },
  { id: 'manga-f-5', theme: 'manga', gender: 'f', slot: 5, label: '日系二次元 · 女 · 神官', source: require('../../../assets/avatars/manga_f_5.webp') },
  { id: 'scifi-m-1', theme: 'scifi', gender: 'm', slot: 1, label: '赛博科幻 · 男 · 佣兵', source: require('../../../assets/avatars/scifi_m_1.webp') },
  { id: 'scifi-m-2', theme: 'scifi', gender: 'm', slot: 2, label: '赛博科幻 · 男 · 技师', source: require('../../../assets/avatars/scifi_m_2.webp') },
  { id: 'scifi-m-3', theme: 'scifi', gender: 'm', slot: 3, label: '赛博科幻 · 男 · 骇客', source: require('../../../assets/avatars/scifi_m_3.webp') },
  { id: 'scifi-m-4', theme: 'scifi', gender: 'm', slot: 4, label: '赛博科幻 · 男 · 浪人', source: require('../../../assets/avatars/scifi_m_4.webp') },
  { id: 'scifi-m-5', theme: 'scifi', gender: 'm', slot: 5, label: '赛博科幻 · 男 · 医师', source: require('../../../assets/avatars/scifi_m_5.webp') },
  { id: 'scifi-f-1', theme: 'scifi', gender: 'f', slot: 1, label: '赛博科幻 · 女 · 佣兵', source: require('../../../assets/avatars/scifi_f_1.webp') },
  { id: 'scifi-f-2', theme: 'scifi', gender: 'f', slot: 2, label: '赛博科幻 · 女 · 技师', source: require('../../../assets/avatars/scifi_f_2.webp') },
  { id: 'scifi-f-3', theme: 'scifi', gender: 'f', slot: 3, label: '赛博科幻 · 女 · 骇客', source: require('../../../assets/avatars/scifi_f_3.webp') },
  { id: 'scifi-f-4', theme: 'scifi', gender: 'f', slot: 4, label: '赛博科幻 · 女 · 浪人', source: require('../../../assets/avatars/scifi_f_4.webp') },
  { id: 'scifi-f-5', theme: 'scifi', gender: 'f', slot: 5, label: '赛博科幻 · 女 · 医师', source: require('../../../assets/avatars/scifi_f_5.webp') },
];

/**
 * Safe lookup: a missing id (including `null` = "no avatar") resolves to null
 * and every caller falls back to the default nameplate, mirroring
 * `getTheme()`'s defensive semantics.
 */
export function findAvatar(id: string | null | undefined): AvatarPreset | null {
  if (!id) return null;
  return AVATAR_PRESETS.find(preset => preset.id === id) ?? null;
}
