# Core Foundation V1 收口（2026-11-03）

**结论：NOT_ACCEPTED；交付可运行恢复点，不宣称 Core 或 Full Foundation Accepted。** 工程/公共接入条件已通过，陌生资料自主取得已有真实成功，但自主指导质量仍有阻断项。本次用户明确停止新费用；没有为凑通过再请求模型、替换首答或降低标准。

## 用户实际获得什么

- 未预置品牌可以进入真实原生搜索，不再被有限品牌表挡在搜索之前。ZOOM H1essential 无官方URL输入时取得真实厂家手册，使用外部公司目录与实际HTTPS迁移链核对发布者，再核对完整型号和地区。HTML原文、PDF页码/字节哈希、来源范围进入已有资料记录。
- 对话、详情、能力发现及任务可读同一 Reality。公开资料与本人状态分开；官方原文定位、用户报告、模型读图观测分别标记。没有为每个功能建立新事实库。
- 开放目标能发现未点名的已有资源。水彩任务曾错误声称没有托盘，修复目录截断后找到已登记托盘，结合获准“软冰格单独端走失败”的合成经历改走托盘承托路线。水源/容器、净尺寸、摩擦和承重仍待核；没有实物试验。
- 组员能通过稳定 TypeScript 服务、Provider 注入及 Mock 开发，不依赖商品问答页面；同一 Task/Outcome 保存反馈，重试复用原请求，撤权和变更使旧上下文失效。

## 核心门槛与证据

| 条件 | 结论 | 实际证据与边界 |
| --- | --- | --- |
| 未预置品牌可启动原生搜索 | 通过有限样本 | [J01发现r5](evidence/core-j01-discovery-r5.json)，6次/74.319秒；搜索22条候选、实际厂家HTML/PDF。不是品牌白名单新增ZOOM；目录不可验证时仍拒绝认证 |
| 两种来源形态、型号/来源及共享积累 | 通过有限样本 | ZOOM单页HTML章节及官方PDF；历史Sony SRS-XB100 PDF路径另保留但未当作本次新品牌通过。原文定位/条件化能力与未验证读图观测持久化后新会话复用；[来源原文/原图复核](evidence/core-manual-original-review.json)、[共享原图复测](evidence/core-cached-visual-r2.json) |
| J01完整正确指导 | **未通过首次质量验收** | [Task连续旅程](evidence/core-j01-continuity-r1.json)真实Qwen执行了保存、复用、纠正、遗忘，但出现“右侧”、不受支持的屏幕/档位描述；发现r5把关机概括为可能中断录音，却遗漏“录音中不能关机”。[新会话复测](evidence/core-cached-original-r1.json)答对关键3项，仍扩写“保存录音文件/屏幕可能变暗”等，不是完整独立复验 |
| 开放目标、资源、经历实际作用 | 修复后有限通过，探索级 | [失败r1](evidence/core-cached-goal-r1.json)明明有托盘却称没有；[修复后r2](evidence/core-cached-goal-r2.json)3次/41.872秒，实际读4件资源并改变行动。仍有可读性、可选未登记防滑材料、未验证措辞问题，未声称创新质量或物理可行已证明 |
| 状态、纠正、撤权、跨物品隔离 | 通过本次检查 | [真实账号HTTP/浏览器](evidence/core-state-permissions-r1.json)：授权前403、显式共享后可读公开知识但不可读私人Task/故事、撤权后403且目录移除；型号纠正使知识失效，恢复型号不覆盖lost状态；模型台账字节不变。离线含错误来源/跨物品引用、在途撤权、共享Task不扩大等回归 |
| 团队独立接入、类型、Mock | 通过 | [可运行示例](../../../examples/foundation/README.md)、[CLI结果](evidence/core-team-example-cli.txt)，独立测试包括19个干扰项、晚出现的目标、重试不调模型、用户确认/云端许可分离；不是千问质量测试 |
| 构建及必要安全回归 | 通过 | [594项离线](evidence/core-closeout-tests.txt)、[类型](evidence/core-closeout-typecheck.txt)、[生产构建](evidence/core-closeout-build.txt)、[离线benchmark](evidence/core-closeout-benchmark.txt)、[定向9项](evidence/core-closeout-targeted.txt)。这些不替代真实智能质量 |

原冻结18首答 **0/18**，原文/判准哈希未变；四旅程完整标准留作 Full Foundation Quality Accepted。初始失败、重测、零模型UI和真实Qwen明确分列。未做外部真人盲测；本次逐句判断为工程负责人对原始手册的人工核对，不冒充独立机构验收。

## 修改为什么必要

1. 搜索以前依赖已有品牌目录条目，未知品牌在模型之前被挡住。现在搜索与发布者认证分开；没有把搜索命中或品牌域名字符串当官方认证。公共目录可能缺失/过时，也不是权威商品认证，仍是长期风险。
2. 手册正文截断丢失后续章节，图示缺文本时模型猜左右。保留实际章节锚点、按需读章节与选页PDF；复用成熟 pdf-parse/sharp，读图结果始终标为推断。未新增第二模型审稿。
3. 只有词法匹配目录导致把“没检索到”说成“不拥有”。现在精简库存目录与当前详细资料分开，超过30条继续分页；服务端用途范围只能收窄，不扩大授权。
4. 开放Task起初没有物品，后来实际读到的资源没跟随Outcome。补齐私有Task的实际读取引用，不扩大共享Task。修复新增引用导致创建重试冲突，冻结初始请求指纹；Outcomes使用稳定ID和预期revision，不能静默重放新状态。

公共契约集中在 `src/lib/foundation/services.ts`，上层接 `readReality / discoverCapabilities / compileTaskContext / respond / createTask / recordOutcome`，模型由现有 Provider 注入。将来升级检索或模型不必重建上层；但返回结构改变仍需版本兼容测试，不承诺“任意框架无成本替换”。既有SQLite、身份、事务、记忆、领域模块保留；退役旧通用循环清单见[决策](CONVERGENCE_DECISION.md)。

## 实测与费用

本次继续收尾新增真实请求 **0**。实际使用的模型版本为 `qwen3.8-max-0902`，实际模型ID/Token/工具事件逐请求保留。完整回答耗时示例：首次陌生发现74.319秒/6请求；缓存原问题复测13.545秒/1请求；开放目标修复复测41.872秒/3请求。样本太少且条件不同，不据此宣布P95或因果性能提升；流式状态事件不等于完整有效首字。

| 原授权轮次 | 请求 | 已知估算 | 未知用量保守预留 | 合计估算与预留 |
| --- | --- | --- | --- | --- |
| qwen-foundation-20261102-r1 | 142/150（封存） | ¥19.633624 | 0 | ¥19.633624 |
| qwen-foundation-20261103-r2 | 40/40 | ¥4.575668 | ¥13.131072（#24抽取超时） | ¥17.706740 |
| qwen-foundation-20261103-r3 | 12/12 | ¥2.608660 | 0 | ¥2.608660 |

每轮分别守原上限；不是账单实扣。合计已知估算¥26.817952，含未知预留¥39.949024。R2曾在27次保存快照后，于原授权范围继续13次有限文本/选页图复测，原请求、超时预留、R3授权历史锚不变；[追加说明](evidence/rounds/qwen-foundation-20261103-r2/append-only-resumption.json)。Token汇总见[修正后的派生汇总](evidence/core-closeout-summary-r2.json)；初版派生汇总误读Token字段为0，保留错误记录但不采用，原始台账未改。没有新建百炼托管知识库、没有上传私密经历，没有Embedding/Rerank付费试验。

## 运行、恢复与剩余问题

分支 `codex/wujian-qwen-foundation-v1`；前一恢复点 `b64280d`，基础集成检查点 `f449067`。最终提交见Git历史，不把当前改动合并main或自动推进develop。原项目、其他工作区和私人数据库未触碰。

```powershell
npm ci # Node.js 24
$env:WUJIAN_MODEL_ROUND='qwen-foundation-20261103-r3'
node scripts/foundation/preview.mjs --offline --dev --port=3241
# 浏览器 http://127.0.0.1:3241；仅本机合成数据，当前无模型费用权限
node --experimental-strip-types examples/foundation/run-mock.ts
```

本地现有合成账号状态/资料只保存在忽略目录 `.runtime`，不提交账号口令、Cookie或SQLite。新克隆需新建合成账号，查看真实Qwen历史表现直接读证据与截图；离线预览不能生成新的千问指导。开发构建 `.next-foundation`，生产验证 `.next-foundation-release`，不覆盖其他服务。

真实浏览器截图：[商品任务桌面](evidence/core-cached-original-r1-desktop.png)、[移动](evidence/core-cached-original-r1-mobile.png)、[开放目标桌面](evidence/core-cached-goal-r2-desktop.png)、[移动](evidence/core-cached-goal-r2-mobile.png)、[状态/权限](evidence/core-state-permissions-r1.json)。截图与账户/经历均为隔离合成环境，无实物控制。

下一步只需围绕已暴露的根因：减少图示缺失时的自行补全、将已取得的关键操作限制可靠用于自然回答，并用新未见问题确认，而不是再加品牌专用答案或复审循环。当前无付费权限，不擅自继续验证。本次交付的重点是团队可接入且能恢复的底座；**可靠陌生商品服务尚未达标**。
