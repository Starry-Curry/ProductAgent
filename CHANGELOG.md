# Changelog

按原记录日期倒序整理；同日保留各阶段快照，不把中途状态改写成最终状态。旧 Unreleased 中未注明日期的内容单独保留，不猜测日期。当前进度只看 [CURRENT](docs/engineering/CURRENT.md)。

Notable changes to ProductAgent / 物间 are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use [Semantic Versioning](https://semver.org/) when the repository begins publishing tagged releases.

## 2026-11-05

### 决赛产品闭环研发（进行中）

开始逐层对抗审查与纵向修复：检索相关性优先、指导步骤身份与反馈续接、跨会话反馈幂等、通用厂家来源链和结构化商品原文读取。新授权800次真实上游请求、不设金额上限，历史额度不重置；真实陌生商品成功与失败分开保存。尚未通过Core/Full质量验收，未称全功能完成；见 [当前状态](docs/engineering/CURRENT.md)。

阶段恢复点2：修正明确资源引用、历史原文传输重复和工具ID不一致；保留共享知识搜索。尺寸/结构可更正并刷新Reality；记忆政策切换不恢复旧会话；软件执行可接续原Task且保留原授权、回读、幂等。616项离线与生产构建通过，真实模型的错误/超时/复测原样保留；详见[对抗审阅](docs/engineering/finals-product-2026-11-05/QUALITY_REVIEW.md)。未达到全产品质量门槛，研发继续。

阶段恢复点3/4：统一软件回读、刷新Task恢复与旧响应竞争保护；收礼故事采用既有快照、显式记忆授权；模拟家庭云端权限改为由实际成员验证，不能省略页面标记绕过。退役新生成计划的旧纯文字步骤选项，保留历史读取。623项离线、类型与构建通过，家庭/赠礼/软件真实浏览器记录保留；创意和陌生商品问答仍有实际质量失败，未宣布Foundation或全产品通过。

阶段恢复点5：可选百炼原生原文重排、SDK严格Schema可读错误、当前有效读页工具范围、完整型号后缀隔离、公开检索最少披露与机构目录回退。实际KORG复测与软件分身回读有改善，新增陌生型号暴露的拒答、来源适用性与检索失败保留；636项离线和类型检查通过，构建结果见本轮证据。整体质量仍未通过，不将阶段提交当最终验收。

阶段切片6：资料类型不再一律偏手册；同轮重复发现复用；计划后排必要条件不再截断；自然记忆统一原话收据、避免重复抽取/遗忘后复活；主模型按需读取获准兴趣类别。642项离线、类型与生产构建及实际浏览器记录保留。真实模型能读取纠正后的兴趣，但仍漏具体行动安排；来源地区和创意机制仍失败，质量不改为通过。

### GitHub 文档与协作入口整理

三份根历史报告精简为固定提交入口，历史日期与原判断保留；README/CONTRIBUTING 统一 GitHub、main/develop 与 PR 审查流程。新增适配用户指南的 [操作手册](docs/GIT_WORKFLOW.md) 和 [后续规划](docs/engineering/NEXT_STEPS.md)。不迁移 CodeArts、不新建 master、不删除远端分支或历史证据；无业务与费用变化，Core Foundation 仍未通过。

## 2026-11-03

### 团队集成候选

> 2026-11-03 团队集成候选：四认知最小通路、公共接口/纠正遗忘导出与独立示例已验证；599项离线、类型、生产构建通过，新付费请求0。Core质量仍NOT_ACCEPTED；develop需CI与组员审查。见 [CURRENT](docs/engineering/CURRENT.md) 与 [团队指南](docs/engineering/TEAM_INTEGRATION.md)。

### Core零费用收口

> 2026-11-03 零费用收口：团队共享服务、独立接入示例、状态/撤权检查与594项回归、类型、生产构建通过；真实陌生指导首答仍有错误，Core Foundation V1 = NOT_ACCEPTED。未覆盖首答、未新增模型请求、未合并main。详见 [当前状态](docs/engineering/CURRENT.md) 和 [核心复核](docs/engineering/qwen-foundation-2026-11-02/CORE_REVIEW.md)。

### Core增量恢复点

> 2026-11-03 Core Foundation 增量恢复点：未知品牌发现/来源链、共享原文与任务经验接续已修，真实输出仍有无依据细节，尚未Core验收通过。当前范围与证据只看 [CURRENT](docs/engineering/CURRENT.md)。下方历史保留。

### 统一底座收敛（候选，未正式验收）

共享Reality/Context、公开原文定位积累、缓存问答短路径、按页PDF视觉；旧通用Graph/HomeTask循环退役并迁移必要业务。现阶段回归与浏览器证据、费用和未达标项只以[CURRENT](docs/engineering/CURRENT.md)为准；不以离线通过宣称Foundation Accepted。历史正文保留。

## 2026-11-02

### Qwen-first 产品结果轮次

独立分支 codex/wujian-outcome-qwen-v3：已接入原生检索及局部任务/隐私修复，但产品未验收。250次授权请求已用完，BLOCKED_AUTHORIZATION；最新事实、失败与恢复方式统一见 [CURRENT](docs/engineering/CURRENT.md)。历史正文与账本保留。

### Qwen-first统一底座（进行中）

Gate0/1源码与离线保护检查点已建立；真实模型及产品验收尚未执行，不称发布成功。当前状态与证据见 [工程入口](docs/engineering/CURRENT.md)。

2026-11-02 Gate2恢复点：AgentScope工具循环、SDK传输、共享原文语义选择与最终呈现合同已接线；Sony开发样本真实浏览器复验见 [本轮状态](docs/engineering/qwen-foundation-2026-11-02/STATUS.md)。尚未通过Gate2–4，不是最终产品发布；旧循环收敛、四条旅程和冻结盲测继续进行。

## 2026-11-01

### 统一智能与连续产品集成

官方章节检索、来源绑定数值条件、确认行动进入同Task、自然故事接续；修复故事收据遮掉获准操作经验与旧清单续聊回归。真实模型经验纠正/遗忘、独立账号家庭赠礼及REA软件实验已运行。陌生商品自主发现仍有限，新跨物品首答不合格，未宣称创意成熟。交付快照58次/估算18.156276元；详见[交付与未达标项](docs/engineering/integrated-agent-2026-11-01/DELIVERY.md)。未迁移私人库、未合并main。

### Practical追加轮次交付

新20次/10元额度已执行20次，估算3.631992元，原60次台账哈希未变。新增EOS R10无SKU预置链接的实时厂家目录→手册→操作章节→问答/追问；R50已取得真实录像章节，修正核心启停指导。合成经历跨Task复用、更正后转回放、遗忘后真实模型不再收到经历已通过。自由跨物品仍编造资源，消息布局候选无改善，均未宣称可靠、实验默认关闭。全量离线469通过/1跳过；修复限流测试跨分钟偶发失败，未改生产限额。构建、类型、benchmark通过。详见 [追加交付](docs/engineering/practical-continuation-2026-11-01/ADDITIONAL.md)及[质量复核](docs/engineering/practical-continuation-2026-11-01/ADDITIONAL_REVIEW.md)。

### 追加授权：陌生型号资料链路

用户追加20次/10元，建立独立台账并冻结原60次。EOS R10已真实完成无URL录入→实时厂家目录→型号核对→JSON章节→两个操作章节→真千问回答与追问；核心问题有依据，扩写仍不合格。全网搜索虽返回200但来源为空，没有把生成正文当资料。原跨物品方案仍失败；消息组织候选默认关闭待实测。见 [追加记录](docs/engineering/practical-continuation-2026-11-01/ADDITIONAL.md)。

### Practical续作交付与未达标项

已保留资料发现修复、带来源的数值条件与App展示、同TaskRun→合成结果确认→授权→下一Task经验复用；浏览器实际验证纠正、撤销、遗忘、幂等与跨账号隔离。额外修复新报告/任务切换沿用旧云端勾选的问题。陌生商品自主获取仍未真实通过；拍摄方案仍编造动作，强制计算回合仅实验且默认关闭。累计60/60次、估算12.2246元（含失败预留）已停止付费；新协议及纠正后模型复测blocked。离线463通过/1跳过、类型/生产构建/benchmark通过，模型质量不据此判通过。恢复点7be025a、08f1f18。详见 [本轮交付、运行与证据](docs/engineering/practical-continuation-2026-11-01/TEST_REPORT.md)及[质量复核](docs/engineering/practical-continuation-2026-11-01/QUALITY_REVIEW.md)。未合并main、未迁移私人数据、未操作设备。

### Practical续作：来源绑定约束与跨任务经验

服务端必要条件已进入原生上下文和App：310g与官方170–290g分别有来源、超20g、不误认证相机安装；模型自填数字仅作假设。真实UI完成同Task两件物品→用户确认合成结果→授权复用→另一Task调整为定点分段。方案整体仍未达标（虚构支撑、按钮操作和故障后果），强制计算回合候选默认关闭。累计60次/估算12.2246元达到请求上限，已停止付费。详见 [质量复核](docs/engineering/practical-continuation-2026-11-01/QUALITY_REVIEW.md)。

### Practical Agent续作：陌生商品资料发现（部分完成）

已修复失效种子阻断、官方章节/图示信息丢失及泛词混入无关物品。SRS-XB100真实浏览器仍失败：旧百炼搜索端点HTTP400，已依据官方文档改为多模态SSE，但真实复测受当前余量限制，未宣称成功。13项离线通过、类型和生产构建通过。保留55次累计台账和失败原文。详见 [续作记录](docs/engineering/practical-continuation-2026-11-01/README.md)。

## 2026-10-31

### 自然工具 Agent · 本轮交付

Sony/Canon核心真实浏览器任务可用；只读已获准经验、纠正/撤销/遗忘闭环；修复新任务继承无关会话、短手册末尾规格被截断及结果保存版本竞争。复杂排障/跨物品完整方案仍部分达标，具体失败不隐藏。模型49次、估算4.7178元；离线451通过/1既有跳过，生产构建、类型、家庭/赠礼/权限浏览器回归通过。详见 [交付](docs/engineering/practical-agent-2026-10-31/DELIVERY.md) 和 [运行与证据](docs/engineering/practical-agent-2026-10-31/TEST_REPORT.md)。未合并main、未迁移私人数据、未操作硬件。

### 自然工具 Agent · 经历切片

真实浏览器已执行保存、跨会话使用、更正、撤销和遗忘合成经历；修复结果保存的任务版本竞争，增加显式只读记忆授权。模型仍有未获来源支持的排障扩展，未宣称可靠性全面通过。详见 [本轮记录](docs/engineering/practical-agent-2026-10-31/README.md)。

### 自然工具Agent纵向交付中

基线0432ace33，独立codex/wujian-practical-agent-v1。Sony真实浏览器录入→原生工具→官方来源→回答→追问已走通；首次11.9秒2次上游，追问4.5秒1次。核心操作有来源，仍有额外扩写及短按开机措辞含糊；逐句原文复核更正：5分钟关机实际见官方英文指南，不应列为模型错误。保留原样本，继续Canon/经验/跨物品。新增独立60次/15元授权，历史不重置。详见[本轮记录](docs/engineering/practical-agent-2026-10-31/README.md)。

### 智能内核 V3（工程交付，真实质量未过门禁）

从4d210bcd隔离升级，codex/wujian-intelligence-kernel-v3。TaskFrame、动态来源/主张核对、必要条件计算与逐子问呈现已接入App实验开关；两项事实实验均默认false，保留原事务和默认业务。最终442项离线、类型、生产构建和桌面/390px真实浏览器通过；真实质量没有通过：历史关键项27/71，留出26/63，低于直接同模型45/71与40/63；同模型语义复核误拒/漏放、经验错误归因及创意超时仍在。新授权轮次247/250次，239返回8失败，估算含未知usage预留7.5945元以内；旧轮次另追加9次至146，前137次不改。仅8题新鲜三臂，历史34+留出30本轮双臂，不能冒称全量三方验收。保留原始失败、匿名样本、官方来源、四条旅程和恢复命令。见 [本轮交付](docs/engineering/intelligence-kernel-v3-2026-10-31/README.md)、[真实结果](docs/engineering/intelligence-kernel-v3-2026-10-31/MODEL_RESULTS.md)、[测试与运行](docs/engineering/intelligence-kernel-v3-2026-10-31/TEST_REPORT.md)。未合并main、未迁移私人库、未操作硬件。

### 真实智能评测与定向修复

独立分支codex/wujian-real-intelligence-eval-v1，基线c31a535。新授权轮次137次真实上游请求；保留历史账本。修复错误索尼来源、未知值协议、跨语章节检索、色温步骤误拒、经验呈现、部分完成状态和general标签绕过。409项离线与类型/生产构建通过；真实创意仍存在错误物理机制，自由事实问答默认关闭。见[本轮交付](docs/engineering/real-intelligence-2026-10-31/README.md)及[阶段依据](docs/engineering/real-intelligence-2026-10-31/STAGE_FIXES.md)。不以回归通过宣称产品可靠。

### 长期经验与跨模块闭环（真实模型未验收）

基线 unified-foundation-v2 7d682465，新分支 codex/wujian-experience-lifecycle-v1。先复现并修复：新增台灯反馈令旧耳机经验丢失；拆开运行epoch与长期隐私scope，保留有效旧经验，支持纠正、停止复用、忘记与已知派生失效。单物品指导/开放创造接收获准经验，家庭报告同事务更新原任务。保留原有故事、赠礼、分身与REA软件实验；未改Instructions、main或私人库。

398项离线、类型、生产构建、benchmark、新旅程及旧10组真实浏览器通过；付费请求0。有限厂家主张核对仍是实验，默认不开事实综合；34个真实模型案保持预算阻塞，没有直接千问或创造力质量新认证。来源获取失败与B创造场景模型关闭502保留，用户报告不算实物验证。

[本轮运行及交付](docs/engineering/experience-lifecycle-2026-10-31/README.md) · [测试证据](docs/engineering/experience-lifecycle-2026-10-31/TEST_EVIDENCE.md) · [未达标及待授权验证](docs/engineering/experience-lifecycle-2026-10-31/REMAINING_GAPS.md)

### 统一智能基座 V2 实验分支（最终验收未通过）

以 product-foundation-v1 d8eee930 为正式本轮基线，在 codex/wujian-unified-foundation-v2 隔离升级；未合 main、未修改私人库或项目 Instructions。物品/型号适配、独立 Grant、TaskSpec/Run/Context/Outcome、故事赠礼与家人引用桥接、未知运行保护及软件能力证据已落地。新目标直接发起，旧任务可跨页面恢复；普通视图刷新、自然/大字问答交家人已修复。软件运行按数据空间/账号/实物隔离，历史赠礼不能重复赠出或复用控制。

382项离线通过（新增11项及既有测试扩展）；类型、生产构建、benchmark、原有API与新旧真实浏览器通过。85案46通过（含9原型路径）、5其他阻断、34真实模型预算阻断。新增付费调用0；旧150次账目不重置，事实综合实验仍关闭，不能宣称模型更聪明或G5通过。普通报告与失败证据完整保留。

[本轮交付与运行](docs/engineering/unified-foundation-v2-2026-10-30/README.md)、[测试](docs/engineering/unified-foundation-v2-2026-10-30/TEST_EVIDENCE.md)、[未达标项](docs/engineering/unified-foundation-v2-2026-10-30/REMAINING_GAPS.md)。产品正式依据为 docs/product/PRODUCT_FINAL_V1.md：释放人与物的价值；兑现、创造、延续、传递。导航未真人定案，硬件/公开部署/付费仍单独授权。

## 2026-10-30

### 统一家庭体验 Beta（独立分支，内容验收未全部通过）

基准 `codex/wujian-personal-objects-v1@113696effe5f7f162fe9dccfbdf0bb64a7737d55`，分支 `codex/wujian-unified-home-beta`，隔离工作区 `D:/ProductAgent-LifeContext/.runtime/unified-home-app`。保留原项目未提交的 `deliverables/`，未合main、迁私人数据库、换框架或控制硬件。

已接入固定7款真实SKU与模拟赠画、一键家庭加载和明确云端许可；实际取得各商品至少一份官方资料（含规格、说明PDF和真实失败记录）。首页→统一任务→相关物品/故事→分身→原任务的流程已连通。使用现有LangGraph/SQLite会话、授权、记忆及反馈；普通真实物品空间仍保留旧路径，未宣称已把任意真实家庭全部迁入新机制。

329项离线通过（新增14）；类型、生产构建、benchmark、原纵向6条替身浏览器旅程和公开演示8组离线检查通过。新家庭6次真实问答与反馈、桌面/移动页面实际跑通；移动端另一个合成角色的跨会话纠正、遗忘及越权阻止通过。真实模型52次请求，50次提供方返回、2次失败；API返回和引用检查不能代替内容验收。

**内容仍有明确失败：未登记材料、未经证实的空余空间/支撑、旋钮方向及过早重置等。** 强模型小样本没有实证收益，未采用替换。下一轮先解决依据与动作、资源条件之间的约束，不先加REA或换框架。[可体验流程与来源](docs/engineering/unified-home-beta-2026-10-30/README.md)、[测试](docs/engineering/unified-home-beta-2026-10-30/TEST_REPORT.md)、[真实回答与失败](docs/engineering/unified-home-beta-2026-10-30/MODEL_RESULTS.md)。下方历史记录保留。

### 统一家庭连续体验修复

继续 `codex/wujian-unified-home-beta`，基于0c6851a。首页目标入口前移；物品详情增加聚焦单件的新用途探索、可选其他资源、逐方案继续；明确同意后才将反馈备注带入旧会话，修复前端丢弃planContext和hash导航问题。家庭偏好共享严格限于获准模拟范围，原空间私人偏好不混入。工具使用严格映射的本轮短引用，不模糊放行拼错ID。

真实浏览器完成生成、收藏、反馈、返回原会话及390px手机操作；但所生成方案物理机制不成立，已经页面标为不采用。98次真实请求（96 qwen-plus、2 qwen-max），估算0.8471632元，非账单；提供者返回不代表产品正确。模型复核实验效果不足，默认关闭；不采用qwen-max为默认。自动测试、构建不能证明智能或创意成熟。详细失败和证据见 [连续开发报告](docs/engineering/continuous-experience-2026-10-30/README.md)。无真实硬件、私人数据库或main合并。

### 开放创造力 V2 收敛交付

从 codex/wujian-unified-home-beta / a2a9a23 创建独立 codex/wujian-creativity-engine-v2。实际接入单次自然探索、可选8条出处原理索引、选中后条件核对、反馈与统一任务交接；保留原功能/权限，不迁移数据或框架。修复结果裁剪/交接容量、可空字段、完整文本呈现与记忆变化后的创意云端复用。

362项离线、类型、生产构建、API集成及桌面/移动真实浏览器通过；22项新增测试。107次真实请求，103次API返回、3次超时、1次指令替换中止；估算含失败预留约1.2396元。24任务三策略与20次调用方式消融保留原文，不用响应成功或模型自评分代表创造力。物理/资源幻觉仍明显，未证明创新质量成熟；本轮停止，不自动开发V3/V4。REA仅源码预研，当前Node补丁版本低于其要求，未安装执行。

详见 [本轮入口](docs/engineering/creativity-v2-2026-10-30/README.md)、[质量审阅](docs/engineering/creativity-v2-2026-10-30/QUALITY_REVIEW.md)、[真实测试与账目](docs/engineering/creativity-v2-2026-10-30/TEST_REPORT.md)。本机隔离预览 http://127.0.0.1:3207/#home → 物品 → 让它多一种可能。剩余：创意价值/物理推理不可靠、案例覆盖窄、真人盲评未做、REA未实测；下一阶段转整体Agent体验与授权设备探索基础。

### 完整产品基础收口（未合并 main）

分支 codex/wujian-product-foundation-v1，基准创造力V2 a24bfd7。陌生SKU真实界面录入与官方资料索引连通、英文说明书检索遗漏修复；保留单轮操作校验、快速事实问答与流式实验源码。自然事实综合仍会编造结论，WUJIAN_EXPERIMENTAL_FACT_QA 默认关闭，未为交付而默认发布。

独立本机账号、家庭邀请/逐物品授权、已读/接手/用户报告完成、赠礼独立实例及双向隐私通过生产浏览器；保留分身并验证本地纠正遗忘。REA 6.8.0 实际分析自有JS软件灯，经明确授权执行调光与回读；是软件模拟，非硬件验证。未换框架、重构创造力、迁移私人数据库、修改AGENTS或合并main。

371项离线、类型、生产构建、benchmark和新旧桌面/移动浏览器回归通过。150次真实百炼上游请求，548881输入/30350输出tokens，估算0.4998048元，已停付费。answered不等于正确；问答内容质量、完整响应目标及全产品五旅程未全部达标。用户已要求本轮正式结束，不自动启动下一轮重构。

本机可体验：http://127.0.0.1:3216/ （独立账号，费用关闭）。[交付与截图](docs/engineering/product-foundation-2026-10-30/README.md)、[测试与性能](docs/engineering/product-foundation-2026-10-30/TEST_REPORT.md)、[失败原文](docs/engineering/product-foundation-2026-10-30/MODEL_SAMPLES.md)、[环境](docs/engineering/product-foundation-2026-10-30/ENVIRONMENT.md)、[恢复点](docs/engineering/product-foundation-2026-10-30/HANDOFF.md)。

## 2026-10-29

### 最新交接：商品、关系与可选分身纵向版（未合并main）

独立分支 `codex/wujian-personal-objects-v1`，基准行为版 `d02b35e`，工作区 `D:/ProductAgent-LifeContext/.runtime/personal-objects-app`。请先读[本轮可体验流程及明确限制](docs/engineering/personal-objects-2026-10-29/README.md)、[测试报告](docs/engineering/personal-objects-2026-10-29/TEST_REPORT.md)和[真实回答](docs/engineering/personal-objects-2026-10-29/MODEL_RESULTS.md)。原项目与私人数据库未修改，没有迁库、换框架、操作硬件或合并main。

已接入三款经核对商品的认识与明确持有、公共知识/个人状态分区、图文故事确认关系记忆、可选名字/六种形象/语气与统一Agent交流、来源撤回和隐私检查。新增8项，315离线通过；类型/构建/benchmark、既有6浏览器旅程、公开演示8组离线检查与生活/文件两旅程通过。本轮真实百炼14请求/14返回，输入65004、输出4571tokens，估算0.0611452元；预览后续操作继续累计40次/10元台账。

**技术流程通过不等于产品效果通过：商品个性化帮助仍回退资料，分身错称用户、混合问题漏答、摆放建议缺乏实物依据仍未解决。** 下一轮先修回答与行动建议的证据衔接和角色身份，不扩大功能、换框架或宣称实体方案安全。以下保留历史记录。

### 智能核心 Alpha（独立分支）

- 新增两款型号明确的官方商品知识实验与显式合成测试入口；详情、聊天和创意共用资料。
- 自然聊天可建议有原话来源的记忆候选，确认前不作为长期认识；保留私密、纠正与遗忘。事实型赠送者回忆避免编造留言。
- 创意新增性质到作用/成果/条件结构，修复勾选物品被部分名称匹配删除、否定粘贴误判、引用命名空间和修复上下文隐私；明确否决不取回坏草稿，不自动用观察模板冒充新用途。
- 增加24项离线回归、商品来源解析、同模型真实对照与桌面/移动验收脚本。创意真实质量未过关；[交付与完整证据](docs/engineering/intelligence-alpha-2026-10-29/README.md)。

### 框架实证与共享物品资料切片

- 在独立实验子包比较 LangGraph、Mastra、Pi Core/Durable；继续使用 LangGraph，未替换框架或根应用依赖。
- 选择性移植未合并 v1 的物品读取、工具回合、路由/否定、条件和失败处理修复与测试，重新验收；不是声称 main 原有能力。
- 新增共享物品资料安全投影与内容快照，连接聊天、创意和故事；故事上云只带必要身份，不扩展记忆许可，不建新业务表。
- 265 项业务回归通过，新增跨会话赠画/遗忘/越权浏览器验收；真实百炼 42 请求，纸盒创意仍未达标，保留失败。
- 详细结果与直接开发清单见 [本轮交付](docs/engineering/framework-evidence-2026-10-29/README.md)。

### 智能行为与创造力实验版

独立分支 codex/wujian-intelligence-behavior-v1，从 Alpha 7c51317 开发，未合并 main。详见 [交付说明](docs/engineering/intelligence-behavior-2026-10-29/README.md)、[测试报告](docs/engineering/intelligence-behavior-2026-10-29/TEST_REPORT.md) 和 [匿名原始样本](docs/engineering/intelligence-behavior-2026-10-29/REVIEW_SAMPLES.md)。

已实现：完整型号资料综合问答、诚实摘录回退、两回合创意资源池子集、反馈主动再探索、收藏/结果/备注并发写入修复。真实浏览器的生成—展示—收藏—否定—再探索及桌面/移动端跑通。307/307离线、类型、生产构建、benchmark、6个集成旅程及8组公开演示替身检查通过。真实模型60次、57返回/3失败；已知usage估算0.2114072元，含无usage保守预留合计0.49414元，额度耗尽停止。

尚未实现：可靠的物理/动作语义验证或已证明的创造力提升。qwen3-max两次404，未启用。原始差样本、夹具错误和补测限制均保留；没有外部盲评或物理试用。下一步先解决创意机制错误，不扩展框架、数据库、数字分身或REA。本机独立预览费用关闭；凭证、SQLite、依赖和运行缓存不入Git。

## 2026-10-21

### [0.1.0] - 2026-10-21

### Added

- Next.js 15 / React 19 life-object workspace with an optional Chinese-language Agent.
- Versioned product evidence, manual ingestion, source tracking, and grounded help checks.
- Life stories, memory candidates, chapter organization, family tasks, gifts, and privacy controls.
- Offline rule-based ideas plus optional Qwen planning through an OpenAI-compatible provider.
- Docker/ModelScope configuration with isolated visitors, quotas, upload limits, and model cost gates.
- Idempotent synthetic showcase with 25 items, 4 ideas, 4 stories, and 2 chapters.
- Unit, domain, reliability, and browser acceptance test suites.

## 未标日期的早期条目（原 Unreleased）

### Changed

- Reorganized the repository around a product-first README, product brief, architecture, demo guide, deployment guide, and validation record.
- Made `npm run dev` and `npm start` launch the working local demo with an isolated data directory.
- Consolidated ModelScope notes into maintainable documentation.

### Added

- Offline GitHub Actions validation for type checking, tests, and production build.
- Security, contribution, and third-party notices for public collaboration.
- A cross-platform offline test launcher that prepares the isolated runtime directory on a fresh checkout.

### Fixed

- Updated historical showcase assertions from 3 to the current 4 synthetic stories.
