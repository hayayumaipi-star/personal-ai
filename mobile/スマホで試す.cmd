@echo off
rem  Personal AI - launcher. Runs start.ps1 without changing PowerShell execution policy.
rem  All Japanese guidance lives in start.ps1 (UTF-8 with BOM), not here:
rem  a .cmd file is read in the console codepage, so non-ASCII would break.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
echo.
pause
