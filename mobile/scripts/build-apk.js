const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const mobileRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(mobileRoot, '..');
const androidDir = path.join(mobileRoot, 'android');
const variant = (process.argv[2] || '').toLowerCase();

if (!['debug', 'release'].includes(variant)) {
  console.error('Usage: npm run apk:<debug|release>');
  process.exit(1);
}

const mobilePackage = require(path.join(mobileRoot, 'package.json'));
const appGradle = fs.readFileSync(path.join(androidDir, 'app', 'build.gradle'), 'utf8');
const appVersion = appGradle.match(/versionName\s+["']([^"']+)["']/);
const appVersionCode = appGradle.match(/versionCode\s+(\d+)/);
const appId = appGradle.match(/applicationId\s+["']([^"']+)["']/);
if (!appVersion || appVersion[1] !== mobilePackage.version) {
  console.error(
    `Version mismatch: mobile/package.json=${mobilePackage.version}, app/build.gradle=${appVersion?.[1] || 'missing'}`,
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(mobileRoot, 'node_modules', 'react-native', 'package.json'))) {
  console.error('Mobile dependencies are missing. Run npm ci from the mobile directory first.');
  process.exit(1);
}

const localPropertiesPath = path.join(androidDir, 'local.properties');
const localProperties = fs.existsSync(localPropertiesPath)
  ? fs.readFileSync(localPropertiesPath, 'utf8')
  : '';
const localSdkPath = localProperties.match(/^\s*sdk\.dir\s*=\s*(.+)\s*$/m)?.[1]
  ?.replace(/\\:/g, ':')
  .replace(/\\\\/g, '\\');
const sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || localSdkPath;
if (!sdkPath) {
  console.error('Android SDK not configured. Set ANDROID_HOME/ANDROID_SDK_ROOT or mobile/android/local.properties.');
  process.exit(1);
}

const releaseSigningVariableNames = [
  'SHINE_WRITER_RELEASE_STORE_FILE',
  'SHINE_WRITER_RELEASE_STORE_PASSWORD',
  'SHINE_WRITER_RELEASE_KEY_ALIAS',
  'SHINE_WRITER_RELEASE_KEY_PASSWORD',
];
if (variant === 'release') {
  const missing = releaseSigningVariableNames.filter(name => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.error(`Release signing variables are missing: ${missing.join(', ')}`);
    console.error('Load the Windows User-scope variables with mobile/scripts/build-release-apk.ps1.');
    process.exit(1);
  }
  if (!fs.existsSync(path.resolve(process.env.SHINE_WRITER_RELEASE_STORE_FILE))) {
    console.error('Release signing keystore does not exist at the configured path.');
    process.exit(1);
  }
}

const gradleScript = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const wrapperJar = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.jar');
if (!fs.existsSync(gradleScript) || !fs.existsSync(wrapperJar)) {
  console.error('Gradle Wrapper files are missing from mobile/android.');
  process.exit(1);
}

const gradleTask = variant === 'debug' ? 'assembleDebug' : 'assembleRelease';
const build = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', gradleScript, gradleTask, '--stacktrace'], {
    cwd: androidDir,
    stdio: 'inherit',
    shell: false,
  })
  : spawnSync('bash', [gradleScript, gradleTask, '--stacktrace'], {
    cwd: androidDir,
    stdio: 'inherit',
    shell: false,
  });

if (build.status !== 0) {
  if (build.error) console.error(build.error.message);
  process.exit(build.status || 1);
}

const sourceApk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
if (!fs.existsSync(sourceApk)) {
  console.error(`Gradle completed without producing ${sourceApk}`);
  process.exit(1);
}

const rootGradle = fs.readFileSync(path.join(androidDir, 'build.gradle'), 'utf8');
const buildToolsVersion = rootGradle.match(/buildToolsVersion\s*=\s*["']([^"']+)["']/)?.[1];
if (!buildToolsVersion || !appVersionCode || !appId) {
  console.error('Could not read Android build-tools, package, and version metadata from Gradle configuration.');
  process.exit(1);
}

function runAndroidTool(toolName, args) {
  const windowsExtensions = { aapt: '.exe', apksigner: '.bat', zipalign: '.exe' };
  const extension = process.platform === 'win32' ? windowsExtensions[toolName] : '';
  const toolPath = path.join(sdkPath, 'build-tools', buildToolsVersion, `${toolName}${extension}`);
  if (!fs.existsSync(toolPath)) {
    console.error(`Android SDK tool not found: ${toolPath}`);
    process.exit(1);
  }
  return process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', toolPath, ...args], { encoding: 'utf8', windowsHide: true })
    : spawnSync(toolPath, args, { encoding: 'utf8' });
}

const badging = runAndroidTool('aapt', ['dump', 'badging', sourceApk]);
if (badging.status !== 0) {
  console.error('Could not inspect APK metadata with aapt.');
  process.exit(badging.status || 1);
}
const packageInfo = badging.stdout.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
if (!packageInfo
  || packageInfo[1] !== appId[1]
  || packageInfo[2] !== appVersionCode[1]
  || packageInfo[3] !== appVersion[1]) {
  console.error('APK package/version metadata does not match mobile/android/app/build.gradle.');
  process.exit(1);
}

if (variant === 'release') {
  const signature = runAndroidTool('apksigner', ['verify', '--verbose', '--print-certs', sourceApk]);
  const signatureOutput = `${signature.stdout || ''}\n${signature.stderr || ''}`;
  const expectedCertificate = '017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a';
  const actualCertificate = signatureOutput.match(/certificate SHA-256 digest:\s*([0-9a-f:]+)/i)?.[1]
    ?.replace(/:/g, '')
    .toLowerCase();
  if (signature.status !== 0
    || !/Verified using v2 scheme \(APK Signature Scheme v2\): true/i.test(signatureOutput)
    || !/Number of signers:\s*1/i.test(signatureOutput)
    || actualCertificate !== expectedCertificate) {
    console.error('Release APK signature verification failed or did not match the configured signing certificate.');
    process.exit(signature.status || 1);
  }

  const alignment = runAndroidTool('zipalign', ['-c', '4', sourceApk]);
  if (alignment.status !== 0) {
    console.error('Release APK zip alignment verification failed.');
    process.exit(alignment.status || 1);
  }
  console.log('Release APK verified: expected certificate, one signer, v2 signature, and zip alignment.');
}

const outputDir = path.join(projectRoot, 'dist', 'apk', variant);
const outputApk = path.join(outputDir, `ShineWord-V${mobilePackage.version}-${variant}.apk`);
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(sourceApk, outputApk);

const sizeMb = (fs.statSync(outputApk).size / 1024 / 1024).toFixed(2);
console.log(`APK copied to ${outputApk} (${sizeMb} MB)`);
