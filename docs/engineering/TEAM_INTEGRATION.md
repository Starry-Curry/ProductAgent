# 团队接入：最小通路与扩展边界

本页供组员直接开始开发，不是新的架构方案。产品权威为 [PRODUCT_FINAL_V1](../product/PRODUCT_FINAL_V1.md)。**共享底座可集成，不代表 Core Foundation 智能质量通过；后者仍 NOT_ACCEPTED。**

**用户最新决策（2026-11-05）：审计前暂停历史集成。** PR #4 改为Draft，不自动合入develop/main；历史材料留存不代表正式功能。组员现在可按公共接口独立开发和提Draft PR，暂不集成。以下原先“CI＋组员审查后合并”的说明须先满足解除本次暂停；简明角色分工、登录/旧版说明和验收见 [TEAM_WORK_PLAN](TEAM_WORK_PLAN.md)。

2026-11-05：负责人已授权将决赛成果 `dbd93cf` 更新到 main。当前团队接入分支 `codex/wujian-team-ready-v2` 在其基础上整理启动、分工和集成；没有另建智能运行器。develop 同步前暂以本分支开发。真实智能质量仍 NOT_ACCEPTED；可独立开发不等于问答和创造力已可靠。公共`foundation-services/1`入口不变，Provider 的可选 `rerank` 不要求旧 Mock 实现。

## 从哪里开始

最新团队候选：`codex/wujian-team-ready-v2`，包含 main 的 `dbd93cf` 及团队启动工具。develop 核对时仍为 `f449067`。本次准备新的同步集成 PR，需 CI + 一名组员审查；不直接覆盖 develop，也不重新更新 main。旧 PR #1/#2/#3 保留，不能再把旧候选误当成最新起点。

大家可以立即从这个候选创建各自分支、各自 clone。候选进 develop 前，个人 PR 先指向候选，避免重复显示整套底座；集成后改向 develop 并重新核对差异和 CI。已经开工的分支只合并更新，不重建或覆盖本地工作。

```bash
git fetch origin
# 集成PR合并前的临时起点
git switch -c feature/alice-my-feature origin/codex/wujian-team-ready-v2
# 集成PR合并后，新功能改用 origin/develop 作为起点
npm ci
npm run team:dev -- --name=alice --port=3251
```

Node.js **24**，使用现有 lockfile。上面打开 http://127.0.0.1:3251，先注册本地测试账号。团队命令只监听本机，使用现有 authenticated 模式；强制关闭模型费用、公开联网、设备实验及未达标问答实验。数据在 `.runtime/team-dev/alice`，构建在 `.next-team-alice`；同机另一人换为 `--name=bob --port=3252`。各自 clone 或 worktree；Git 分支只隔离代码，不会隔离共用文件夹里的环境和 SQLite，不要两个人/Agent同时改同一工作区。

`npm run team:dev -- --name=alice --port=3251 --check` 只检查并展示非敏感配置，不启动服务。不复制别人的 `.env.local`、Key、Cookie 或数据库。不通过公共数据目录共享开发状态，集成数据使用明确合成 fixture。零模型模式中智能回答不可用是预期；测试连续工具协议用下列 Mock，不能把它当千问成功。需要真实 Qwen 时由底座负责人使用已授权网关统一安排，不直接改启动脚本打开收费。

```bash
npm run team:mock
npm run test:team
npm run typecheck
npm test
npm run build
```

Mock 无网络、不代表 Qwen、创意质量或实物效果。四方向测试复用真实领域事务/测试账号，Provider 为替身：物品→Reality；目标→多物品→Task；反馈→新任务→纠正/遗忘；共享→跨账号读取→撤权。原真实模型成功/失败、被冻结的首答和费用台账保留；本轮不新增付费请求。

## 怎么分工才不互相覆盖

| 角色（由团队认领，不虚构人员） | 独立负责 | 需要共同协调 |
| --- | --- | --- |
| 物品与资料体验 | 录入/详情组件、资料展示、对应业务和测试 | Item/Reality 公共语义、来源认证 |
| 创意/任务体验 | 自己的界面、组合服务、反馈展示 | 复用 respond、Task、Outcome，不建第二 Agent |
| 故事/数字分身 | 自己的展示和已有故事领域服务 | 私人 Context、分享授权、遗忘 |
| 家庭/赠礼或其他专业能力 | 已有领域模块及自己的页面 | 跨账号事务、撤权、安全回归 |
| 底座维护者 | services.ts、Context、工具注册、Provider、身份/费用、数据库迁移 | 所有公共契约变更提前在小 PR 协调 |

这是分工建议，不要求现在开发全部功能。开始前在 GitHub Issue 写负责范围、预期文件、公共接口需求和验收方式；同一个大页面先划组件边界，由一人整合入口。新依赖及 package-lock 由一个 PR 更新，数据库迁移编号先协调。分支不能自动解决修改同一行的冲突。

每个功能用小 PR 尽早合入 develop，不等最后一天才一次合并。同步前保存自己的修改，然后 `git fetch origin`、`git merge origin/develop`，冲突逐段处理，不强推、不整份覆盖他人代码。CI 通过且一名其他组员审查后，由维护者合并；最终 develop→main 由产品负责人明确批准。分支保护是否在 GitHub 服务端启用，以仓库设置实际状态为准，本说明不冒充强制保护已配置。

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

决赛分支的展示契约另有兼容可选字段：`AssistantReply.steps[].sourceId`、`guidanceSources`为服务器绑定的当前公开原文/实例/文档hash，不是模型释义认证；旧消费者可忽略。`CatalogCandidate.creators`区分书目作者与品牌，不自动转成厂家事实。专业功能继续使用原`respond`和领域服务，无需新增运行器。路径分组不再认证型号，旧资料仍保存，但投影需要准确型号或实际厂家链接链。

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

接入现有 App 时，HTTP 组合层沿用 `src/lib/db.ts` 的 `localOnly(request)`、`actor(request)`、`database()`、`read`，以及 `src/lib/life/provider.ts` 的 `lifeProvider()`；Route 的请求生命周期继续由现有 `withDemoRequest` 包装，保留会话复核与错误映射。专业业务函数只接收注入的 db/read/已认证 actor/provider，不自行读取 Cookie、Key 或构造用户身份。现有 `/api/life`、`/api/assistant`、`/api/foundation` 的能力优先复用，不为每个页面复制一个运行器。Provider/数据库适配器属于应用装配层，不是需要每个专业模块依赖的智能内核。离线 fixture 只用于 examples/tests，不能被 App Route 引用。

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
