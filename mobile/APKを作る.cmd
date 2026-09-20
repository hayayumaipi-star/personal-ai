@echo off
rem  Personal AI - build an installable Android APK via EAS.
rem  Runs build-apk.ps1 without changing PowerShell execution policy.
rem  All Japanese guidance lives in build-apk.ps1 (UTF-8 with BOM), not here.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" %*
echo.
pause
