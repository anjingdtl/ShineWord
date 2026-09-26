const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

module.exports = mergeConfig(getDefaultConfig(projectRoot), {
  watchFolders: [repoRoot],
  resolver: {
    nodeModulesPaths: [
      path.join(projectRoot, 'node_modules'),
      path.join(repoRoot, 'node_modules'),
    ],
  },
});
