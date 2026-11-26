# Pravi APK: dist-apk\nba-predikcije.apk
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$jdk = Get-ChildItem (Join-Path $root '.tools\jdk-dl') -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
if (-not $env:JAVA_HOME) { throw 'Potreban je JDK 21 (postavite JAVA_HOME).' }
$env:GRADLE_USER_HOME = Join-Path $root '.tools\gradle'
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

Push-Location (Join-Path $root 'web')
try {
  npm run android:sync
  if ($LASTEXITCODE -ne 0) { throw 'Web deo nije uspeo.' }
  Set-Location android
  .\gradlew.bat assembleDebug --no-daemon -q
  if ($LASTEXITCODE -ne 0) { throw 'Android build nije uspeo.' }
  $out = Join-Path $root 'dist-apk'
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item app\build\outputs\apk\debug\app-debug.apk (Join-Path $out 'nba-predikcije.apk') -Force
  Write-Output "Gotovo: $out\nba-predikcije.apk"
} finally { Pop-Location }
