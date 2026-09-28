import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Closeout C5: headless world-build runner, woken by the dataSync foreground
// service. Only the runId crosses the boundary; state lives in SQLite.
AppRegistry.registerHeadlessTask('WorldBuildRunner', () => require('./src/buildRunner').worldBuildRunner);
