/**
 * Shine-TRPG design tokens — one component tree, four skins.
 *
 * This file is the ONLY place in `src/ui` where literal colour values are
 * allowed. Every component reads a named token through `useTheme()`, so adding
 * a fifth skin means adding a fifth entry here plus one ornament path set —
 * never touching a component (plan §3.1/§3.3).
 *
 * Source of truth for the values below: `docs/ui-prototype/play-screen-themes.html`
 * (the reviewed prototype wins over the prose tables when they disagree) and
 * `docs/UI_REDESIGN_PLAN.md` §3.2.
 */
import { Platform } from 'react-native';

/** The four selectable skins. `ink` is the shipped default (plan §3.2 ①). */
export type ThemeId = 'ink' | 'fantasy' | 'manga' | 'scifi';

/** Stable display order for switchers and the theme gallery. */
export const THEME_ORDER: readonly ThemeId[] = ['ink', 'fantasy', 'manga', 'scifi'];

export const DEFAULT_THEME_ID: ThemeId = 'ink';

/** Slot names for the ornament library (plan §3.3). */
export type CornerOrnamentId = 'cloud' | 'vine' | 'speedlines' | 'hud';
export type DividerOrnamentId = 'seal' | 'fleur' | 'bold' | 'tick';
export type PatternOrnamentId = 'bamboo' | 'none' | 'dots' | 'hex';

/**
 * System font stacks only — the app never bundles a CJK font (plan §3.4).
 * `Platform.select` exists purely so iOS resolves a serif instead of falling
 * back to the UI font; no font file is shipped either way.
 */
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const SANS = Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' });
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export interface ThemeTokens {
  id: ThemeId;
  /** Short Chinese name, e.g. 墨. */
  name: string;
  /** Full label for switchers, e.g. 中国古典 · 墨. */
  label: string;
  /** One-line mood description shown in the gallery / settings row. */
  tagline: string;
  /** Card content is dark-on-light for `manga`; everything else is dark shell. */
  scheme: 'dark' | 'light';

  /** Background ramp: base = page, raised = cards, overlay = insets/dice strips. */
  bg: { base: string; raised: string; overlay: string; sunken: string };
  /** Text ramp for content sitting directly on `bg`. */
  text: { primary: string; secondary: string; muted: string };
  /** Text ramp for content sitting on a card (`bg.raised`). */
  onRaised: { primary: string; secondary: string };
  /** Text/hairline colour on top of `accent.primary` fills. */
  onAccent: string;
  accent: { primary: string; secondary: string; tertiary: string };
  /**
   * Accent colour that is safe as *text* on this skin's surfaces (>= 4.5:1).
   * `accent.primary` is a fill/border colour: 朱砂 on 玄色 is only 3.9:1, and
   * 漫画红 on its white panels is 3.3:1, so labels use this instead.
   */
  accentText: string;
  semantic: { good: string; bad: string; warn: string; info: string };
  border: { color: string; colorStrong: string; width: number; hairline: number };
  /** Highlight chip variant (`chip.hot` in the prototype). */
  chip: { hotBackground: string | null; hotText: string; hotBorder: string };
  /** Attribute pips: total track width/height plus the three fill states. */
  pip: { on: string; off: string; half: string; border: string; width: number; height: number; radius: number };
  /** Resource bars (气血 / 体力 …). */
  bar: { track: string; border: string; fill: string; fillAlt: string; height: number; radius: number };
  /** Die-face badge (d4–d12) shown on every skill row. */
  die: { fill: string; text: string; size: number };

  radius: { sm: number; md: number; lg: number; pill: number };
  /** 4/8/12/16/24/32 rhythm — no component invents its own spacing. */
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  /** Minimum touch target in dp (§4 accessibility floor). */
  touch: { min: number };
  font: { narrative: string | undefined; ui: string | undefined; numeric: string | undefined };
  type: {
    display: TypeToken;
    title: TypeToken;
    heading: TypeToken;
    body: TypeToken;
    small: TypeToken;
    caption: TypeToken;
    label: TypeToken;
    micro: TypeToken;
  };
  effects: {
    /** Card outline thickness (manga = 3px comic panel). */
    cardBorderWidth: number;
    /** Hard offset drop shadow; manga only (never a blurred shadow). */
    cardShadow: { dx: number; dy: number; color: string } | null;
    /** Smaller hard offset used by buttons and chips (manga only). */
    controlShadow: { dx: number; dy: number; color: string } | null;
    /** Fantasy's inner double hairline frame. */
    insetFrame: boolean;
    /** HUD corner cut expressed as a diagonal length in dp; 0 = square. */
    clipCorner: number;
    /** Scanline overlay is opt-in and off by default (§4 梭). */
    scanlines: boolean;
    /** Press feedback scale for Pressable surfaces. */
    pressedScale: number;
    /** Divider rules can be tinted with the accent instead of the border. */
    dividerUsesAccent: boolean;
  };
  ornament: { corner: CornerOrnamentId; divider: DividerOrnamentId; pattern: PatternOrnamentId };
}

export interface TypeToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  letterSpacing: number;
  /** Which font slot the component pairs this size with. */
  family: 'ui' | 'narrative' | 'numeric';
}

const type = (
  fontSize: number,
  lineHeight: number,
  fontWeight: TypeToken['fontWeight'],
  extra: Partial<TypeToken> = {},
): TypeToken => ({ fontSize, lineHeight, fontWeight, letterSpacing: 0, family: 'ui', ...extra });

/** Spacing and touch floor are shared by all four skins (rhythm stays stable). */
const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
const TOUCH = { min: 44 };

/**
 * ① 中国古典风「墨」 — the default. Sparse, warm, seal-red.
 * Narrative text is serif; decorations are cloud-scroll corners + bamboo-slip
 * vertical rules (see `ornaments/`).
 */
const INK: ThemeTokens = {
  id: 'ink',
  name: '墨',
  label: '中国古典 · 墨',
  tagline: '玄色卷轴 · 朱砂泥金',
  scheme: 'dark',
  bg: { base: '#12100C', raised: '#1D1913', overlay: '#2A241B', sunken: '#0C0A07' },
  text: { primary: '#EFE6D0', secondary: '#A99E86', muted: '#8A8A8A' },
  onRaised: { primary: '#EFE6D0', secondary: '#A99E86' },
  // Near-white on 朱砂 = 4.8:1. The prototype used the dark base colour here
  // (3.9:1); §4's contrast floor wins — see the deviation list in the report.
  onAccent: '#FFFDF5',
  accent: { primary: '#C8442F', secondary: '#C9A063', tertiary: '#7FA05A' },
  accentText: '#C9A063',
  semantic: { good: '#7FA05A', bad: '#C8442F', warn: '#C9A063', info: '#A99E86' },
  border: { color: '#3A3226', colorStrong: '#5A4C36', width: 1, hairline: 1 },
  chip: { hotBackground: null, hotText: '#C9A063', hotBorder: '#C8442F' },
  pip: { on: '#C9A063', off: '#2A241B', half: '#C9A063', border: '#3A3226', width: 16, height: 6, radius: 2 },
  bar: { track: '#2A241B', border: '#3A3226', fill: '#C8442F', fillAlt: '#C9A063', height: 8, radius: 4 },
  die: { fill: '#C9A063', text: '#12100C', size: 26 },
  radius: { sm: 2, md: 3, lg: 6, pill: 999 },
  space: SPACE,
  touch: TOUCH,
  font: { narrative: SERIF, ui: SANS, numeric: SERIF },
  type: {
    display: type(24, 34, '700', { family: 'narrative', letterSpacing: 2 }),
    title: type(18, 26, '700', { family: 'narrative', letterSpacing: 1 }),
    heading: type(15, 22, '700', { letterSpacing: 3 }),
    body: type(14, 25, '400', { family: 'narrative' }),
    small: type(12, 20, '400'),
    caption: type(11, 18, '400'),
    label: type(10, 15, '600', { letterSpacing: 1 }),
    micro: type(9, 13, '600'),
  },
  effects: {
    cardBorderWidth: 1,
    cardShadow: null,
    controlShadow: null,
    insetFrame: false,
    clipCorner: 0,
    scanlines: false,
    pressedScale: 0.96,
    dividerUsesAccent: true,
  },
  ornament: { corner: 'cloud', divider: 'seal', pattern: 'bamboo' },
};

/** ② 欧洲奇幻风「烛」 — the "upgraded current look": midnight blue + candle gold. */
const FANTASY: ThemeTokens = {
  id: 'fantasy',
  name: '烛',
  label: '欧洲奇幻 · 烛',
  tagline: '午夜蓝 · 烛金钢蓝',
  scheme: 'dark',
  bg: { base: '#0A0E1A', raised: '#101828', overlay: '#1A2438', sunken: '#070A12' },
  text: { primary: '#F1F5F9', secondary: '#A8B8C6', muted: '#8EA1B2' },
  onRaised: { primary: '#F1F5F9', secondary: '#A8B8C6' },
  onAccent: '#0A0E1A',
  accent: { primary: '#D9A441', secondary: '#91B6D7', tertiary: '#79C99E' },
  accentText: '#D9A441',
  semantic: { good: '#79C99E', bad: '#FF9B9B', warn: '#D9A441', info: '#91B6D7' },
  border: { color: '#263A4D', colorStrong: '#3B5568', width: 1, hairline: 1 },
  chip: { hotBackground: null, hotText: '#D9A441', hotBorder: '#D9A441' },
  pip: { on: '#91B6D7', off: '#1A2438', half: '#91B6D7', border: '#263A4D', width: 16, height: 6, radius: 3 },
  bar: { track: '#1A2438', border: '#263A4D', fill: '#D9A441', fillAlt: '#91B6D7', height: 8, radius: 4 },
  die: { fill: '#91B6D7', text: '#0A0E1A', size: 26 },
  radius: { sm: 6, md: 10, lg: 14, pill: 999 },
  space: SPACE,
  touch: TOUCH,
  font: { narrative: SERIF, ui: SANS, numeric: SERIF },
  type: {
    display: type(24, 34, '700', { family: 'narrative', letterSpacing: 1.5 }),
    title: type(18, 26, '700', { family: 'narrative', letterSpacing: 0.5 }),
    heading: type(15, 22, '700', { letterSpacing: 2 }),
    body: type(14, 24, '400', { family: 'narrative' }),
    small: type(12, 19, '400'),
    caption: type(11, 17, '400'),
    label: type(10, 15, '600', { letterSpacing: 0.5 }),
    micro: type(9, 13, '600'),
  },
  effects: {
    cardBorderWidth: 1,
    cardShadow: null,
    controlShadow: null,
    insetFrame: true,
    clipCorner: 0,
    scanlines: false,
    pressedScale: 0.96,
    dividerUsesAccent: true,
  },
  ornament: { corner: 'vine', divider: 'fleur', pattern: 'none' },
};

/** ③ 日本漫画风「漫」 — Neubrutalism: white panels, 3px black ink, hard offset. */
const MANGA: ThemeTokens = {
  id: 'manga',
  name: '漫',
  label: '日本漫画 · 漫',
  tagline: '网点纸 · 白漫画格',
  scheme: 'light',
  bg: { base: '#16161E', raised: '#FFFFFF', overlay: '#FFFDF5', sunken: '#1E1E28' },
  text: { primary: '#F5F5F5', secondary: '#9A9AA5', muted: '#8A8A93' },
  onRaised: { primary: '#111111', secondary: '#555555' },
  // Black on the red accent = 5.7:1 (prototype used white, 3.3:1).
  onAccent: '#111111',
  accent: { primary: '#FF4757', secondary: '#3B82F6', tertiary: '#FACC15' },
  // On the white manga panels black is the readable "ink"; colour carries the
  // accent through borders and fills instead of through label text.
  accentText: '#111111',
  semantic: { good: '#2ED573', bad: '#FF4757', warn: '#FACC15', info: '#3B82F6' },
  border: { color: '#000000', colorStrong: '#000000', width: 3, hairline: 2 },
  chip: { hotBackground: '#FACC15', hotText: '#111111', hotBorder: '#000000' },
  pip: { on: '#111111', off: '#EEEEEE', half: '#111111', border: '#000000', width: 16, height: 6, radius: 2 },
  bar: { track: '#EEEEEE', border: '#000000', fill: '#FF4757', fillAlt: '#3B82F6', height: 8, radius: 0 },
  die: { fill: '#111111', text: '#FFFFFF', size: 26 },
  radius: { sm: 2, md: 6, lg: 8, pill: 999 },
  space: SPACE,
  touch: TOUCH,
  font: { narrative: SANS, ui: SANS, numeric: SANS },
  type: {
    display: type(24, 32, '800', { family: 'narrative', letterSpacing: 1 }),
    title: type(18, 26, '800', { family: 'narrative' }),
    heading: type(15, 22, '800', { letterSpacing: 1 }),
    body: type(14, 24, '500', { family: 'narrative' }),
    small: type(12.5, 19, '500'),
    caption: type(11, 17, '500'),
    label: type(10, 15, '800', { letterSpacing: 0.5 }),
    micro: type(9, 13, '800'),
  },
  effects: {
    cardBorderWidth: 3,
    cardShadow: { dx: 4, dy: 4, color: '#000000' },
    controlShadow: { dx: 2, dy: 2, color: '#000000' },
    insetFrame: false,
    clipCorner: 0,
    scanlines: false,
    pressedScale: 0.97,
    dividerUsesAccent: false,
  },
  ornament: { corner: 'speedlines', divider: 'bold', pattern: 'dots' },
};

/** ④ 未来科技风「梭」 — cyberpunk HUD: near-black, cyan/magenta, mono numerics. */
const SCIFI: ThemeTokens = {
  id: 'scifi',
  name: '梭',
  label: '未来科技 · 梭',
  tagline: 'HUD 切角 · 青与品红',
  scheme: 'dark',
  bg: { base: '#05070D', raised: '#0B101B', overlay: '#111A2B', sunken: '#03050A' },
  text: { primary: '#D7E6F5', secondary: '#7D93AC', muted: '#6C8098' },
  onRaised: { primary: '#D7E6F5', secondary: '#7D93AC' },
  onAccent: '#05070D',
  accent: { primary: '#35E0FF', secondary: '#FF3DF0', tertiary: '#7D93AC' },
  accentText: '#35E0FF',
  semantic: { good: '#35E0FF', bad: '#FF3DF0', warn: '#FF3DF0', info: '#7D93AC' },
  border: { color: 'rgba(53,224,255,0.22)', colorStrong: 'rgba(53,224,255,0.45)', width: 1, hairline: 1 },
  chip: { hotBackground: null, hotText: '#35E0FF', hotBorder: '#35E0FF' },
  pip: {
    on: '#35E0FF',
    off: '#111A2B',
    half: '#35E0FF',
    border: 'rgba(53,224,255,0.22)',
    width: 16,
    height: 6,
    radius: 1,
  },
  bar: {
    track: '#111A2B',
    border: 'rgba(53,224,255,0.22)',
    fill: '#35E0FF',
    fillAlt: '#FF3DF0',
    height: 8,
    radius: 0,
  },
  die: { fill: '#35E0FF', text: '#05070D', size: 26 },
  radius: { sm: 1, md: 2, lg: 4, pill: 999 },
  space: SPACE,
  touch: TOUCH,
  font: { narrative: SANS, ui: SANS, numeric: MONO },
  type: {
    display: type(24, 32, '700', { family: 'numeric', letterSpacing: 2 }),
    title: type(18, 26, '700', { family: 'numeric', letterSpacing: 1 }),
    heading: type(15, 22, '700', { letterSpacing: 2 }),
    body: type(14, 22, '400'),
    small: type(12, 19, '400'),
    caption: type(11, 17, '400'),
    label: type(10, 15, '700', { letterSpacing: 1.5 }),
    micro: type(9, 13, '700', { family: 'numeric' }),
  },
  effects: {
    cardBorderWidth: 1,
    cardShadow: null,
    controlShadow: null,
    insetFrame: false,
    clipCorner: 16,
    scanlines: false,
    pressedScale: 0.96,
    dividerUsesAccent: true,
  },
  ornament: { corner: 'hud', divider: 'tick', pattern: 'hex' },
};

export const THEMES: Readonly<Record<ThemeId, ThemeTokens>> = {
  ink: INK,
  fantasy: FANTASY,
  manga: MANGA,
  scifi: SCIFI,
};

/** Safe lookup: unknown or missing ids fall back to the shipped default. */
export function getTheme(id: string | null | undefined): ThemeTokens {
  if (id && (THEME_ORDER as readonly string[]).includes(id)) {
    return THEMES[id as ThemeId];
  }
  return THEMES[DEFAULT_THEME_ID];
}
