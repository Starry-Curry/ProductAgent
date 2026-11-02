# Qwen-first 统一底座：执行状态

基线：远端 `codex/wujian-outcome-qwen-v3@c18b26d758af9281677150c513d9225a19bb4e67`，2026-11-02实际核对；main为ea32c3f。工作区 `.runtime/qwen-foundation-v1`，分支 `codex/wujian-qwen-foundation-v1`。原项目未跟踪deliverables与上一轮工作区保留。产品定稿、Instructions不改。

本轮授权：用户批准150次/80元，含只放公开商品资料的临时百炼知识库（预留最多10元）；首批技术证伪最多12次/8元。实际用量以evidence/model-calls.json为准，Gate0/1检查点真实上游调用0次。旧250次轮次不续用、不修改。

Gate0与Gate1已通过离线保护门槛；完整回归519通过、0失败/跳过（gate1-regression-final.txt）。**这不是Gate2–4真实模型/浏览器质量验收。**

## Gate 0：调用链和故障复现

```mermaid
flowchart TD
 UI[首页、物品与统一对话] --> Service[会话与Task/Run事务]
 Service --> Router[graph当前路由]
 Router --> Native[Native Practical：工具循环]
 Router --> Kernel[实验Kernel：草稿与二次审核]
 Router --> Home[HomeTask：家庭专用循环]
 Router --> Old[原Graph：领域处理与旧模型循环]
 Creative[创意入口] --> Planning[planning → ideas → open-exploration]
 Native --> Context[Kernel Context聚合]
 Context --> Items[State.items：实例身份与状态]
 Context --> Sources[life_knowledge_documents：原文和型号范围]
 Context --> Personal[memory / stories / Outcome：按用途授权]
 Context --> Policy[foundation授权 + legacy共享兼容]
 Planning --> Heuristics[名称正则能力 / 正文词项候选 / 实例属性]
```

这张图描述**本轮基线**，不是声称已经完成收敛。service还有已确认步骤续接短路；旧Graph保留的故事、准备清单、安全和事务不能随循环直接删除。

已由源码和隔离fixture确认：

1. Practical空ID读取前八件，和相关物品混合。修复为空ID只展开已选相关物品；检索发现将在共享compiler按目标处理。
2. planning按“纸/灯”等名称把无能力事实的纪念物推为照明/记录；已删除此段名称正则，改消费同一个实例/pack事实投影。
3. 正文 `does not support playback` 仍被documentCapabilities作为声音播放候选：必须退役词项式能力提取，而非加一串否定词补丁。
4. 过期foundation授权在Kernel拒绝，但仅用canRead的底层共享reader可返回实例。已统一有DB读取到authorize；无DB纯投影只能读所有者数据。合法跨人业务必须提供DB，不扩大共享。

模型、工具和协议还未因本轮修改获得真实质量验收。首次复现的手造会话缺owner/identity导致409，属于测试fixture错误，日志gate0-repro-before保留、排除产品归因；改为真实respond生命周期后，gate0-repro-fixture-corrected才是前八件与名称推断问题的有效红测。

基线npm test：489通过/0失败/1跳过（本工作区未配置既有REA工具），不是“490全通过”。原始数据用validationFixture独立SQLite；未复制私人数据库。准确型号必须在item.model，物理事实在attributes.physicalFacts；测试先断言这两个字段，避免重犯输入错误。

## 后续门槛

- Gate1：共享语义投影、任务相关compiler、来源/修正/撤权/冲突负例；通过后才进入下一门。
- Gate2：首批12次/8元比较成熟工具与真实路径；依据结果替换重复通用机制。未建KB/未读文件不能算成功。
- Gate3：四条真实App旅程与负例。
- Gate4：独立冻结6SKU×3问题至少15/18首答，零严重错误；质量/成本对照及旧路径实际退役。

冻结集由分离的验收子任务建立，开发不读取标准答案；历史污染题不作为本轮盲测。阶段提交是恢复点，不是ACCEPTED。

## Gate1 实际代码与减法

- `context/reality.ts`从原Item/已确认商品pack生成事实、条件化能力、来源、未知、冲突及修订；不新增平行数据库。用户报告≠官方事实≠模型假设≠实物回读。官方pack目前没有生产程序步骤，新适配程序测试明确是合成契约。
- `context/compiler.ts`迁入原Kernel有效的权限/型号/相关原文与经历聚合，删除原`agent/kernel/context.ts`；两个位置不会长期各养一套。发现目录按目标和明确身份匹配，没有匹配不取前八件，具体读取仍再次鉴权。
- `modelReality`用来源字典与短语义卡传输，原始事实/说明书没有被摘要覆盖。事实值、依据、冲突及原文指针均有传输完整性测试；尚不宣称实际Token与答案质量改善，留给Gate2同模型实测。
- `affordances`、`creativeFacts`、开放探索和Practical共用该投影；删除重复物品/pack解析和名称能力正则。`documentCapabilities`词项提取被删除，替换为保留原文的`documentEvidence`候选；出现playback不再自动得到正向能力。
- 图文读取显式区分html_text/pdf_text_layer/unknown；PDF不可经网页抽取路径冒充读图。官方来源的型号/地区/厂家链接范围成为统一的`evidence-scope`服务，文字、读页与读图使用同一边界。
- workspace/life/collaboration的当前可见物品统一DB授权；过期/撤回后当前引用不可执行，本人历史文字与原始数据库不删。真实Request handler的独立账号测试通过，不当成浏览器。

回归曾发现两项：紧凑传输改变了结构，新测试的整对象镜像断言改为逐事实/来源完整性；旧光影任务fixture只有名字没有能力，补充明确标记的合成照明报告后继续测其原有反馈/排除/权限行为，另保留名称不能证实功能的负例。第一次514项回归的2个失败日志保留，冻结新验收题未改。

实验V3/HomeTask/旧Graph尚未退役，属于Gate2替换后的必要工作，不用本次Context迁移冒充所有Runtime已收敛。
