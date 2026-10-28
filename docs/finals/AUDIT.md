# 技术现状审计与问题定位

日期：2026-10-29；基准 `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`。所有定位指向该基准的源码。问题均未在正式产品中修复。

## 代码来源与隔离

| 项目               | 本轮核验                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 仓库               | `https://github.com/Starry-Curry/ProductAgent.git`；git origin、远端HEAD与安全克隆均对应目标仓库                                     |
| 默认分支/远端 HEAD | `main` / `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`；初次及收尾 `git -c http.sslBackend=openssl ls-remote --symref origin HEAD` 一致 |
| 提交时间           | 2026-10-22 00:52:15 +08:00，`feat: package Wujian as a runnable product agent`                                                       |
| 原目录             | `D:\ProductAgent-LifeContext`；`handoff/wujian-prelim-20261021` / `9ba0bc8bc750721986b4824a681aef99670b1957`                         |
| 原工作区状态       | 开始/收尾均只有 `?? deliverables/`；未覆盖、清理或切换该分支，没有读取其交付内容                                                     |
| 实际审计路径       | `D:\ProductAgent-LifeContext\.runtime\finals-audit`，安全独立克隆；分支 `codex/finals-baseline-audit`                                |
| 初始审计状态       | 从最新 main 干净检出，随后只添加文档、审计脚本和脱敏合成证据；`src/`、依赖清单与锁文件无差异                                         |
| 环境               | Windows、Node v24.16.0、npm 11.13.0；北京时间 2026-10-29，详细时间在证据 JSON 中以 UTC 保存                                          |

首次 Git HTTPS 因 Windows schannel `SEC_E_NO_CREDENTIALS` 失败；使用单次 `-c http.sslBackend=openssl` 成功，未关闭 TLS 验证或改全局配置。更新原仓库 Git 元数据需沙箱批准，已通过后获取最新 refs，不改变原工作文件。曾由管理工具创建一个临时工作树，因路径在当前可写根之外即归档；最终审计使用上述可写范围内的独立克隆，没有继续使用被归档工作树。

已读原目录要求的 README、实现状态、工程交接和 docs 索引；远端最新版本已删除后三份根工程报告（`DEVELOPMENT_REPORT.md`、`IMPLEMENTATION_STATUS.md`、`REVIEW_HANDOFF.md`），并大幅整理历史 docs。已另读最新 README、PRODUCT、ARCHITECTURE、VALIDATION、DEPLOYMENT 及实际代码。本轮新建精简根记录连接本审计，不把旧分支历史验收冒充当前验收，也不复制旧数据库。

## 证据等级

交付状态：本轮61个审计/文档/合成证据文件已暂存；Git作者身份缺失，首次commit未成功，因此HEAD仍是产品基准，尚无审计提交SHA或远端审计分支。没有把暂存误写成已提交/已推送。后续提交步骤见根REVIEW_HANDOFF。

- **代码证实**：源码可直接确认，但不自动代表所有运行环境均已验证。
- **测试复现**：注明离线替身 / 本地浏览器 / 真实模型及请求号。
- **合理怀疑**：有原因，尚无隔离变量或统计证据。
- **暂不能验证**：缺少实机、账号、平台或本轮未执行。

P1 表示应先解决的核心任务/约束问题；P2 表示明显体验或工程诊断缺口。这里不是完整安全审计结论。

## 已证实与复现的问题

| ID / 优先级                                 | 证据与实际影响                                                                                                                                                                                                                                                                   | 定位与建议（尚未实施）                                                                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 / P1 公开工具循环被预算截断             | 代码证实；离线真实 Graph + 替身复现。本机2次 complete 得到回答；`public-demo` 仅1次，工具实际执行后返回 referred，未能读结果作答。非真实公开百炼测试                                                                                                                             | [`graph.ts:1067`](../../src/lib/agent/graph.ts#L1067)，校验修复也有相同上限。把任务费用上限与“至少一次工具往返所需轮次”分开；继续保留每次 HTTP 持久预算。先用只读工具试验，不能直接放开无限循环                                           |
| F02 / P2 库存指代误判，模型根本未运行       | 真实首轮/复验均0 API；已有4件可用物品，目标包含“只用我已登记的物品”仍报无法对应库存。离线替身计数确认；改为“利用现有物品”才进入 Provider                                                                                                                                         | [`planning.ts:62`](../../src/lib/life/planning.ts#L62)、`:287`、`:338`。标准化库存指代与具体新物品声明，增加自然同义表达回归；`不要拍照`也被 focus 的关键词当作摄影方向，属同类负向语义损失                                               |
| F03 / P1 工具取得真数据却丢掉关键条件       | 真实请求5–6、15–16均完成 list_accessible_items；工具结果只有名称/state/demo，不含 attributes、availability、型号、限制。最终建议杯子喝温水，未考虑登记限制                                                                                                                       | [`graph.ts:1243`](../../src/lib/agent/graph.ts#L1243)、[`builder.ts`](../../src/lib/context/builder.ts)。提供稳定物品ID、获准能力/限制/未知字段及来源；按建议类型再查选中物品详情；不要把全部私人故事混进工具                             |
| F04 / P1 通用回答校验漏掉自相矛盾的安全保证 | 修正夹具字段后的真实请求12：先承认“食品接触/耐热未确认”，后说“日常饮水…可安心使用”，`validated=answered`。没有断言实际杯子有害，而是证明输出与已知未知条件矛盾                                                                                                                   | [`graph.ts:400`](../../src/lib/agent/graph.ts#L400) 附近的正则检查；[`prompts.ts`](../../src/lib/agent/prompts.ts)。把任务适用前提变成结构化检查项，并对“放心/安心”等保证做范围核对。仅改语气或追加 caveat 无法解决                       |
| F05 / P1 创意不具备通用物理/依赖校验        | 请求8初版发布“杯底曲面反射”方案，额外假定杯底弧面和抛光；该夹具含非正式 notes 字段，仅作初版证据。care字段复验请求18草稿包含杯沿/鼠标机械机制、计秒、用量不一致；进入修复请求19超时，最终 unavailable，没有发布此次草稿。直接Qwen也出现鼠标留印、共振反馈、未登记计时/电脑等错误 | [`ideas.ts:741`](../../src/lib/life/ideas.ts#L741)、[`idea-audit.ts`](../../src/lib/life/idea-audit.ts)、[`planning.ts`](../../src/lib/life/planning.ts)。把机制依赖、可观测成果与现实确认分开；用反例/独立评价验证，不以同模型自检作证明 |
| F06 / P2 两组浏览器测试默认路径不可跨平台   | `test:task-planning` / `test:care` 在 Windows 寻找 `/Applications/Google Chrome.app/...`，浏览器未启动；继发 Node libuv assertion。指定 EDGE_PATH 后均通过                                                                                                                       | [`task-planning-integration.mjs:38`](../../tests/task-planning-integration.mjs#L38)、[`care-integration.mjs:49`](../../tests/care-integration.mjs#L49)。统一浏览器选择或依赖 Playwright channel；本轮仅用环境变量复验，没有修改原测试     |
| F07 / P2 公开验收脚本落后于界面             | 原 `test:cloud` 等旧标题“生活里，值得留住的小片段”，实际页面标题“生活故事书”，正文也已不是 heading。原测试失败；审计副本仅调整定位器后整组通过                                                                                                                                   | [`test-cloud.mjs:338`](../../scripts/test-cloud.mjs#L338)、[`finals-cloud-recheck.mjs`](../../scripts/finals-cloud-recheck.mjs)。使用稳定的可访问区域/测试标识，分开业务断言与易变文案；不能把修改副本后的通过写成原命令通过              |
| F08 / P2 绿色基准仍有误拒                   | 旧7条基准拒绝5条无据说法，但把正确“这款鼠标需要一节 AA 电池”也拒绝。命令exit0；新 foundation基准0 regression                                                                                                                                                                     | [`harness.ts:18`](../../src/lib/ai/harness.ts#L18)、[`benchmark.ts`](../../scripts/benchmark.ts)。旧层采用严格摘录策略，并非整个新版都拒绝改写。分开记录安全漏检、正确拒答和正确改写被拒                                                  |

离线复现见 [offline-diagnostics.json](evidence/offline-diagnostics.json)；模型原文与最终回答见 [台账](evidence/paid-ledger.json)、[care-v2主场景](evidence/live-results.json)、[care-v2补充场景](evidence/live-followup.json)。上述页码/行号指基准源码；表述中“真实模型”均为真实 API + 合成测试物品，非真实设备。

## 模型链路与降级

本轮配置实际为 `qwen-plus`、北京 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`、`enable_thinking=false`、配置 JSON 模式开启。普通 generate、无工具 complete 使用 JSON response_format；有工具 complete 使用原生 function calling，不强加 response_format。本轮真实清单与资料工具往返均成功，**没有证据表明 API 根本没接通或工具协议整体坏了**。模型是滚动别名，本轮未记录上游解析到的具体快照，不能声称锁定了某个快照版本。

[`life-local.mjs`](../../scripts/life-local.mjs) 默认强制两个付费开关 false；`--cloud` 仅启用该进程。`cloudStatus` 检查 key/base/model、HTTPS、两个开关；ready只是配置齐备。`lifeProvider` 再以 WUJIAN_ALLOW_PAID_CALLS 约束 AI_ALLOW_PAID_CALLS；裸 createProvider 本机只检查 AI_ALLOW_PAID_CALLS，不能据此认为所有调用入口都有两个开关。公开 governedModelFetch 另检查域名、路径、预算、并发、输入/输出上限与急停。

Provider 区分400/401/403/429、超时、网络、无效/截断输出；generate默认输出1500、上限4000，Graph普通1500、资料2600，本轮创意3候选2800。配置超时60秒，调用者可更短，最高90秒。没设置temperature/seed；两条路径提示词、上下文、输出格式和预算不同，所以这里只做链路诊断，不是等条件模型排名。

关闭/不可用时，故事可本地组织、普通聊天有简短本地回应、资料有有限离线指导、创意可能本地兜底或缺口/错误。精选指导也可能优先于已就绪模型。`outcome=answered`、`HTTP200`、`source=curated-guidance`各有含义，不能互相替代。Provider/transport 台账才是付费请求事实来源，Graph `modelCalls`有时统计调用尝试（包括出站前失败），创意分支也未把其Token完整汇入Graph返回值。

## 权限、持久化与恢复

可保留的基础：领域事务、动作预览确认、owner/scope、epoch失效、照片归属、幂等requestId、会话revision/lease、SQLite同步检查点、临时会话用MemorySaver。已有测试覆盖等待澄清后重开DB、遗忘后清除旧会话/检查点、共享与访客隔离。公开生产模拟通过备份/空卷恢复及预算跨重启。

限制：本机 x-demo-actor 是演示身份；wait/interrupt主要等下一句，业务动作另由动作卡确认。没有后台自动唤醒调度的成熟证据；Graph异常会删除该线程检查点，releaseTurn清未完成请求。突然杀进程、模型已计费但尚未提交、外部写工具执行一半等恢复语义本轮未做故障注入，不能把“有checkpoint”写成“任意长任务无损恢复”。90秒lease与可达120秒Agent预算也应在故障/并发实验中验证。

## 尚未证实与暂不能验证

**合理怀疑**：约两千多输入Token的通用指令、跨场景规则叠加与正则路由影响自然性；没有短提示对照盲测，不能宣称是主因。Graph约1500行、准备/生成/校验/修复多分支耦合增加维护成本，但还没有与Pi的同条件工程量/故障率比较。

**暂不能验证**：真实库存理解准确率、真人创意偏好与实物成功率、协议探索/设备控制、个性化长期收益、Linux/Docker/公网HTTPS/目标Volume、真实家庭账号及通知。未安装或运行Pi，因此框架收益仍是官方能力分析和待验证假设。没有读取账单账户，超时是否计费及实际扣款未知。

视觉浏览：桌面与390px主要路径无本轮捕获的pageerror，准备/关怀/故事已有交互；截图显示普通手机版内容较长、表单和确认步骤密度高，是后续体验观察点，不是已做用户研究的结论。首页绿色占位来自测试上传的合成色块，不能据截图断言真实商品图片加载失败。

## 本轮逐文件改动清单

2026-10-29按审计克隆实际Git状态核验：**61个文件 = 11份文档 + 4个审计脚本 + 46个测试证据**；3个修改、58个新增。无法仅凭Git状态确认用户界面中“17个文件”的统计口径。以下全部属于本轮审计、测试或交接记录范围。

用户最新要求：暂停Git提交；未配置作者身份，未推送或合并main。后续优先使用用户本人确认的GitHub用户名及GitHub noreply隐私邮箱，仅用当前审计克隆的仓库级配置，不改全局设置；收到身份不自动视为恢复提交授权。

`src/`、`tests/`、原有运行/验收脚本、`package.json`、`package-lock.json`、部署配置均没有变更。这里的4个脚本是新增审计工具，虽然调用现有业务函数和测试，但只写独立合成环境。21个发布日志是本轮脱敏合成验收副本，原始运行文件在被忽略的.runtime中。初版模型输出有夹具问题，明确保留标记，不能当正式产品能力证明。

| #   | 状态 | 文件（点击查看）                                                                                       | 为什么改/新增                                                                            |
| --- | ---- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | 修改 | [CHANGELOG.md](../../CHANGELOG.md)                                                                     | 追加本轮审计范围、验证结果和限制，保留历史记录。                                         |
| 2   | 新增 | [DEVELOPMENT_REPORT.md](../../DEVELOPMENT_REPORT.md)                                                   | 基准中原文件缺失；新建本轮完成事项、真实证据与未完成工作记录，遵循项目交接要求。         |
| 3   | 新增 | [IMPLEMENTATION_STATUS.md](../../IMPLEMENTATION_STATUS.md)                                             | 基准中原文件缺失；新建实际能力、规则/演示边界和未验证范围说明。                          |
| 4   | 修改 | [README.md](../../README.md)                                                                           | 只在开头追加审计入口链接；不替换原产品说明。                                             |
| 5   | 新增 | [REVIEW_HANDOFF.md](../../REVIEW_HANDOFF.md)                                                           | 基准中原文件缺失；新建接手入口、独立分支与后续提交规则。                                 |
| 6   | 修改 | [docs/README.md](../../docs/README.md)                                                                 | 给现有文档索引增加本轮决赛审计入口。                                                     |
| 7   | 新增 | [docs/finals/ARCHITECTURE.md](ARCHITECTURE.md)                                                         | 提供整体模块/数据关系及真实调用过程两张Mermaid图。                                       |
| 8   | 新增 | [docs/finals/AUDIT.md](AUDIT.md)                                                                       | 记录源码基准、证据分级、具体代码问题；本次追加逐文件范围清单。                           |
| 9   | 新增 | [docs/finals/DECISIONS.md](DECISIONS.md)                                                               | 比较四种Agent架构、辅助工具及三项未实施实验，记录不预设重构的理由。                      |
| 10  | 新增 | [docs/finals/README.md](README.md)                                                                     | 提供一页中文概要、交付导航和长期状态维护约定。                                           |
| 11  | 新增 | [docs/finals/TEST_REPORT.md](TEST_REPORT.md)                                                           | 列出实际命令、失败定位、复验、模型对照、用量和截图入口。                                 |
| 12  | 新增 | [docs/finals/evidence/browser-care.json](evidence/browser-care.json)                                   | 关怀版浏览器验收结果。                                                                   |
| 13  | 新增 | [docs/finals/evidence/browser-formats.json](evidence/browser-formats.json)                             | 合成PDF/OCR/条码/照片录入验收结果。                                                      |
| 14  | 新增 | [docs/finals/evidence/browser-life.json](evidence/browser-life.json)                                   | 新版生活主流程验收结果。                                                                 |
| 15  | 新增 | [docs/finals/evidence/browser-stories.json](evidence/browser-stories.json)                             | 故事书阅读、交互与布局断言结果。                                                         |
| 16  | 新增 | [docs/finals/evidence/browser-task.json](evidence/browser-task.json)                                   | 准备计划、进度、条件变化及权限验收结果。                                                 |
| 17  | 新增 | [docs/finals/evidence/cloud-adapted.json](evidence/cloud-adapted.json)                                 | 更新定位器后的公开模式审计副本结果；不冒充原命令通过。                                   |
| 18  | 新增 | [docs/finals/evidence/cloud-test-adaptation.json](evidence/cloud-test-adaptation.json)                 | 原公开测试源码哈希与定位器替换清单。                                                     |
| 19  | 新增 | [docs/finals/evidence/foundation-benchmark.json](evidence/foundation-benchmark.json)                   | 新版离线基准输出。                                                                       |
| 20  | 新增 | [docs/finals/evidence/legacy-benchmark.json](evidence/legacy-benchmark.json)                           | 旧基准输出，保留正确改写误拒。                                                           |
| 21  | 新增 | [docs/finals/evidence/live-followup.json](evidence/live-followup.json)                                 | care-v2修正夹具后的创意/资料任务真实API结果，含超时。                                    |
| 22  | 新增 | [docs/finals/evidence/live-initial-fixture.json](evidence/live-initial-fixture.json)                   | 初始夹具真实API结果；标明非正式notes字段，不隐去审计自身错误。                           |
| 23  | 新增 | [docs/finals/evidence/live-initial-followup-fixture.json](evidence/live-initial-followup-fixture.json) | 初始补充场景结果，保留失败和质量限制。                                                   |
| 24  | 新增 | [docs/finals/evidence/live-results.json](evidence/live-results.json)                                   | care-v2主场景真实API结果，区别于初版。                                                   |
| 25  | 新增 | [docs/finals/evidence/logs/benchmark.log](evidence/logs/benchmark.log)                                 | 离线基准命令日志。                                                                       |
| 26  | 新增 | [docs/finals/evidence/logs/browser-care-edge.log](evidence/logs/browser-care-edge.log)                 | 指定Edge后关怀版复验通过日志。                                                           |
| 27  | 新增 | [docs/finals/evidence/logs/browser-care.log](evidence/logs/browser-care.log)                           | 关怀版默认macOS浏览器路径失败日志。                                                      |
| 28  | 新增 | [docs/finals/evidence/logs/browser-legacy.log](evidence/logs/browser-legacy.log)                       | 旧版/基础/家庭/空间四组旅程日志。                                                        |
| 29  | 新增 | [docs/finals/evidence/logs/browser-life.log](evidence/logs/browser-life.log)                           | 新版生活与格式旅程日志。                                                                 |
| 30  | 新增 | [docs/finals/evidence/logs/browser-storybook.log](evidence/logs/browser-storybook.log)                 | 故事书旅程日志。                                                                         |
| 31  | 新增 | [docs/finals/evidence/logs/browser-task-edge.log](evidence/logs/browser-task-edge.log)                 | 指定Edge后任务准备复验通过日志。                                                         |
| 32  | 新增 | [docs/finals/evidence/logs/browser-task.log](evidence/logs/browser-task.log)                           | 任务准备默认浏览器路径失败日志。                                                         |
| 33  | 新增 | [docs/finals/evidence/logs/build.log](evidence/logs/build.log)                                         | 生产构建日志。                                                                           |
| 34  | 新增 | [docs/finals/evidence/logs/cloud-recheck.log](evidence/logs/cloud-recheck.log)                         | 审计副本公开模式最终复验日志。                                                           |
| 35  | 新增 | [docs/finals/evidence/logs/cloud-wrapper-initial.log](evidence/logs/cloud-wrapper-initial.log)         | 审计包装器最初URL参数错误日志，修复后仍保留。                                            |
| 36  | 新增 | [docs/finals/evidence/logs/cloud.log](evidence/logs/cloud.log)                                         | 原公开测试过期定位器失败日志。                                                           |
| 37  | 新增 | [docs/finals/evidence/logs/install.log](evidence/logs/install.log)                                     | 按锁文件安装项目依赖的日志。                                                             |
| 38  | 新增 | [docs/finals/evidence/logs/live-followup-recheck.log](evidence/logs/live-followup-recheck.log)         | 修正夹具后的补充真实API运行日志。                                                        |
| 39  | 新增 | [docs/finals/evidence/logs/live-followup.log](evidence/logs/live-followup.log)                         | 初始补充真实API运行日志。                                                                |
| 40  | 新增 | [docs/finals/evidence/logs/live-recheck.log](evidence/logs/live-recheck.log)                           | 修正夹具后的主场景真实API运行日志。                                                      |
| 41  | 新增 | [docs/finals/evidence/logs/live.log](evidence/logs/live.log)                                           | 初始主场景真实API运行日志。                                                              |
| 42  | 新增 | [docs/finals/evidence/logs/offline-diagnostics.log](evidence/logs/offline-diagnostics.log)             | 离线缺陷复现日志。                                                                       |
| 43  | 新增 | [docs/finals/evidence/logs/offline-probes.log](evidence/logs/offline-probes.log)                       | 离线降级探针日志。                                                                       |
| 44  | 新增 | [docs/finals/evidence/logs/typecheck.log](evidence/logs/typecheck.log)                                 | 类型检查日志。                                                                           |
| 45  | 新增 | [docs/finals/evidence/logs/unit.log](evidence/logs/unit.log)                                           | 191项离线测试日志。                                                                      |
| 46  | 新增 | [docs/finals/evidence/manifest.json](evidence/manifest.json)                                           | 发布证据的文件大小与SHA256清单，不证明业务语义正确。                                     |
| 47  | 新增 | [docs/finals/evidence/offline-diagnostics.json](evidence/offline-diagnostics.json)                     | 离线问题复现的结构化结果。                                                               |
| 48  | 新增 | [docs/finals/evidence/offline-probes.json](evidence/offline-probes.json)                               | 默认关闭模型时的路由与降级结果。                                                         |
| 49  | 新增 | [docs/finals/evidence/paid-ledger.json](evidence/paid-ledger.json)                                     | 全部22次出站尝试、耗时、usage、响应和错误的脱敏台账。                                    |
| 50  | 新增 | [docs/finals/evidence/screenshots/care-desktop.png](evidence/screenshots/care-desktop.png)             | 合成数据关怀版桌面截图。                                                                 |
| 51  | 新增 | [docs/finals/evidence/screenshots/cloud-story.png](evidence/screenshots/cloud-story.png)               | 隔离合成访客恢复后的公开故事页面截图。                                                   |
| 52  | 新增 | [docs/finals/evidence/screenshots/home-desktop.png](evidence/screenshots/home-desktop.png)             | 合成物品首页桌面截图。                                                                   |
| 53  | 新增 | [docs/finals/evidence/screenshots/home-mobile.png](evidence/screenshots/home-mobile.png)               | 390px首页截图。                                                                          |
| 54  | 新增 | [docs/finals/evidence/screenshots/preparation-mobile.png](evidence/screenshots/preparation-mobile.png) | 390px准备清单与进度截图。                                                                |
| 55  | 新增 | [docs/finals/evidence/screenshots/stories-desktop.png](evidence/screenshots/stories-desktop.png)       | 合成故事阅读桌面截图。                                                                   |
| 56  | 新增 | [docs/finals/evidence/screenshots/stories-mobile.png](evidence/screenshots/stories-mobile.png)         | 合成故事390px截图。                                                                      |
| 57  | 新增 | [docs/finals/evidence/summary.json](evidence/summary.json)                                             | 环境、基准、命令、返回码、请求数、用量和费用估算汇总。                                   |
| 58  | 新增 | [scripts/finals-audit.mjs](../../scripts/finals-audit.mjs)                                             | 新增隔离合成库与直调/Agent对照探针；默认离线，显式授权参数才可调用百炼，持久台账上限40。 |
| 59  | 新增 | [scripts/finals-cloud-recheck.mjs](../../scripts/finals-cloud-recheck.mjs)                             | 生成原公开测试的独立审计副本，仅更新过期定位器并采集截图/pageerror，不改原测试。         |
| 60  | 新增 | [scripts/finals-evidence.mjs](../../scripts/finals-evidence.mjs)                                       | 汇总本轮合成结果、日志、截图、费用摘要和哈希；不产生模型请求。                           |
| 61  | 新增 | [scripts/finals-offline-diagnostics.mjs](../../scripts/finals-offline-diagnostics.mjs)                 | 用替身离线复现公开轮次预算和库存指代问题；不修改业务逻辑，不联网。                       |

## 发布状态更新（2026-10-29）

用户已授权发布；此前61文件及暂停提交记录保留为历史。已认证GitHub身份与系统Git认证一致，仅设置仓库级noreply作者。新增AGENTS.md固化自动检查、独立分支提交推送、中文证据维护和重大决策边界；发布合计62个文件。原46个合成证据未删除。审计源码仍以ea32c3f为准，后续修复单独分支。
