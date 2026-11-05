# 决赛产品升级：可运行版本与实际差距

**产品质量结论：NOT_ACCEPTED。** 这是一份可运行、可审查的研发交接，不是“所有功能已可靠完成”认证。Core/Full Foundation未放行，历史冻结首答0/18原样保留。用户要求的八小时持续研发已按实际工具时间达到，另见[最终工作记录](STATUS.md)及[保守计时证据](evidence/work-window-final-r1.json)；阶段提交不能冒充时间或质量达标。

## 用户可以实际做的事

- 登记未预置的真实型号，在已核对官网资料中问答、续问、查看逐步原文；已有明确成功，也有无法认证厂家/资料和模型误读的失败。THERMOS JNL-355三问修复后回答0.35L、约0.17kg、约6.5×7.5×17cm；M350s短按切已配对设备/长按进入配对的窄任务也实际回答正确。均为合成持有，不是操作实物。
- 从食品条码/ISBN公开库获得候选、核对后建档，保留众包来源和许可。真实ISBN为Fantastic Mr. Fox；作者独立展示，不充当品牌。图码测试使用生成QR，经浏览器ZXing真实解码；不能称已识别所有现实包装。
- 给物品保存私人故事、选择是否启用交流身份、明确授权记忆/云端使用；图书赠送来历与“尚未实际尝试”的反馈能够跨任务/会话复用。纠正、遗忘、撤权以及媒体读取边界均有反例/复验。分身不是常驻独立模型，也不认证想象的经历。
- 由生活目标进入原Task、讨论已有资源、预览并明确确认候选计划、记录结果。逐步条件与构想状态保留。复杂创意和物理组合仍不可靠，不能把候选卡/保存成功当作方案成立。
- 通过两个独立测试账号验证授权共享、精选赠礼故事及分离的新经历；原家庭/赠礼/记忆领域事务保留。REA 6.8只分析自有软件测试目标，在明确授权后写入/回读、幂等及撤权；没有真实硬件逆向、固件修改或联网设备控制。

这些增量来自物间的物品资料、权限、状态、个人经历和任务事务。直接给同款千问同样有效资料时，它的单次解释可以更简洁、更正确；本轮**没有证明物间总体智能质量胜过直接千问**。

## 怎么打开

当前隔离预览：[http://127.0.0.1:3242](http://127.0.0.1:3242)。新建自己的本机测试账号（口令至少12字），再明确加载“虚拟年轻人公寓”。所有八件持有/位置/私人经历均为模拟，商品型号与资料来源分别标注。不要将测试空间当正式私人数据库。

从GitHub恢复运行时使用Node24、`npm ci`。在本分支新工作区内：

```powershell
# 免费离线体验：页面、领域事务、已有资料；不产生模型调用
node scripts/finals/preview.mjs --offline --port=3242
```

需真实模型且仍在本轮有效授权内时，由应用安全配置鉴权（不要打印配置或Key）：

```powershell
$env:WUJIAN_EVAL_CONFIG='D:\ProductAgent-LifeContext\.env.local'
$env:NODE_USE_ENV_PROXY='1' # 仅当前进程；沿用本机网络设置
node scripts/finals/preview.mjs --port=3242 --rerank --vision
```

只允许一份当前账目/一个网关，不在其他副本重置或复制授权。新任务不自动继承本轮剩余额度。默认不记录预览对话正文；`--record-synthetic-evidence`仅限明确合成评测，不用于真实私人输入。当前默认思考/自然聊天实验关闭；`WUJIAN_EXPERIMENTAL_FACT_QA`与旧Kernel开关保持关闭。SSE为进度流及完成后发布正文，**不是逐字展示未经核对的动作草稿**。

隔离数据在`.runtime/finals-product-preview/`，构建在`.next-finals-product-release/`，均不进Git。原项目及其未跟踪`deliverables/`未改。账号登录态、私人照片/DB、依赖、缓存和密钥不提交。已误读的一条合成测试会话已立即撤销，见[撤销记录](evidence/synthetic-session-revocation-r1.json)；不删除其数据或证据。

## 本次实际检查

- 集中离线：[681/681](evidence/offline-regression-slice10-r1.txt)，类型：[最终源码检查](evidence/typecheck-slice10-r1.txt)，生产构建：[slice10-r1](evidence/build-slice10-r1.txt)。后续如仅文档变化不重跑全套；如果再改源码则重新确认覆盖范围。
- 团队独立功能：[公共服务Mock示例](evidence/team-example-slice9-r1.txt)可运行、确认反馈幂等、默认不允许云端。它不证明千问质量；旧抽取/契约[benchmark](evidence/benchmark-slice9-r1.txt)零真实调用，也不作为当前智能正确率。
- [费用与延迟快照](evidence/usage-summary-slice9-r1.json)：本轮368项模型/原生工具请求（含失败/重试），已知估算¥55.783876，未知用量另预留¥1.786268；上限800次、无金额上限。普通官网访问与模型列表读取不是计费推理。实际账单以服务方为准。
- 上游请求P50约4.124s/P95约33.332s；12个具名浏览器开发样本的完整可见答复P50约9.016s/P95约56.635s，混有失败兜底，**不是实际生活任务成功耗时或独立质量统计**。
- 默认真实冒烟：[原始输出](evidence/final-private-preview-smoke-r1.json)、[桌面](evidence/final-private-preview-r1-desktop.png)、[移动](evidence/final-private-preview-r1-mobile.png)；图书故事/任务/反馈：[记录](evidence/book-value-browser-r2.json)、[桌面](evidence/book-value-r2-desktop.png)、[移动](evidence/book-value-r2-mobile.png)。
- 全部真实失败、脚本错误、修复、首次/复测区别及原始链接见[逐案审阅](QUALITY_REVIEW.md)、[逐层F1–F12对抗覆盖](ADVERSARIAL_COVERAGE.md)。没有外部真人盲评、现实设备验证或“模型自评分证明创造力”的结论。

依赖层新增实测：Next15.5.28不变，PostCSS仅同主版本升级8.5.32；官方[审计后结果](evidence/dependency-audit-r3.json)为0项已知生产依赖漏洞，[恶意map回归](evidence/postcss-security-r1.txt)只使用自造无敏感内容文件。[最终生产包浏览器](evidence/production-browser-smoke-r2.json)、[桌面](evidence/production-smoke-r2-desktop.png)、[手机](evidence/production-smoke-r2-mobile.png)在新隔离目录完成录入/数量0/状态同步/匿名401，关闭模型与公开抓取，0费用；不是重复宣称Qwen成功。

审查入口：[草稿PR #3](https://github.com/Starry-Curry/ProductAgent/pull/3)，base为文档分支，依赖PR #2/#1。786bf55的Validate #7已成功；后续提交的CI必须按对应SHA另看，不能借用旧绿灯。原始评测、复测、依赖失败与恢复证据均保留。

## 仍阻止可靠产品的缺陷

1. **来源自主发现覆盖不足**：Fellow/HOTO等缺可认证身份链；网页/PDF/版本资料可能取得不全。路径不再冒充型号证明，但这也可能降低部分合法资料召回。没有承诺任何陌生品牌均成功。
2. **读到资料仍会误解或扩写**：M350首答曾给关机长按、后来加无依据电池限制；家庭台灯扩展不必要重置；KORG仍有版本和功能解释风险。原文卡只是让错误可检查，不能认证翻译语义。
3. **复杂行动不能信任**：曾推荐花束自立、未知画框倚靠、额外书本/支撑、超重短试。确定性条件能拦截明确失败参数，却不能证明自然语言步骤的机制与隐含资源。思考模式约52–57s仍失败，未默认采用。
4. **长期认识尚不够自然**：授权、记忆来源与更正可传递，但兴趣建议仍可能出现科学事实错误、漏目标或过度追问。用户报告不证明成功原因；跨时间经验语义的适用性仍需更多独立任务验证。
5. **范围仍有原型**：照片仅合成铭牌测试、条码仅两个社区库、REA仅自有软件、赠礼图片传承与真实硬件未完成；没有因F1–F12存在入口而宣称全实现。

下一轮最值得投入的是：用少量新任务验证“完整自然回答与动作依赖如何统一”，以及通用的来源主体/版本判断；保留已有身份、业务事务和共享Context。不要先增加页面、扩大品牌白名单或用第二个模型赞同充当认证。正式质量门槛继续保留，不降低分数、不覆盖首答。

[最终源码检查与CI](evidence/final-checks-r1.json)确认`7a19e30`的Validate #8成功。后续仅交接文档/证据更新；全产品仍未放行，需独立组员审查。

## 团队与恢复

[公共接口接入](../TEAM_INTEGRATION.md)仍以`src/lib/foundation/services.ts`为入口。Provider可选重排、AssistantReply可选逐步原文、目录候选可选creators均为增量字段；业务模块不直接读密钥/内部运行器。旧计划/原文/故事/账号数据保留，本轮不迁移私人数据库或增加Runtime。

研发分支：[codex/wujian-finals-product-v1](https://github.com/Starry-Curry/ProductAgent/tree/codex/wujian-finals-product-v1)。它依赖文档PR #2及团队PR #1；不改两者，不合并main/develop。阶段恢复点包括`5198dd9`、`947fd98`。需要恢复时从固定SHA另开worktree/分支，指向新的隔离测试目录；不要reset当前工作或回滚私人数据库。现有本轮数据目录与所有历史费用/失败证据保留。
