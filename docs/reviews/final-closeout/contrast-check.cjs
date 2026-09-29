#!/usr/bin/env node
/*
 * Token-level WCAG 2.1 contrast audit for the four Shine-TRPG skins.
 *
 * This is a STATIC verification: it reads the same literal colour values the
 * components read (the single source of truth is
 * `mobile/src/ui/theme/tokens.ts`, mirrored below) and computes contrast
 * ratios. It does NOT render anything on a device and cannot prove the pixel
 * result of alpha compositing, fonts, or shadows — see F1_VISUAL.md.
 *
 * Each pair carries a role:
 *   text   — the value is rendered as a small text label; must clear 4.5:1.
 *   large  — text rendered at >= 18.66px bold; must clear 3:1.
 *   fill   — a block/bar/border fill; contrast is not a text requirement, kept
 *            for reference only and never counted as a failure.
 *   guard  — a pairing the components must NOT use for text (documented
 *            regression guard); never counted as a failure.
 *
 * Exit code is non-zero only if a `text`/`large` pair falls below its floor.
 *
 * Usage: node docs/reviews/final-closeout/contrast-check.cjs [--json]
 */
'use strict';

const THEMES = {
  ink: {
    scheme: 'dark',
    bg: { base: '#12100C', raised: '#1D1913', overlay: '#2A241B' },
    text: { primary: '#EFE6D0', secondary: '#A99E86', muted: '#8A8A8A' },
    onRaised: { primary: '#EFE6D0', secondary: '#A99E86' },
    onAccent: '#FFFDF5',
    accent: { primary: '#C8442F', secondary: '#C9A063' },
    accentText: '#C9A063',
    accentOnBase: '#C9A063',
    semantic: { good: '#7FA05A', bad: '#C8442F', warn: '#C9A063', info: '#A99E86' },
    semanticText: { good: '#7FA05A', bad: '#D96D5C', warn: '#C9A063', info: '#A99E86' },
    chip: { hotBackground: null, hotText: '#C9A063' },
    die: { fill: '#C9A063', text: '#12100C' },
  },
  fantasy: {
    scheme: 'dark',
    bg: { base: '#0A0E1A', raised: '#101828', overlay: '#1A2438' },
    text: { primary: '#F1F5F9', secondary: '#A8B8C6', muted: '#8EA1B2' },
    onRaised: { primary: '#F1F5F9', secondary: '#A8B8C6' },
    onAccent: '#0A0E1A',
    accent: { primary: '#D9A441', secondary: '#91B6D7' },
    accentText: '#D9A441',
    accentOnBase: '#D9A441',
    semantic: { good: '#79C99E', bad: '#FF9B9B', warn: '#D9A441', info: '#91B6D7' },
    semanticText: { good: '#79C99E', bad: '#FF9B9B', warn: '#D9A441', info: '#91B6D7' },
    chip: { hotBackground: null, hotText: '#D9A441' },
    die: { fill: '#91B6D7', text: '#0A0E1A' },
  },
  manga: {
    scheme: 'light',
    bg: { base: '#16161E', raised: '#FFFFFF', overlay: '#FFFDF5' },
    text: { primary: '#F5F5F5', secondary: '#9A9AA5', muted: '#8A8A93' },
    onRaised: { primary: '#111111', secondary: '#555555' },
    onAccent: '#111111',
    accent: { primary: '#FF4757', secondary: '#3B82F6' },
    accentText: '#111111',
    accentOnBase: '#FF4757',
    semantic: { good: '#2ED573', bad: '#FF4757', warn: '#FACC15', info: '#3B82F6' },
    semanticText: { good: '#1A8345', bad: '#EA0014', warn: '#8C7103', info: '#196CF4' },
    chip: { hotBackground: '#FACC15', hotText: '#111111' },
    die: { fill: '#111111', text: '#FFFFFF' },
  },
  scifi: {
    scheme: 'dark',
    bg: { base: '#05070D', raised: '#0B101B', overlay: '#111A2B' },
    text: { primary: '#D7E6F5', secondary: '#7D93AC', muted: '#6C8098' },
    onRaised: { primary: '#D7E6F5', secondary: '#7D93AC' },
    onAccent: '#05070D',
    accent: { primary: '#35E0FF', secondary: '#FF3DF0' },
    accentText: '#35E0FF',
    accentOnBase: '#35E0FF',
    semantic: { good: '#35E0FF', bad: '#FF3DF0', warn: '#FF3DF0', info: '#7D93AC' },
    semanticText: { good: '#35E0FF', bad: '#FF3DF0', warn: '#FF3DF0', info: '#7D93AC' },
    chip: { hotBackground: null, hotText: '#35E0FF' },
    die: { fill: '#35E0FF', text: '#05070D' },
  },
};

const NORMAL_MIN = 4.5;
const LARGE_MIN = 3.0;

function parseHex(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

function channelLuminance(c) {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map(channelLuminance);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** [label, foreground hex, background hex, floor, role] */
function pairsFor(t) {
  const pairs = [
    ['text.primary / bg.base', t.text.primary, t.bg.base, NORMAL_MIN, 'text'],
    ['text.secondary / bg.base', t.text.secondary, t.bg.base, NORMAL_MIN, 'text'],
    ['text.muted / bg.base', t.text.muted, t.bg.base, NORMAL_MIN, 'text'],
    ['onRaised.primary / bg.raised', t.onRaised.primary, t.bg.raised, NORMAL_MIN, 'text'],
    ['onRaised.secondary / bg.raised', t.onRaised.secondary, t.bg.raised, NORMAL_MIN, 'text'],
    ['onRaised.primary / bg.overlay', t.onRaised.primary, t.bg.overlay, NORMAL_MIN, 'text'],
    ['onRaised.secondary / bg.overlay', t.onRaised.secondary, t.bg.overlay, NORMAL_MIN, 'text'],
    ['accentText / bg.raised (panel label)', t.accentText, t.bg.raised, NORMAL_MIN, 'text'],
    ['accentText / bg.overlay (panel label)', t.accentText, t.bg.overlay, NORMAL_MIN, 'text'],
    ['accentOnBase / bg.base (page chrome)', t.accentOnBase, t.bg.base, NORMAL_MIN, 'text'],
    ['onAccent / accent.primary (label on fill)', t.onAccent, t.accent.primary, NORMAL_MIN, 'text'],
    ['chip.hotText / chip background', t.chip.hotText, t.chip.hotBackground || t.bg.base, NORMAL_MIN, 'text'],
    ['die.text / die.fill (large glyph)', t.die.text, t.die.fill, LARGE_MIN, 'large'],
    ['accent.primary / bg.base (fill/border only)', t.accent.primary, t.bg.base, NORMAL_MIN, 'fill'],
    ['text.muted / bg.raised (WRONG surface guard)', t.text.muted, t.bg.raised, NORMAL_MIN, 'guard'],
    ['accentText / bg.base (WRONG surface guard)', t.accentText, t.bg.base, NORMAL_MIN, 'guard'],
  ];
  for (const slot of ['good', 'bad', 'warn', 'info']) {
    pairs.push([
      `semantic.${slot} / bg.raised (fill only)`,
      t.semantic[slot],
      t.bg.raised,
      NORMAL_MIN,
      'fill',
    ]);
    pairs.push([
      `semantic.${slot} / bg.overlay (fill only)`,
      t.semantic[slot],
      t.bg.overlay,
      NORMAL_MIN,
      'fill',
    ]);
    pairs.push([
      `semanticText.${slot} / bg.raised (label)`,
      t.semanticText[slot],
      t.bg.raised,
      NORMAL_MIN,
      'text',
    ]);
    pairs.push([
      `semanticText.${slot} / bg.overlay (label)`,
      t.semanticText[slot],
      t.bg.overlay,
      NORMAL_MIN,
      'text',
    ]);
  }
  return pairs;
}

const results = {};
let textFailures = 0;
let textChecks = 0;
for (const [id, t] of Object.entries(THEMES)) {
  results[id] = [];
  for (const [label, fg, bg, min, role] of pairsFor(t)) {
    const ratio = contrast(fg, bg);
    const pass = ratio + 1e-9 >= min;
    const counted = role === 'text' || role === 'large';
    if (counted) textChecks += 1;
    if (counted && !pass) textFailures += 1;
    results[id].push({ label, fg, bg, ratio: Math.round(ratio * 100) / 100, min, role, pass });
  }
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ results, textChecks, textFailures }, null, 2) + '\n');
  process.exit(textFailures === 0 ? 0 : 1);
}

for (const [id, rows] of Object.entries(results)) {
  process.stdout.write(`\n## ${id}  (${THEMES[id].scheme})\n`);
  for (const r of rows) {
    const mark = r.role === 'text' || r.role === 'large' ? (r.pass ? 'PASS' : 'FAIL') : '----';
    process.stdout.write(
      `${mark}  ${r.ratio.toFixed(2).padStart(6)}  (min ${r.min}, ${r.role.padEnd(5)})  ${r.label}  [${r.fg} on ${r.bg}]\n`,
    );
  }
}
process.stdout.write(
  `\nText/large checks: ${textChecks}; below floor: ${textFailures}\n` +
    `${textFailures === 0 ? 'ALL TEXT PAIRS PASS' : 'TEXT PAIRS BELOW FLOOR'}\n`,
);
process.exit(textFailures === 0 ? 0 : 1);