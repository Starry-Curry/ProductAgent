#!/bin/zsh
cd -- "${0:A:h}"
wj_node="$(command -v node)"
if [[ -z "$wj_node" ]]; then
  wj_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$wj_node" ]]; then
  print '请先安装 Node.js 24，再运行物间。'
  read '?按回车退出'
  exit 1
fi
if /usr/bin/curl -fsS http://127.0.0.1:3210/api/health >/dev/null 2>&1; then
  /usr/bin/open http://127.0.0.1:3210/
  exit 0
fi
(print '页面准备好后会自动打开。'; for attempt in {1..180}; do if /usr/bin/curl -fsS http://127.0.0.1:3210/api/health >/dev/null 2>&1; then /usr/bin/open http://127.0.0.1:3210/; break; fi; sleep 1; done) &
"$wj_node" scripts/companion-start.mjs start --cloud
read '?程序已退出。按回车关闭窗口'
