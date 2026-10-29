# 创意与任务：从性质推导能力，从能力组合出用途

状态：拟定算法与契约。现有 main 的 [planning.ts](../../src/lib/life/planning.ts)、[ideas.ts](../../src/lib/life/ideas.ts)、[task-planning.ts](../../src/lib/life/task-planning.ts) 已有能力推断、模型候选、动作检查、反馈和摄影准备依赖；并非全是 recipes。问题是这些机制与证据／记忆／任务结构尚未统一，部分核心行为仍依赖场景模板和关键词。修复分支已有的否定、属性、工具往返、失败分类与测试要保留。

## 两个入口，同一个目标结构

物品入口“旧纸盒还能做什么”先锁定 itemIds，允许搜索多个用途目标；目标入口“利用现有物品拍视频”先定义成功标准，再找物品。最终都形成 GoalSpec，而不是分别走两套硬编码方案。

```json
{
  "goalId": "goal:video-reveal",
  "entry": "goal",
  "objective": "拍一段有揭晓感的短视频",
  "successCriteria": ["能看清一段由遮挡到揭晓的内容", "只使用已登记物品"],
  "itemIds": ["item:phone", "item:box-1", "item:paper", "item:pen"],
  "hardConstraints": {"noPurchase": true, "noHeat": true, "noWater": true, "noCutting": true},
  "softPreferences": ["安静", "喜欢手写的小故事"],
  "unknowns": ["手机能否保持稳定拍摄", "桌面空间是否足够"],
  "maxMinutes": 20
}
```

约束由语义解析候选 + 用户本次明确条件 + 结构化控件组成。解析冲突或是否定范围不明时只问会影响下一步的一个问题；“不拍照”不等于“不能录视频”，两种能力应区分。解析器不得自行创造物品 ID，服务端从获准清单消歧；无法消歧不等于用户未登记。

## 可实现的七步流程

### 1. 生成有依据的物品特征包

ItemKnowledgeRepository 输出实体、当前状态、原子属性、来源、冲突和未知。单位和数量规范化；物品不可用／借出／故障先作硬排除。能力提取不是从名称一跃推出用途：纸板尺寸不证明承重、杯子不证明食品接触、手机不证明有慢动作或远程控制。

### 2. 以小型功能词表提出能力候选

初始词表只描述效果，例如 contain、occlude、support、mark、emit_light、capture_video、signal、sequence。它不是“纸盒可做 20 种玩具”的清单。

规则只承担单位、类型、几何上下界等可检查推导；模型可提出未收录的功能候选，但必须给 `basisRefs + requirements + predictedEffect`。资料明确或用户报告的性质可支撑能力假设，未知前提保持三值：`satisfied / unknown / contradicted`。命名相似度、模型分数和过去别人的成功都不能把 unknown 变 satisfied。

```json
{
  "id": "cap:box-occlude",
  "subjectId": "item:box-1",
  "effect": {"verb": "occlude", "input": ["line_of_sight"], "output": ["temporary_hidden_region"]},
  "basisRefs": [{"id": "claim:box-material", "revision": 1}],
  "requirements": [{"predicate": "opaque_for_target_light", "subjectId": "item:box-1", "state": "unknown", "verification": "先在现场看是否能遮住所选内容"}],
  "status": "conditional",
  "verificationRefs": []
}
```

这项能力允许低风险、先观察再尝试的构思，不允许“已确认全遮光”。支撑热灯、吊挂重物或直接接触食品等后果更大的任务，unknown 必须先阻断执行。

### 3. 把目标拆成功能需求，做有界组合搜索

视频例子可拆为 `capture + make_content + occlude/reveal + stable_scene`。这不是固定视频 recipe：模型可以提出其他功能分解，规划器验证每个子目标是否真的服务总目标。物品入口则反向枚举少量可利用效果，选择用户可能在意的目标。

建立带角色的有向超图：节点是能力／中间效果；一个组合边连接多个角色，记录输入输出、约束、证据和缺口。例如纸笔生成内容，纸盒遮挡，手机记录；不能因画和纸盒都属于“家居”就算互补。

拟定初始搜索参数：相关物品最多 30 件、每件最多 5 个能力候选、搜索深度 4、beam width 8、返回最多 6 个概念。先用硬条件剪枝，再按目标覆盖、缺口代价、用物数量和偏好排序；超限返回“未探索完”，不假装穷尽全屋。参数需用实际运行成本调优，不代表已达到性能指标。

```text
frontier = decompose(goal)
beam = [empty_concept]
repeat until requirements covered or depth == 4:
  expand each concept with compatible allowed capabilities
  reject contradicted constraints and inaccessible evidence
  retain unknown as explicit condition with task-specific risk policy
  score remaining concepts and retain diverse top 8
return at most 6 concepts with provenance and unresolved requirements
```

### 4. 迁移案例背后的原理，不照搬物品名单

案例库存应存 `desiredEffect, roleGraph, governingPrinciple, requiredProperties, observedConditions, failureModes, evidence, license`，而非只存标题与现成步骤。新纸盒可以匹配“先遮挡再揭晓”的角色，即使旧案例用布；迁移时必须重新验证遮挡、尺寸、固定方式和拍摄条件，不能继承布的柔软或遮光程度。

模型可做类比、角色重分配、反转或交互规则设计，并生成 ConceptGraph；服务端验证角色和前提，不能用固定原理词表封死新概念。未经验证的新原理先保留探索假设，不进入可信原理库。来源支持一个现象，不等于支持整套新用途。

### 5. 生成可检查的 PlanSpec

```typescript
interface PlanSpec {
  id: string; goalId: string; revision: number;
  concept: { effects: string[]; roles: RoleBinding[]; principle: string };
  itemRefs: RevisionRef[]; capabilityRefs: RevisionRef[]; claimRefs: RevisionRef[];
  steps: { id: string; dependsOn: string[]; action: string;
    requires: PredicateExpr[]; expectedObservation: string; recovery: string | null }[];
  conditions: { id: string; state: 'satisfied' | 'unknown' | 'contradicted'; refs: string[] }[];
  predictedOutcome: string; missing: RequiredFact[]; risks: Risk[];
  status: 'draft' | 'needs_info' | 'ready' | 'awaiting_authorization' | 'running'
    | 'awaiting_observation' | 'completed' | 'failed' | 'cancelled' | 'stale';
}
```

步骤按依赖排列；每一步写明看见什么才算完成。缺剪刀就不能用“把纸剪成……”藏过材料检查；没有计时工具就用轮次／结束条件代替精确秒数。艺术想象允许新颖，但实际动作依赖必须由资源和条件闭合。

### 6. 分层检查与个性化排序

检查器依次核对 schema、ID／权限、事实版本、资源数量、前提三值、动作依赖、风险和目标覆盖，再由独立审阅／后续实测检验模型难以核对的机理。禁止把模型的“我已经检查可行”当证明；初期可以让第二个模型找反例，但它只是另一项意见。

未知的遮挡效果可以先给不涉及破坏的观察步骤；未知食品接触、承重或电气能力不能直接给执行建议。条件作用域逐项绑定，不能用一句“如果适用”放行所有步骤。失效的来源／物品版本让计划 stale，用户确认前重新检查。

通过硬约束后，拟定排序维度是目标价值、现有资源覆盖、预期可实施性、个人相关性、差异性和试错成本。差异性可用结构距离、能力角色组合和语义去重作代理，**不等于真正创新**。个性化只改变合法候选的选择与表达，不把偏好变能力，不用敏感关系提高“惊喜”。

### 7. 用实践反馈修正条件，避免成功偏差

记录 `planRevision, itemRevisions, conditions, actualSteps, observation, outcome, whoReported, sourceIds`。区分“没尝试”“不感兴趣”“做不出来”“条件不满足”“用户报告有效”“仪器／设备回读”与“独立实测”。一条有效反馈只提升对应条件下的候选，不把整个物品类别变 verified；失败要更新缺口和边的反例，不能只收藏成功点子。

## 生成、任务和失败恢复是一套流程

创意保存后才成为待执行计划，计划确认后才产生领域任务；提醒、维护和家庭协作复用步骤／回执，不再把一段模型正文当完成记录。出现超时保存已提交的草稿状态与准确错误，不把半个 JSON 展示成成功；候选不合格最多一次有针对性的修正，网络重试独立计预算；缺用户条件时保留已有条件，只问关键缺口。

本地降级可以是有限规则方案，但来源必须标为 local-rule，不冒充新创意。recipes 可留作离线演示／基线和案例原理提取对象；不能继续作为开放创意引擎的主要候选来源。旧安全正则保留短期防线，逐步由结构化条件、来源和动作检查接管。

## 与直接问千问的盲评设计

先冻结 24 个新场景作为留出集，另用不重叠的开发集调试；旧审计 24 例只作回归。每例固定物品、限制、授权记忆、可见资料、模型版本／别名、温度和最终展示长度。比较：D0 直接给物品和目标；D1 直接给同一批物品、目标、获准偏好和证据；V2 给相同信息，由引擎组织。主要比较 D1 与 V2，D0 只帮助观察上下文价值。

未来小试预算建议：每组 24 例、1 次采样，D0/D1 各 1 请求，V2 每例最多 2 请求，总上限 **96 请求／10 元**，发送前预留，失败与修正都占额；**这是下一阶段建议，本轮不执行**。若任务需要更多回合，先缩减场景或重新分配总预算，不能无记录追加。相同展示长度不等于相同总推理成本，报告每个可用候选的全部 tokens、请求、耗时和拒绝率。不能再次用单请求 token 上限把基准三候选截断，再据此宣称胜出。

至少三名独立真人匿名、打乱顺序评分：相关性、惊喜、可实施性、原理可信度、条件清晰和个性化帮助；不知道来自哪个系统。量表先写锚点；涉及物理原理的例子增加具备相应经验的审阅。自动统计越权、资源超额、漏约束与错误引用，不能代替创新度评分。拒绝或空答案按不可用计，不从质量分母删掉。

进入低风险实践的候选由用户选择，记录是否真正完成、前提是否充分和失败原因。拟定产品进入下一阶段标准：硬边界错误为 0；留出集 V2 可用率不低于 D1；真人偏好 V2 的点估计达到预先约定门槛，报告置信区间和分歧。24 例不能单独证明广泛优越，未达标则检查上下文、算法、模型与交互，不能先归咎框架。
