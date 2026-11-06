@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows.ps1" -Task start
if errorlevel 1 pause
endlocal
