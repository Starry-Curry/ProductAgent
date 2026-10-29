# 实测报告：框架能力与产品质量分别记账

日期：2026-10-29；Windows、Node 24.16.0、Next.js 15.5.28、现有 Edge/Playwright。固定三提交和包版本见 [SUMMARY](evidence/SUMMARY.json)。所有数据为合成物品与关系；数据库只在隔离工作区 `.runtime`，没有打开私人数据库。没有硬件操作。

## 1. 真正运行的检查

以下日志均保存在 [evidence/logs](evidence/logs/)，没有把 RFC 的 71 项文档检查算进产品测试。

公开 `.txt` 统一 UTF-8/LF、去行尾横向空白并保留一个结尾换行，避免 Git 行尾转换破坏校验；没有删失败内容。原日志保留本机 `.runtime`，原始/发布哈希与规范化方式在 SUMMARY.manifest 中。模型原始 JSON 和截图不作上述文本处理。

| 实际命令（工作目录为本轮工作区）                                                                                | 结果和证据                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm ci --cache D:/ProductAgent-LifeContext/.runtime/finals-audit/.npm --no-audit --no-fund`                    | 应用依赖安装成功，根 lockfile 未改；不是依赖漏洞审计                                                              |
| `npm install --cache D:/ProductAgent-LifeContext/.runtime/finals-audit/.npm --no-audit --no-fund`（实验子目录） | 锁定 Mastra/Pi 版本，独立 lockfile；未加入应用依赖                                                                |
| `node --experimental-strip-types experiments/framework-evidence/offline.mjs`                                    | 最终完整矩阵 38 项；以 [offline.json](evidence/offline.json) 为最终结果。模型替身验证管线，不是模型智能评分       |
| `node --experimental-strip-types experiments/framework-evidence/offline.mjs --arm=pi-durable`                   | 定向 11/11；含跨进程暂停、写入后退出、恢复/重复、撤权                                                             |
| `npm test`（移植 v1 后）                                                                                        | 256/256 实际重跑；未拿历史通过数代替本次                                                                          |
| `node --experimental-strip-types --test tests/shared-item-knowledge.test.ts`                                    | 初始 8 项新共享资料回归通过；后补正式入口一项，纳入最终全量                                                       |
| `npm run typecheck`、`npm test`                                                                                 | 最终 265/265，含移植的 65 项与本轮 9 项；类型通过                                                                 |
| `npm run test:benchmark`                                                                                        | 0 regressions；见 benchmark.txt，不是创意盲评                                                                     |
| `npm run build`                                                                                                 | 生产构建成功；未部署                                                                                              |
| `npm run test:cloud`                                                                                            | 8 组公开隔离/预算/重启/工具往返通过；全部模型替身，0 真实请求                                                     |
| `npm run test:acceptance -- life`                                                                               | 新版物品/故事/创意/家庭、格式与桌面/390px 旅程通过；0 真实请求                                                    |
| `node scripts/verify-local.mjs shared-knowledge`                                                                | 新增真实浏览器：显式记住赠画、全新会话召回、遗忘、另一演示主体拒绝、纸盒离线规划入口、390px 与 pageerror 检查通过 |

运行 `node scripts/verify-local.mjs` 时新增旅程也纳入默认列表；本轮没有额外重跑全部 legacy 旅程。新增测试首次错用下拉框的精确标签定位而超时，改为源码确认的 select 定位后通过；没有放松业务断言。[浏览器结果](evidence/browser/result.json)、[赠画截图](evidence/browser/painting-cross-session.png)、[纸盒离线移动截图](evidence/browser/box-offline-mobile.png)。

## 2. 框架失败怎样定位

- 实验脚本初始有括号语法错误；修正实验代码后运行，没有归因框架。
- 第一轮 29/34：Mastra 把中途崩溃当 suspended 来 `resume`，Pi 等待器又在读到旧 sleeping 状态时提前退出。分别使用正确 restart、等待终态复验。
- 第二轮 30/34：Mastra 仍受旧进程所有权租约保护；Core 冷启动遇到测试超时。改为只加载本组依赖、允许限定时间等待租约，保留实际等待成本。
- 中间全矩阵 36/38，Pi 定向共享库 9/11：旧未完成任务共用实验库时出现恢复等待超时，不能判为产品或框架通过。
- 最后按运行隔离 Pi 的存储，定向 11/11；同一业务断言再次完整复验。见 [最终日志](evidence/logs/offline-complete-final.txt)。共享库并发、多宿主竞争、断电与中途模型请求恢复未认证。

所有组的授权和幂等均由同一物间领域服务保证。测试刻意在 `saveMemory` 提交后、框架记录完成前 `process.exit(73)`，证明重复调用与重复效果可以区分；**不是实际设备恰好一次执行证明**。Pi Core 的持久状态由宿主补齐；Pi Durable 的审批使用宿主授权表 + 原生持久 sleep + 持续前进的测试时钟偏移，不宣称其具备物间原生审批产品。

## 3. 真实百炼：42 请求，全部保留

运行命令：

```powershell
node --experimental-strip-types experiments/framework-evidence/live.mjs --live-max=60-cny=20 --config=D:/ProductAgent-LifeContext/.env.local
node --experimental-strip-types experiments/framework-evidence/live.mjs --live-max=60-cny=20 --config=D:/ProductAgent-LifeContext/.env.local --stage=framework-recheck
node --experimental-strip-types experiments/framework-evidence/live.mjs --live-max=60-cny=20 --config=D:/ProductAgent-LifeContext/.env.local --stage=main-ui-baseline
node --experimental-strip-types experiments/framework-evidence/live.mjs --live-max=60-cny=20 --config=D:/ProductAgent-LifeContext/.env.local --stage=product-slice
```

配置由网关安全加载，未读 api.txt、未复制/输出 Key；应用与框架只知道本机网关和合成凭证。台账在发出前预留，失败/重试计数，不自动清零。所有真实阶段按序执行；最终脚本另加进程锁与 flush，避免未来并发启动和无记录重置。复现不要删除或重置本轮台账，也不要把复制到新目录当成新额度；新一轮须另约预算。

| 组                   | 请求数 | 输入 tokens | 输出 tokens |    估算人民币 |
| -------------------- | -----: | ----------: | ----------: | ------------: |
| LangGraph 小宿主     |      9 |        2782 |         239 |     0.0027036 |
| Mastra Agent         |      9 |        2944 |         325 |     0.0030052 |
| Pi Core              |      9 |        2727 |         220 |     0.0026216 |
| Pi Durable           |      9 |        2756 |         178 |     0.0025608 |
| main 旧调用入口      |      1 |         500 |          49 |     0.0004980 |
| main 正式助手入口    |      2 |        1654 |        1047 |     0.0034172 |
| 本轮产品切片正式入口 |      3 |        3645 |         981 |     0.0048780 |
| 总计                 | **42** |   **17008** |    **3039** | **0.0196844** |

42 HTTP 200，20 次 tool_calls、22 次 stop，传输失败/超时 0；工具临时失败另外注入，修复回合均计请求。没有为了用完额度继续采样。按北京 qwen-plus 非思考、<=128k 输入的 0.8/2 元每百万 tokens 估算，不计缓存优惠，**不是账单**。[官方价格](https://help.aliyun.com/zh/model-studio/qwen-plus)

每组初始三情境：未知物品性质、已报告赠送关系、工具失败后读取；加一例明确 ID 的共同复验。初始请求把 `box：旧纸盒` 当 ID，四组都拒绝；改为显式 `itemId="box"` 后四组都取得尺寸和未知。没有借此宣称某框架更聪明。SDK 提示结构、错误包装、返回长度不同，因此不是严格创造力盲评或性能排名。

初始实验包装器还把写入故障测试的偏好带入纸盒关系数组；最终代码按 kind 过滤并分离工作流数据。四组在每个阶段实际收到的成功工具数据均相同，见 [数据指纹核对](evidence/FAIRNESS.json)；赠画事实未受该分类问题影响。保留初始输出，但不能由这些实验包装字段评价关系理解质量。

## 4. 两个产品案例的实际结果

**赠画：** main 与本轮都能从已明确保存的记忆回答“小夏送给你的”，没有添加生日/旅行。说明记忆基础已存在，不是本轮从零发明。新增浏览器从用户输入“记住：……”开始，再开新问题召回，并测试遗忘与越权；私密事实默认本地，0 模型。真实 API 的关系例则使用合成且明确 allowCloud=true 的记录。当前仍是有源文本记忆，不是完整 V2 人物关系图。

**纸盒：** main 正式入口输出“折叠回声：盒盖翻页故事书”，步骤依赖未登记的笔和未确认盒盖结构，还声称开合能触发新读序；不能因 outcome=answered 认定可实施。本轮生成“静默故事盒”，引用了登记尺寸和获准偏好，但依赖画作摆放条件；动作检查还把“不粘贴、不固定”等否定表达视作材料依赖。一次修补后仍被拒，回退为本地观察卡，且需要另核对纸笔。**该例未达到具体、合格新用途的产品门槛。**

原始输出、工具结果和修补理由在 [台账](evidence/live-ledger.json) 第 39、41、42 请求；产品外层结果见 [main](evidence/live-main-ui-baseline.json) 与 [本轮](evidence/live-product-slice.json)。两个版本展示候选数量不同，不能作质量优胜率。没有人类盲评、真实纸盒实践或物理原理验证。

## 5. 本轮新增与剩余风险

移植：12 个 v1 源码文件、5 个配套测试文件与公开测试脚本，不带旧评测额度脚本或运行库。新增 `context/knowledge.ts`，在 builder、创意模型输入和故事计划复用；快照是获准投影 hash，不冒充旧 Item 持久 revision。故事上云最后收紧到身份，物理属性留本地；该输入最小化经过最终离线复验，未另外追加真实模型采样。

仍未证明：开放语言意图通用性、关系提取/纠正的统一模型、创意机理与资源检查的语义准确性、盲评增益、共享库多任务恢复、真实账号/家庭权限、原生上游流式协议和长期运行成本。没有用框架检查、模型自评或截图消除这些风险。
