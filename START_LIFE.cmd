@echo off
cd /d "%~dp0"
node -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Please use Node.js 24');process.exit(1)}"
if errorlevel 1 goto done
if not exist node_modules\next\dist\bin\next (
  echo Dependencies missing. Run npm ci first.
  goto done
)
if not exist .next\BUILD_ID (
  call npm.cmd run build
  if errorlevel 1 goto done
)
echo Open http://127.0.0.1:3200 . Keep this window open.
call npm.cmd run start:life
:done
pause
