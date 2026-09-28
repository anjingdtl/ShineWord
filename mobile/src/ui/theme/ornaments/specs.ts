/**
 * Ornament geometry — the vector data behind the three decoration slots.
 *
 * Path data is lifted from the reviewed prototype
 * (`docs/ui-prototype/play-screen-themes.html`, the `<defs>` block) and only
 * re-expressed as numbers. Colours are NOT stored here: every stroke declares a
 * semantic `tone` that the components resolve through the active theme, which
 * keeps the "no literal colours in components" rule intact while still letting
 * this file stay a pure data table.
 */
import type { CornerOrnamentId, DividerOrnamentId, PatternOrnamentId } from '../tokens';

/** Semantic stroke roles, resolved to token values at render time. */
export type OrnamentTone = 'primary' | 'secondary' | 'tertiary' | 'edge';

export interface OrnamentShape {
  d: string;
  tone: OrnamentTone;
  strokeWidth: number;
  opacity?: number;
}

export interface OrnamentDot {
  cx: number;
  cy: number;
  r: number;
  tone: OrnamentTone;
  /** Filled discs read as seals/jewels; hollow ones as scroll centres. */
  filled: boolean;
  strokeWidth?: number;
}

export interface CornerSpec {
  /** Square viewBox edge; all prototype paths live in a 32x32 box. */
  box: number;
  shapes: OrnamentShape[];
  dots: OrnamentDot[];
}

/**
 * Corner ornaments, one entry per skin. Each is authored top-left and mirrored
 * for the other three positions (the prototype does the same with CSS
 * `scaleX/scaleY`).
 */
export const CORNER_SPECS: Readonly<Record<CornerOrnamentId, CornerSpec>> = {
  // 云纹如意角花：双线卷草 + 朱砂圆点
  cloud: {
    box: 32,
    shapes: [
      { d: 'M2 30 V14 Q2 2 14 2 H30', tone: 'secondary', strokeWidth: 1.4 },
      { d: 'M8 30 V17 Q8 8 17 8 H30', tone: 'secondary', strokeWidth: 1, opacity: 0.55 },
    ],
    dots: [{ cx: 13, cy: 13, r: 2.2, tone: 'primary', filled: false, strokeWidth: 1.2 }],
  },
  // 卷草藤蔓角花：蔓线 + 叶瓣 + 金珠
  vine: {
    box: 32,
    shapes: [
      { d: 'M3 27 C3 12 12 3 27 3', tone: 'primary', strokeWidth: 1.3 },
      { d: 'M3 27 C8 22 8 15 4 12 M27 3 C22 8 15 8 12 4', tone: 'primary', strokeWidth: 1, opacity: 0.6 },
    ],
    dots: [{ cx: 10, cy: 10, r: 1.6, tone: 'primary', filled: true }],
  },
  // 集中线角标：纯黑硬线
  speedlines: {
    box: 32,
    shapes: [
      { d: 'M4 4 L20 4 M4 4 L4 20 M8 8 L26 4 M4 8 L4 26 M4 4 L16 16', tone: 'edge', strokeWidth: 2.4 },
    ],
    dots: [],
  },
  // HUD 刻度角框：切角 + 刻度线 + 品红定位点
  hud: {
    box: 32,
    shapes: [
      { d: 'M2 30 V8 L8 2 H30', tone: 'primary', strokeWidth: 1.3 },
      { d: 'M14 2 v4 M20 2 v4 M26 2 v4', tone: 'primary', strokeWidth: 1, opacity: 0.7 },
    ],
    dots: [{ cx: 8, cy: 8, r: 1.5, tone: 'secondary', filled: true }],
  },
};

export interface DividerSpec {
  /** Motif drawn between the two rules, in its own square box. */
  box: number;
  shapes: OrnamentShape[];
  dots: OrnamentDot[];
  /** Extra rule riding above/below the main one (fantasy double line). */
  twinRule: boolean;
}

/** Chapter dividers: 印章菱形 / ─ ❖ ─ / 粗黑星 / 刻度轨。 */
export const DIVIDER_SPECS: Readonly<Record<DividerOrnamentId, DividerSpec>> = {
  // 菱形朱砂章节分隔饰
  seal: {
    box: 16,
    shapes: [{ d: 'M8 1 L15 8 L8 15 L1 8 Z', tone: 'primary', strokeWidth: 1.2 }],
    dots: [{ cx: 8, cy: 8, r: 1.8, tone: 'primary', filled: true }],
    twinRule: false,
  },
  // ─ ❖ ─ 章节饰线
  fleur: {
    box: 16,
    shapes: [
      { d: 'M8 1 L14 8 L8 15 L2 8 Z', tone: 'primary', strokeWidth: 1.1 },
      { d: 'M0 8 H2 M14 8 H16', tone: 'primary', strokeWidth: 1 },
    ],
    dots: [{ cx: 8, cy: 8, r: 2.2, tone: 'primary', filled: true }],
    twinRule: true,
  },
  // 粗黑线 + 拟声星
  bold: {
    box: 16,
    shapes: [
      { d: 'M8 0 L10 6 L16 8 L10 10 L8 16 L6 10 L0 8 L6 6 Z', tone: 'edge', strokeWidth: 1.6 },
    ],
    dots: [],
    twinRule: false,
  },
  // 刻度轨
  tick: {
    box: 16,
    shapes: [
      { d: 'M1 8 H15', tone: 'primary', strokeWidth: 1 },
      { d: 'M4 4 v8 M8 2 v12 M12 4 v8', tone: 'primary', strokeWidth: 1, opacity: 0.75 },
    ],
    dots: [{ cx: 8, cy: 8, r: 1.4, tone: 'secondary', filled: true }],
    twinRule: false,
  },
};

export interface PatternSpec {
  /** Tile size in dp. */
  width: number;
  height: number;
  kind: 'line' | 'dot' | 'hex';
  tone: OrnamentTone;
  opacity: number;
  strokeWidth: number;
}

/** Background textures: 竹简竖线 / 无 / 网点纸 / 六边形网格。 */
export const PATTERN_SPECS: Readonly<Record<PatternOrnamentId, PatternSpec | null>> = {
  // 竹简式竖线底纹（原型：每 47dp 一条，5% 泥金）
  bamboo: { width: 47, height: 8, kind: 'line', tone: 'secondary', opacity: 0.05, strokeWidth: 1 },
  none: null,
  // 网点纸纹理
  dots: { width: 13, height: 13, kind: 'dot', tone: 'edge', opacity: 0.14, strokeWidth: 1.1 },
  // 六边形网格（原型 28x24 的扁六边形）
  hex: { width: 28, height: 24, kind: 'hex', tone: 'primary', opacity: 0.09, strokeWidth: 1 },
};
