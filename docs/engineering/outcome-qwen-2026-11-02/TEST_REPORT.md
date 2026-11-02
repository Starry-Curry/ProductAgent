# 实测记录与恢复

当前状态：**BLOCKED_AUTHORIZATION；产品NOT_ACCEPTED**，具体失败不因以下工程通过而消失。产品判定见[QUALITY_REVIEW](QUALITY_REVIEW.md)。

## 执行环境

Windows、Node24.22.2、当前锁文件、Next15.5.28。独立worktree`.runtime/outcome-qwen-v3`，分支`codex/wujian-outcome-qwen-v3`，初始基线f0e3114。依赖复用既有同锁文件目录；未改全局Node/Git。真实持有人全部为合成账户，数据目录`.runtime/outcome-preview`及逐场景隔离SQLite；无私人数据库拷贝或迁移。

## 实际命令

| 命令/脚本 | 证据与结果 |
|---|---|
| `npm test` | baseline-offline.txt：479通过；regression-slice1.txt：3失败，定位为旧协议/回合数/先搜索后种子断言。最后完整回归regression-artifact-free.txt：490通过、0失败，实际暂移本工作区可再生artifacts后运行，并已完整恢复（artifact-free-verification.json）。随后本机记忆限定当前物品、工具Schema计入调用预算的定向复验final-targeted-review.txt：15通过、0失败。 |
| `npm run typecheck` | final-typecheck.txt及最终typecheck-closeout.txt；最终构建自动生成配置已恢复仓库版本再检验。 |
| `npm run test:benchmark` | benchmark-final.txt，离线、真实模型0次，regressions=0；不能当真实商品智能验收。 |
| `WUJIAN_BUILD_DIR=... npm run build` | 各阶段构建及最终build-final-snapshot.txt通过，使用.next-outcome-final-snapshot，包含最后的本机记忆限定与调用预算修复。regression-final-reviewed.txt曾因新增测试未迁移foundation_grants表失败，已修正测试初始化并保留失败记录，没有放宽权限实现。 |
| `scripts/outcome/creative-suite.ts`、`direct-suite.ts` | 12题基线、直接与候选原始结果；单独台账逐请求计费；不是浏览器或实物验证。输入脚本错误的两批明确标无效，未删原文或费用。 |
| `responses-probe.mjs`、`native-targeted.ts` | 基本流、实际搜索、闭合范围抽取成功；开放式抽取两次150秒失败保留。 |
| `runtime-compare.mjs` | 真千问下SDK/AgentScope同一小工具任务；2次模型/1次工具，不夸大一例为泛化优势。 |
| `browser-knowledge.mjs` | knowledge-first记录6个新型号；r2—r5保留问题导向检索、范围与导航修复的每次失败/部分回答。页内型号由用户正常录入，不提供官方URL，未把“answered”计为正确。 |
| `browser-journey.mjs` | open-plan-r1超时；open-plan-r2-fast完成自然目标、确认计划、同Task、合成反馈与下一Task；open-story-r1-fast完成自然故事、确认、同Task后续及隐私断言。 |
| `business-browser.mjs` | business-r2在本机关系召回失败；定位后修复。business-r3真实独立账号、关系纠正/遗忘、家庭接手、赠礼独立实例、私人信息不回流、既有软件REA授权/回读/撤权及390px界面通过。软件灯42不是实体灯。 |
| `browser-lifecycle.mjs` | lifecycle-and-changes：纠正、撤权、遗忘实际业务通过；只改备注不触发物理重核，改尺寸后实际标出第1/4步（4步中2步），0次新增模型。这证明局部依赖提示可用，未比较真人耗时。 |
| `cached-search-fetch.ts` | 实际公开网络+之前真实搜索URL缓存、0次新增模型。仍未取得目标Philips手册，失败原文保留。支持页CDN联册的通用修复有离线测试，尚无模型预算完成真正端到端复验。 |
| 最终构建浏览器冒烟 | final-offline-smoke.json：当前最终构建真实注册、进入首页，桌面/390px移动截图，无页面异常或横向溢出，新增上游请求0。仅证明离线恢复入口可运行，不是新的千问质量验收。 |

测试目录在[evidence](evidence/)。旧失败日志均保留。多进程浏览器期间按全局台账差计算的请求数只能叫“该时间窗请求”，不能归属于某一旅程；准确总账见SUMMARY/model-calls，分组模型请求有evaluation标签，浏览器还保留实际工具trace和原始问题。

提交检查保留控制台原始日志中的尾随空白与末尾空行，未为风格检查修改测试输出；`git diff --cached --check`对这些日志有告警。排除本轮evidence原始产物后的源码、脚本与说明文档检查通过。秘密扫描未发现凭证模式、私人数据库或构建缓存待提交。

## 新增验证重点

任务外资源目录与私密详情分离；动作隐含资源/已知数值/权限；未完成草稿不发布；条件变更确认阻断与逐步标记；原生SDK分片/授权/无终态；流连接后仍有整段超时；厂家实际单URL联册授权而非整个CDN放行；大站导航不吞正文链接；本机私人关系不传云端、不经下一轮历史泄漏；危险状态不允许改称配重继续使用；工具失败未恢复不标完整回答；引用和资源ID动态绑定。均区分离线替身与实际Qwen。

## 费用和性能

轮次`outcome-qwen-20261102-r1`，250次上限已经达到：245返回、5失败、0在途；返回不代表质量通过。已知用量输入1,164,245、输出160,821 Token，不包含失败未知用量。估算33.608168元，包含13.227672元保守预留；不是供应商账单。原生工具及PDF页费用计入，未知不按零元算。

详细[SUMMARY.json](evidence/SUMMARY.json)、[逐调用台账](evidence/model-calls.json)、[授权](evidence/authorization.json)。历史授权中列出的台账SHA全部保持一致。本轮最后请求用于真实ID绑定契约试验；不另开轮次规避250限制。

完整响应而非首字延迟：同思考设置下f0执行器P50/P95=58.3/88.1秒，直接模型27.1/43.9秒，候选86.3/175.0秒；R3关闭强制思考后11.6/13.8秒。后者不同配置，且质量未过，不作为同条件性能胜出或完整有效任务成功率。

## 恢复与未完成

源码恢复点b782c02（冻结/清理）、24941d1（原生工具与动作依赖中间版本），其后实际提交见当前分支历史。不要reset旧工作区；从需要的SHA另建worktree。当前分支HEAD是可恢复工程结果，**不是已验收产品发布**。所有原始模型输出与匿名样本保留，真人盲评未执行。

未完成：4/6陌生型号正确操作门槛、9/12高质量首答、零严重创意错误、四条都由统一Agent完整自主连续推进、执行器最终收敛，以及最终安全/ID绑定后的真实全量复验。现有数据/记忆/家庭/赠礼/REA软件功能未删除；没有实体设备操作。
