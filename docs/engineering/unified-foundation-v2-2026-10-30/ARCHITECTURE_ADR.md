# G0 架构冻结 / 2026-10-30

基线：远端 `codex/wujian-product-foundation-v1@d8eee9306e8eb53975e80eb98d3b1ace812777b7`；main 为 ea32c3f。交接 ZIP SHA256：32940b985a743ea6e01433b480eedfeb0d179e761ced655eabb598a920f7be97；14 个清单文件长度、SHA256 全部一致。预检 85 案结构通过，不是产品通过。

## 固定依据与取舍

采用产品定稿 V1.0 的释放人与物的价值、认知四层、兑现/创造/延续/传递四机制。V1.2 优先于 V1.1 的 Gate 次序，以任务书 G0—G5 为交付编号。保留 Next.js、SQLite、LangGraph、现有专业执行器；不修改 AGENTS、不默认切换导航数量。没有真人导航研究，不宣布四入口定案。

| 原数据 | 新逻辑身份 | 兼容办法 |
|---|---|---|
| Item.id / brand / model / region | ItemInstance / ProductModel | 保持实例 ID，规范完整型号建立稳定 modelKey；不自动合并近似型号或地区后缀 |
| owner / sharedWith / household_members | Relation 与 Grant | 归属、家庭为关系；旧逐件授权投影为 Grant，新授权与撤销独立版本记录，读时重新判定 |
| 会话、计划、家庭事项 | TaskSpec / TaskRun | 新表只保存引用；原会话与事务继续工作，统一任务桥接已有对象，不复制私密聊天到家庭摘要 |
| life sources / knowledge chunks | SourceDocument / EvidenceClaim | 适用型号、原文 hash、四态与推导依据分开；原文存在不证明任意改写正确 |
| REA 软件记录与调用回执 | Capability / ToolReceipt / Outcome | 固定软件目标沿用授权、意图先写及回读；只标软件验证，不扩展硬件 |
| story / memory / gift snapshots | Experience refs | 复用来源、纠正、遗忘及赠礼独立实例，任务读取时重新鉴权 |

首先改变：`foundation/legacy.ts`、`foundation/policy.ts`、`foundation/evidence.ts`、`foundation/tasks.ts`、统一 API 与任务续接组件。专业执行器通过桥接接入，不重写全部业务。

## 数据保护与回退

原工作区、旧预览服务、账户和数据库均不修改、不复制。本分支仅使用独立 PRODUCT_AGENT_DATA_DIR。保留 workspace.body 的存储与原事务；新表使用 foundation_ 前缀、schemaVersion、revision 与幂等请求键。首次添加版本表前为隔离库创建 SQLite backup，保留文件 hash 与迁移记录；测试验证迁移后旧 body 原字节一致。回退切换旧提交及原有数据目录；新增表可以留存，禁止自动删除真实数据。单事务兼容桥接，避免无协调双写；异步执行前后重新鉴权。

## 发布门禁

`WUJIAN_EXPERIMENTAL_FACT_QA` 继续默认关闭：已有真实输出曾把 ANC 缺证当否定，编造售后。证据服务先提供可追溯原文与四态，不以原文子串验证冒充语义证明；未获真实质量验证的自然综合不默认发布。34 个 live_model 案本轮未授权，标 blocked_model_budget，新增费用为零。

先复跑旧 371 项，新增兼容/并发/撤权/证据/任务恢复测试；最终类型、构建、旧集成及独立账号桌面/390px浏览器。85 案逐项保留真实方式与结果，不用结构预检替代验收。G5 若有预算或质量阻断，只交付实验分支及缺口，不宣称整体通过。
