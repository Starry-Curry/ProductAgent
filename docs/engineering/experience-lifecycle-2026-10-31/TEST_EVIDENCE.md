# 本轮测试、真实失败和口径

环境：Node24.22.2、Next15.5.28、package-lock、Windows Edge/Playwright。只在本worktree `.runtime/` 建库及迁移；未复制私人库、凭证或原上传资料。原项目仍有未提交`deliverables/`，未覆盖。

## 先失败，再验证修复

- [P0原始失败](evidence/p0-before.txt)：A耳机经验在B台灯反馈后不再召回，明确断言失败。
- [P0修复](evidence/p0-after.txt)及[后续范围化失效](evidence/scoped-context.txt)：普通新增不递增失效epoch；纠正、遗忘、撤权仍阻断旧结果；多物品历史不能通过仍获准的一件物品泄露其余内容；派生经验版本变化后阻断。
- 新增回归还覆盖105条无关历史、旧有效经验迁移、旧无效经验不复活、原workspace逐字相等、SQLite备份和无关单物品会话保留。
- 首次迁移测试把已绝对化的Windows路径再次拼接，属于[脚本路径错误](evidence/p0-test-path-failure.txt)。赠礼脚本最初使用旧演示角色而非独立账号语义，保留[身份用错的失败](evidence/journey-demo-identity-failure.txt)，随后使用u_*合成身份及真实注册浏览器分别验证。没有改动旧Demo兼容行为掩盖失败。

## 命令与结果

| 实际命令 | 结果 |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --cache .runtime/npm-cache` | 正常依赖安装，package-lock未变；首次默认外部npm缓存权限不足，改用本工作区缓存，没有提升全局权限 |
| `node --experimental-strip-types --test tests/experience-lifecycle.test.ts ...` | 先保留原失败，再分阶段执行定向测试；[四旅程集成](evidence/journeys-integration.txt)、[范围化回归](evidence/scoped-context.txt) |
| `npm test` | 最新[398/398通过、0跳过](evidence/offline-final.txt)，基线382；新增16个测试，另扩展原账号/实验问答断言 |
| `npm run typecheck` | [干净配置通过](evidence/typecheck-clean.txt)，构建自动修改的next-env/tsconfig已恢复，不提交构建缓存路径 |
| `npm run test:benchmark` | [0回归、真实模型0](evidence/benchmark-final.txt)，不证明真实模型质量或速度 |
| `WUJIAN_BUILD_DIR=.next-experience-final npm run build` | [生产构建通过](evidence/build-final.txt)，最终源代码恢复点e26bb85 |
| `node --experimental-strip-types scripts/experience-lifecycle/source-audit.ts` | [8个官方目标读取记录](evidence/official-fetch.json)，6个返回正文，其中DJI规格31字不足以理解；读取成功不自动算知识理解成功 |
| `node --experimental-strip-types scripts/experience-lifecycle/cache-review.ts` | [真实缓存上的9项断言、5个有限审阅事实](evidence/cache-review.json)，新增网络0/模型0，不冒充再次联网 |
| `TEST_BASE_URL=...3224 node scripts/experience-lifecycle/browser.mjs` | [新流程真实浏览器](evidence/browser.json)，桌面和390px；独立账号与UI操作，部分前置造数及状态通过API完成 |
| `TEST_BASE_URL=...3224 TEST_EVIDENCE_DIR=.../legacy-browser node scripts/product-foundation/browser.mjs` | [原功能10组浏览器回归通过、pageErrors为空](evidence/legacy-browser/browser.json)，含分身、记忆、赠礼、家庭及实际REA软件回读 |
| `TEST_BASE_URL=...3225 node tests/integration.mjs` | [旧API及桌面/手机通过](evidence/legacy-integration.txt)；单独local-demo fixture服务，非真实认证替代品；独立账号权限另由上两组验证 |
| `node scripts/experience-lifecycle/prepare-evaluation.mjs` | 冻结85案及34个live_model输入，付费0；`--run`直接拒绝。旧51个非模型案本轮未逐案整批重跑，保留not_run；定向旅程另行记录，不搬用上轮46通过作本轮结果 |

## 四条旅程完成到哪里

| 旅程 | 真实执行 | 尚未证明 |
|---|---|---|
| A 陌生耳机 | 注册账号、合成持有Sony WH-CH520、实际官网导入、原文帮助、UI报告经验、台灯B后耳机C召回、UI更正/忘记 | 千问是否能更好利用经验未测。替身断言已确认经验送到新会话执行器；本人报告不是设备检测 |
| B 跨物品创造 | 同任务下开放生成、来源/未知条件传递、反馈、后续经验进入创造执行器，离线替身完整贯通 | App真实关闭模型返回502，原任务标记blocked；没有真实创意成功或物理验证。不能把替身晾放袋点子当本轮真实模型作品 |
| C 家庭协作 | 真实双账号、逐件授权、批准摘要、接手/报告、原任务更新、私密目标隔离、撤权403 | 家人报告不证明现实修好；无真实家庭受试者或外部通知 |
| D 故事赠礼 | 故事关联原任务、选择性快照、实际收礼页确认、独立实例、收礼后双方私人记录隔离 | 模拟人物/经历；不声称现实礼物已交付或所有已分享副本可收回 |

首轮新浏览器在B把预期的“模型关闭502”错误当作脚本异常，保留[原始记录](evidence/browser-first.json)与[日志](evidence/browser-first.txt)；最终改为明确断言阻塞、继续验证C/D，未把502改成成功。

## 事实、性能与费用

- Sony配对与初始化两英文页、Sony PDF、Logitech M185规格、DJI V1.8说明PDF在App读取器中取得正文。Sony UK网络失败；SAMLA超体积；DJI规格正文过短。没有扩大安全限制或绕过访问控制。IKEA官网的食品接触条款另经网页核对，但不写成App成功抓取。
- 对真实缓存：ANC未提及不等于反驳，维修费用缺证；错型号/地区不给结论；M185接收器N/A字段不推广到整个设备的任意能力；DJI重量范围仅是必要条件。相同范围也不证明手机全兼容。
- Sony两官方入口出现7秒与10秒差异；UK页面本机读取失败，不能把网络搜索取得的另一段文字混入App缓存、统一成确定步骤。细分地区和版本仍需真实评审。
- 最新浏览器保存本机完整回应、source、耗时和tokens空值。耳机原文路径本轮71ms，未配置台灯路径44ms；只有这两个本机样本，不能作为P50/P95或模型正确完成耗时。`modelCalls`旧字段可能包含被本机闸门拒绝的尝试（此处台灯为1），不等于一次付费API请求。
- **新增真实付费推理0次，估算0元。** 历史150次账目只核对哈希，不改写。34案保持blocked_model_budget；无新模型正确率、Token用量、直接千问对照或真人创造力胜率。

## 实际截图

[经验桌面](evidence/experience-desktop.png)、[经验手机](evidence/experience-mobile.png)、[家庭原任务更新](evidence/family-progress-desktop.png)、[赠礼手机](evidence/gift-mobile.png)、[旧功能REA软件回读](evidence/legacy-browser/software-readback-desktop.png)。真实本机页面，合成数据，非设计稿或实体硬件证据。
