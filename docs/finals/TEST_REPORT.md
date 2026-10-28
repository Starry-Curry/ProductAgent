# 第一阶段测试报告

测试日：2026-10-29，北京时间。产品源码基准 `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`。工作目录 `D:\ProductAgent-LifeContext\.runtime\finals-audit`；Node v24.16.0 / npm 11.13.0 / Windows / Microsoft Edge。完整命令与返回码见 [summary.json](evidence/summary.json)，脱敏日志在 [evidence/logs](evidence/logs/)，文件哈希在 [manifest.json](evidence/manifest.json)。发布日志统一LF并去除行末空白，原运行日志仍在本机`.runtime/audit-20261029`，summary逐命令保留原文件SHA256；没有删除失败内容。

## 自动基础测试与网页验收

| 实际命令                                                                 | 结果                                          | 范围与日志                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --cache .npm --no-audit --no-fund`                               | 通过，安装100个包，锁文件未改                 | [install.log](evidence/logs/install.log)；没有以此宣称依赖漏洞扫描通过                                                                                                                                                                                          |
| `npm test`                                                               | **191/191通过，0失败/跳过**                   | [unit.log](evidence/logs/unit.log)；含模型替身/领域/授权/持久化测试，**非191次真实模型**                                                                                                                                                                        |
| `npm run typecheck`                                                      | 通过                                          | [typecheck.log](evidence/logs/typecheck.log)                                                                                                                                                                                                                    |
| `npm run test:benchmark`                                                 | exit0；新版0 regression；旧版1 falseRejection | [benchmark.log](evidence/logs/benchmark.log)、[旧结果](evidence/legacy-benchmark.json)、[新版结果](evidence/foundation-benchmark.json)。5条坏回答拒绝，1条正确同义改写被拒                                                                                      |
| `npm run build`                                                          | 通过，Next.js 15.5.28                         | [build.log](evidence/logs/build.log)；独立克隆中的生产构建，未覆盖旧服务                                                                                                                                                                                        |
| `npm run test:acceptance -- life`                                        | 两组通过                                      | 新版物品/资料/故事/发现/家庭/社交，PDF文字提取、合成图本机OCR、QR/EAN解码、照片录入、桌面及390px；[日志](evidence/logs/browser-life.log)                                                                                                                        |
| `npm run test:acceptance`                                                | 四组通过                                      | integration / foundation / household / home，含API范围、遗忘、澄清、反馈、家庭交接与旧版；[日志](evidence/logs/browser-legacy.log)                                                                                                                              |
| `npm run test:task-planning`                                             | **原默认失败**                                | 写死macOS Chrome路径；浏览器未启动，继发libuv assertion；[原日志](evidence/logs/browser-task.log)                                                                                                                                                               |
| `npm run test:care`                                                      | **原默认失败**                                | 同上；[原日志](evidence/logs/browser-care.log)                                                                                                                                                                                                                  |
| 设置 `EDGE_PATH` 后重跑以上两条                                          | 两组通过                                      | 保存/刷新/电量依赖/缩短时间/排除；关怀版导航/提醒/实际事项/模型关闭/390px；[task](evidence/logs/browser-task-edge.log)、[care](evidence/logs/browser-care-edge.log)                                                                                             |
| `node scripts/verify-local.mjs storybook`                                | 通过                                          | 三类故事布局、章节/多物品、回到原滚动位置、焦点/Escape、照片与CRUD；[日志](evidence/logs/browser-storybook.log)                                                                                                                                                 |
| `npm run test:cloud`                                                     | **原脚本失败**                                | 页面实际存在但标题/正文定位器过期；[原日志](evidence/logs/cloud.log)含ARIA实际页面证据，不能当服务崩溃                                                                                                                                                          |
| `node scripts/finals-cloud-recheck.mjs`                                  | 首次审计包装器失败，修正后通过                | 首次把file URL当shell路径，已修为fileURLToPath，保留[包装器初错](evidence/logs/cloud-wrapper-initial.log)。仅修改审计副本的旧标题与正文定位器，附加截图/pageerror；[最终日志](evidence/logs/cloud-recheck.log)、[改动清单](evidence/cloud-test-adaptation.json) |
| `node --experimental-strip-types scripts/finals-offline-diagnostics.mjs` | 4个定向诊断断言通过                           | 两种环境tool往返、两种库存指代；[结果](evidence/offline-diagnostics.json)。这些断言**复现现有缺陷，不表示缺陷已修复**                                                                                                                                           |
| `node --experimental-strip-types scripts/finals-audit.mjs`               | 离线探针完成                                  | 缺配置/本地兜底/0出站请求；[结果](evidence/offline-probes.json)                                                                                                                                                                                                 |

Edge设置使用：`$env:EDGE_PATH='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`。已有依赖足够，未下载第二套浏览器。验收启动器使用随机空闲端口、独立`.runtime/verification-*`数据，进程退出后结束其自有服务；没有终止用户旧服务。

公开模式审计副本整组通过的含义：两个合成访客的物品/故事/媒体/记忆/会话隔离、伪造身份拒绝、服务器重启、完整快照与空卷恢复、页面刷新、假密钥不出现在页面/API/JS、测试进程模型替身预算跨重启、HTTP限流、退出与清理。**0真实模型；没有Docker/Linux/公网/真实Volume验证。** 原`test:cloud`仍失败，副本通过不能掩盖它。

所有新增数据均为合成，真实主库未打开/迁移。迁移自动备份保留在隔离fixture/verification目录，审计fixture的`PRAGMA integrity_check`为ok。没有为了“证明未变”而读取用户私人数据库。

## 真实百炼：实际执行方式与限制

本轮用户最后补充允许最多40次，覆盖最初12次上限；**实际22次尝试后停止**。已配置凭证仅由应用进程`process.loadEnvFile`加载原项目`.env.local`用于鉴权，不打印、不复制；没读取api.txt、其他工作区密钥或账单账户。每次HTTP发出前先写台账，修复调用和失败也计数，硬上限40；未开启百炼搜索/视觉请求。

实际命令（分别执行主场景与补充场景，夹具修正后各复验一次）：

```powershell
node --experimental-strip-types scripts/finals-audit.mjs --live --authorize-paid-max=40 --config=D:/ProductAgent-LifeContext/.env.local
node --experimental-strip-types scripts/finals-audit.mjs --live --followup --authorize-paid-max=40 --config=D:/ProductAgent-LifeContext/.env.local
```

这两个命令会付费，后续轮次须先取得对应任务授权；默认不带`--live`零网络。该审计台账为串行单进程设计，不用并发运行多个付费探针。即使返回`source=curated-guidance`，也不能凭标签推断是否付费，须核对台账。

共同模型为`qwen-plus`，端点`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，非思考。Agent沿现有`respond → executeGraph/planDiscovery`运行，直接组用相同Provider传输但无工具/JSON强制。直接组上限900输出Token，Graph1500/2600，创意3候选2800；双方均未固定随机种子/temperature。比较控制了模型和当前目标/登记事实，**没有控制Prompt、输出预算、工具及候选数量，不能作为统计优劣结论**。没有用千问网页产品作对照。真实模型探针通过服务器库函数调用Provider；网页/API旅程另用隔离生产服务离线验证，没有从公开HTTP页面发起付费测试。

测试使用4件登记合成物品（水杯、纸本、笔、M-R0061鼠标）；补充场景再加合成收纳盒。主资料来自仓库绑定资料包；收纳盒手册是明示的合成90字符fixture，`example.org`没有被抓取。测试直接写入隔离知识表以检查传输/引用/步骤流程，其输出虽沿产品既有`kind=official`字段，**不构成官方说明书获取或实物验证成功**。

请求1–10的初始夹具将附加限制放在Item类型未声明的`attributes.notes`；发现后把它改为实际支持的`attributes.care`，请求11–22复验。初版结果保留为历史，费用全部计入；本轮主要结论使用care-v2复验及独立离线复现。报告不把该审计夹具错误隐去。

## 场景结果：业务判定独立于HTTP

| 场景                            | 直接千问                                                        | 经过物间Agent                                                                        | 判定                                                                                                  |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 物品理解 / 无刻度杯             | #11能读取限制，但添加未提供的标准名等说法，并声称未引入外部知识 | #12读到care限制、判不可计量，却又保证日常饮水可安心；路由companion，校验通过         | **部分理解、重要限制失守**；不是“全系统不读数据”                                                      |
| 原始创意请求 / 20分钟、已有物品 | #13生成鼠标蘸墨拓印等无可靠根据玩法                             | Agent 0次请求，needs_info；库存指代被误判                                            | **业务预处理失败**；不能把这个Agent结果归因Qwen质量                                                   |
| M-R0061供电与充电               | #14读AA事实，但从“未说明充电”扩大成确定不能充电                 | Agent 0次请求，精选资料给AA并明确资料未确认充电，不猜状态                            | **有限范围有用**；不是模型与模型对照成功                                                              |
| 查清单后放松建议                | 无对应直接组，专测工具链                                        | #15调用list_accessible_items，#16真正使用返回的4个名称，但建议喝温水；工具缺属性限制 | **工具协议与数据往返通过，建议质量未过**                                                              |
| 同义改写创意入口                | #17仍产生未登记电脑、计时与共振机制                             | #18确实进入generate；草稿需修复，#19 30秒超时，最终unavailable                       | **入口对照定位成功，创意业务失败**。#8初版曾发布杯底反射方案，但有未核实几何/表面条件，不能当可靠创意 |
| 导入手册下的清洁任务            | #20在干布/不可浸水以外扩写大量禁止事项                          | #21真正调search_product_knowledge，#22据返回chunk给干布、不可浸水两步                | **合成资料流程通过**，显著收束无据扩写；没有验证实物，也未证明缺布等现场资源均被核对                  |
| 摄影出游准备                    | 未做直接模型比较                                                | Agent 0请求，明确本地规则、确认后保存；浏览器另验证持久与修订                        | **有限规则闭环通过**，不是通用动态Agent                                                               |

两次清单工具往返及一次资料工具往返均有上游原生`tool_calls`、应用`tool_completed`与第二轮`role=tool`内容，不只是模型在正文说“我查过”。真实工具读取的是本次SQLite中的登记数据与导入chunk；非私人真实库存。

## 请求数量、用量与费用

**22次尝试；21次HTTP200；1次传输超时（#19，30017ms）**。已返回input **31,805** / output **8,019** tokens。#19没有usage，可能的上游消耗未知。请求#18是草稿生成；#19是业务质量修复，不是静默网络重试。最终unavailable保留了失败。

按本次读取的[阿里云官方qwen-plus北京价目](https://help.aliyun.com/zh/model-studio/qwen-plus)，非思考、每请求输入≤128K档，输入¥0.8/百万、输出¥2/百万；已知返回用量原价估算：`31805×0.8/1e6 + 8019×2/1e6 = ¥0.041482`。不含超时未知用量，也没应用缓存、免费额度、优惠；**实际账单未知，不是扣款证明**。

每次模型配置、max_tokens、工具名、上游返回、usage、耗时及错误在[paid-ledger.json](evidence/paid-ledger.json)。不含Authorization、Key、Cookie或真实私人输入。后续若要模型快照级复现，还应记录上游returned model、固定快照/采样参数；本轮仅记录配置别名。

## 截图与实际页面观察

已经查看桌面首页、390px首页、手机版准备清单、关怀版桌面，并保存其他旅程截图。桌面/390px主要旅程未捕获pageerror；这只证明被覆盖路径，不证明所有页面或浏览器无错。

| 截图                                                                                                    | 说明                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [首页桌面](evidence/screenshots/home-desktop.png) / [390px](evidence/screenshots/home-mobile.png)       | 合成物品及测试上传色块，不能当真实用户照片 |
| [准备清单390px](evidence/screenshots/preparation-mobile.png)                                            | 进度、变化依赖、确认按钮与持久化           |
| [关怀版桌面](evidence/screenshots/care-desktop.png)                                                     | 家庭提醒仍有效、精选资料指导、演示身份     |
| [故事桌面](evidence/screenshots/stories-desktop.png) / [390px](evidence/screenshots/stories-mobile.png) | 测试图文、阅读及布局                       |
| [公开模式故事](evidence/screenshots/cloud-story.png)                                                    | 隔离合成访客恢复后页面，0真实模型          |

## 后续离线复现

```powershell
npm.cmd ci --cache .npm --no-audit --no-fund
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
$env:PRODUCT_AGENT_DATA_DIR=Join-Path (Get-Location) '.runtime/finals-reproduce'
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:benchmark
npm.cmd run build
$env:EDGE_PATH='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npm.cmd run test:acceptance -- life
npm.cmd run test:task-planning
npm.cmd run test:care
node --experimental-strip-types scripts/finals-offline-diagnostics.mjs
node scripts/finals-cloud-recheck.mjs
```

原始公开脚本仍有定位器问题，已明确记录；不建议为了绿色结果修改产品文案迎合旧断言。没有新增真实模型调用来验证设备效果、模型迁移、Linux/Docker或公网部署；这些仍是待验证项。

<!-- Request table generated from the immutable audit ledger follows. -->

## 逐请求记录（输入/输出Token、耗时）

| #   | 场景/路径                  | HTTP/结果       | 输入 | 输出 | ms    |
| --- | -------------------------- | --------------- | ---- | ---- | ----- |
| 1   | understanding:direct       | 200             | 575  | 434  | 10551 |
| 2   | understanding:agent        | 200             | 2236 | 236  | 5593  |
| 3   | creative:direct            | 200             | 550  | 441  | 10015 |
| 4   | task:direct                | 200             | 572  | 219  | 5877  |
| 5   | tool:agent                 | 200             | 2117 | 16   | 693   |
| 6   | tool:agent                 | 200             | 2210 | 122  | 3036  |
| 7   | creative-normalized:direct | 200             | 607  | 530  | 12488 |
| 8   | creative-normalized:agent  | 200             | 2452 | 1576 | 35091 |
| 9   | grounded-task:direct       | 200             | 681  | 287  | 7046  |
| 10  | grounded-task:agent        | 200             | 2538 | 143  | 3495  |
| 11  | understanding:direct       | 200             | 570  | 415  | 9643  |
| 12  | understanding:agent        | 200             | 2234 | 184  | 4887  |
| 13  | creative:direct            | 200             | 547  | 423  | 9639  |
| 14  | task:direct                | 200             | 567  | 161  | 3846  |
| 15  | tool:agent                 | 200             | 2117 | 16   | 756   |
| 16  | tool:agent                 | 200             | 2210 | 109  | 2692  |
| 17  | creative-normalized:direct | 200             | 614  | 466  | 10894 |
| 18  | creative-normalized:agent  | 200             | 2466 | 1784 | 39708 |
| 19  | creative-normalized:agent  | transport-error | 未知 | 未知 | 30017 |
| 20  | grounded-task:direct       | 200             | 685  | 272  | 6512  |
| 21  | grounded-task:agent        | 200             | 2535 | 33   | 1109  |
| 22  | grounded-task:agent        | 200             | 2722 | 152  | 3646  |
