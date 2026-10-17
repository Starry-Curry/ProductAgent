# ItemOS / 物伴：让商品智能从“成交”之后开始
## 商业计划书（组内讨论稿 v0.1）

> **项目定位**：面向日常生活与后购买场景的本地多模态商品智能系统  
> **核心入口**：GuideLens —— 面向真实商品的实时视觉讲解、使用指导与故障排查  
> **核心底座**：Product Pack → Owned Item → Capability Graph → Experience Network  
> **长期方向**：从 Preference-based Recommendation 走向 Capability-aware Recommendation / Agentic Commerce  
> **一句话概括**：给已经买回家的每一件商品增加一个持续存在的数字智能身份，并让这些物品从“孤立商品”变成可以被理解、使用、维护、协同和持续进化的个人能力网络。

---

# 0. Executive Summary

今天的电商平台已经高度数字化了商品“购买前”的全过程：搜索、推荐、比较、详情页、客服、直播、测评、交易。

但商品完成交易后，其数字身份几乎立即中断。

用户买回路由器、打印机、相机、咖啡机、空气净化器、显示器等耐用品后，仍需要依靠说明书、搜索引擎、视频教程、品牌客服和经验帖来完成安装、使用、维护与故障排查。

与此同时，平台虽然知道用户“买过什么”，却很少知道：

- 这些商品现在是否还在使用；
- 实际解决了什么生活需求；
- 当前处于什么状态；
- 出现过哪些问题；
- 哪些问题被成功解决；
- 用户已经拥有哪些现实能力；
- 用户真正缺少的下一项能力是什么。

**ItemOS 希望补上这一层。**

我们不再把商品仅仅看作交易完成前的 SKU，而是将其转化为一个购买后长期存在的 **Owned Item**：

- 商家提供商品的 Product Pack：说明书、能力、兼容性、限制、Skill、Evaluation；
- 用户购买后自动实例化为属于自己的 Owned Item；
- 端侧多模态模型通过摄像头理解真实商品的当前状态；
- GuideLens 为用户提供实时使用讲解、安装指导、维护和故障排查；
- 每次使用的结果被记录为本地 Experience；
- 多个 Owned Item 形成 Personal Capability Graph，可围绕用户的生活目标进行能力组合；
- 当用户现有能力确实存在缺口时，再进入商品与服务推荐；
- 经用户授权、脱敏和验证后的真实使用经验可沉淀为 Experience Network，进一步改善 Product Skill、知识库、后训练数据与推荐系统。

我们最终希望推动一个变化：

> **今天的电商主要理解“你可能喜欢什么”；  
> 未来的电商还应该理解“你已经拥有什么、真正使用了什么、这些东西解决了什么问题，以及你现在实际缺什么能力”。**

---

# 1. 项目愿景

## 1.1 我们真正想做的，不只是“会讲说明书的 AI”

GuideLens 是用户最容易理解、最容易感知价值的第一入口，但它不是整个项目的终点。

我们希望构建的是：

> **现实商品世界之上的一层持续智能基础设施。**

一件商品在平台上首先是一个 SKU；用户购买以后，它进一步变成一个属于用户自己的数字智能实体：

```text
SKU
 ↓
Product Pack
 ↓
Owned Item
 ↓
Use / Guide / Maintain
 ↓
Experience
 ↓
Capability Graph
 ↓
Goal Planning
 ↓
Capability Gap
 ↓
Commerce
```

整个系统的长期演进可以概括为五个词：

> **Guide → Memory → Capability → Experience → Commerce**

---

## 1.2 核心理念

### 1）商品智能不应该在“成交”时结束

今天的平台关系：

```text
发现 → 搜索 → 比较 → 咨询 → 下单 → 支付 → 结束
```

我们希望变成：

```text
发现 → 搜索 → 比较 → 下单
                ↓
           Owned Item
                ↓
安装 → 使用 → 维护 → 排障 → 升级 → 再消费
```

---

### 2）硬件本身不需要智能，商品仍然可以拥有智能

今天智能家居平台大多围绕联网设备、IoT 协议和设备控制展开。

但现实生活中，大量商品本身并不“智能”：

- 普通打印机
- 相机
- 显示器
- 咖啡机
- 老家电
- 工具
- 机械设备
- 各类消费电子
- 传统耐用品

ItemOS 不要求这些硬件本身具备大模型、联网模块或新的智能硬件能力。

我们给它们增加的是：

> **外部持续存在的数字智能身份。**

即：

> **Hardware doesn't need to be smart for the product to become intelligent.**

---

### 3）AI 不替用户做高风险决策，只负责理解、解释、组织、指导、验证和记忆

我们坚持：

> **AI organizes. Human decides.**

ItemOS 不做：

- 高风险设备的自主维修；
- 医疗、安全、燃气等高责任判断；
- 自动替用户购买商品；
- 未经验证的经验直接传播；
- 未经授权上传家庭视频；
- 让模型替用户承担价值判断和最终决策。

ItemOS 主要做：

- 看懂当前状态；
- 告诉用户官方资料中的可执行步骤；
- 指出当前做到哪一步；
- 验证客观结果；
- 记录真实使用经验；
- 在多个物品之间组织能力；
- 当现有能力不足时提示 Capability Gap。

---

# 2. 市场与用户痛点

## 2.1 痛点一：商品在交易后失去“数字连续性”

用户买一台路由器时，购买前拥有：

- 商品详情；
- 参数；
- 测评；
- 评论；
- AI 客服；
- 搜索推荐；
- 直播；
- 价格比较。

买回家以后遇到问题：

> “这根线到底插哪里？”

又回到了：

- 翻说明书；
- 搜 B 站；
- 百度错误码；
- 找客服；
- 问朋友；
- 重新确认型号。

**商品的数字身份在交易后断裂了。**

---

## 2.2 痛点二：说明书知道“怎么做”，但不知道“你现在做到哪了”

传统 Manual / PDF 可以告诉用户：

> WAN 口在什么位置。

但它不知道：

> 用户现在实际把线插在哪个口。

视频教程可以告诉用户：

> 怎样换墨盒。

但它不知道：

> 用户现在是否已经拆下旧墨盒、是否装反、当前是哪一个型号。

聊天机器人可以告诉用户：

> E03 可能意味着什么。

但它未必知道：

> 用户眼前这台设备的具体版本、真实状态和周围环境。

真正缺失的是：

> **Product Knowledge × Physical State Grounding**

---

## 2.3 痛点三：智能家居知道“设备状态”，但不理解“整个物品世界”

今天的智能家居平台擅长：

- 开关；
- 联网；
- 远程控制；
- 自动化规则。

但用户拥有的物品不仅是智能家电。

用户现实生活中的能力，来自大量不同物品共同组成：

- 烤箱；
- 咖啡机；
- 相机；
- 三脚架；
- 打印机；
- 路由器；
- 显示器；
- 投影；
- 音箱；
- 工具；
- 普通家电；
- 各类配件。

现有平台通常没有形成：

> **“我已经拥有什么现实能力”的统一理解。**

---

## 2.4 痛点四：推荐系统知道“你喜欢什么”，却不知道“你已经能做什么”

传统推荐大量依赖：

- 浏览；
- 点击；
- 收藏；
- 停留；
- 加购；
- 购买。

这些信号主要描述：

> **Preference**

但无法完整描述：

> **Capability**

例如：

用户想“在家练习拉花”。

传统系统可能根据咖啡兴趣不断推荐咖啡器具。

而更合理的系统应该首先知道：

- 用户已有咖啡机；
- 咖啡机已经带蒸汽棒；
- 已经有磨豆机；
- 已经有电子秤；
- 最近经常使用；
- 当前 Owned Item Graph 中没有拉花缸。

于是：

> 先确认已有能力，再识别真实能力缺口。

这比“猜你喜欢”更加接近真实生活需求。

---

# 3. 产品总体设计

ItemOS 由五个核心层组成：

| 层级 | 名称 | 回答的问题 |
|---|---|---|
| L1 | Product Pack | “这个型号是什么、会什么、怎么用？” |
| L2 | GuideLens | “我现在眼前到底该怎么办？” |
| L3 | Owned Item | “我的这一台现在怎么样？” |
| L4 | Personal Capability Graph | “我现有的东西能完成这个生活目标吗？” |
| L5 | Experience Network | “真实世界里还有哪些经过验证的经验？” |

最上层进一步连接：

> **Capability-aware Recommendation / Agentic Commerce**

---

# 4. 核心模块一：Product Pack

## 4.1 Product Pack 是什么

Product Pack 是一件商品面向 AI 的“机器可读能力包”。

它不是为一个商品训练一个单独的大模型。

所有商品共享同一个本地 AI Runtime，不同商品的区别来自：

- 商品身份；
- 说明书；
- FAQ；
- 能力；
- 兼容性；
- 限制；
- Skill；
- Evaluation；
- Verified Experience。

示意结构：

```text
Product Pack
│
├── Identity
│   ├── SKU
│   ├── Model
│   └── Version
│
├── Knowledge
│   ├── Manual
│   ├── FAQ
│   ├── Parts Diagram
│   └── Support Cases
│
├── Capability
│
├── Constraint
│
├── Compatibility
│
├── Skill
│   ├── Setup
│   ├── Use
│   ├── Maintain
│   └── Troubleshoot
│
└── Evaluation
    └── 如何验证操作是否成功
```

---

## 4.2 为什么 Product Pack 有平台价值

今天商家上传的是：

> 商品详情页。

未来商家可以进一步维护：

> **AI-ready Product Pack**

这意味着：

- 商品不再只是“给人看的详情页”；
- 还拥有“给 Agent 理解和执行的结构化能力”。

长期可形成：

> **Product Intelligence Builder**

作为商家 SaaS 能力。

---

# 5. 核心模块二：GuideLens

## 5.1 GuideLens 是第一阶段最重要的产品入口

用户遇到：

- 不会安装；
- 不知道某个按钮；
- 不知道接口；
- 不理解错误码；
- 不会更换耗材；
- 不知道当前做到哪一步；
- 需要排查常见问题。

不再先搜说明书。

而是：

> **摄像头直接对准商品。**

GuideLens 综合：

```text
Camera
+
Product Identity
+
Product Pack
+
Owned Item History
+
Local Multimodal Model
```

输出：

```text
当前状态识别
↓
与 Manual / Skill 对齐
↓
下一步指导
↓
客观 Verification
↓
记录 Outcome
```

核心闭环：

> **See → Ground → Guide → Verify → Remember**

---

## 5.2 典型案例：路由器无法联网

用户：

> “为什么这个路由器没有网？”

摄像头看到：

- 路由器型号；
- WAN / LAN 标签；
- 网线当前位置；
- 指示灯状态。

系统根据 Product Pack 判断：

> 当前入户网线连接在 LAN2。

然后视觉框选：

> 正确 WAN 接口。

提示：

> “请将当前网线从 LAN2 移至蓝色 WAN 端口。”

用户完成。

系统进一步验证：

```text
Gateway       ✓
DNS           ✓
Internet      ✓
```

然后：

> **Resolved**

最后记入 Owned Item：

```text
Issue:
No Internet

Cause:
WAN cable misplaced

Action:
Reconnect to WAN

Evaluation:
Connectivity restored

Outcome:
Resolved
```

---

## 5.3 GuideLens 与普通 RAG / AI 客服的区别

普通说明书问答：

> PDF → RAG → 文本回答

GuideLens：

```text
Manual / Diagram
        +
Real-world Camera
        +
Current Physical State
        +
Owned Item Memory
        ↓
Grounded Guidance
        ↓
Objective Evaluation
```

它不仅知道：

> “理论上应该怎么做。”

还知道：

> **“你现在实际做到哪一步，以及是否真的成功。”**

---

# 6. 核心模块三：Owned Item

## 6.1 从 Product 到 Owned Item

Product：

> “TP-Link 某型号路由器”

Owned Item：

> “我家客厅里的这一台路由器”

购买后，商品获得属于用户自己的本地状态。

包括：

```text
purchase_date
location
firmware_version
configuration
maintenance
usage
issues
resolved_cases
local_notes
```

---

## 6.2 为什么 Owned Item 很重要

它让 AI 不再面对一个抽象商品，而是理解：

> **“用户与这个具体物品之间的长期关系。”**

同一型号的两台设备：

```text
Product Agent
      │
 ┌────┴────┐
 ▼         ▼
用户 A     用户 B
Owned Item Owned Item
```

共享：

> 官方 Product Pack。

但保留不同的：

> 使用状态与私人历史。

个人状态默认：

> **Local-first**

---

# 7. 核心模块四：Personal Capability Graph

## 7.1 为什么不讲“几十个 Agent 开会”

我们不建议把家庭协作描述成：

> “冰箱 Agent、烤箱 Agent、音箱 Agent 互相聊天。”

更合理的抽象是：

> **Personal Capability Graph**

也就是把用户拥有的物品映射成：

> “我现在具备哪些现实能力”。

例如：

```text
烤箱
├── 32L
├── 50–230℃
└── 烤盘尺寸 28×24cm

咖啡机
├── espresso
├── steam wand
└── 54mm portafilter

投影仪
├── HDMI
├── AirPlay
└── 1080p

空气净化器
├── 适用面积 35㎡
└── 滤芯状态 18%
```

---

## 7.2 生活 Goal 驱动

用户不需要逐个打开设备 App。

可以直接问：

> “周六有六个人来家里吃饭，我现有东西够不够？”

Manager 层：

```text
User Goal
↓
Parse Requirements
↓
Query Capability Graph
↓
Existing Capabilities
↓
Capability Gap
↓
Plan
```

输出：

> 现有烹饪、投影、音响能力基本满足；  
> 根据当前记录，六人份烘焙容量可能存在不足。  
> 可以调整菜单，也可以查看与你现有烤箱尺寸兼容的更大烤盘。

这里不替用户自动购买。

而是：

> **Human decides. Commerce follows.**

---

# 8. 核心模块五：Experience Network

## 8.1 每一次真实使用，都是一个新的真实世界 case

用户的真实过程：

```text
Problem
↓
Observation
↓
Action
↓
Outcome
↓
Evaluation
```

天然产生：

- Good Case；
- Bad Case；
- Failure Case；
- Recovery Case。

但我们不做：

> “一个用户说有效 → 全部用户立刻学会。”

---

## 8.2 经验分级机制

### L0：Official Knowledge
- 官方 Manual；
- 商家发布的 Product Pack。

### L1：Verified Support Knowledge
- 官方 FAQ；
- 官方售后案例；
- 品牌审核经验。

### L2：Community Verified Experience
- 多用户重复验证；
- 与官方知识不冲突；
- 经 Evaluation 证明有效。

### L3：Candidate Experience
- 单个用户新产生的真实案例；
- 默认仅本地保存。

---

## 8.3 经验升级流程

```text
Local Experience
↓
User Opt-in
↓
De-identification
↓
Conflict Check
↓
Cross-case Validation
↓
Evaluation
↓
Verified Experience
```

之后才可能：

- 更新 Product Skill；
- 更新 Category Skill；
- 加入 RAG；
- 进入数据集；
- 用于下一轮 post-training。

---

# 9. 推荐系统：从 Preference 到 Capability

这是 ItemOS 长期最有价值的方向之一。

## 9.1 传统推荐主要理解 Preference

信号：

```text
Click
Watch
Favorite
Cart
Purchase
```

主要回答：

> “用户可能喜欢什么？”

---

## 9.2 ItemOS 增加三类新信号

### Ownership
> 用户已经拥有什么？

### Capability
> 用户已经能做什么？

### Outcome
> 买回来以后是否真正解决了问题？

于是用户建模变成：

```text
Preference
+
Ownership
+
Capability
+
Usage
+
Outcome
+
Goal
```

---

## 9.3 Capability-aware Recommendation

例如用户：

> “我想在家拍商品视频。”

系统先看已有能力：

```text
相机       ✓
三脚架     ✓
麦克风     ✓
灯光       ×
```

然后识别：

> Capability Gap = Lighting

再进入：

> Lighting Retrieval / Ranking。

最终推荐仍然可以结合：

- 用户偏好；
- 预算；
- 品牌；
- 兼容性；
- 质量；
- 场景适配。

但推荐触发原因从：

> “你可能喜欢它。”

进一步变成：

> **“你的真实目标里确实缺这一项能力。”**

---

# 10. 核心技术优势

我们的项目不是单纯调用一个通用大模型 API。

团队已有一个基于 **Qwen3.5-9B-Base** 的领域后训练多模态模型，并具备模型压缩成员。

现有技术储备包括：

- CPT；
- SFT；
- RL；
- 工业 / 科学领域数据；
- OCR 专项数据；
- CAD；
- 工业安全；
- 建筑设计；
- 平面设计；
- 芯片设计；
- 机械原理；
- 自动标注管线；
- 自适应数据清洗；
- 多领域数据配比；
- 数据质量验证；
- 模型压缩 / 端侧部署。

这些技术与 ItemOS 的需求可以形成直接对应。

---

## 10.1 模型能力映射

| 团队模型能力 | ItemOS 用途 |
|---|---|
| OCR | 读设备铭牌、错误码、面板文字、接口标识 |
| CAD / 工程图 | 理解说明书中的结构图、零件图 |
| 机械原理 | 理解部件和操作关系 |
| 工业数据 | 提升真实设备场景鲁棒性 |
| 多模态推理 | 实物 ↔ Manual ↔ Diagram 对齐 |
| RL | 强化 grounded answer、step progression、低幻觉 |
| 数据合成 | 自动构造 Product QA / grounding / troubleshooting 数据 |
| 数据清洗 | 多品牌、多品类资料的差异化清洗 |
| 数据配比 | 平衡 Router / Printer / Camera 等领域 |
| 数据验证 | 判断新 Experience 是否值得进入训练集 |
| 模型压缩 | 本地 AI PC 推理 |

---

# 11. 本地部署与隐私

## 11.1 为什么本地不是 gimmick

GuideLens 可能看到：

- 家庭内部环境；
- 桌面；
- Wi-Fi 设备；
- 序列号；
- 房间布局；
- 电脑屏幕；
- 使用习惯；
- 已拥有物品。

因此系统采用：

> **Local-first, Cloud-enhanced**

架构。

---

## 11.2 数据流

```text
Raw Camera
Owned Item State
Personal History
        ↓
     LOCAL
Compressed Qwen3.5-9B
        ↓
Structured State
```

云端主要负责：

- Product Pack 更新；
- 官方知识；
- Verified Experience；
- 可选同步；
- 模型版本更新。

核心原则：

> **Product knowledge can come from the cloud.  
> Your home doesn't have to.**

---

# 12. 模型压缩与技术展示

模型压缩不应该只是：

> “我们用了 INT4。”

比赛中应该展示：

> **Capability–Efficiency Pareto**

比较：

| 模型 | GuideBench | 内存占用 | TTFT | TPS |
|---|---:|---:|---:|---:|
| Qwen3.5-9B Base | 实测 | 实测 | 实测 | 实测 |
| 我们的 Post-trained 9B | 实测 | 实测 | 实测 | 实测 |
| 我们的 Compressed 9B | 实测 | 实测 | 实测 | 实测 |
| 更小通用模型 | 实测 | 实测 | 实测 | 实测 |

目标不是提前承诺具体数字，而是证明：

1. 后训练带来了明确的 technical multimodal gain；
2. 压缩后能力保持在可接受范围；
3. 端侧推理达到可交互水平。

---

# 13. 自建 GuideBench

为了证明项目不仅是 UI Demo，建议自建一个小型 Benchmark：

## 13.1 评测任务

### Product Recognition
- 型号识别；
- SKU / Version 判断。

### OCR
- 面板；
- 屏幕；
- 错误码；
- 接口文字。

### Diagram QA
- Manual；
- 零件图；
- 结构图。

### Physical Grounding
- 说明书中的零件 ↔ 真实物品。

### Procedure Tracking
- 用户当前做到第几步。

### Manual-grounded QA
- 回答是否有官方证据。

### Hallucination
- Manual 不存在的信息，模型是否编造。

---

## 13.2 数据规模

黑客松阶段可先构建：

> **100–300 个高质量样例**

而不需要大规模公开 Benchmark。

重点是：

> 证明模型能力与产品需求真正匹配。

---

# 14. 第一阶段 MVP

整个 Vision 很大，但比赛 MVP 必须极度克制。

第一阶段只做：

> **Product → Guide → Verify → Remember**

不做：

- 全屋多 Agent；
- 自动购物；
- 实时在线 post-training；
- 百种商品；
- 大规模 Experience Network；
- 高风险维修。

---

## 14.1 MVP 商品一：路由器

场景：

> 入户网线插错端口导致无法联网。

流程：

```text
Mock 天猫订单
↓
自动识别 SKU
↓
Owned Item
↓
Camera
↓
识别 WAN / LAN
↓
Manual Grounding
↓
指出正确接口
↓
用户调整
↓
Network Verification
↓
Resolved
↓
Experience Memory
```

---

## 14.2 MVP 商品二：打印机

用于证明：

> 系统不是路由器 hardcode。

选择一个安全、明确、容易现场复现的问题：

- 纸张方向；
- 纸盒未闭合；
- 简单错误码；
- 墨盒安装步骤；
- 网络连接问题。

---

# 15. 90 秒 Demo 设计

## 0–10 秒：Owned Item

界面：

```text
My Items

Router
Printer
Camera
```

提示：

> Imported from purchases

演讲：

> “商品购买以后不会从数字世界消失，而是自动生成属于用户自己的 Owned Item。”

---

## 10–20 秒：真实问题

用户拿起路由器：

> “这个为什么没有网？”

Camera Mode 打开。

右上角明显显示：

> **Local AI**

---

## 20–45 秒：模型实时理解

系统显示：

```text
Device identified
Model confirmed
WAN / LAN detected
Current cable → LAN2
```

视觉框出：

> WAN。

提示：

> “当前入户网线连接在 LAN2。根据该型号官方说明，应连接至蓝色 WAN 端口。”

---

## 45–60 秒：Verification

用户调整网线。

系统：

```text
Gateway       ✓
DNS           ✓
Internet      ✓
```

显示：

> **Resolved**

这一幕是整个 Demo 最关键的差异点：

> 别人展示“AI 回答了”；  
> 我们展示“现实世界真的变好了”。

---

## 60–70 秒：Remember

Owned Item 自动记录：

```text
Issue:
No Internet

Cause:
WAN cable misplaced

Outcome:
Resolved

Verification:
Connectivity restored
```

---

## 70–90 秒：展示长期 Vision

动画：

```text
One Item
↓
Owned Item Graph
↓
Capability Graph
↓
Experience Network
↓
Agentic Commerce
```

结束语：

> **Today commerce ends at checkout.  
> We think that's where product intelligence should begin.**

---

# 16. 市场进入策略

## Phase 1：高频耐用品指导

优先品类：

- Router / Network；
- Printer；
- Camera；
- Maker device；
- Coffee machine；
- Air purifier。

筛选标准：

1. 使用门槛明显；
2. Manual 资料丰富；
3. 用户常出现安装 / 排障问题；
4. 风险可控；
5. 能够客观验证结果。

---

## Phase 2：Personal Capability Graph

从单个商品扩展到：

> 我的物品网络。

用户可以从：

> “这台东西怎么用？”

转向：

> “我现有的东西能不能完成这个 Goal？”

---

## Phase 3：Experience Network

把真实使用的成功 / 失败 Outcome 变成：

> Verified Product Experience。

---

## Phase 4：Capability-aware Commerce

当真实能力缺口出现时：

> 再进入商品 / 服务匹配。

从：

> “猜你喜欢”

向：

> **“你现在真正缺什么能力”**

演进。

---

# 17. 商业模式

## 17.1 C 端

GuideLens / ItemOS：

- 免费；
- 或作为平台会员 / 高级服务能力。

目标：

- 提升 Post-purchase 体验；
- 提升平台留存；
- 降低售后咨询成本；
- 延长平台与用户关系。

---

## 17.2 B 端：Product Intelligence Builder

向品牌 / 商家提供：

> AI-ready Product Pack Builder

商家上传：

- Manual；
- FAQ；
- 产品图片；
- 零件图；
- 兼容矩阵；
- 售后案例；
- 维修知识。

系统自动生成：

- Product Pack；
- Skill；
- Evaluation；
- QA Test Set。

商家可以：

> 测试自己的 Product Agent 是否合格，再发布。

---

## 17.3 平台价值

平台长期获得：

```text
Purchase Graph
↓
Ownership Graph
↓
Capability Graph
↓
Experience Graph
```

进一步支持：

- 耗材；
- 配件；
- 维修；
- 服务；
- 升级商品；
- 更真实的推荐。

---

# 18. 竞争格局与差异化

| 类型 | 商品知识 | 现实视觉理解 | 我的这件商品 | 多物品能力 | Outcome 学习 |
|---|---:|---:|---:|---:|---:|
| PDF / Manual | ✓ | × | × | × | × |
| 通用 AI Chatbot | ✓ | 部分 | 弱 | × | × |
| 品牌客服 | ✓ | 部分 | 部分 | × | 少 |
| 智能家居平台 | 部分 | 设备状态 | ✓ | ✓ | 弱 |
| Shopping Agent | ✓ | × | 购买历史 | × | 购买反馈 |
| **ItemOS** | **✓** | **✓** | **✓** | **✓** | **✓** |

我们的核心差异不是：

> “又做一个 Agent。”

而是：

1. **Post-purchase Intelligence**
2. **Physical-world Grounding**
3. **Owned Item Memory**
4. **Personal Capability Graph**
5. **Verified Experience Loop**
6. **Capability-aware Recommendation**
7. **Local multimodal deployment**

---

# 19. 技术架构建议

```text
                         ┌──────────────────┐
                         │ Product Platform │
                         │ SKU / Manual /   │
                         │ FAQ / Support    │
                         └────────┬─────────┘
                                  │
                           Product Pack
                                  │
                                  ▼
┌─────────────────────────────────────────────────────┐
│                    LOCAL RUNTIME                    │
│                                                     │
│  Camera ──┐                                        │
│  OCR ─────┤                                        │
│  Device ──┤ → Compressed Qwen3.5-9B → State       │
│  History ─┘                         Understanding   │
│                                         │           │
│                                         ▼           │
│                                 Skill / Guide       │
│                                         │           │
│                                         ▼           │
│                                   Evaluation        │
│                                         │           │
│                                         ▼           │
│                                  Owned Item DB      │
│                                         │           │
│                                         ▼           │
│                                Capability Graph     │
└─────────────────────────────────────────────────────┘
                                  │
                           Optional Opt-in
                                  │
                                  ▼
                     Experience Validation Layer
                                  │
                                  ▼
                       Verified Experience Network
```

---

# 20. 数据飞轮

```text
Merchant Product Data
        ↓
Product Pack
        ↓
Local Model
        ↓
Real-world Usage
        ↓
Outcome / Evaluation
        ↓
Candidate Experience
        ↓
Cleaning / Validation
        ↓
Verified Experience
        ↓
┌───────────────────────────────┐
│ RAG / Skill / Data / RL       │
└───────────────────────────────┘
        ↓
Better Model
        ↓
Better Product Experience
```

---

# 21. 团队技术优势如何分工

建议按照技术能力组织，而不是按照“前端 / 后端 / PPT”简单拆。

## A. Model & Post-training
负责：

- 现有 9B 模型整理；
- GuideBench；
- Base vs Post-trained 对比；
- Domain capability 分析；
- 后续数据合成 / SFT / RL。

---

## B. Compression & Edge Runtime
负责：

- 量化；
- OpenVINO / 本地推理；
- memory / latency / TPS；
- 模型部署；
- Capability–Efficiency Pareto。

---

## C. Product Intelligence / Agent System
负责：

- Product Pack Schema；
- Skill；
- Evaluation；
- Owned Item；
- Experience Memory；
- Capability Graph。

---

## D. Product / Recommendation / UX
负责：

- 用户流程；
- GuideLens UI；
- Capability Gap；
- Recommendation 逻辑；
- BP / Demo story；
- 商业模型。

---

# 22. 技术与产品风险

## 风险一：Vision Grounding 不够稳定

解决：

- 第一版选视觉结构清晰的产品；
- Product identity 已知；
- 结合 Manual / diagram；
- 不做开放世界任意物体识别。

---

## 风险二：模型幻觉

解决：

- Manual-grounded response；
- Product Pack retrieval；
- source tracing；
- Unknown / insufficient evidence 状态；
- 高风险操作拒绝。

---

## 风险三：Demo 太宏大

解决：

第一阶段严格限制：

> **一个核心闭环 + 两个商品**

其余全部作为 Roadmap。

---

## 风险四：Experience Network 的错误传播

解决：

> Candidate ≠ Verified

严格引入：

- 用户授权；
- 脱敏；
- cross-case validation；
- 官方冲突检查；
- Evaluation；
- 商家审核。

---

## 风险五：像普通智能家居

回应：

智能家居的核心是：

> 控制联网设备。

ItemOS 的核心是：

> **理解用户已经拥有的整个现实商品世界。**

即使设备完全没有联网，也可以拥有：

> Product Pack + Owned Item + GuideLens + Experience。

---

# 23. 比赛阶段的明确边界

## 必须实现

- [ ] 一个真实 Product Pack；
- [ ] 一个路由器 GuideLens Demo；
- [ ] 第二个商品简化 Demo；
- [ ] 团队 9B 模型接入；
- [ ] 压缩版端侧推理；
- [ ] Manual / Diagram Grounding；
- [ ] Objective Evaluation；
- [ ] Owned Item Memory；
- [ ] GuideBench 初版；
- [ ] 完整 UI；
- [ ] Demo 视频 / 现场流程。

---

## 暂不实现

- [ ] 大规模商品平台；
- [ ] 真正接入天猫账户；
- [ ] 大规模 Experience Network；
- [ ] 多 Agent 自动协商；
- [ ] 自动购买；
- [ ] 在线 post-training；
- [ ] 全屋 IoT 控制；
- [ ] 高风险设备操作。

---

# 24. 路演故事线建议

## Slide 1 — Problem

### Commerce shouldn't end at checkout.

```text
Search → Compare → Buy │ ????????
```

一句话：

> 一件商品在付款前拥有丰富的数字身份，买回家以后却重新变成一本说明书和一个客服电话。

---

## Slide 2 — Product

# ItemOS / 物伴

### Every product deserves an intelligence layer.

```text
Purchase
↓
Owned Item
↓
Camera
↓
Guide
↓
Verify
↓
Remember
```

---

## Slide 3 — Demo

展示路由器完整：

> See → Ground → Guide → Verify → Remember

---

## Slide 4 — Technology

```text
Our Qwen3.5-9B
CPT + SFT + RL
       ↓
Compression
       ↓
Local AI PC
       ↓
Manual + Vision + Device State
```

旁边放：

> GuideBench + latency + memory + accuracy。

---

## Slide 5 — Flywheel

```text
Product Pack
↓
Owned Items
↓
Real-world Outcomes
↓
Verified Experience
↓
Better Skills / Data / Model
```

---

## Slide 6 — Why Commerce

# From Purchase Graph to Ownership Graph.

```text
Preference
+
Ownership
+
Capability
+
Experience
```

最终走向：

> **Capability-aware Agentic Commerce**

---

# 25. 最终产品定义

如果必须用一句话对外介绍：

> **ItemOS 是面向购买后生活场景的本地多模态商品智能系统：它把用户买回家的商品转化为持续存在的 Owned Item，让 AI 可以看懂真实商品、实时指导使用和排障、记录真实结果，并逐步形成用户的物品能力网络与经过验证的使用经验网络。**

如果需要更短：

> **让每件买回家的商品，都拥有持续存在的本地智能。**

如果需要最适合路演的一句：

> **Today commerce ends at checkout. We think that's where product intelligence should begin.**

---

# 26. 组内讨论需要重点回答的问题

这份方案目前仍是讨论稿。下一次组会建议重点讨论：

1. **第一阶段到底选哪两个商品？**
   - 路由器是否最适合主 Demo？
   - 第二个商品用打印机、相机还是其他？

2. **现有 9B 模型在这些场景里到底强在哪里？**
   - OCR？
   - Diagram？
   - Technical reasoning？
   - Grounding？
   - 需要补哪些定向数据？

3. **端侧实际部署目标是什么？**
   - 目标硬件；
   - RAM / VRAM；
   - TTFT；
   - TPS；
   - INT4 / mixed quantization。

4. **GuideLens 是否能够稳定做到“当前状态识别”？**

5. **Objective Evaluation 选什么最容易展示？**
   - 路由器网络状态是很好的第一例。

6. **Product Pack Schema 做到多复杂？**
   - 如何避免为了框架而框架？

7. **初赛故事应该讲多大？**
   - 建议 Demo 聚焦 GuideLens；
   - Owned Item / Capability Graph / Experience Network 用于平台故事。

8. **Capability-aware Recommendation 要做到什么程度？**
   - 是否只展示一个 conceptual prototype？
   - 是否需要接入真实推荐算法？

9. **项目名称是否保留 ItemOS / 物伴？**
   - GuideLens 是否作为核心功能名？

10. **是否存在导师 / 模型技术保密问题？**
    - 哪些内容可以公开；
    - 哪些只展示 benchmark / capability 而不公开训练 recipe。

---

# 27. 当前建议结论

现阶段最合理的项目结构不是“把所有想法都做出来”，而是：

## 比赛产品入口
### GuideLens
> 真实商品的本地视觉使用指导与故障排查。

## 核心数据对象
### Product Pack
> 商品的机器可读知识和能力。

### Owned Item
> 用户真正拥有的这一件商品及其长期状态。

## 第二阶段能力
### Personal Capability Graph
> 把“我买过什么”转化成“我现在能做什么”。

## 长期数据飞轮
### Experience Network
> 把真实世界经过验证的 good / bad case 沉淀为商品经验。

## 长期商业价值
### Capability-aware Commerce
> 从“猜你喜欢什么”进一步走向“你的真实目标现在缺什么能力”。

---

# 28. 一段适合直接发群里的超短介绍

> 我现在倾向于把我们的项目理解成“商品购买后的智能层”，而不是单纯做一个会读说明书的 AI。  
> 第一阶段最容易落地的是 GuideLens：用户买了路由器、打印机、相机等商品以后，系统根据购买记录自动知道具体型号，摄像头对着设备，本地 9B 多模态模型结合官方 Manual 实时看懂当前状态，告诉用户怎么使用、怎么排查，并尽可能验证问题是不是真的解决；结果还会记进属于用户自己的 Owned Item。  
> 再往后，用户家里的 Owned Items 可以形成 Capability Graph，让系统知道“我已经拥有什么能力”，以后面对一个生活 Goal 时先组织现有物品，而不是先推荐新东西。真实使用产生的成功/失败案例经过用户授权、脱敏和验证后，可以形成 Experience Network，反过来更新 Product Skill、知识和模型。  
> 最终推荐也可以从“你可能喜欢什么”进一步变成“你现在真实缺什么能力”。  
> 比赛阶段不做这么大，只先把“商品 → 实时视觉指导 → 结果验证 → Owned Item 记忆”这个闭环打磨好，家庭协同、Experience Network 和 Capability-aware Commerce 作为完整长期故事。

---

## 附：项目核心关键词

**Post-purchase Intelligence**  
**Product Pack**  
**Owned Item**  
**GuideLens**  
**Physical-world Grounding**  
**Local Multimodal AI**  
**Capability Graph**  
**Verified Experience**  
**Experience Network**  
**Capability-aware Recommendation**  
**Agentic Commerce**
