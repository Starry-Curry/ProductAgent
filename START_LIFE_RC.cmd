@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=3201
node -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Please use Node.js 24');process.exit(1)}"
if errorlevel 1 goto done
node scripts/life-launch.mjs --offline
:done
pause
