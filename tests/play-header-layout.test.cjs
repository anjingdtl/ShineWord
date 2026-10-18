const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadPlayHeaderLayout() {
  const sourcePath = path.resolve(__dirname, '../mobile/src/ui/layout/playHeaderLayout.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  new Function('exports', compiled)(exports);
  return exports;
}

function loadHeaderLayout() {
  const sourcePath = path.resolve(__dirname, '../mobile/src/ui/layout/headerLayout.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  new Function('exports', compiled)(exports);
  return exports;
}

test('play header stacks its full title when text, width, or window height is constrained', () => {
  const { playHeaderMode } = loadPlayHeaderLayout();
  assert.equal(playHeaderMode({ width: 360, height: 800, fontScale: 2 }), 'stacked');
  assert.equal(playHeaderMode({ width: 411, height: 914, fontScale: 1.3 }), 'stacked');
  assert.equal(playHeaderMode({ width: 800, height: 540, fontScale: 1 }), 'stacked');
  assert.equal(playHeaderMode({ width: 411, height: 914, fontScale: 1 }), 'inline');
});

test('stacked header title gets a content-sized full-width row', () => {
  const { headerTitleContainerStyle } = loadHeaderLayout();
  assert.deepEqual(headerTitleContainerStyle(true), { width: '100%' });
  assert.deepEqual(headerTitleContainerStyle(false), { flex: 1 });
});
