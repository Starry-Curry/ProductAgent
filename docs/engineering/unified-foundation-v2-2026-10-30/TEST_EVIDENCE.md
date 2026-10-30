# 真实测试证据与口径

## 工程与数据

Node 24.22.2，Next.js 15.5.28，Edge Playwright；使用 package-lock，未改全局 Node/Git。npm ci --ignore-scripts 安装正常依赖；REA复用既有隔离固定6.8.0工具，通过工作区内部 Junction 引用，不新增生产依赖。

全部新数据库位于本 worktree 的 `.runtime/`。测试人、持有、故事、位置、设备状态均为合成，SKU与厂家URL是真实目标。迁移前 VACUUM INTO 生成增量版本备份；测试只读打开备份，验证旧 workspace.body 逐字相等。原目录/账号库/上传资料不复制、不试迁移。

## 实际命令

| 命令 | 结果与原始记录 |
|---|---|
| `python .../package/wujian_acceptance_preflight.py --suite ... --fixtures ...` | 85案/9商品/15URL，结构有效；[仅结构预检](evidence/acceptance-record-validation.json)不是业务验收 |
| `npm test` | [382项通过](evidence/offline-final.txt)，相对371基线新增11测试，另扩展软件灯故障注入；最初本工作区370通过/1REA跳过，链接可选工具后实际执行 |
| `node --experimental-strip-types --test tests/foundation.test.ts tests/software-lab.test.ts tests/unified-foundation.test.ts` | [后续关键修改的定向回归](evidence/final-safety.txt)，包括旧记忆/检查点/家庭幂等与新内核 |
| `npm run typecheck` | 最终清除构建自动改写的tsconfig/next-env后仍通过，[记录](evidence/typecheck-clean-config.txt) |
| `npm run test:benchmark` | [0回归、真实模型0](evidence/benchmark-final.txt)；不作为实际AI质量或延迟 |
| `WUJIAN_BUILD_DIR=.next-unified-v2-final-safe npm run build` | 最终生产构建，[记录](evidence/build-final-safe.txt) |
| `node scripts/unified-foundation/acceptance.mjs` | 真实独立账号、9SKU合成实例、15官网URL首轮联网，4页面在DOM修复后有限复验；新任务/页面恢复/反馈/同任务交接/撤权、桌面与390px；[运行记录](evidence/acceptance-run.json) |
| `node scripts/unified-foundation/journeys.mjs` | 分身设置、故事、纠正/遗忘、家庭各状态、Sony/Canon/JBL/IKEA赠礼及隔离，[逐组浏览器证据](evidence/additional-browser.json)；API建立前置数据，页面按钮和业务状态断言，非全程人工操作 |
| `node scripts/unified-foundation/care.mjs` | 真实大字M185资料回答→预览当前问题→交家人；[记录](evidence/care-browser.json)，资料为既有经审核资料包，不是新付费模型输出 |
| `node --experimental-strip-types scripts/unified-foundation/integration.ts` | 适用型号拒绝、未知状态、上传后同任务恢复、撤权、真实型号不进入软件执行器、反馈独立云许可；[记录](evidence/additional-integration.json) |
| `TEST_BASE_URL=... node tests/integration.mjs` | [旧本机API和桌面/手机](evidence/legacy-integration-final.txt)，跨域、回放、来源作者、动态约束、私人Context；无真实模型 |
| `TEST_BASE_URL=... TEST_EVIDENCE_DIR=... node scripts/product-foundation/browser.mjs` | [最终旧版10组浏览器回归](evidence/legacy-browser-final/browser.json)，含陌生Sony官方读取、分身纠正遗忘、家庭状态、赠礼和实际REA软件回读 |

收口复验日期为2026-10-31（北京时间；JSON保留实际UTC时间）。广泛旅程最初在3220执行；最新 `.next-unified-v2-final-safe` 构建在3222再次完成旧版10组浏览器、[任务新建/恢复](evidence/focus-browser.json)与[大字交接](evidence/care-browser.json)。新目标恰好发起一次助手请求，导航和刷新恢复不重发旧目标；桌面和390px无横向溢出。最新安全修改后重新运行全部382项离线测试及干净配置类型检查。旧3216预览、原工作区及历史付费账目未改动。

## 85案结果

[逐案JSONL](evidence/acceptance-results.jsonl)：46 pass、5 blocked、34 blocked_model_budget，无漏行/隐藏not_run。9个 `prototype` 通过只表示三种原型的27条预设点击路径可达，[原始路径](evidence/prototype-paths.json)，没有真人首次发现率或导航方案优劣结论。其余 pass 各自依据集成、浏览器或软件实验；不能汇总成“46个模型正确回答”。

所有34个 live_model 案均未执行；本轮没有获批新增付费额度。没有借用历史样本冒充新输出，也没有付费模型正确性P50/P95。模型替身仅验证工具往返/任务协议，来源对照中的测试片段明确是合成文本。

## 成功与真实失败

- [首轮15URL](evidence/acceptance-first-run.json)：Sony、Logitech、Canon、DJI读取/核对成功；JBL未公开返回正文；Philips跳到其他站点被安全规则拒绝。未绕过登录、反爬或跳转限制。
- 小米精确型号以及宜家SKU曾被DOM粘连吞掉边界。保留[修复前测试失败](evidence/g4-parser-first-failure.txt)；保留节点分隔后，准确型号匹配恢复，近似型号仍不放宽。后续记录中小米规格、SAMLA和KALLAX重新联网并索引成功；小米介绍页不含完整MJTD01SYL仍不冒充精确匹配。
- [浏览器修复前错误](evidence/additional-before-refresh-fix.json)：服务已有故事/共享物品，旧SPA清单没刷新；增加导航/窗口焦点刷新后相同场景通过。不是通过改断言掩盖。
- 新测试脚本曾未刷新API造数后的展柜、引用错误按钮名字、TS把JSON.parse直接当map回调；[首次脚本失败](evidence/acceptance-first-failure.txt)、[按钮失败](evidence/journeys-first-failure.txt)、[类型失败](evidence/typecheck-first-failure.txt)均保留并修复，不算产品模型失败。
- REA实际启动6.8.0分析自有JS灯、执行本机HTTP与回读；真实本机写入时注入撤权，返回不确定；注入pending持久回执后重试没有增加软件revision。[原始断言](../../../tests/software-lab.test.ts)与[输出](evidence/final-software-isolation.txt)。没有真实小米灯或其他硬件。
- 最后自审修复软件模拟运行环境全进程共用的问题：按数据库/账号/实例隔离，第二盏实际分析运行的灯保持初始40，而第一盏保持37。赠出/遗失/借出记录拒绝再操作；已认领赠礼的历史档案即使手动改回available也不能重复赠送。这些是已修复的授权/状态缺陷，不是模型问题。
- 软件授权使用单调递增版本；撤权后重新授权不会让旧的在途确认恢复有效。故障注入验证：等待运行环境时撤权再授权，旧请求实际HTTP写入数为0；写入后撤权则返回不确定。原子版本更新及不可重放回执只证明固定软件目标边界，不证明分布式真实硬件可撤回。
- 原事实综合模型错误没有因编译通过而消失。旧模型失败证据仍在 `product-foundation-2026-10-30/MODEL_SAMPLES.md`，不是本轮新测试。实验开关继续关闭。

## 截图

[任务手机](evidence/task-mobile.png)、[任务桌面](evidence/task-desktop.png)、[大字交接](evidence/care-handoff-mobile.png)、[R50分身](evidence/r50-persona-desktop.png)、[Sony赠礼](evidence/sony-gift-mobile.png)、[REA软件验证](evidence/legacy-browser-final/software-desktop.png)。全部为本机实际页面，合成内容，非设计稿。控件局部排版在最终聚焦截图另存。
