# 家庭执行器退役与测试迁移（零付费开发切片）

日期：2026-11-02。恢复参考：本切片前已推送 checkpoint `9eb80fe`。本记录不是冻结验收、真实 Qwen 成功或产品发布声明。

## 真正删除的生产逻辑

`src/lib/agent/home-task.ts` 从约 640 行缩为 35 行兼容薄桥：保留八件家庭完整性、独立显式云端许可、Provider 可用性与模拟身份说明；执行仅转入同一个 `executePractical`。

删除该文件内部的 LangGraph 状态图、专属 `read_home_items` 工具、`provider.complete` 手工多轮、最终额外 `provider.generate`、可选第二模型审稿、短 ID 编解码及它独有的检查点写入。没有新增框架或个人存储。无 `provider.converse` 时明确不可用，不退回旧执行链。

`src/lib/context/compiler.ts` 以现有 SQLite 为权威补齐：

- 家庭只发现当前账号自己的八件模拟物品；即使另一账号主动共享了它的模拟物品，也不会混入本家庭。
- 家庭偏好只来自八件物品上的有效、允许上云的 preference/interest/requirement，遵循分身记忆策略和实际用户问题；与当前选中物品无关的关系故事不加载。全局真实 `state.contexts` 和私人真实物品偏好不进入家庭 Context。
- `memoryPolicy=off`、`useItemMemories=false` 和临时模式不发送家庭私人记忆；临时模式也不附选中创意/反馈。
- 显式选中创意才进入 `selectedPlans`，校验 epoch、当前物品授权及偏好依赖；反馈备注须另被显式选中。保持 `model-hypothesis-not-physical-verification`，不升格成实物成功。
- `homeVoiceItemId` 可精确聚焦同一物品；前轮目标以 `previous_conversation_goal_not_verified_result` 延续，不虚构子任务成功标志。

共享执行器 guard（主线程接入）继续负责每次模型/工具前后检查 epoch、家庭云许可/八件范围、物品授权/版本、会话过期及持久会话最新 revision/closed。该文件不另起循环或事务系统。

## 原 22 项家庭测试迁移清单

| 原有性质/旧实现断言 | 新断言与保留范围 |
| --- | --- |
| 固定八件精确 SKU、重复安装不复活遗忘记录 | 原断言保留 |
| PDF 不等于说明书、法务/营销 PDF 排除、备用页面与说明书获取 | 三项原断言保留，网络由本地替身提供 |
| 获取中所有权变化不得写官方缓存 | 原断言保留 |
| 原 `buildHomeTaskContext` 权限/临时/分身策略 | 改测正式共享 `compileTaskContext`；工具检索 query 不替代实际问题授予记忆权限 |
| 无家庭云许可零模型调用、许可不扩大单条记忆许可 | 原性质保留，同时新执行器不可用时不假装模型回答 |
| complete→read_home_items→complete→最终 generate；固定三次及 graph_checkpoints | 改为实际 converse→get_item_context/get_relevant_experiences→回答；检查语义物品含 40×30 和获准关系、会话目标延续；不要求模型生成任务徽标，检查不再写该旧图检查点。当前替身脚本三回合只证明工具往返，不作为真实调用成本结论 |
| 其他用户家庭及未授权 ID 不得读取 | 改用共享 get_item_context，保持 403 和服务端物品 ID 范围 |
| 在途遗忘/撤权旧草稿不发布 | 保留，错误判定用 AgentError 409，而非锁定旧中文错误文案 |
| 纠正/遗忘后旧私人故事不能成为第二来源 | 改测共享 evidence，仅新关系可用，全部遗忘后均不可用 |
| 八件资源、家庭偏好、排除真实偏好/未选关系 | 改测目录/authorizedItemIds/语义 evidence，新增全局 contexts 私人标记反例 |
| 首轮硬指定 read_home_items、后续恢复 auto | 改为旧 complete/generate 一经调用就失败，验证所有回合走 converse 与共享工具；无 converse 零调用且 unavailable |
| 模拟家庭与真实空间不能复用旧聊天 | 原领域服务隔离断言保留 |
| 多主题原文不被挤掉 | 原纯函数回归保留；不是声称旧家庭检索器仍为生产执行器 |
| 未请求物品不带说明书正文 | 改为共享 Context：仅被选物品详细资料，目录没有 owner/location/note/private story |
| 创造入口显式许可、不能扩大到真实空间、在途撤权不保存方案 | 原创造领域三项性质保留，没有在本切片改造创造执行器 |
| 历史助手全文不能作为当前事实；用户限制/新目标保留 | 不再要求对话历史绝无 assistant（那是旧实现），而断言旧助手文本不进入 privateFacts/证据，用户限制仍在 history，新 question 保持原样 |
| 显式选中创意及反馈回到同一会话 | 改检查共享首轮 packet.selectedPlans，保留同一 session 与未实测标记 |
| 短句柄 item8 精确还原、item8x 不模糊匹配 | 新执行器使用真实规范 ID，拒绝旧别名 item8、item8x 和规范 ID 加后缀；不为保留旧协议重新实现别名 |
| 单件再创造可用家庭偏好、不可读全局偏好 | 原领域入口断言保留 |

旧辅助 input 将 memoryPolicy 默认从 off 改为 read，是为了在“明确允许读记忆”的场景检查关系。另加严格 off 负例，不用旧执行器忽视 off 的行为来定义新权限。

新增五项性质：off/临时模式云端私人记录零读取；主动共享仍不能跨模拟家庭；家庭分身精确聚焦；在途会话关闭或 revision 变化零文本发布；选中方案/反馈的显式性、epoch 与跨范围过滤。

## 执行证据与实际失败

- 首次协议迁移后家庭 19/22：2 项锁定旧错误文案，实际已正确抛 409；1 项新 contexts 负例 fixture 没初始化可选数组。修复测试表达/fixture，未放松权限断言。
- 初次类型检查发现回调隐式 any、可空偏好值及测试 tested 字面量类型，均修正类型，不修改运行时权限语义。
- 最终：家庭 27 项及相关 compiler/历史纯函数/上下文行动/来源发布共 **76/76 离线通过**；`tsc --noEmit` exit 0。原文见 `home-runtime-retirement-tests.txt` 与 `home-runtime-retirement-typecheck.txt`。
- 本切片上游模型请求 **0**；没有读取冻结验收题，没有操作真实设备或用户数据库。真实家庭浏览器/Qwen 验收由主线程继续，未在此宣称通过。

复现：Node.js 24，工作区根运行：

```
node --experimental-strip-types --test tests/unified-home.test.ts tests/foundation-semantics.test.ts tests/foundation-gate0.test.ts tests/kernel-v3.test.ts tests/outcome-context-actions.test.ts tests/outcome-publisher-manual.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

## 保留项与边界

`context/home-task.ts` 的只读旧投影及纯函数仍被历史 `scripts/unified-home/continuous-compare.ts` 引用，本切片不删除历史比较资料。脚本旧 current-arm 协议不代表新的运行合同；未来重新运行必须明确指向历史 Git 基线或更新评测适配，不能把旧脚本结果称为新链路验证。

虚拟家庭安装、商品资料、记忆/故事、分身配置、创造计划和反馈仍使用原领域系统。删除的是重复推理执行链，不是业务数据或历史。旧助手内容可作为已标识的对话历史，但不成为官方事实或实物验证。共享语义/最终工具仍不证明模型自然语言必然正确，需真实用户旅程检验。
