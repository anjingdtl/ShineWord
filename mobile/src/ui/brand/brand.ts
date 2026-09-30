/**
 * Brand layer — the one identity every skin shares (plan §3.2/§3.3).
 *
 * The four world skins change colour and ornament; the product identity does
 * not. These tokens are the only place besides `theme/tokens.ts` where literal
 * colours may appear, and ordinary components must not read them: they exist
 * for the brand assets (mark, wordmark, launcher icon, splash) only.
 */
import { useMemo } from 'react';
import { useTheme } from '../theme/ThemeContext';

/** The single user-visible product name. Never hard-code it in a screen. */
export const PRODUCT_NAME = 'Shine-TRPG';
/** Author credit shown in About/brand surfaces (VERSIONING.md owner). */
export const PRODUCT_AUTHOR = 'ShineHe';
/** Default product description (plan §3.1). */
export const PRODUCT_TAGLINE = 'AI 驱动的互动小说 TRPG';
/** Short description for tight lockups. */
export const PRODUCT_TAGLINE_SHORT = '小说世界里的单人 TRPG';

/** Fixed brand asset colours (plan §3.3). */
export const BRAND_COLORS = {
  dark: '#0B0D12',
  light: '#F4EFE5',
  shine: '#D9A441',
  arc: '#35E0FF',
} as const;

export interface BrandPalette {
  /** Monochrome ink for the mark's geometry on the active skin. */
  ink: string;
  /** The single accent the mark is allowed to carry. */
  accent: string;
  /** Fill used when the brand is painted as a tile (launcher, splash). */
  surface: string;
}

/**
 * Colour adaptation only — geometry is frozen (plan §3.3): the mark keeps its
 * shape on all four skins and swaps between the ink-safe light/dark tone plus
 * one accent (泥金 on the three warm skins, cyan on 梭).
 */
export function brandPaletteFor(scheme: 'dark' | 'light', themeId?: string): BrandPalette {
  return {
    ink: scheme === 'light' ? BRAND_COLORS.dark : BRAND_COLORS.light,
    accent: themeId === 'scifi' ? BRAND_COLORS.arc : BRAND_COLORS.shine,
    surface: BRAND_COLORS.dark,
  };
}

/** Palette for the active skin. */
export function useBrandPalette(): BrandPalette {
  const { theme } = useTheme();
  return useMemo(() => brandPaletteFor(theme.scheme, theme.id), [theme.scheme, theme.id]);
}