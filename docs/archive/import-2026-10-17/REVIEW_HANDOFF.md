# 物间 2.0 完整工程审查交接

生成日期：2026-10-17。此包用于审查，没有为打包修改业务逻辑。请先读本文，再读 DEVELOPMENT_REPORT.md 与产品说明书。文中路径均相对 ZIP 根目录。

## 1. 版本与来源

- package.json 版本：0.1.0；产品名称：物间 2.0 第一批技术深化。
- 分支：codex/p0-reliability。
- 最新提交：f0584882769bd85a143b3756ff8e1db2845591c6，feat: harden v2 evidence, trace replay, privacy and migration boundaries。
- 对比基线：118e295d6f513fc439daaa67870c4f186ac1df69（保存同学 Windows Demo 2.0 分发源码）。这不是已确认的团队上游提交，上游仓库、分支和更早历史无法核实。
- 导出时 Git 工作区干净；导出使用文件遍历而非仅 git archive，因此安全的未跟踪源码也会包含。
- 新增的两份报告、review-evidence 和审查辅助脚本是本次交接材料，未声称属于上述开发提交。
- 完整 app 工程在 ZIP 根目录；未附带外层 Windows 启动器、嵌套 ZIP、Node 运行时和依赖缓存，它们不是重建此工程的必要源码。
- 技术栈：Next.js 15 / React 19 / TypeScript，Node.js 24 内置 SQLite，单体 App Router；具体锁定版本见 package-lock.json，无 FastAPI、LangGraph、Neo4j、多 Agent 或微服务。

## 2. 架构与功能边界

浏览器 page.tsx 管理页面状态、演示角色和物品档案；组件负责单物品服务、活动清单、家庭事项、组合和偏好。API 路由调用 domain、db、service-store；AI 路由调用 Harness → Provider；商品来源与能力为版本化 Product Pack。业务写入只能走受权限检查的领域操作，模型没有家庭/赠礼/支付写工具。

主导航是「使用帮助、活动准备、家庭事项、发现、礼物与记忆」。首页即使用帮助，并不是六个独立 URL；截图包含首页和五个导航状态（其中首页与使用帮助内容重复是正常的）。物品列表、录入、档案、赠礼编辑是页面内子视图，收礼页是 /gift/[token]。

真实本机能力：文字录入/图片档案展示、档案编辑与存储、共享和负责人规则、任务记录、维护日期计算、收藏/尝试、计划保存、赠礼预览/撤销/确认收物认领、记忆权限、资料绑定、失败 trace 和回放、私人偏好、基于资料的条件组合。

模拟/规则能力：三名固定演示角色与单一家庭；设备信号；精选妙用卡；野餐/出行清单按关键词匹配；组合按有限确定性规则生成。它们不是实际账户、设备接入或开放式模型创意。

未验证或未接入：实际千问成功调用、视觉/OCR/条码识别、真实跨设备账号与公开分享、影音记忆、设备控制、生态订单同步、任意目标规划、实物组合试验。代码存在不代表通过实物或在线验收。

## 3. 相比基线的具体变化

39 个文件变化（包含文档与恢复的测试），完整差异见 review-evidence/changes.patch 和 changes-stat.txt。主要是：

1. 引用 ID-only 校验改为严格的资料原文拼接，阻断引用合法但内容错误的回答；接受范围收窄。
2. Harness 增加阶段检查点、证据快照、哈希、错误、耗时和只读回放；过期运行标中断。
3. 显式本机模拟身份、Host/Origin/转发边界；付费调用开关默认关闭。
4. 迁移前 WAL 一致备份、迁移审计；礼物作者与持有人分离，历史不确定来源标未知。
5. 补充 JBL / IKEA 资料包和组合条件；新增可纠错、逐项允许云端使用的个人偏好。
6. 恢复/增加领域、可靠性、集成测试与离线基准；修正独立目录构建配置。

没有重做导航、CSS，没有完整实现所有 P0/P1/P2。

## 4. 各技术模块实现深度

| 模块 | 当前代码事实 | 验证/限制 |
|---|---|---|
| 千问 | 服务端兼容 HTTP 适配，超时、JSON、用量、429/截断处理，显式付费开关 | 网络测试替身通过；真实模型调用为 0，真实费用/延迟未知 |
| 商品识别 | 文本录入、资料搜索、型号人工确认；图片可作档案 | 没有视觉识别/OCR/扫码识别；不能把上传成功算识别成功 |
| Product Pack | M185 两硬件版、Go4、指定货号 RÅSKOG，共三类商品四包；来源/版本/事实/限制 | 上轮核对官方公开资料；本次未重新在线核验，没有三件实物实测 |
| 检索 | 按确认绑定与版本取本地 pack | 不是实时互联网检索、向量库或完整商品知识库 |
| Harness | 固定只读流程与事件；来源快照和错误回放；当前授权再次核对 | 工具名是受控步骤记录，不是模型自主 function calling；无通用回滚现实行为 |
| 输出校验 | answer 等于所引事实原文，uncertainties 必须空 | 不是语义蕴含验证；可拒绝正确改写；资料错误、问题不相关仍需审查 |
| 用户 Context | 本人设置说明详略/经验水平，明确/未知、来源时间、纠错、单项云端授权 | inferred 类型预留，无自动推断，无完整多用户画像 |
| 能力组合 | 已确认资料与可访问物品触发 Go4 双音箱或 Go4+推车候选，检查场景、数量、载荷等 | 规则有限；待确认不等于可行性验证；不是任意组合推理 |
| 家庭关怀 | 既有共享、任务、维护、本人授权、暂停/外出/离线优先规则保留 | 固定角色，B 类设备信号模拟；本轮没有接入设备或新增完整关怀引擎 |
| 礼物记忆 | 故事选择快照、原作者/原记录、收礼者持有权限、收物确认、私密记忆不回流 | 链接仅本机可用；不具备真实账号认领/影音分享/完整生产级状态机 |

## 5. 数据与迁移

默认 data/demo.sqlite，可用 PRODUCT_AGENT_DATA_DIR 指定独立目录。业务数据库未打包。首次启动自动使用 domain.ts 的 seed() 创建完全虚构的演示角色、物品、家庭和故事，不代表实际用户。

- workspace(id, body)：一条 JSON 工作区，包含 items、tasks、memories、gifts、plans、contexts、care、saved、attempts。
- service_runs(id, actor, item_id, body)：运行 JSON 与 actor/item 索引。
- service_feedback(run_id, outcome, at)：运行反馈、外键与 outcome 限制。
- schema_migrations(version, applied_at)、migration_audit(version, backup_path, notes)。当前 v2。
- 业务 mutate 用 BEGIN IMMEDIATE/COMMIT，SQLite WAL，busy_timeout=5000。
- 迁移先 VACUUM INTO 创建 before-v*-to-v2 备份，再事务更新；未知历史作者标 null/legacy-unknown。不得用本包覆盖现有业务库。

对象关系：固定 Person 拥有 Item，shared 只对固定家庭成员有效；Task 关联 Item 和 assignee；Memory 关联 Item，author 与 owner 分离；Gift 关联具体 Item 和选择后的 storySnapshots；ProductBinding 关联 pack/version；Run 关联 actor/item/identity/resources；ContextFact 属于本人。尚没有真实 User、Family、Membership、Grant 关系表。

## 6. API 与优先阅读路径

| 入口 | 职责与检查 |
|---|---|
| src/app/api/workspace/route.ts | GET 可见状态，POST action；domain.ts 校验对象/负责人/本人权限 |
| src/app/api/products/route.ts | 精选商品资料候选 |
| src/app/api/ai/route.ts | 单物品只读服务；无型号422、未配置503、失败502、期间范围变化409 |
| src/app/api/service-runs/route.ts | 授权记录/回放与执行反馈；撤权或型号改变不再放行 |
| src/app/api/discover/route.ts | 场景/载荷等输入和有权限组合候选 |
| src/app/api/gift/[token]/route.ts | 仅所选内容的收礼预览；认领写入经 workspace/domain |

建议顺序：docs/物品智能服务_完整产品说明书_V1.1_交付版.md → src/lib/domain.ts → db.ts/migrations.ts → auth.ts → ai/harness.ts/provider.ts/types.ts → service-store.ts → products.ts/discovery.ts/planning.ts → API routes → src/app/page.tsx 与 components → tests。

关注：本机角色头不是身份认证；确认型号仍依赖人；严格文字校验不验证事实本身；失败回放不含原始问题/失败输出，不能复现模型内部推理；tokens 是供应商报告，cost 始终未知 null。

## 7. 测试证据与执行示例

本次重新执行的准确结果见 review-evidence/VALIDATION.md 和对应原始日志；既往开发记录保留在 docs/engineering/验证记录.md，不能混为本次新测。

测试模型使用 offline-test-double，provider HTTP 使用 mock；未执行 test:live。review-evidence/agent-example.md 解释输入、资料、工具步骤、成功/失败和回放边界。artifacts 不整体打包，仅选择本次生成的已知合成 trace、基准、集成报告和截图。

离线七例基准：五条带合法引用的错误内容被拒；一个正确改写被误拒。样本小，不能推出整体事实准确率。测试夹具将 seed 的 lamp ID 绑定鼠标包仅为构造领域用例，不是实物型号确认的证据。

## 8. 在新环境启动

使用 Node.js 24（本次 v24.16.0）、npm。解压到新目录，不覆盖现有工程。先阅读本节，因为原 README 保留了开发机器的绝对路径；将其中 cd 替换为自己的解压目录。

```powershell
npm.cmd ci
$env:AI_ALLOW_PAID_CALLS='false'
$env:PRODUCT_AGENT_DATA_DIR=Join-Path $PWD 'review-local-data'
npm.cmd test
npm.cmd run test:benchmark
npm.cmd run build
npm.cmd run typecheck
npm.cmd run start:local
```

访问 http://127.0.0.1:3100 。无需凭证。启动自动生成虚构数据。Linux/macOS 使用 npm 与 export 对应变量；本包实测平台为 Windows，未声称跨平台集成测试通过。

另一独立测试服务：设置 PORT=3101、PRODUCT_AGENT_DATA_DIR 为新的目录，清空进程级 AI_API_KEY/AI_BASE_URL/AI_MODEL，AI_ALLOW_PAID_CALLS=false，再 start:local；另一个终端运行 npm.cmd run test:integration。它会写入测试档案，绝不能指向正在使用的业务库。现有测试硬编码 Windows Edge 路径 C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe；没有该浏览器时需要在审查副本调整路径或安装适配浏览器，不能视作业务失败。

截图重现脚本：review-tools/capture.mjs，TEST_BASE_URL 指向独立测试服务；也是 Windows Edge。不需要登录真实账号。截图只含生成的演示内容。

verify-baseline.mjs 依赖外层分发 ZIP 与 Git 历史，本审查包故意不包含它们，因此不能在独立包中直接复验；已有来源记录与 Git patch 已包含。不要把这个工具的环境依赖误认为缺少业务源码。

真实 API 要先获费用授权，再在本机配置 .env.local；不得把密钥写入报告。默认不调用。实际付费验证流程见原 README。

## 9. 已知风险与缺失

- 核心 AI 在线闭环尚未验证，不能宣传真实千问成功服务。
- 模拟角色只能本机运行；完整认证、家庭授权模型、公开链接安全/有效期/审计尚待实现，不应公开部署。
- JSON 工作区聚合写入，不适合直接扩大为多人高并发；无生产灾备或高负载基准。
- 提取式校验会误拒正确改写；没有完整原子事实与操作安全评价。
- 维护提醒是日期规则而非后台可靠通知；关怀来自示例信号，无健康推断证明。
- 原 README 的路径、集成测试 Edge 路径、来源校验脚本均有环境耦合。本次仅如实记录，未顺便重构。
- 用户指定的 docs/engineering/物间2.0_产品技术全维审查与Codex深化任务书_V1.0.md 未发现。现有交付说明仅摘述上一轮要求，不能代替缺失原文。
- 上游仓库及同伴后续未交付改动无法核实；本包版本以记录的源码目录/commit 为准。

回滚需在独立目录保留当前版本与相应数据库备份；本包不包含 .git，不能直接 checkout 基线。可结合外部原仓库提交与 changes.patch 审查差异，不要对运行库执行覆盖恢复。

## 10. 包内容与安全

完整源码、锁文件、模板、测试、必要文档均包含，文件清单及 SHA256 见 FILE_MANIFEST.json。未复制 .env.local、真实数据库、node_modules、.next、.git、缓存、嵌套 ZIP。源码中的 test-only、固定演示人名和合成 token 是测试数据，不是实际凭证。安全扫描是导出检查，不等于完整安全审计。安装/构建产生的依赖与缓存只存在验证副本，最终 ZIP 排除。
