'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { describeWorldClock } = require('../dist/domain/state/worldClock');

// Compile the pure exported formatter with inert component dependencies.
const source = fs.readFileSync('mobile/src/ui/features/play/PlayHeader.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const exported = {};
new Function('require', 'exports', compiled)(name => name === 'react-native'
  ? { StyleSheet: { create: value => value } } : {}, exported);

test('world clock handles midnight, multi-day values and invalid input consistently', () => {
  assert.equal(describeWorldClock(0), '第1日 00:00');
  assert.equal(describeWorldClock(86400 + 8 * 3600 + 15 * 60), '第2日 08:15');
  assert.equal(describeWorldClock(NaN), '第1日 00:00');
});

test('ink quarter-hours are measured from the 23:00 start of 子时', () => {
  const format = exported.formatWorldClock;
  assert.equal(format('ink', 23 * 3600), '子时一刻');
  assert.equal(format('ink', 0), '子时五刻');
  assert.equal(format('ink', 45 * 60), '子时八刻');
  assert.equal(format('ink', 3600), '丑时一刻');
  assert.equal(format('ink', 2 * 3600), '丑时五刻');
  assert.equal(format('ink', 86400), '子时五刻');
});
