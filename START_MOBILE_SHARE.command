#!/bin/zsh
cd "${0:A:h}"
TASK_NODE="$(command -v node 2>/dev/null)"
if [[ -z "$TASK_NODE" || "$("$TASK_NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != "24" ]]; then
  TASK_NODE="/Users/yangyi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$TASK_NODE" ]]; then
  print '请先安装 Node.js 24，再打开手机分享。'
  exit 1
fi
TASK_PLIST="$HOME/Library/LaunchAgents/com.wujian.pc-host.plist"
if [[ -f "$TASK_PLIST" ]]; then
  launchctl bootstrap "gui/$(id -u)" "$TASK_PLIST" 2>/dev/null
  launchctl kickstart "gui/$(id -u)/com.wujian.pc-host"
  print '电脑共享已启动。请使用最新的固定二维码。'
else
  print '尚未安装固定入口，请先运行电脑共享安装脚本。'
  exit 1
fi
