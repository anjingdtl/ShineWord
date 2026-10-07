param(
  [string]$Sdk = "$env:LOCALAPPDATA/Android/Sdk",
  [string]$Serial = 'emulator-5556',
  [string]$BuildTools = '37.0.0',
  [string]$Platform = 'android-37.1'
)
$ErrorActionPreference = 'Stop'
$qaRoot = (Resolve-Path "$PSScriptRoot/../..").Path
$qaOutput = Join-Path $qaRoot '.tmp/phase9/ui-text-helper'
$qaTools = Join-Path $Sdk "build-tools/$BuildTools"
$qaJar = Join-Path $Sdk "platforms/$Platform/android.jar"
New-Item -ItemType Directory -Force -Path "$qaOutput/classes", "$qaOutput/dex" | Out-Null
function Assert-QACommand { if ($LASTEXITCODE -ne 0) { throw "QA helper command failed with exit $LASTEXITCODE" } }
javac -source 8 -target 8 -classpath $qaJar -d "$qaOutput/classes" "$PSScriptRoot/TextInput.java"
Assert-QACommand
jar cf "$qaOutput/classes.jar" -C "$qaOutput/classes" .
Assert-QACommand
& "$qaTools/d8.bat" --lib $qaJar --min-api 26 --output "$qaOutput/dex" "$qaOutput/classes.jar"
Assert-QACommand
& "$qaTools/aapt2.exe" link -I $qaJar --manifest "$PSScriptRoot/AndroidManifest.xml" -o "$qaOutput/unsigned.apk"
Assert-QACommand
jar uf "$qaOutput/unsigned.apk" -C "$qaOutput/dex" classes.dex
Assert-QACommand
& "$qaTools/zipalign.exe" -f 4 "$qaOutput/unsigned.apk" "$qaOutput/aligned.apk"
Assert-QACommand
if (!(Test-Path -LiteralPath "$qaOutput/qa.keystore")) {
  keytool -genkeypair -keystore "$qaOutput/qa.keystore" -storepass qa-input-test -keypass qa-input-test -alias qa -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=ShineWord QA'
  Assert-QACommand
}
& "$qaTools/apksigner.bat" sign --ks "$qaOutput/qa.keystore" --ks-pass pass:qa-input-test --out "$qaOutput/ui-text-helper.apk" "$qaOutput/aligned.apk"
Assert-QACommand
& "$Sdk/platform-tools/adb.exe" -s $Serial install -t -r "$qaOutput/ui-text-helper.apk"
Assert-QACommand
