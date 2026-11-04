# 团队接入：最小通路与扩展边界

本页供组员直接开始开发，不是新的架构方案。产品权威为 [PRODUCT_FINAL_V1](../product/PRODUCT_FINAL_V1.md)。**共享底座可集成，不代表 Core Foundation 智能质量通过；后者仍 NOT_ACCEPTED。**

2026-11-05 后续研发提示：决赛分支`codex/wujian-finals-product-v1`仍在独立研发，未合入本页团队候选。下面的零费用交付记录是历史轮次，不表示当前新轮次没有授权。最新实际状态见[CURRENT](CURRENT.md)。公共`foundation-services/1`入口不变；Provider增加可选`rerank(query,documents)`，旧Mock可不实现，不需要专业模块另建检索器或直接调用原生模型。

## 从哪里开始

最新候选分支：`codex/wujian-team-integration-v1`，基于 `codex/wujian-qwen-foundation-v1@5b8573d`。集成 [PR #1](https://github.com/Starry-Curry/ProductAgent/pull/1) 目标为 `develop`；在 CI + 一名组员审查完成前，不宣称已经进入 develop。

合并前需立即开发时，可以从该明确候选创建自己的功能分支，但 PR 先标明依赖底座集成 PR；合并后从更新的 `origin/develop` 开分支。不要从较旧的 main 重新造底座，不直接向 develop/main 推送功能。

```bash
git fetch origin
# 集成PR合并前的临时起点
git switch -c codex/my-feature origin/codex/wujian-team-integration-v1
# 集成PR合并后，新功能改用 origin/develop 作为起点
npm ci
npm run dev
```

Node.js **24**，使用现有 lockfile。默认 http://127.0.0.1:3200，仅本机、演示身份、付费关闭；不能当作真实账号认证。开发/集成测试设置独立 `PRODUCT_AGENT_DATA_DIR`，不要指向私人数据库。需要独立账号的零费用预览见 [CURRENT](CURRENT.md)；不复制其他人的 `.env.local`、Cookie 或 SQLite。

```bash
node --experimental-strip-types examples/foundation/run-mock.ts
node --experimental-strip-types --test tests/foundation-four-paths.test.ts
npm run typecheck
npm test
npm run build
```

Mock 无网络、不代表 Qwen、创意质量或实物效果。原真实模型成功/失败、被冻结的首答和费用台账保留；本轮没有新付费授权，不开启模型网关。

## 公共服务契约 v1

统一服务端入口：`src/lib/foundation/services.ts`，`FOUNDATION_API_VERSION === 'foundation-services/1'`。页面不得直接导入 `agent/practical.ts`、Graph 或工具运行器；类型来自公共入口，业务写入仍走对应领域服务。

| 需求 | 调用/类型 | 必须遵守 |
| --- | --- | --- |
| 物品、知识、状态 | `readReality(db,state,actor,itemId)` → `RealityCard` | 每次重新授权；`identity` 型号/地区与 `instance` 私有状态分开；facts保留basis/source/version；图示识读是未验证模型观测 |
| 发现已有资源 | `discoverCapabilities(db,state,actor,{goal?,cursor?,limit?,scopeItemIds?})` → `CapabilityDiscovery` | goal为词法候选，不证明库存缺失/物理可行；无匹配可分页浏览；scope只能收窄 |
| 当前任务Context | `compileTaskContext(db,state,actor,session,question)` → `SharedTaskContext`，`ServiceSession` | 获准公开原文/能力与当前所需私人经历分层；不得把整个返回直接发给模型：`authorizedItemIds`为服务端字段，原始历史也需最少化。正常业务优先让 `respond` 编译 |
| 自然对话/工具 | `respond(db,read,actor,input,provider)` → `TurnResult`，`TurnRequest` / `Provider` | `TurnRequest`是带可省略默认值的调用输入；`TurnInput`是解析后的内部形式。供应商替换只实现Provider；`reply.outcome`可为不可用/需信息，HTTP200不代表成功 |
| 任务与经历 | `createTask / getTask / resolveTaskContext / recordOutcome / amendOutcome` | `CreateTaskInput / OutcomeInput / AmendOutcomeInput`；稳定requestId、明确confirmed、expectedRevision。复用与上云许可独立；Outcome历史兼容字段如revision读取时按既有服务约定处理 |
| 原始资料 | `readKnowledge`，`AcquiredDocument / KnowledgeReference` | 原文与适用范围保留；引用有效不证明推理正确；不直接写底层资料表造“官方事实” |

`State / Person / Item / ModelMessage / ModelResponse / ToolDefinition / TurnResult` 也从同一入口取得。`Person`是已认证服务端身份类型，**不是让客户端自由传身份**。Route使用现有 `actor(r)` 等认证边界，不接受正文里的actor作为权限依据。

决赛分支的可选兼容字段：`ItemManagementSnapshot` 从公共入口导出。物主读取 `/api/life?itemId=...` 时才得到 `management: {version:'item-management/1',itemId,revision,fields}`；共享读取者不获得编辑快照。管理表单以同一快照填值，`updateItem.input.expectedManagementRevision` 原样带回。服务端在原SQLite写事务中核对；409保留草稿，重新展示最新资料后由用户决定，不自动重放。旧调用方省略此字段仍兼容，**但只有传入版本的写入得到乐观并发保护**。这不是第二套Reality或新数据库。

本轮补充导出既有 `amendOutcome` 与其输入类型，组员不必为了纠正/遗忘经历去引用内部实现。没有新建Runtime、数据库、Context或记忆系统；私人Outcome不能因物品共享而自动传给别人。

## 一个直接复用的最小功能

完整可复制模块：[goal-feature.ts](../../examples/foundation/goal-feature.ts)；离线Provider：[mock-provider.ts](../../examples/foundation/mock-provider.ts)。它们不引用内部运行器：

```ts
import {startGoal,confirmGoalOutcome} from './examples/foundation/goal-feature';
import type {Provider,State,Person} from './src/lib/foundation/services';

// 由已认证的应用组合入口提供 db / read / actor / provider。
const result = await startGoal(db, read, actor, goal, provider, stableRequestId);
// 展示 result.turn.reply 与同一 result.task；不自动确认建议已实施。
// 仅在用户确实点击确认后：
const outcome = confirmGoalOutcome(db, read, actor, result, {
  requestId: stableFeedbackId, confirmed: true,
  notes: userReport, goalStatus: 'partial',
  reuse: userAllowedReuse, allowCloud: userAllowedCloud,
});
```

路径按调用文件位置调整；上面为仓库根模块的示意调用。真正可执行的初始化/隔离数据库见 [run-mock.ts](../../examples/foundation/run-mock.ts)，不要把测试fixture用于生产。`startGoal` 创建任务不是每句聊天的硬要求；普通问题直接调用 `respond` 即可。

读获准记忆优先通过Context及 `resolveTaskContext.previousOutcomes`，不要原始SQL扫全用户历史。写入/纠正/遗忘用既有领域服务；本轮不新增私密画像或新的Memory表。

## 专业工具怎样接入

**已有领域业务先直接复用**：故事/共享/赠礼/软件REA各自领域服务仍存在，本轮只验证共享最短路径，不强制统一重写。功能页面可像最小示例一样组合共享读取、`respond` 和领域确认。

若确实需要新的Agent工具，先把专业操作写成可独立测试的服务函数，然后与底座负责人以一个小PR接入现有 `agent/practical.ts` 的 Schema、描述和执行分派，以及 `agent/tool-policy.ts` 的服务端权限/副作用元数据。通过现有 `respond` 调用；不调用 `runToolAgent` 再起循环。

- 供应商的搜索、网页抽取、视觉等实现可通过既有Provider能力替换；不要在专业页面自行调用SDK、读取Key或建立供应商会话记忆。
- 新领域工具没有任意动态注入接口；这是当前明确边界，不假称通用插件平台已建成。注册集中协调，专业服务实现保持独立；无需重写其他页面或所有业务模块。
- 输入Schema只负责格式，模型不能授予读写/设备权限。网络前后复核身份、物品与版本；读结果限制在当前用途；写操作先预览、明确确认、事务/幂等、记录实际结果。
- 约束计算区分已绑定来源的数值与假设；能力不等于操作许可。外部硬件本轮不接入，原REA软件实验安全边界不变。

## 错误、兼容和协作

- `AgentError.status` 保留领域状态：400字段/确认问题，403未授权，409版本或幂等冲突；认证入口也可能401。Route不要把这些全改成成功响应。Zod字段错误按现有API映射400。
- `ProviderError.code` 表达供应商/超时/配置等失败；`respond`通常会返回 `reply.outcome='unavailable'` 等状态，不能只catch异常就显示“任务完成”。不把供应商原始错误/密钥吐到UI。
- 409后重新获取并展示最新状态，由用户重新确认；同一requestId内容改变必须拒绝。禁止自动刷新revision后悄悄重放写入。
- 公共语义、身份/权限、Context、Task/Outcome、工具协议、费用网关由底座负责人协调。专业模块的页面/纯业务逻辑可独立改动；不要各建一份物品、检索或Agent系统。
- v1允许新增可选字段/导出，不把内部trace、排序、Prompt或运行器永久冻结。需要不兼容修改时，先在PR列出受影响消费方与迁移例子，保留旧入口/适配期并用消费者测试验证；需要v2时再加版本入口，不能直接复用v1名称静默改义。当前没有虚构v2服务。

集成PR合并条件是离线CI + 一名组员审查；不是Core智能质量验收。没有满足时保持PR待审，组员从明确候选开发；不要强推或自行绕过审查进入develop，更不合并main。
