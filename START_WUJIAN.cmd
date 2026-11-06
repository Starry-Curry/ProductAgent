@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo 请先安装 Node.js 24，再运行物间。
 pause
 exit /b 1
)
start "物间" http://127.0.0.1:3210/
node scripts/companion-start.mjs start --cloud
pause
