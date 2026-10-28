# 架构：让物品事实真正进入回答

## 模块和数据关系

```mermaid
flowchart LR
  U[用户：目标、当前物品、限制] --> UI[Next.js 页面：展柜、助手、发现、任务]
  UI --> API[API 门口：身份、访客隔离、请求幂等]
  API --> G[LangGraph：路由、模型与只读工具循环]
  API --> P[创意规划：选物品、生成、检查或降级]
  DB[(现有 SQLite：物品、任务、故事、知识、会话)] --> C[物品上下文契约：属性、来源、限制、未知项]
  K[对应型号的资料包与已获取知识] --> C
  C --> G
  C --> P
  G --> T[授权工具：分页物品清单、按 ID 详情、资料与获准记忆]
  T --> DB
  M[私密故事与偏好：按用途和上云授权过滤] --> G
  G --> Q[百炼 Provider：费用闸门、HTTPS、超时、工具协议]
  P --> Q
  Q --> V[回答检查：结构、来源、授权与部分物品条件]
  V --> R[回答或明确失败；写入仍须原领域授权与确认]
  R --> UI
  E[隔离 Pi 实验：相同只读工具、模型替身、独立 SQLite] -. 不进入生产 .-> C
```

页面是入口；API 像门卫；Graph 是协调员；上下文契约像一张带来源和“尚不知道什么”的物品卡。数据库仍是同一套业务账本。型号资料描述产品设计，不是实物体检报告。创意规划像按现有材料提出草案并检查条件的工作台，不代表草案已经做成功。

物品卡复用 `Item.attributes`，包括 material、dimensions、power、care、quantity、capabilities，以及已有状态与型号绑定；没有新增数据库表或迁移。结构没有可靠来源时放未知，不能从“不锈钢杯”推出镜面、304、耐热或食品级。私人位置、备注、故事和照片不放进新物品工具；私密记忆继续经过原权限过滤。

## 从输入到模型与最终回答

```mermaid
sequenceDiagram
  actor User as 用户
  participant API as API 门口
  participant Router as 意图与条件整理
  participant Graph as LangGraph 协调员
  participant Q as 百炼模型
  participant Tool as 白名单只读工具
  participant DB as 隔离后的业务数据
  participant Check as 回答检查
  User->>API: 只用已有物品；不要拍照；当前问题
  API->>API: 身份、访客、幂等和会话检查
  API->>Router: 当前输入与已授权上下文
  alt 创意目标
    Router->>DB: 选出可读、可用且未排除的物品
    Router->>Q: 真实属性与未知项；默认一个候选
    Q-->>Check: 候选步骤、原理、限制、引用
    Check->>Check: 资源、条件、动作依赖、授权再核对
    Check-->>User: 模型候选，或标注本地降级／具体失败
  else 需要模型理解或查询
    Router->>Graph: 任务与物品卡
    Graph->>Q: 有边界的上下文与可用工具
    Q-->>Graph: 原生 function call
    Graph->>Tool: 校验工具名、参数和读取次数
    Tool->>DB: 当前权限下分页或按 ID 读取
    DB-->>Tool: 属性、状态、限制、来源、未知项
    Tool-->>Graph: tool result
    Graph->>Q: 工具真实结果；每个请求继续扣费用额度
    Q-->>Check: 最终 JSON 回答
    Check->>DB: 权限、物品条件是否已变化
    Check-->>User: 回答；或有限修正后明确不可用
  else 可直接读取的登记或本地资料
    Router->>DB: 读登记或对应事实
    DB-->>User: 标明来源的本地回答，0 模型请求
  end
```

Graph 主循环最多 4 个模型回合、6 次工具调用、1 次校验修正；第四回合不再提供新工具，留给收尾。缺失的官方操作补齐路径另有一次受控修正，实际 HTTP 请求仍由原费用闸门逐次记账。公开模式不再因为“只允许一回合”而在工具返回后停止；公开访客额度、全局额度与限流没有放宽。

物品工具默认每页 20 件，最多 40 件，返回 total 和 nextOffset；模型必须继续翻页或声明未读完，不能把首页当全部库存。按 ID 详情不扩大权限。每次读取记下当前物品条件，等待模型期间若撤权、可用性或登记属性变化，旧回答中止。

创意默认单候选请求 30 秒，候选修正 20 秒；网络失败不自动偷偷重试。传输错误、候选不合格、信息不足分别保留。最终检查是有限的程序规则和来源检查，无法证明所有物理机制；剩余风险见决策文档。
