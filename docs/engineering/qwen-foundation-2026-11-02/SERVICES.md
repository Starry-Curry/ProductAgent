# 共享底座：团队接入页

产品规则仍是 `docs/product/PRODUCT_FINAL_V1.md`；当前验收状态看 [CURRENT](../CURRENT.md)。以下都是实际调用接口，不是待建 SDK。

稳定服务端导出入口：`src/lib/foundation/services.ts`。类型包括 `RealityCard / RealityFact / RealityCapability / CapabilityDiscovery / SharedTaskContext / Provider / TaskSpec / TaskRun / CreateTaskInput / OutcomeInput / KnowledgeReference / PublicVisualReading`。通过此入口依赖共享服务，上层不直接依赖所选模型SDK。

| 需要什么 | 公共接口 | 权限与边界 |
| --- | --- | --- |
| 物品及已认识知识 | `context/reality-service.ts: readReality(db,state,actor,itemId)` → `RealityCard` | 每次重新授权；厂家原文、本人报告、推测分别标记；能力不是设备授权 |
| 获准资源发现 | `discoverCapabilities(db,state,actor,{goal?,cursor?,limit?,scopeItemIds?})` | 名称/型号/已学习条件化能力词法匹配；无匹配可分页浏览。scopeItemIds只收窄当前授权，不能扩大用途范围；结果不证明适用性 |
| 当前问题 Context | `context/compiler.ts: compileTaskContext(...)` → `TaskContext` | 目录用于发现、具体物品按需展开；私人经历需原领域用途/云授权；不序列化服务端 authorizedItemIds |
| 模型与工具 | `agent/service.ts: respond(...)`；`agent/practical.ts: practicalTools`；`agent/tool-policy.ts` | 主模型经 SDK/AgentScope 调工具；schema 不授予权限；最多6次上游/8工具、150秒、每轮估算¥3 |
| Task 与 Outcome | `foundation/tasks.ts` 的 createTask / beginRun / recordOutcome / resolveTaskContext | 使用已有请求ID、事务、明确结果确认与未来复用/云端授权；用户报告不是成功因果或实物回读 |
| 原始官方资料 | `life/acquisition.ts: readKnowledge / acquireKnowledge` | 准确型号、地区、官方域与公开抓取限制；缓存与实时获取分开记录 |

## 知识如何积累

模型最终引用已有来源时，服务器把实际文档/段落ID绑定为文档 hash、范围与引文 hash。`saveGuidanceSources / saveSourceSelections` 仅在现有 `life_knowledge_documents.body` 保存公开原文定位；不保存问题、私人条件、未知项或模型改写。原始正文不改，不新建商品数据库。operation表示原文被用于指导，不是独立语义认证；不需要另调模型先完成抽取。

`readReality` 重新校验当前来源与授权，供对话、物品资料页和现有开放创意入口复用。原文变更后旧定位失效；错误型号、地区及撤权不能继续读。型号操作能力只作为条件化的人类指导，不执行硬件。

已有缓存的普通问答直接给当前相关原文与语义信息，**没有强制前置抽取或第二模型审稿**。必要时继续读章节、网页或图示。PDF 只将选中页图交给视觉模型，保留原始URL、物理页码及原PDF hash，未看到的页不能说已验证。

选页视觉请求只发送公开页面和中性的来源识读要求，不发送私人目标到待持久化的公开知识。返回的 `PublicVisualReading` 以 `inferred_unverified` 投影为 `visual_reading_candidate`，保留模型、原PDF字节hash、文档版本、物理页码与时间；不认证为厂家事实，不授予能力/执行许可。文档版本或物品型号不适用后不再投影。

Context把当前相关的详细资料与获准的精简物品目录分开，目录不含所有者、私人备注、故事、位置。超过30项通过工具分页继续发现；“词法未匹配”不能等于“不拥有”。HTTP入口 `/api/life?itemId=...` 与 `/api/life?capabilities=...&cursor=0` 验证真实账号后调用同一服务。

## 最小实际示例与 Mock

[独立目标功能与运行说明](../../../examples/foundation/README.md)，[源码](../../../examples/foundation/goal-feature.ts)，[零网络Provider](../../../examples/foundation/mock-provider.ts)。实际运行：

```powershell
node --experimental-strip-types examples/foundation/run-mock.ts
```

直接复用现有SQLite/认证actor/state。模型只作为Provider依赖注入；Task与Outcome仍通过原领域接口写入。调用者为创建/确认各自持有稳定requestId，409后重新展示最新状态请用户确认，不能偷偷刷新revision重放。

开放私有Task只纳入执行器实际读过且仍获准的物品；有参与者的Task不因主Agent读取新资源而扩大共享。Outcome的未来复用和云端许可分开，用户成功报告不证明因果。示例测试覆盖资源晚于19个干扰项、物品变更/撤权、创建及确认幂等；[实际CLI输出](evidence/core-team-example-cli.txt)明确是Mock而非真实千问。

```ts
// 在已认证的服务端领域入口，复用当前数据库与状态。
const reality = readReality(db, state, actor, itemId);
const context = compileTaskContext(db, state, actor, session, question);
// 不把 actor、授权集合、私人备注或整本历史无条件发给模型。
```

- `tests/foundation-knowledge-reuse.test.ts`：独立 SQLite、合成新型号、替身 Provider，验证保存→共享读取→来源变更→撤权，以及缓存问答一次主模型调用。
- `tests/foundation-tool-runtime.test.ts`：工具失败/结果往返/预算/重复调用ID；是协议替身，不是千问质量证明。
- `tests/foundation-pdf-pages.test.ts`：真实渲染合成多页 PDF，SDK 替身检查只发所选页，不是实际供应商读图。
- `tests/foundation-read-permission.test.ts`：共享、到期、撤回与网络等待期间撤权。

新页面/专业功能消费这些接口，不创建第二套物品事实、Context 或通用模型循环。对领域业务仍调用故事、家庭、赠礼、记忆、Task 原服务，不能直接把模型结果写进数据库。
