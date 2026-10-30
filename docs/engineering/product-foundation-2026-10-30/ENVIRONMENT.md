# 环境、隔离与复现

工作区：`D:/ProductAgent-LifeContext/.runtime/product-foundation-app`。原目录及旧工作区没有被替换，未读取私人数据库。原项目 `deliverables/` 未提交内容保持不动。

全局 Node 实际已是26.13.0，不符合本项目24要求。因此下载独立 Node **24.22.2**，核对官方 SHASUMS256 后解压到工作区 `.runtime/tools/`，没有修改系统 PATH 或全局 Node/Git。归档：`https://nodejs.org/dist/v24.22.2/node-v24.22.2-win-x64.zip`；SHA256：`ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2`。PowerShell HTTPS 首次失败，改用 Node HTTPS 成功获取并验证，不关闭 TLS 校验。

以下在本工作区 PowerShell 执行，变量仅影响当前进程：

```powershell
$node = '.runtime/tools/node-v24.22.2-win-x64/node.exe'
# 项目依赖遵循 package-lock.json；不安装全局包。
& $node .runtime/tools/node-v24.22.2-win-x64/node_modules/npm/bin/npm-cli.js ci --cache D:/ProductAgent-LifeContext/.runtime/npm-cache --no-audit --no-fund
& $node scripts/test-offline.mjs
& $node node_modules/typescript/bin/tsc --noEmit
$env:WUJIAN_BUILD_DIR='.next-closeout'
& $node node_modules/next/dist/bin/next build
# 独立本机账号；不启用付费模型。已有隔离目录会保留，不重置。
& $node scripts/product-foundation/preview.mjs --accounts --port=3216 --data=accounts-handoff --build=.next-closeout
```

真实模型实验由 `gateway.mjs` 单一台账限制150次/50元。应用仅收到 fixture-only 假凭证，网关进程使用既有 `.env.local` 认证，报告不含密钥/请求头；失败和重试计入，不重置历史。台账在工作区旁 `../product-foundation-evidence/`，**本轮已达到150次，不再启用 --cloud**。普通预览和 CI 保持关闭费用。

## REA 可选本机实验

```powershell
& $node .runtime/tools/node-v24.22.2-win-x64/node_modules/npm/bin/npm-cli.js install --prefix .runtime/rea-tools --cache D:/ProductAgent-LifeContext/.runtime/npm-cache --ignore-scripts --no-audit --no-fund rea-agents@6.8.0
& $node --test tests/software-lab.test.ts
```

REA 与应用依赖隔离。软件分析通过版本固定的 CLI（Skill 的合法回退路径），没有改 Codex MCP 配置，也没有安装 Ghidra/Hopper/ADB。原生分析引擎不存在不妨碍此次 JS 静态分析。诊断中的部分用户目录权限失败不被写成分析成功；真正成功的 Evidence 单独保留。

自有目标：`tests/fixtures/virtual-lamp/`，含实际 HTTP 服务与浏览器客户端。分析子进程只收到必要 PATH/SystemRoot/TEMP/NODE_ENV，不收到模型密钥或账号 Cookie。所有设备状态均来自本机软件，未访问真实硬件。源码版本变化后适配器失效，须重新分析/授权。

新账号库、会话、家庭邀请、协作回执、软件适配器和测试 SQLite 均在 `.runtime/*` 独立数据目录，不入 Git。新增表没有破坏性变更，原应用迁移备份逻辑保留。发布的截图/模型样本只有合成持有和合成人物经历；邀请口令、会话 Cookie 不发布。

账号目前限定同源本机服务；不是可以直接公网部署的完整认证产品。仍缺账号找回、完整成员生命周期、正式 TLS/身份服务与运营限流方案。
