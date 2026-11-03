# 共享执行器收敛：离线迁移与实际回归（2026-11-03）

本切片从已安全提交的 `543a933` 继续，仅完成生产旧 Graph 退役后的必要回归。没有新增模型付费请求，没有读取冻结题，没有修改私人数据库或真实硬件；本文不是用户质量门槛验收结论。

## 实际修复，不只是改测试

1. **故事不能截走普通任务或未经确认写入**：auto 的旧 story 分类只作为聊天线索，不能触发原故事写入。只有显式 story 模式保留原来的私人原话记录。在线多问先走共享 Agent，不因本地回忆片段提前返回；无云回忆的“还有呢/展开”仍沿用来源与已读片段，不复读、不新增故事。
2. **无物品聊天仍能使用获准兴趣**：原 compiler 只迭代已选物品，无当前物品时丢失相关全局兴趣。现在仅按当前问题、原记忆权限取全局 Context；家庭范围继续排除真实/全局私人偏好。
3. **规划入口连续**：经既有 continuation schema 校验后，将旧目标/时间/限制及当前获准 ID 投影为 priorPlanningContext；本轮 question 明确优先。计划和最终动作的确定性限制核对复用旧禁止条件，不恢复旧规划模型循环。历史 30 分钟不被悄悄伪装成已经确认的 10 分钟计划；新 10 分钟方向先形成用户可确认的候选。
4. **在途登记变化必须阻断**：迁移属性变更负例后发现旧 Practical itemStamp 只有身份，不能发现破损/禁用属性变化。主线程修为 turn-local Reality revision + identity；session.itemScopes 仍保持原领域身份合同。负例已通过。
5. **跨物品历史隔离**：迁移真实 converse 负例暴露旧物品私人 feedback 被整体历史带给新目标。主线程对显式不同 itemId 的历史过滤，保留无物品的全局用户目标。负例已通过。
6. **软件 REA 不丢功能**：旧 graph 删除 explore_owned_software 后，共享 Agent 只剩继续入口，不能分析原软件实验。主线程在共享工具接入既有 analyzeOwnedLamp，限定本人、当前焦点、合成自有软件目标与非临时模式；仍必须独立授权才能执行软件模拟器。实际本地 REA 6.8.0 静态分析及授权/回读/重放/撤权回归通过；不是实体设备验证。

## 旧协议如何迁移

- 原 complete/generate/read_home_items/list_accessible_items/read_item_context fixture 改为正式 converse/get_item_context/get_relevant_experiences/search_product_knowledge 及现有确认卡。属性、来源与未知项断言改测共享语义卡，没有预置商品答案。
- 旧“Graph SQLite checkpoint 存在”改为领域会话 SQLite 重开后仍能续接，同时断言已退役通用图不再写检查点。幂等、并发、撤权、遗忘与临时模式断言保留。
- 旧故事 JSON 二次表达、商品固定属性表等校验反例仍在其纯函数层验证；不声称新 Agent 会运行已删除的 reviewer。只有旧 complete/generate 的 Provider 明确不可用或零调用本地指导，不伪装模型回答。
- SDK 原生流测试使用合成 SSE 字节，保持 stop 附带 tool_calls、tool_result 往返与无 JSON mode 冲突；不是上游千问调用。
- 按需源语义抽取测试先调用 search_product_knowledge，再让同一个模型使用带来源操作条目完成最终合同；不再强迫每轮先做一次初始抽取。原文保持、动作核对、无第二审稿性质保留。
- 历史 scripts/unified-home/continuous-compare.ts 增加执行器退役阻断，在 gateway 调用之前报错；原文及恢复 Git checkpoint 9eb80fe 保留。实际阻断结果见 home-historical-script-guard.txt。

## 测试证据（全部非付费）

- 定向 r1–r7 日志保留在 runtime-convergence-regression-r*.txt。早期实际失败包含属性在途变更与跨物品 feedback 泄露；没有被改成通过期望，修复后负例通过。
- 首次最终 npm test：**578/579**，唯一失败是新短路径已取消强制 initial 抽取，而 foundation-guidance fixture 仍强迫该旧顺序。失败原文 runtime-convergence-npm-test.txt 保留。
- 修复 fixture 后该组 **6/6** 通过：runtime-convergence-guidance-fix.txt。
- 最终集中 `npm test`：**579/579**，exit 0，耗时约 64.4 秒：runtime-convergence-npm-test-r2.txt。
- 最终 `npm run typecheck`：exit 0：runtime-convergence-typecheck-r2.txt。
- 新增4个路由/存储/退役开关/Context权限负例在 foundation-routing-retirement.test.ts；其余为既有功能迁移与必要修复。

这些证据只证明离线协议、领域事务、安全和软件实验回归。真实模型首答、创造力、浏览器完整旅程与产品质量仍由主线程的原始测试独立评审；579 项通过不能代替该结论。
