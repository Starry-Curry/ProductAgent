# 家居案例扩充与一次性介绍（2026-10-18）

## 本轮判断与修改

日常新增记忆以**与具体物品对话**为主；记忆区承担展示、来源解释、纠正、忘记和授权管理。首次使用时提供一次可跳过的自然背景介绍，保存或跳过后不再出现。已经在对话里形成个人故事/兴趣的用户也不再被提示重新介绍。遗忘介绍正文不会重新开启介绍流程。

已移除网页中的“手动补充（可选）”“直接写下一段记忆”和额外的私人记录表；原来的私人物品求助表改为跳转物品对话。既有固定帮助设置仅为已设置用户保留纠正入口；新用户不再看到指导方式/使用经验表。记忆纠正仍可编辑现有内容，陪伴开关继续保留。

底层已有 memory/saveMethod/importStory 接口暂保留兼容；网页日常流程不再用它们收集新画像。新的介绍接口在服务端执行一次性校验和幂等控制，不能靠刷新反复新增介绍。

## 家居资料与案例

新增 **8 件演示物品、16 段合成故事、24 条案例记忆、4 条示例家庭事项、2 个示例计划**。新增 7 个官方资料包，复用已存在的 RÅSKOG 资料；知识目录总计 **11 个版本包、33 条事实、2 个有限预审过程**。案例由项目构造，商品事实核对自以下官方页面；没有使用网上个人故事或真实用户画像。

| 生活案例 | 商品/型号与资料地域 | 来源 |
| --- | --- | --- |
| 早晨给家人泡杯茶 | Xiaomi Electric Kettle 2；UK 页面规格 | [小米 UK 官方规格](https://www.mi.com/uk/product/xiaomi-electric-kettle-2/specs/) |
| 周末一起准备晚餐 | Xiaomi Smart Air Fryer 6.5L，MAF10；UK | [小米 UK 官方规格](https://www.mi.com/uk/product/xiaomi-smart-air-fryer-6-5-liter/specs/) |
| 给阅读角留一点安静 | Xiaomi Smart Air Purifier 4 Lite，AC-M17-SC；Global | [小米全球官方规格](https://www.mi.com/global/product/xiaomi-smart-air-purifier-4-lite/specs/) |
| 十分钟收拾家的角落 | Xiaomi Vacuum Cleaner G20 Lite，C203；Australia | [小米澳大利亚官方规格](https://www.mi.com/au/product/xiaomi-vacuum-cleaner-g20-lite/specs/) |
| 小边桌上的晚间阅读 | IKEA LACK 黑色边桌，003.529.88；中国 | [宜家中国商品详情](https://www.ikea.cn/cn/zh/p/lack-la-ke-bian-zhuo-hei-se-00352988/) |
| 让手作和照片各有位置 | IKEA KALLAX 白色带门搁架，793.840.57；中国 | [宜家中国商品详情](https://www.ikea.cn/cn/zh/p/kallax-qia-lai-ke-dai-men-ge-jia-dan-yuan-bai-se-s79384057/) |
| 从第一本书到一家人的书架 | IKEA BILLY 白色书架，005.220.47；中国 | [宜家中国商品详情](https://www.ikea.cn/cn/zh/p/00522047/) |
| 把手作材料推到身边 | IKEA RÅSKOG 米色推车，306.297.11；UAE | [宜家 UAE 商品详情](https://www.ikea.com/ae/en/p/raskog-trolley-beige-30629711/) |

核对日期为 2026-10-18。保留来源地域、货号、版本与有限适用范围，不把系列名作为实物型号证明。KALLAX 页面标题的 77×77 为名义规格，资料包记录的是详细尺寸 76.5×39×76.5 厘米。书架/搁架的固定要求独立保留，载荷资料不等于现场已经安全。

每组案例都围绕生活目标，而不是只增加商品卡片：例如水壶关联搬家后给家人泡茶的故事、相处关系与交流方式；书架关联旧书、家人的留言与待核实固定事项。全部生活片段与偏好均有“演示”标记，并非实际持有、购买或使用记录。

## 怎么体验

1. 首页展开家居案例（默认展示 4 个，点击可看全部 8 个）。点“查看资料与帮助”，选择一个问题再发送，例如容量、净重、覆盖面积、承重、固定要求。来源匹配的事实可以离线回答并查看官方链接。
2. 点“和它聊聊”，先填入“聊聊以前的故事”再发送，可回顾该案例的合成故事。继续讲述后会形成该演示物品的新记录，带演示范围标记。
3. 在案例物品的记忆区查看、纠正或忘记；刷新和重启不会重新填回已忘记的案例记忆。首页默认显示自己的记忆，演示记忆通过独立按钮查看。
4. 想记录真实经历，添加自己的真实物品后直接与它对话。首次介绍是可选的一次机会；日常无需再打开记忆添加表。

## 技术与数据边界

- v5 增量迁移增加 memory_introductions 与 demo_content_installations；升级前保存 .before-v4-to-v5.sqlite 备份。
- demo/install.ts 在数据库初始化后按版本追加保留 ID 的案例，已有用户记录不重置，已有相同 ID 不覆盖；安装回执阻止重复安装和遗忘复活。记忆使用稳定 UUID，使现有纠正/删除 API 可以直接工作。
- Item.demo、原故事 demo、MemoryRecord.demo 贯穿页面和服务端。原合成故事不会经后台提取进入真实画像；案例内新的讲述与喜好也绑定当前演示物品。
- 真实活动准备、资料组合和模型物品清单排除新增案例，防止系统把它们当成用户确实拥有的资源；案例故事只在对应案例召回，不跨案例/全局召回。
- 演示记忆纠正、删除、重复删除、到期、关闭案例对话和演示角色设置只清除该案例上下文，保留其他真实会话；跨标签页通知也携带案例范围。
- 演示记忆的 allowCloud 在写入与 Context Builder 两处限制，即使客户端尝试调整授权也不上云。真实记忆仍按原逐条授权规则处理。
- 首次介绍有按人状态、requestId 与 hash；保存/跳过均持久化，重复请求不会新增内容。它不强迫用户填写类型、技能或兴趣字段；仅在本机整理有限可识别线索。
- 所有原产品入口、家庭/礼物授权、型号核对、原故事时间线、已尝试反馈和有限规则闭环继续保留。没有新增付费模型调用、真实订单接口、设备感知或完整语义提取能力。

主要代码：catalog/household-products.ts、demo/household-cases.ts、demo/install.ts、memory/introduction.ts、MemoryCenter.tsx、HouseholdCases.tsx、experience-schema.ts。验证入口为 tests/household-cases.test.ts、tests/household-integration.mjs 与 npm run test:acceptance；后者自动隔离数据库并关闭真实模型。
