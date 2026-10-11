param([switch]$Lint)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $env:LOCALAPPDATA 'Codeclub\android-build-tools'
# Respect an installed SDK/JDK; the managed locations are a local development fallback.
if (!$env:JAVA_HOME) {
    $managedJdk = Get-ChildItem (Join-Path $toolRoot 'jdk') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($managedJdk) { $env:JAVA_HOME = $managedJdk.FullName }
}
if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $toolRoot 'sdk' }
$gradleCommand = Get-Command gradle -ErrorAction SilentlyContinue
$gradle = if ($gradleCommand) { $gradleCommand.Source } else { Join-Path $toolRoot 'gradle\gradle-8.11.1\bin\gradle.bat' }
if (!(Test-Path -LiteralPath $gradle) -or !(Test-Path -LiteralPath "$env:ANDROID_HOME\platforms\android-35\android.jar") -or !$env:JAVA_HOME) { throw 'Install JDK 17, Android SDK 35, Build Tools 35.0.0 and Gradle 8.11.1. See docs/android-companion.md.' }
$tasks = @('assembleDebug')
if ($Lint) { $tasks += 'lintDebug' }
& $gradle -p (Join-Path $projectRoot 'android-companion') @tasks --console=plain
if ($LASTEXITCODE) { throw 'Android build failed.' }
Write-Output (Join-Path $projectRoot 'android-companion\app\build\outputs\apk\debug\app-debug.apk')
