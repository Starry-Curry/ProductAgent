# 测试、环境与恢复

## 已执行（均在独立工作区）

Node.js 24.22.2 / package-lock；`npm ci`，新增OpenAI SDK与react-markdown。依赖仅装在此工作区，未修改全局Node或Git。

| 命令 | 实际结果 | 证据 |
|---|---|---|
| `node --experimental-strip-types --test tests/practical-agent.test.ts` | 新增9项全通过；替身模型，不收费 | slice4-offline-v3.txt |
| `node --experimental-strip-types --test tests/practical-ledger.test.ts` | 1项离线HTTP替身：手动体验不记录正文、原台账保留、达到额度停止 | private-preview-offline.txt |
| `npm test` | 452项，451通过，1项既有跳过，无失败 | delivery-regression.txt |
| `npm run typecheck` | 通过 | delivery-typecheck.txt |
| `npm run test:benchmark` | 0 regressions；纯离线 | final-benchmark.txt |
| `WUJIAN_BUILD_DIR=.next-practical npm run build` | 生产构建通过 | delivery-build.txt |
| `node scripts/practical/sony-browser.mjs --stage=sony-browser-v6` | 真录入/真工具/真模型/真来源/追问；3请求 | sony-browser-v6.json |
| `node scripts/practical/canon-browser.mjs --stage=canon-browser-v2` | 真链接录入/主动抓取/多问/追问；3请求 | canon-browser-v2.json |
| `node scripts/practical/experience-browser.mjs --stage=experience-browser-v4 --resume-v2` | 纠正、撤销、遗忘已UI执行；最后取证相对URL错误 | experience-browser-v4.json |
| `node scripts/practical/experience-browser.mjs --stage=experience-browser-v5 --verify-forgotten` | 单独补验遗忘后正文为空/真实模型不再携带经历 | experience-browser-v5.json |
| `node --experimental-strip-types scripts/practical/compare.ts --authorized-60-cny15 --stage=small-comparison-final` | 同模型两题三方，共5请求；不是大评测 | small-comparison-final.json |
| `node scripts/practical/cross-item-browser.mjs --stage=cross-item-browser-v3 --reuse-items` | 兼容核心正确，完整方案部分达标 | cross-item-browser-v3.json |
| `node scripts/practical/final-browser.mjs` | 最终生产包Sony/Canon、桌面/手机追问，4请求 | final-browser.json |
| `TEST_BASE_URL=http://127.0.0.1:3240 TEST_REPORT_DIR=.../evidence/business-regression node scripts/real-intelligence/browser-regression.mjs` | 离线真实浏览器：经验、家庭、赠礼、撤权隔离4组通过；0付费 | business-regression/browser.json |
| `node scripts/practical/scan.mjs` | 拟发布文件与新增历史对象秘密/路径/大文件检查 | secret-scan.json |

所有日志均在本目录evidence。表中stage为已执行的历史命令；复跑必须使用新的唯一stage，禁止覆盖现有证据。带有resume/reuse的补验依赖本轮忽略测试状态；干净环境先执行Sony注册/录入，再执行Canon与完整经历、跨物品流程。PowerShell使用 `$env:NAME='value'` 设置对应环境，不把上表POSIX前缀直接粘贴执行。离线回归明确关闭两道付费门、使用独立PRODUCT_AGENT_DATA_DIR；模型替身不等于真实千问。最后只读/提取开关的移动端真实浏览器补验见`ui-privacy-smoke.json`，0模型请求；读取可单独启用，关闭读取也会关闭提取，不通过候选开关暗中启用已关闭的读取。

## 本轮真实请求

独立轮次 **49/60 请求，估算¥4.7178/15；输入325,120、输出22,677 Token**。49个上游均返回；浏览器自动化失败及0上游的本地网关配置错误仍保留。失败/重试没有豁免。未读取、重置或覆盖旧247次台账。无现实设备验证。

截至交付49次合成测试的完整台账[model-calls.json](evidence/model-calls.json)保留每次原始输入、工具、返回、耗时、Token与估算；[usage-summary.json](evidence/usage-summary.json)包含边界与口径。模型请求固定qwen3.8-max-0902、非思考模式；SDK原生Function Calling、自然答案，无强制答案JSON、无第二模型审稿。原网页与PDF获取不计为付费模型请求。价格按[百炼官方标价](https://help.aliyun.com/zh/model-studio/model-pricing)12/36元每百万输入/输出Token估算，非账单。

最终4条缓存资料浏览器回答：7384/5684/3920/3795毫秒，各1请求；P50=4802ms、近秩P95=7384ms，仅n=4，不宣称全产品性能。首次无缓存Sony11.9秒、2请求。HTTP成功不等于任务正确，逐案状态另见DELIVERY与case-review。

## 启动与恢复

当前工作区：`D:\ProductAgent-LifeContext\.runtime\practical-agent-v1`，独立分支`codex/wujian-practical-agent-v1`，基线0432ace33。未迁移真实库，未改项目Instructions，未合并main。

本机已构建，可在Node24的PowerShell中执行：

```powershell
Set-Location D:\ProductAgent-LifeContext\.runtime\practical-agent-v1
$env:PATH='D:/ProductAgent-LifeContext/.runtime/product-foundation-app/.runtime/tools/node-v24.22.2-win-x64;'+$env:PATH
node scripts/practical/preview.mjs --authorized-60-cny15
```

打开 http://127.0.0.1:3232 ，注册一个自己的测试账号。每次预览最多30分钟；真实调用仍累计在同一个60次/15元台账，重启不重置额度。停止方法：在当前工作区创建`.runtime/stop-practical-preview-3232`，脚本关闭子进程及网关；重启前仅删除这个专用停止标记。不得删除轮次账本或锁来绕额度。若网关额度不足，停止付费，不自动换账户。原账号和测试cookie不公开；账号之间默认隔离。

默认交付预览不把后续手动对话的正文、输入Hash或输出写入公开台账，只追加请求、Token、耗时与估算费用；原来的49次合成样本保持原样。正常会话仍在忽略的测试库中。未来确需采集新的合成评测证据时，明确加`--record-synthetic-evidence`，不得用该参数采集私人数据。该开关不改变额度、不创建新账本。

此本机专用测试脚本仅在网关进程内读取已授权的原项目忽略配置用于认证，应用只得到fixture-only假凭证；不把密钥复制到工作区、报告或前端。其他电脑需正常配置自己的忽略环境，不能借此脚本获取凭证。

若需从干净检出构建：Node24 → `npm ci`；将`WUJIAN_BUILD_DIR=.next-practical`、`PRODUCT_AGENT_DATA_DIR`设到新的`.runtime/`子目录、关闭付费后`npm run build`。正常应用明确配置`WUJIAN_AGENT_RUNTIME=native`并按已有授权门使用模型；普通问答没有模型时保留既有离线业务。`WUJIAN_EXPERIMENTAL_FACT_QA=false`和`WUJIAN_EXPERIMENTAL_KERNEL_V3=false`保持关闭。

现有Sony/Canon测试数据在`.runtime/practical-preview`，全为模拟持有/合成账号，未提交。输入官方资料示例：Sony WH-CH520；Canon SELPHY CP1500、公开链接https://cam.start.canon/en/P001/manual/html/UG-01_Preparations_0030.html。录入时确认持有且标记模拟；不要当成真正拥有。经历功能：展开“继续我的事”创建任务 → 回答后记录“实际尝试结果”并独立允许未来复用/云端使用 → 新会话显式勾选使用获准经验。可在原任务纠正、撤销或忘记。

恢复代码：选择d59b10e（Sony）、65e94f4（Canon）或c910aff（经历/资料上下文）创建新的独立分支/工作区，使用新的隔离数据目录；不要reset现有工作区、覆盖数据库或删历史。恢复上一执行路径仅设`WUJIAN_AGENT_RUNTIME=legacy`，不需要数据迁移。已有角色、权限、记忆、故事、赠礼、家庭、REA和创造力代码保留。已生成的next-env/tsconfig临时目录修改不提交。
