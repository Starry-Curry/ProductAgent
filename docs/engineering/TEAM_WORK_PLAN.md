# 物间团队分工开发说明

本页是组员立即开工的简明说明；完整调用签名看 [TEAM_INTEGRATION](TEAM_INTEGRATION.md)，当前状态看 [CURRENT](CURRENT.md)，产品以 [定稿](../product/PRODUCT_FINAL_V1.md) 为准。

## 现在先统一什么

用户最新决策：先完成公共底座，专业功能分工开发；审计之前不把历史分支、旧执行器、实验方案或过程材料再次接入。PR #4 暂停集成，保持 Draft；main/develop 不再自动更新。当前 main 中已存在此前获准上传的成果，本次不擅自回滚或删除。

仓库不是每个文件都代表正式功能：

| 内容 | 本阶段用途 |
| --- | --- |
| `src/lib/foundation/services.ts` | 已有团队服务端公共入口，版本 `foundation-services/1` |
| 既有 `/api/life`、`/api/assistant`、`/api/foundation` | 浏览器消费入口；服务端认证，不传任意 actor 冒充用户 |
| `examples/foundation`、`tests` | 接入示例和测试，Mock 明确不是真实智能 |
| `docs/engineering/**/evidence`、历史报告/费用记录 | 研发证据；不导入 App、不作为当前物品或默认成功答案 |
| `/legacy`、历史分支和旧实验执行器 | 保留待审；本阶段不新增引用、路由、复活开关或迁移其数据 |

新页面的主流程已移除“旧版入口”。旧文件和历史记录未删，不将保留历史误称为已选用。登录页只是本机账号隔离，不是百炼、GitHub或正式第三方登录；模型开关与账号独立，不为了演示省略认证。

## 开工步骤

1. 每人一个 clone 或 worktree，不多人/多Agent共写同一个文件夹。自己的 GitHub 身份只配置在当前仓库。
2. 当前临时接入候选为 `origin/codex/wujian-team-ready-v2`；它包含已存在的历史代码，不等于全仓均已审定。**暂不把功能合入该候选或 develop**，先提交小型 Draft PR，标明依赖底座及实际使用的公共服务。底座/仓库审查完成后，由负责人指定正式 develop 基线并安排集成。
3. 每个功能自己的分支、端口、测试账号、数据/构建目录。下例的 alice 和分支名换成自己的名字。

```bash
git clone https://github.com/Starry-Curry/ProductAgent.git
cd ProductAgent
git fetch origin
git switch -c feature/alice-item-detail origin/codex/wujian-team-ready-v2
npm ci
npm run team:dev -- --name=alice --port=3251
```

Node.js 24。其他人可用 bob / 3252、carol / 3253。每人浏览器打开自己的端口并注册测试账号，不能复制其他人的数据库、Cookie或配置。数据 `.runtime/team-dev/alice`、构建 `.next-team-alice` 均不提交。

`team:dev` 是离线开发：强制关闭收费、公开搜索和设备实验，不能拿它验收真实问答。接入流程可用 `npm run team:mock`，公共通路/权限可用 `npm run test:team`。真实模型体验必须另行接入已有费用网关、核实本任务授权；不要自己换Key、开第二套网关或复制历史预算。

## 建议怎么分工

以下是角色槽位，由团队认领，不虚构已分配人员。人数少可合并角色，先对齐接口再改页面。

| 角色 | 独立开发范围 | 依赖的公共能力 | 最小验收 |
| --- | --- | --- | --- |
| 底座维护（Codex本轮） | 身份/权限接入、Reality/Context、Agent/Provider、Task/Outcome、工具注册、Mock和契约兼容 | 复用当前实现，不再造运行器 | 组员示例独立跑通；授权/纠正/遗忘/幂等通过；真实智能另计验收 |
| A：物品与资料 | 自己的录入、详情、资料来源展示组件 | Reality、物品领域服务、已有 API | 本人确认录入，未知不填成事实，修改后资料更新，其他账号不可越权 |
| B：创意与任务 | 自己的目标/候选/条件/反馈组件和纯业务组合 | 资源发现、respond、Task/Outcome | 同一Task贯穿候选和反馈，想法与执行分开，实际资源及未知条件可查看 |
| C：故事与数字分身 | 自己的故事/人格展示与已获准内容使用 | 既有故事/人格领域服务、共享Context | 不另建物品或常驻Agent，故事来源可查，未授权记忆不外传 |
| D：家庭/赠礼或其他专项 | 由产品负责人选择的具体领域模块 | 既有共享/赠礼事务与同一身份系统 | 跨账号授权、拒绝和撤权有效，私人经历不默认跟随物品转移 |

这张表用于划分接口，不代表现在要求开发全部功能，也不代表历史模块可直接启用。REA实机、硬件逆向等需专项授权，不能由角色认领自动获得。

同一 `WujianApp.tsx` 和页面导航由一名集成者接入口，其他人新增独立组件，避免多人同时改大文件。`services.ts`、Context语义、身份/权限、工具协议、数据库迁移、费用网关和 lockfile由底座维护者协调；需求写成一个小PR，不自行复制一套。

## 功能如何接底座

| 需求 | 直接复用 |
| --- | --- |
| 物品身份、状态、事实和条件化能力 | `readReality`；浏览器通过已有物品API取得 |
| 从开放目标发现已获准物品 | `discoverCapabilities`；它给候选，不证明物理可行 |
| 问答/创意推理与工具循环 | `respond` + 注入的 `Provider`；功能不导入模型SDK或内部运行器 |
| 当前任务所需个人与物品信息 | 正常让 `respond` 编译；必要时 `compileTaskContext`，不要整包外传 |
| 创建/恢复任务与确认反馈 | `createTask/getTask/recordOutcome/resolveTaskContext` |
| 纠正、遗忘经验 | `amendOutcome`，保留确认、revision和requestId |

直接复制 [goal-feature.ts](../../examples/foundation/goal-feature.ts) 的组合方式，运行 [run-mock.ts](../../examples/foundation/run-mock.ts) 看完整初始化及幂等反馈。生产Route不能引用测试fixture；HTTP组合层注入当前认证actor、db/read/provider，细节看接入指南。服务端字段、已确认事实、模型假设和用户报告不可混用。

新专业工具先写可测试的领域函数，再由底座维护者接入当前工具Schema/权限分派；不开发第二个循环。允许后续替换Provider或检索实现；公共类型兼容新增可选字段，破坏性变化须列受影响模块、迁移例子和适配期，不能静默改掉 v1 语义。

## 每个人交什么，什么时候合并

- 开始时用 GitHub Issue 写目标、负责文件、依赖接口和验收。无需先写大型设计。
- 完成一个小闭环即推送自己的分支、创建 Draft PR；附真实检查、失败和未测项。不要最后一天才把所有人的代码一起合并。
- 当前审计暂停期间只评审、不集成。负责人解除暂停并确定基线后，保存自己的修改，再 `git fetch origin` / `git merge origin/develop`，逐段解决冲突，不强推、不整份覆盖。
- 之后功能PR目标为develop，最新CI通过且另一名组员审查后，由维护者合并。main需要产品负责人批准。
- 页面功能提交：对应测试、类型检查；涉及UI要实际浏览器验证。底座/集成提交集中跑必要安全回归和生产构建。Mock、真实Qwen、用户报告、实体回读分开，未测不写通过。

## 底座交付判定

1. 物品→Reality→当前任务Context 的身份、来源、状态与权限一致。
2. 两个专业调用方复用同一公共服务，不依赖内部模型执行器；Mock能独立开发，Provider可换。
3. Task/Run/Outcome确认、幂等和后续获准复用可运行，纠正/遗忘/撤权有效。
4. 类型、必要权限测试和构建通过；团队能各自启动、录入和读回合成物品。
5. 联网模式能通过已有网关真实模型—工具—答案，正常保留同一账号和数据；不能用离线页面/Mock替代这项。
6. 陌生型号来源、回答完整性、物理创意等产品智能质量单独评审，历史未通过结论不变。

前4项已有代码与测试证据，仍按当前提交复验；第5项当前3251关闭，不能宣称本次在线运行通过。第6项仍 NOT_ACCEPTED。团队接口可开发与完整智能底座验收通过是两个结论；这份说明不把缺口藏起来。
