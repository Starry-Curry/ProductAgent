# 开发记录

## 2026-10-30：统一家庭体验 Beta（独立分支，内容验收未全部通过）

基准 `codex/wujian-personal-objects-v1@113696effe5f7f162fe9dccfbdf0bb64a7737d55`，分支 `codex/wujian-unified-home-beta`，隔离工作区 `D:/ProductAgent-LifeContext/.runtime/unified-home-app`。保留原项目未提交的 `deliverables/`，未合main、迁私人数据库、换框架或控制硬件。

已接入固定7款真实SKU与模拟赠画、一键家庭加载和明确云端许可；实际取得各商品至少一份官方资料（含规格、说明PDF和真实失败记录）。首页→统一任务→相关物品/故事→分身→原任务的流程已连通。使用现有LangGraph/SQLite会话、授权、记忆及反馈；普通真实物品空间仍保留旧路径，未宣称已把任意真实家庭全部迁入新机制。

329项离线通过（新增14）；类型、生产构建、benchmark、原纵向6条替身浏览器旅程和公开演示8组离线检查通过。新家庭6次真实问答与反馈、桌面/移动页面实际跑通；移动端另一个合成角色的跨会话纠正、遗忘及越权阻止通过。真实模型52次请求，50次提供方返回、2次失败；API返回和引用检查不能代替内容验收。

**内容仍有明确失败：未登记材料、未经证实的空余空间/支撑、旋钮方向及过早重置等。** 强模型小样本没有实证收益，未采用替换。下一轮先解决依据与动作、资源条件之间的约束，不先加REA或换框架。[可体验流程与来源](docs/engineering/unified-home-beta-2026-10-30/README.md)、[测试](docs/engineering/unified-home-beta-2026-10-30/TEST_REPORT.md)、[真实回答与失败](docs/engineering/unified-home-beta-2026-10-30/MODEL_RESULTS.md)。下方历史记录保留。


## 2026-10-29 最新交接：商品、关系与可选分身纵向版（未合并main）

独立分支 `codex/wujian-personal-objects-v1`，基准行为版 `d02b35e`，工作区 `D:/ProductAgent-LifeContext/.runtime/personal-objects-app`。请先读[本轮可体验流程及明确限制](docs/engineering/personal-objects-2026-10-29/README.md)、[测试报告](docs/engineering/personal-objects-2026-10-29/TEST_REPORT.md)和[真实回答](docs/engineering/personal-objects-2026-10-29/MODEL_RESULTS.md)。原项目与私人数据库未修改，没有迁库、换框架、操作硬件或合并main。

已接入三款经核对商品的认识与明确持有、公共知识/个人状态分区、图文故事确认关系记忆、可选名字/六种形象/语气与统一Agent交流、来源撤回和隐私检查。新增8项，315离线通过；类型/构建/benchmark、既有6浏览器旅程、公开演示8组离线检查与生活/文件两旅程通过。本轮真实百炼14请求/14返回，输入65004、输出4571tokens，估算0.0611452元；预览后续操作继续累计40次/10元台账。

**技术流程通过不等于产品效果通过：商品个性化帮助仍回退资料，分身错称用户、混合问题漏答、摆放建议缺乏实物依据仍未解决。** 下一轮先修回答与行动建议的证据衔接和角色身份，不扩大功能、换框架或宣称实体方案安全。以下保留历史记录。

## 2026-10-29：智能核心 Alpha（本轮）

从功能基准1cb9764创建独立分支codex/wujian-intelligence-alpha，工作区D:\ProductAgent-LifeContext\.runtime\alpha-app。新增真实商品小样本知识、自然聊天的原话记忆候选与确认、事实型关系回忆保护、创意作用/条件契约与反例复核；修复物品范围丢失及修复上下文权限。没有迁库、换框架、合main或触碰硬件。

289项离线通过（新增24），类型/构建/benchmark/隔离API及桌面移动浏览器通过。真实百炼72次尝试/60返回/12传输失败；已返回用量估算0.199881元，失败用量保守预留9.092990元，预算累计9.292870元。**创意产品验收仍失败，不能声称优于直接千问。**

[业务交付与体验入口](docs/engineering/intelligence-alpha-2026-10-29/README.md)、[真实失败与对照](docs/engineering/intelligence-alpha-2026-10-29/MODEL_RESULTS.md)、[完整测试](docs/engineering/intelligence-alpha-2026-10-29/TEST_REPORT.md)。以下保留上一轮报告。

---


## 2026-10-29：框架实证与首个共享物品切片

从 main `ea32c3f` 开独立分支，研究 RFC `69eb7c8` 和 v1 `8eca3d7`。框架实测收敛为继续 LangGraph；Mastra/Pi 留在独立实验子包，不进入根应用依赖。

实际改动：移植 v1 的有效工具、上下文、路由与条件修复及测试；新增 `context/knowledge.ts`，复用当前物品登记与产品资料，为聊天、创意和故事提供统一安全投影。快照不是持久版本或授权；记忆继续独立许可，故事模型只拿身份。

265 项业务测试、类型、benchmark、构建、cloud 替身、新版浏览器与新增赠画旅程通过。真实百炼 42 请求，估算 ¥0.0196844：工具和显式赠送事实可用；纸盒创意仍不合格，不能以 HTTP 200 或本地降级宣布成功。没有人类盲评、私人数据迁移、真实设备操作。

完整 [证据/失败](docs/engineering/framework-evidence-2026-10-29/TEST_REPORT.md)、[简短决策](docs/engineering/framework-evidence-2026-10-29/DECISION.md)、[下一轮源码清单](docs/engineering/framework-evidence-2026-10-29/NEXT_IMPLEMENTATION.md)。后续直接做关系来源与创意动作语义，不再扩展框架研究。


## 2026-10-29 智能行为与创造力实验版

独立分支 codex/wujian-intelligence-behavior-v1，从 Alpha 7c51317 开发，未合并 main。详见 [交付说明](docs/engineering/intelligence-behavior-2026-10-29/README.md)、[测试报告](docs/engineering/intelligence-behavior-2026-10-29/TEST_REPORT.md) 和 [匿名原始样本](docs/engineering/intelligence-behavior-2026-10-29/REVIEW_SAMPLES.md)。

已实现：完整型号资料综合问答、诚实摘录回退、两回合创意资源池子集、反馈主动再探索、收藏/结果/备注并发写入修复。真实浏览器的生成—展示—收藏—否定—再探索及桌面/移动端跑通。307/307离线、类型、生产构建、benchmark、6个集成旅程及8组公开演示替身检查通过。真实模型60次、57返回/3失败；已知usage估算0.2114072元，含无usage保守预留合计0.49414元，额度耗尽停止。

尚未实现：可靠的物理/动作语义验证或已证明的创造力提升。qwen3-max两次404，未启用。原始差样本、夹具错误和补测限制均保留；没有外部盲评或物理试用。下一步先解决创意机制错误，不扩展框架、数据库、数字分身或REA。本机独立预览费用关闭；凭证、SQLite、依赖和运行缓存不入Git。
