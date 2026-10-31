# 34案逐案工程复核

不是模型自评分，也不是独立真人盲评。按原任务expected核心事实与所问子问题审阅；扩写未证实与已发现错误分开标注。覆盖率不能证明事实正确，拒答也不能算完成。资料为空与推理失误见备注。取QA-05/06/11定向复测，其余保留首轮；不是把整个34案冒充最终源码一次性回归。默认路径另见default-eight-v1与gate-fixed-v1。

| 案例 | 物间关键事实/覆盖/完成 | 直接千问关键事实/覆盖/完成 | 物间断点 | 对照断点 |
|---|---|---|---|---|
| QA-01 | correct; 2/2; pass | unverified_expansion; 2/2; partial | 2秒开机、首次自动配对。 | 核心开机正确，扩写充电/App自定义按键及状态细节未逐主张有据。 |
| QA-02 | correct; 2/2; pass | wrong_inference; 2/2; partial | 后续配对5秒及设备选择步骤。 | 核心5秒正确；附带短按电源确认开机等无据/错误指导。 |
| QA-03 | unanswered; 0/2; fail | correct; 2/2; pass | 资料有短按/长按区别，有限原子索引未覆盖。 | 核心短按减音量、长按上一首正确；附带重置措辞另需区分初始化。 |
| QA-04 | correct_limited; 1/2; partial | wrong_inference; 2/2; partial | 本地安全停用；没有明确针对湿耳机给出处。物间上游0次，不能称真实模型回答。 | 正确阻止湿态充电；编出2—4小时、IPX0和清洁剂等结论。 |
| QA-05 | correct_unknown; 1/1; pass | wrong_inference; 0/1; fail | 修复null后明确证据不足；不能从未提及推否定。 | 先说不能从缺席否定，后又以未出现特性为不支持的证据。 |
| QA-06 | correct_unknown; 1/3; partial | wrong_inference; 0/3; fail | 未编造政策，但未知项合并为未覆盖提问，拆修风险/保修覆盖仍不清楚。 | 一拆即失保、通常不修电池、费用比、12小时充电等均未获所给政策支持。 |
| QA-07 | correct; 4/4; pass | wrong_inference; 4/4; partial | 开机、暂停、音量、再次配对均覆盖。 | 四问覆盖但额外宣称再次配对必须开机不能关机，及无据状态/方向。 |
| QA-08 | unanswered; 0/2; fail | unverified_expansion; 2/2; partial | QSG有相关防护文字但PDF图标受损，索引又不覆盖，未回答。 | IP67核心正确；冲洗/盐水维护政策未在逐案资料核对中证实。 |
| QA-09 | unanswered; 0/3; blocked_source | wrong_inference; 2/3; fail | 产品页未取到，QSG仅有12小时；Boost资料未在该模型快照中取得。 | 明确否定15小时/Boost，说第三方误传。后续独立官方规格核对反驳了该结论。 |
| QA-10 | unanswered; 0/2; blocked_source | wrong_inference; 0/2; fail | QSG图示不足以完成连接模式语义问答；不能据未提及否定。 | 错误否定双机立体声/Auracast并改称PartyBoost。 |
| QA-11 | correct; 2/2; partial | wrong_inference; 2/2; partial | 1节AA正确，但多拆一个battery_count后又说未知，令人困惑。 | 数量规格正确，追加无据的充电电池不兼容结论。 |
| QA-12 | unanswered; 0/2; fail | unverified_expansion; 2/2; partial | 已有接收器N/A字段，但模型选的谓词与有限索引不匹配。 | 接收器结论有依据；扩大为全地区Unifying/不卖替换接收器等政策。 |
| QA-13 | unanswered; 0/2; fail | unverified_expansion; 2/2; partial | 型号产品页有场景模式；协议/有限索引退回无关摘录。 | A+/SCN有据，但加入模式/菜单路径等未在本轮证据确认的细节。 |
| QA-14 | unanswered; 0/2; fail | unverified_expansion; 2/2; partial | 有来源仍被有限字段挡住，没完成手机联动问答。 | 传图与遥控核心成立，扩写照片删除、遥控全部参数等未核。 |
| QA-15 | unanswered; 0/2; fail | scope_overreach; 2/2; partial | 最初被当事实字段问答，无旋钮属性索引。真实B旅程的操作路径已另外复测。 | 亮度/色温动作正确，却扩展为全球所有地区适用及未核参数。 |
| QA-16 | unanswered; 0/1; fail | correct; 1/1; pass | 官方规格2.4GHz存在，但有限字段没覆盖。 | 2.4GHz有直接规格依据。 |
| QA-17 | unanswered; 0/1; blocked_source | correct_unknown; 1/1; blocked_source | 支持页跨站跳转未读到正文；4次模型请求后仍不可用，属于检索失败叠加调用浪费。 | 明确没有此型号清洗正文；随后通用流程不算该型号验收完成。 |
| QA-18 | correct; 1/2; partial | unverified_expansion; 2/2; partial | 明确未批准食品接触；没给替代容器原则。 | 未批准食品接触判断正确；额外认证标识/法规结论无资料支持。 |
| QA-19 | unanswered; 0/2; fail | unverified_expansion; 2/2; partial | 有官方锚固警告，却未能利用。 | 锚固要求正确；多国强制标准及墙体细则未在提供来源核对。 |
| QA-20 | correct; 2/2; pass | wrong_inference; 2/2; partial | 170—290g，且不把重量满足当完整兼容。 | 重量正确，却说说明书未列宽厚；实际同一V1.8手册有67—84mm/6.9—10mm。 |
| QA-21 | unanswered; 0/2; blocked_source | wrong_inference; 1/2; partial | 应用FAQ只取到31字符空壳。网页工具另能读NZ站，不能冒充已进入模型输入。 | 避雨方向合理，但依据是手册没提防水、猜USB无胶塞；不等于官方明确反驳。 |
| CONSTRAINT-01 | unanswered; 0/2; fail | unverified_expansion; 1/2; partial | 单物品上下文/原子投影没完成相机与手机云台兼容任务。 | 拒绝直接夹相机方向正确；无任意第三方适配器等市场断言无据。 |
| CONSTRAINT-02 | correct_limited; 1/2; partial | wrong_inference; 1/2; partial | 复述170—290g，但没有明确完成310g超限判断。 | 310>290判断正确；对宽厚范围继续猜测且说说明书未列。 |
| CONSTRAINT-03 | unanswered; 0/2; blocked_scope | wrong_inference; 0/2; fail | 只选盒子进入单物品上下文，缺另一件物品净格证据。 | 擅换KALLAX型号，编造39.5cm净格并保证可放。 |
| CONSTRAINT-04 | correct; 1/2; partial | unverified_expansion; 2/2; partial | 拒绝食品用途的事实正确，未给合适替代路线。 | 食品接触拒绝正确，列出未经资料确认的认证/品牌适用性。 |
| CONSTRAINT-05 | unanswered; 0/2; fail | unverified_expansion; 2/2; partial | 原子路径不适合带授权前提的自动化规划。 | 没声称已执行，但配网长按/平台与设备必要条件未核。 |
| CONSTRAINT-06 | unanswered; 0/3; fail | wrong_inference; 0/3; fail | 事实路径截断跨物品任务；另见真实开放创意旅程，其物理机制仍失败。 | 把PP盒称亚克力、1S换成Pro、编造支架和额外白纸。 |
| CONSTRAINT-07 | unanswered; 0/3; fail | wrong_inference; 0/3; fail | 没组织净尺寸、稳定和现有资源；不是HTTP失败。 | 外框推净格、虚构多层与额外器材、胶带/纸板材料。 |
| CONSTRAINT-08 | unanswered; 0/2; blocked_source | not_returned; 0/2; fail | DJI防水FAQ未取到，JBL来源不完整，又退回摘录。 | 上游finish_reason=length，应用正确拒绝当作完整回答；不是事实正确通过。 |
| CONSTRAINT-09 | unanswered; 0/2; fail | wrong_inference; 1/2; partial | 不能仅用原子索引完成稳定性条件推理。 | 以未设计/未提及推不可行，未给载荷/重心却断言必然倾倒。 |
| PERSONA-03 | unanswered; 0/2; fail | wrong_inference; 0/2; fail | 没有虚构经历，但未自然解释当前缺少本人故事。 | 未提供故事，仍写出用户过去的摄影心境和被物品记得的经历。 |
| PERSONA-07 | unanswered; 0/2; fail | wrong_inference; 1/2; fail | 答食品接触，未回答数字身份能提供什么帮助。 | 3个14cm盒高被写为92cm，并虚构当前3D能力/退货政策。 |
| FAMILY-10 | unanswered; 0/2; fail | wrong_inference; 1/2; fail | 倾倒状态没进入有效安全处置，暴露路由与关键条件断点。 | 方向有安全意识，却虚构未固定即不在保修、配件和墙体政策。 |
| AGENT-02 | correct; 2/2; pass | wrong_inference; 2/2; partial | 一轮完成1节AA事实，没绕REA或创造流程。 | 电池核心正确；附加充电电池不支持等无据结论，短问长答。 |
