#!/usr/bin/env node
/*
 * Token-level WCAG 2.1 contrast audit for the four Shine-TRPG skins.
 *
 * Source of truth: the audit PARSES `mobile/src/ui/theme/tokens.ts` at run
 * time — there is no hand-copied colour mirror in this file, so a token change
 * that breaks a pairing fails here even if the script itself is not updated
 * (that mirror gap is exactly how the 2026-09-29 A1 placeholder defect slipped
 * through the previous 84-pair audit).
 *
 * Two layers:
 *
 *  1. Colour maths over the parsed tokens. Each pair carries a role:
 *       text   — small text label; must clear 4.5:1.
 *       large  — text at >= 18.66px bold; must clear 3:1.
 *       fill   — block/bar/border fill; reference only, never a failure.
 *       guard  — a pairing components must NOT use for text; documented
 *                regression guard, never a failure.
 *
 *  2. Component pairing assertions: the real widget sources must bind the
 *     audited slots (e.g. TextField's placeholder colour). Colour maths alone
 *     cannot catch a component reading the *wrong* slot while every pair in
 *     isolation still passes.
 *
 * This remains a STATIC verification: no device pixels, fonts or alpha
 * compositing are involved — see F1_VISUAL.md.
 *
 * Exit code is non-zero if a `text`/`large` pair falls below its floor, if a
 * token the audit expects cannot be parsed, or if a component assertion fails.
 *
 * Usage: node docs/reviews/final-closeout/contrast-check.cjs [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const TOKENS_PATH = path.join(REPO, 'mobile', 'src', 'ui', 'theme', 'tokens.ts');

/* ------------------------------------------------------------------ */
/* 1. Parse the real token literals out of tokens.ts.                  */
/* ------------------------------------------------------------------ */

function parseThemeBlock(source, constName) {
  const start = source.indexOf(`const ${constName}: ThemeTokens = {`);
  if (start < 0) throw new Error(`tokens.ts: theme block ${constName} not found`);
  const end = source.indexOf('\n};', start);
  const block = source.slice(start, end);

  const id = /id:\s*'([^']+)'/.exec(block)?.[1];
  const scheme = /scheme:\s*'(dark|light)'/.exec(block)?.[1];
  if (!id || !scheme) throw new Error(`tokens.ts: ${constName} missing id/scheme`);

  const group = (name) => {
    const inner = new RegExp(`${name}:\\s*\\{([^}]+)\\}`).exec(block)?.[1];
    if (inner === undefined) throw new Error(`tokens.ts: ${constName} missing group ${name}`);
    return inner;
  };
  const hex = (inner, key) => {
    const m = new RegExp(`\\b${key}:\\s*'(#[0-9A-Fa-f]{3,8})'`).exec(inner);
    if (!m) throw new Error(`tokens.ts: ${constName} missing hex for ${key}`);
    return m[1];
  };
  const maybeNull = (inner, key) =>
    new RegExp(`\\b${key}:\\s*null`).test(inner) ? null : hex(inner, key);

  const bg = group('bg');
  const text = group('text');
  const onRaised = group('onRaised');
  const accent = group('accent');
  const semantic = group('semantic');
  const semanticText = group('semanticText');
  const chip = group('chip');
  const die = group('die');

  return {
    constName,
    scheme,
    bg: { base: hex(bg, 'base'), raised: hex(bg, 'raised'), overlay: hex(bg, 'overlay') },
    text: { primary: hex(text, 'primary'), secondary: hex(text, 'secondary'), muted: hex(text, 'muted') },
    onRaised: { primary: hex(onRaised, 'primary'), secondary: hex(onRaised, 'secondary') },
    onAccent: /onAccent:\s*'([^']+)'/.exec(block)?.[1],
    accent: { primary: hex(accent, 'primary'), secondary: hex(accent, 'secondary') },
    accentText: /accentText:\s*'([^']+)'/.exec(block)?.[1],
    accentOnBase: /accentOnBase:\s*'([^']+)'/.exec(block)?.[1],
    semantic: {
      good: hex(semantic, 'good'), bad: hex(semantic, 'bad'),
      warn: hex(semantic, 'warn'), info: hex(semantic, 'info'),
    },
    semanticText: {
      good: hex(semanticText, 'good'), bad: hex(semanticText, 'bad'),
      warn: hex(semanticText, 'warn'), info: hex(semanticText, 'info'),
    },
    chip: { hotText: hex(chip, 'hotText'), hotBackground: maybeNull(chip, 'hotBackground') },
    die: { fill: hex(die, 'fill'), text: hex(die, 'text') },
  };
}

function parseTokens() {
  const source = fs.readFileSync(TOKENS_PATH, 'utf8');
  const themes = {};
  const blockRe = /const\s+([A-Z][A-Za-z0-9_]*):\s*ThemeTokens\s*=\s*\{/g;
  let m;
  while ((m = blockRe.exec(source)) !== null) {
    const theme = parseThemeBlock(source, m[1]);
    themes[theme.constName] = theme;
  }
  // Key by the skin's own `id` so display order follows tokens.ts semantics.
  const byId = {};
  for (const theme of Object.values(themes)) byId[theme.constName] = theme;
  return byId;
}

const THEMES = parseTokens();

/* ------------------------------------------------------------------ */
/* 2. Colour maths (WCAG 2.1 relative luminance / contrast).           */
/* ------------------------------------------------------------------ */

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
    ['TextField placeholder: onRaised.secondary / bg.overlay', t.onRaised.secondary, t.bg.overlay, NORMAL_MIN, 'text'],
    ['TextField typed text: onRaised.primary / bg.overlay', t.onRaised.primary, t.bg.overlay, NORMAL_MIN, 'text'],
    ['accentText / bg.raised (panel label)', t.accentText, t.bg.raised, NORMAL_MIN, 'text'],
    ['accentText / bg.overlay (panel label)', t.accentText, t.bg.overlay, NORMAL_MIN, 'text'],
    ['accentOnBase / bg.base (page chrome)', t.accentOnBase, t.bg.base, NORMAL_MIN, 'text'],
    ['onAccent / accent.primary (label on fill)', t.onAccent, t.accent.primary, NORMAL_MIN, 'text'],
    ['PartyStrip tile text: text.secondary / bg.base', t.text.secondary, t.bg.base, NORMAL_MIN, 'text'],
    ['chip.hotText / chip background', t.chip.hotText, t.chip.hotBackground || t.bg.base, NORMAL_MIN, 'text'],
    ['die.text / die.fill (large glyph)', t.die.text, t.die.fill, LARGE_MIN, 'large'],
    ['accent.primary / bg.base (fill/border only)', t.accent.primary, t.bg.base, NORMAL_MIN, 'fill'],
    ['text.muted / bg.raised (WRONG surface guard)', t.text.muted, t.bg.raised, NORMAL_MIN, 'guard'],
    ['accentText / bg.base (WRONG surface guard)', t.accentText, t.bg.base, NORMAL_MIN, 'guard'],
    // A1 (2026-09-29): TextField's placeholder used the host-surface muted
    // token while sitting on the overlay field box — 4.45/3.36/4.29:1 on
    // ink/manga/scifi. Components must keep text.muted off bg.overlay.
    ['text.muted / bg.overlay (TextField placeholder WRONG pairing guard)', t.text.muted, t.bg.overlay, NORMAL_MIN, 'guard'],
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

/* ------------------------------------------------------------------ */
/* 3. Component pairing assertions — the widget must bind the slot.    */
/* ------------------------------------------------------------------ */

function readComponent(rel) {
  return fs.readFileSync(path.join(REPO, 'mobile', 'src', 'ui', rel), 'utf8');
}

/** [assertion label, component rel path, RegExp the source must match] */
const COMPONENT_ASSERTIONS = [
  [
    'TextField placeholder binds onRaised.secondary (A1)',
    'components/TextField.tsx',
    (src) =>
      (/const fieldMuted = theme\.onRaised\.secondary;/.test(src) &&
        /placeholderTextColor=\{fieldMuted\}/.test(src)) ||
      /placeholderTextColor=\{theme\.onRaised\.secondary\}/.test(src),
  ],
  [
    'TextField must not bind placeholder to the host-surface muted token (A1)',
    'components/TextField.tsx',
    (src) => !/placeholderTextColor=\{hostMuted\}/.test(src) && !/placeholderTextColor=\{props\./.test(src),
  ],
  [
    'PartyStrip renders visible numeric resource values (A2, §30)',
    'features/play/PartyStrip.tsx',
    (src) =>
      /<Text[^>]*>\s*\{props\.value\}/.test(src) &&
      /resourceValue\(member\.resources\.hp,\s*member\.resourceMax\.hp\)/.test(src) &&
      /resourceValue\(member\.resources\.stamina,\s*member\.resourceMax\.stamina\)/.test(src),
  ],
  [
    'NpcCharacterSheet resets stale error/npc when the actor changes (A3)',
    'features/play/character/NpcCharacterSheet.tsx',
    (src) => /setError\(null\);/.test(src) && /setNpc\(null\);/.test(src) && /let cancelled = false;/.test(src),
  ],
];

const componentFailures = [];
for (const [label, rel, matcher] of COMPONENT_ASSERTIONS) {
  let ok = false;
  let err = null;
  try {
    const src = readComponent(rel);
    ok = typeof matcher === 'function' ? matcher(src) : matcher.test(src);
  } catch (e) {
    err = e;
  }
  if (err) componentFailures.push(`${label}: cannot read ${rel} (${err.message})`);
  else if (!ok) componentFailures.push(`${label}: source does not match the required pairing`);
}

/* ------------------------------------------------------------------ */
/* 4. Run.                                                             */
/* ------------------------------------------------------------------ */

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
  process.stdout.write(
    JSON.stringify({ tokensSource: TOKENS_PATH, results, textChecks, textFailures, componentFailures }, null, 2) + '\n',
  );
  process.exit(textFailures === 0 && componentFailures.length === 0 ? 0 : 1);
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
if (componentFailures.length > 0) {
  process.stdout.write('\nComponent pairing assertions:\n');
  for (const f of componentFailures) process.stdout.write(`FAIL  ${f}\n`);
} else {
  process.stdout.write('\nComponent pairing assertions: ALL PASS\n');
}
process.stdout.write(
  `\nText/large checks: ${textChecks}; below floor: ${textFailures}; component failures: ${componentFailures.length}\n` +
    `tokens parsed live from: ${path.relative(REPO, TOKENS_PATH)}\n` +
    `${textFailures === 0 && componentFailures.length === 0 ? 'ALL TEXT PAIRS PASS' : 'TEXT PAIRS BELOW FLOOR'}\n`,
);
process.exit(textFailures === 0 && componentFailures.length === 0 ? 0 : 1);
