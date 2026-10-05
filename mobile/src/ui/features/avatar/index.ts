/**
 * Barrel for the avatar feature (plan §7.1): registry, state and the picker
 * card. Consumers import from here only.
 */
export {
  AVATAR_PRESETS,
  AVATAR_ROLES,
  AVATAR_THEME_LABEL,
  findAvatar,
  type AvatarGender,
  type AvatarPreset,
  type AvatarThemeId,
} from './avatarRegistry';
export { AVATAR_STORAGE_KEY, AvatarProvider, useAvatar, type AvatarContextValue } from './AvatarContext';
export { AvatarCard } from './AvatarCard';
