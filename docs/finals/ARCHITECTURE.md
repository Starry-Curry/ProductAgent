# 当前真实架构

依据 `ea32c3f` 源码；产品说明中的未来能力不计入。以下路径均从仓库根目录解析。

## 整体模块与数据关系

```mermaid
flowchart TB
  U["使用者：提问、登记、讲故事、确认动作"] --> UI["Next.js / React：生活首页、展柜、发现、故事、家庭、社交"]
  UI --> API["服务窗口：assistant / life / memories / workspace"]
  API --> AUTH["门卫：身份、Origin、资源归属、访客隔离"]
  AUTH --> SVC["业务服务：物品、故事、计划、礼物及确认动作"]
  AUTH --> AG["对话调度员：会话服务 + LangGraph"]
  AG --> CTX["资料夹：本次物品、相关资料、获准记忆和有限历史"]
  AG --> RULE["本地指导与规则：规格、摄影准备、有限创意兜底"]
  AG --> TOOLS["受限工具：查资料、查获准记忆、列物品"]
  AG --> PLAN["专用创意规划：约束整理、模型候选、动作检查"]
  AG --> VAL["检查员：格式、引用、数字、部分动作与风险规则"]
  AG --> CP["进度存档：LangGraph checkpoint + 会话幂等记录"]
  AG --> PROVIDER["模型邮差：百炼 HTTPS 兼容接口"]
  PLAN --> PROVIDER
  PROVIDER --> Q["Qwen：生成候选，不能自行确认现实状态"]
  TOOLS --> KNOW["商品资料：11个资料包、有限官方检索、导入文字/PDF/OCR"]
  CTX --> MEM["记忆：原故事、候选、已确认记忆、逐条上云许可"]
  SVC --> DB[("SQLite：workspace JSON + 领域表 + 照片 BLOB")]
  KNOW --> DB
  MEM --> DB
  CP --> DB
  TOOLS --> DB
  RULE --> DB
  VAL --> AG
  GATE["费用闸门：默认关闭；公开模式持久预算与并发限制"] -.-> PROVIDER
```

界面像一个家中服务台；API 是各项业务的窗口；权限层决定谁能看哪件物品。资料夹只挑本次能使用的信息，检查员尝试阻止乱编，业务服务才有权保存更改。模型是受限的建议者。

图中的“列物品”目前只返回名称、状态和 demo 标记，**不是完整物品知识接口**；“检查员”也不是通用物理证明器。规则生成和模型生成是不同路径。

### 存储事实

| 内容                           | 实际保存方式                                                                                                                       | 关系与限制                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 物品、家庭任务、礼物、准备计划 | `workspace(id, body)` 的 JSON                                                                                                      | 依靠稳定物品 ID、owner/shared、领域事务连接；没有独立 SQL items 表 |
| Agent 会话与幂等请求           | `agent_sessions`、`agent_requests`、`agent_feedback`                                                                               | revision、90秒 lease、requestId；与长时任务调度不同                |
| 图执行进度                     | `graph_checkpoints`、`graph_writes`                                                                                                | 自定义 Node SQLite checkpointer，恢复图状态                        |
| 记忆与风格                     | `personal_memories`、`memory_events`、`memory_epochs`、`persona_profiles`                                                          | owner/scope、allowCloud、过期与 epoch 失效                         |
| 图文故事与关联                 | `life_fragments`、`life_fragment_details`、`life_fragment_items`、`life_media`                                                     | 正文一份，多物品关联；照片在 SQLite BLOB；回忆与上云许可分开       |
| 章节/理解                      | `life_chapters`、`life_understanding`                                                                                              | 引用事件及指纹，用户确认派生理解                                   |
| 商品与创意                     | `life_sources`、`life_knowledge_documents`、`life_knowledge_fetches`、`life_creative_evidence`、`life_ideas`、`life_idea_feedback` | 资料身份/版本、来源与反馈；事实 ID 合法不证明语义成立              |
| 公开访客                       | `visitors.sqlite` 注册表 + 每访客独立 `demo.sqlite`                                                                                | 临时演示隔离，仍非生产账号/家庭邀请体系                            |

代码入口：[`db.ts`](../../src/lib/db.ts)、[`domain.ts`](../../src/lib/domain.ts)、[`life/schema.ts`](../../src/lib/life/schema.ts)、[`repositories`](../../src/lib/repositories/)、[`cloud/runtime.ts`](../../src/lib/cloud/runtime.ts)。生活 schema v6，迁移保留 `VACUUM INTO` 备份，WAL/foreign_keys/busy_timeout 已使用。

## 从输入到最终回答的真实过程

```mermaid
sequenceDiagram
  actor U as 使用者
  participant UI as 页面
  participant API as assistant API / 会话服务
  participant DB as SQLite
  participant G as LangGraph
  participant C as 上下文与业务路由
  participant M as 百炼 Provider / Qwen
  participant T as 受限工具
  participant V as 输出检查
  U->>UI: 提问，可带当前物品
  UI->>API: requestId、会话、问题、页面信息
  API->>DB: 权限、幂等、revision、lease
  API->>G: 新执行或恢复 wait 检查点
  G->>C: 规则识别意图，准备获准上下文
  C->>DB: 本人物品、相关来源与允许的记忆
  alt 命中精选指导或摄影准备规则
    C-->>G: 本地回答 / 待确认动作卡，0模型请求
  else 发现创意
    C->>C: planDiscovery 解析库存、排除和时限
    alt 错误识别库存指代
      C-->>G: 本地缺口，未调用模型
    else 可尝试模型规划
      C->>M: generate 候选JSON，通常最多3个
      M-->>C: 创意草稿
      C->>C: 动作/数量/来源校验，有限修复或兜底
      C-->>G: 模型方案 / 本地方案 / 明确错误
    end
  else 普通模型与工具路径
    G->>M: complete：提示词、上下文、当前可用工具
    M-->>G: 工具调用或最终JSON
    opt 模型请求工具
      G->>T: 校验工具名称、参数和权限
      T->>DB: 读取当前实际授权数据
      T-->>G: 工具结果
      Note over G,M: 本机最多3次模型轮次；公开模式上限1次会阻断第二轮
      G->>M: 若预算允许，带工具结果继续
      M-->>G: 最终JSON
    end
    G->>V: 格式、引用、限制及动作检查
    V-->>G: 可展示 / 有限修复 / 缺口或失败
  end
  G->>DB: 同步检查点，在 wait interrupt 暂停
  G-->>API: reply、trace、modelCalls、tokens
  API->>DB: 重新核对权限，事务提交会话/请求回执
  API-->>UI: 来源标签、回答、步骤、缺口、动作卡
  UI-->>U: 展示结果
  opt 用户明确确认业务动作
    U->>API: 确认动作卡及当前版本
    API->>DB: 事务复核并保存领域状态
  end
```

`wait` 是把这次对话停下来等下一句，**不代表每个模型工具调用都有人工审批**。写动作卡由独立领域服务确认；当前四个模型工具主要是读取，联网资料获取可缓存。纯进度报告另有 `continueVerifiedGuidance` 快捷路径，重新检查当前证据后复用步骤，0新增模型请求。

真实实现入口：[`agent/service.ts`](../../src/lib/agent/service.ts)、[`agent/graph.ts`](../../src/lib/agent/graph.ts)、[`agent/prompts.ts`](../../src/lib/agent/prompts.ts)、[`context/builder.ts`](../../src/lib/context/builder.ts)、[`skills/registry.ts`](../../src/lib/skills/registry.ts)、[`life/planning.ts`](../../src/lib/life/planning.ts)、[`home/store.ts`](../../src/lib/home/store.ts)。

## 功能共享到了哪里

首页/详情/发现可以进入统一会话，发现续谈会带先前候选；故事和记忆经权限过滤进入任务；家庭、礼物依靠物品 ID 和预览确认连接。共同存储已经存在，无须先重建一个“统一大脑”。

缺口在于接口不一致：对话工具清单丢掉属性；创意规划走另一套专用输入、错误修复和来源检查；摄影准备只覆盖有限场景；模型统计跨路径不完全一致。需要统一可授权的业务能力契约，而不是把所有内容无差别塞进模型。
