# 物间 V2：智能行为与创造力实验版

日期：2026-10-29（北京时间）。正式开发基准为远端 codex/wujian-intelligence-alpha 的 7c513170a28d5dd76fe7845e0debdc163c53ea19；不是 main。本轮工作区 D:/ProductAgent-LifeContext/.runtime/behavior-app，分支 codex/wujian-intelligence-behavior-v1。开始和交付核对 main 均为 ea32c3f4c9e18992ca267b6dd74e26e418c9e95a。原工作区及 Alpha 工作区未改动，没有迁移私人数据库或控制硬件。

## 产品负责人先看

**问答改善有真实证据，创意质量尚未达标。** Alpha 回答 SAMLA 材质、尺寸、限制的组合问题时漏掉材质；新版真实回答及浏览器中覆盖材质、外尺寸、食品接触限制、内尺寸未知、个人实物状态未检测。不是仅改路由测试。

创意已在 App 接入“开放发散 → 检查动作效果并选择 → 展示 → 收藏/否定 → 主动带反馈再探索”。资源池可任选子集。浏览器真实结果只用了三件可用物品中的两件，收藏和反馈可持久保存；修复了快速连续操作覆盖收藏的缺陷。

但两轮同一模型并未可靠解决物理推理：木盒被编出盒盖，长尾夹被编出转轴，反馈后的方案仍夸大浴巾厚度和配重稳定性。**不能据此宣布创造力胜过直接问千问，也不能作为可行方案承诺。** 下一步应先解决这些具体机制错误，而非扩展数字分身、REA 或框架。

## 查看成果

- [实际测试及失败定位](TEST_REPORT.md)
- [真实模型结果、局限与实施者审阅](MODEL_RESULTS.md)
- [匿名三方样本，供人直接判断](REVIEW_SAMPLES.md)；先评审，再看 [对应关系](REVIEW_KEY.json)。尚未开展外部盲评。
- [本轮决策](DECISIONS.md)
- [用量汇总](evidence/SUMMARY.json)、[原始台账/完整请求与输出](evidence/live-ledger.json)、[浏览器实际结果](evidence/browser/result.json)
- [桌面问答截图](evidence/browser/qa-desktop.png)、[移动创意截图](evidence/browser/creative-mobile.png)、[反馈后结果](evidence/browser/reexploration-mobile.png)

## 怎样体验

本机保留的合成预览库在本轮 worktree 的 .runtime/behavior-preview，包含真实生成的历史及反馈。运行：

在本轮工作区执行 Node.js 24：

```powershell
node scripts/behavior/preview.mjs --port=3202
```

打开 http://127.0.0.1:3202/ 。问物间可查看之前的问题；发现新玩法 → 我的收藏可查看留作评审的真实模型草稿（不代表赞同该方案）。当前真实模型费用关闭，仍可收藏、反馈、阅读物品资料。60 次额度已用尽；本轮不再新生成，也不清空台账绕过上限。

其他机器从独立分支建立新 worktree，npm ci、npm run build 后可启动同一脚本；合成 SQLite 和凭证不在 Git，新克隆可读 GitHub 原始样本，但不会自动获得本机历史库。默认不开付费。

## 实际改了什么

| 业务文件                                                      | 改变与保留                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| src/lib/skills/knowledge.ts、agent/graph.ts、agent/prompts.ts | 小型型号包完整提供给模型；不再命中一个片段就提前结束；保留综合回答；危险操作/未知数值等检查及诚实摘录回退仍在               |
| src/lib/life/creative-exploration.ts、ideas.ts、planning.ts   | 发散与选择两回合；第一回合自然语言、温度0.85，第二回合JSON、温度0.35；无第三次自动付费修补；实际目标不被“桌面=收纳”标签替代 |
| src/lib/life/creative-reasoning.ts                            | 提供数量/单位及来源、未知和限制；没有把引用有效当成物理证明                                                                 |
| src/lib/agent/service.ts                                      | 记忆候选不再覆盖当前回答；原确认、纠正、遗忘和上云同意机制保留                                                              |
| src/components/life/Discovery.tsx                             | 结果优先显示效果、物品和操作；依据/条件折叠；备注默认本机；主动按钮才把本条反馈加入新问题；连续反馈合并且按顺序写入         |
| src/lib/ai/provider.ts                                        | 支持按请求选择温度及JSON形式；创意模型可单独显式配置，但默认仍qwen-plus，未启用不可用的强模型                               |

没有修改依赖、数据库结构、框架或正式部署。上轮权限、工具往返、任务确认和隔离机制继续回归。
