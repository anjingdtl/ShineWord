'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(relative, mocks) {
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = request => {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    throw new Error(`Unexpected UI dependency ${request}`);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const theme = { bg: { sunken: '#000', raised: '#111' }, space: { xs: 2, sm: 4, md: 8, lg: 16 },
  type: { title: {}, caption: {}, small: {} }, onRaised: { primary: '#fff', secondary: '#aaa' },
  text: { primary: '#fff', muted: '#aaa' }, accentText: '#fff' };
const native = { StyleSheet: { create: value => value }, View: 'View', Text: 'Text', ScrollView: 'ScrollView', Modal: 'Modal', RefreshControl: 'RefreshControl' };
const baseReact = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
const baseMocks = {
  react: baseReact, 'react-native': native,
  '../../components/Button': { Button: 'Button' }, '../../components/Card': { Card: 'Card' },
  '../../components/typography': { typeStyle: () => ({}) }, '../../theme/ThemeContext': { useTheme: () => ({ theme }) },
};
function nodes(tree) {
  return [tree, ...((tree?.children ?? (Array.isArray(tree) ? tree : [])).flatMap(nodes))].filter(node => node != null);
}
const sample = { worldId: 'w-a', title: '测试项目', chapterCount: 1, updatedAt: '2026-10-01',
  buildStatus: 'building', playable: false, campaign: null, buildSummary: { dynamicRuns: 1, doneBatches: 0, totalBatches: 8 } };

test('UI-closeout production ProjectCard reflects fast batch/status updates and menu intent', () => {
  const { ProjectCard } = load('mobile/src/ui/features/library/ProjectCard.tsx', {
    ...baseMocks, '../../../projectLibrary': { PROJECT_STATUS_LABEL: { building: '构建中', paused: '已暂停' } },
  });
  let menuCalls = 0;
  const props = { project: sample, onMenu: () => menuCalls++, onOpenProject() {}, onPrimary() {} };
  let tree = ProjectCard(props);
  assert.ok(nodes(tree).some(n => n === 'LLM：0 / 8 批 · 后台继续构建世界资料'));
  nodes(tree).find(n => n.props?.testID === 'project-menu-w-a').props.onPress();
  assert.equal(menuCalls, 1, 'ellipsis requests an action menu');
  tree = ProjectCard({ ...props, project: { ...sample, buildStatus: 'paused', buildSummary: { dynamicRuns: 0, doneBatches: 1, totalBatches: 8 } } });
  assert.ok(nodes(tree).some(n => n === 'LLM：1 / 8 批'));
  assert.ok(nodes(tree).some(n => n === '状态：已暂停'));
});

test('UI-closeout Library ellipsis -> actions -> confirmation -> deletion requires all three steps', async () => {
  const states = [];
  let cursor = 0, deletions = 0, checks = 0;
  const react = { ...baseReact,
    useState: initial => {
      const i = cursor++;
      if (!(i in states)) states[i] = i === 0 ? [sample] : typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    useRef: initial => { const i = cursor++; return states[i] ?? (states[i] = { current: initial }); },
    useMemo: fn => fn(), useCallback: fn => fn,
  };
  const mocks = {
    react, 'react-native': native,
    '@react-navigation/native': { useFocusEffect() {}, useNavigation: () => ({ navigate() {} }) },
    '../../runtime': {}, '../../fileBridge': {}, '../../sourceImport': {},
    '../../projectLibrary': { filterProjects: projects => projects },
    '../../projectLibraryRefresh': { createLibraryRefreshController: () => ({ refreshFull: async () => {} }) },
    '../../projectDeletion': {
      findActiveProjectRuns: async () => { checks++; return []; },
      deleteProjectNow: async () => { deletions++; }, stopAndDeleteProject: async () => { throw new Error('not building'); },
    },
    '../../buildTasks': {}, '../../buildWatchdog': {}, '../../version.json': { versionName: '0.4.1' },
    '../state/AppSessionContext': { useAppSession: () => ({ profile: {}, error: null, setError() {} }) },
    '../theme/ThemeContext': { useTheme: () => ({ theme }) }, '../components/typography': { typeStyle: () => ({}) },
  };
  for (const component of ['Button', 'EmptyState', 'Header', 'ScreenShell', 'StatusBanner', 'TextField'])
    mocks[`../components/${component}`] = { [component]: component };
  for (const component of ['ProjectCard', 'ProjectActionsMenu', 'DeleteProjectDialog'])
    mocks[`../features/library/${component}`] = { [component]: component };
  const { LibraryScreen } = load('mobile/src/ui/screens/LibraryScreen.tsx', mocks);
  const render = () => { cursor = 0; return nodes(LibraryScreen()); };
  let tree = render();
  tree.find(n => n.type === 'ProjectCard').props.onMenu();
  tree = render();
  assert.equal(tree.find(n => n.type === 'ProjectActionsMenu').props.visible, true);
  assert.equal(tree.find(n => n.type === 'DeleteProjectDialog').props.visible, false);
  assert.equal(checks, 0, 'ellipsis does not enter destructive confirmation');
  assert.equal(deletions, 0);
  const { ProjectActionsMenu } = load('mobile/src/ui/features/library/ProjectActionsMenu.tsx', baseMocks);
  const menuTree = ProjectActionsMenu(tree.find(n => n.type === 'ProjectActionsMenu').props);
  nodes(menuTree).find(n => n.props?.testID === 'project-action-delete').props.onPress();
  await Promise.resolve();
  tree = render();
  assert.equal(tree.find(n => n.type === 'ProjectActionsMenu').props.visible, false);
  assert.equal(tree.find(n => n.type === 'DeleteProjectDialog').props.visible, true);
  assert.equal(deletions, 0, 'selecting delete still waits for confirmation');
  tree.find(n => n.type === 'DeleteProjectDialog').props.onConfirm();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(deletions, 1);
});
