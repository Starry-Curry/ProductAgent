# 测试与真实证据

## 范围、基线和数据

2026-11-01，Windows、Node24.22.2、Next15.5.28、SQLite；基线`84f601b8b68bc52471a96cc6c6f6475531e816d6`，分支`codex/wujian-integrated-agent-v1`。工作区`D:\ProductAgent-LifeContext\.runtime\practical-agent-v1`。真实模型预览3233使用独立`.runtime/practical-preview`；业务离线浏览器3234使用隔离测试环境。仅合成账号/持有/经历，厂家正文是真实公开资料。未访问真实私人库、未改SQL结构、未改产品定稿/依赖锁。

所有模型成功指“上游返回”，不等于用户任务达标。逐案判断见[QUALITY_REVIEW](QUALITY_REVIEW.md)。没有模型自评证明创新度，没有实体设备测试。

## 实际执行与结果

以下在本工作区执行，日志均为真实命令输出。先使用Node24路径；离线环境`AI_ALLOW_PAID_CALLS=false`、`WUJIAN_ALLOW_PAID_CALLS=false`。

| 命令/场景 | 结果 | 证据 |
|---|---|---|
| `npm test` | 最终479通过、0失败、0跳过；比基线总数新增9项。覆盖授权、幂等、故事、赠礼、家庭、迁移备份和REA软件，不是模型正确率 | [最终全量](evidence/regression-delivery-fixed.txt) |
| 第一次最终回归 | 478通过/1失败，旧准备清单续聊被新Task路由截走；修复原路由后全量通过，未删测试 | [失败原文](evidence/regression-delivery.txt) |
| `npm run typecheck` | 通过；构建生成的next-env/tsconfig变动恢复后再跑 | [类型](evidence/typecheck-delivery-v2.txt) |
| `WUJIAN_BUILD_DIR=.next-integrated npm run build`（PowerShell先设env） | 生产构建通过；不替换其他预览`.next` | [最终构建](evidence/build-delivery-v2.txt) |
| `npm run test:benchmark` | 通过，regressions0，模型请求0；不是千问性能基准 | [benchmark](evidence/benchmark-delivery.txt) |
| `node --experimental-strip-types --test tests/integrated-memory-receipt.test.ts` | 先红后绿，保留撤销/遗忘不复活旧报告 | [红](evidence/memory-receipt-red.txt)/[绿](evidence/memory-receipt-green.txt) |
| 定向行动/自然Task/比例计算测试 | 7通过，之后包含在全量479；早期浮点断言失败未覆盖 | [定向](evidence/targeted-release.txt)、[早期失败](evidence/targeted-final.txt) |
| `node scripts/product-foundation/browser.mjs`，`TEST_BASE_URL=http://127.0.0.1:3234`，`TEST_EVIDENCE_DIR=.../evidence/business-browser-v2` | 真实Edge/Playwright、独立账号10检查通过、0页面错误、模型0；含REA6.8实际CLI、自有软件状态42回读和撤权 | [结果](evidence/business-browser-v2/browser.json) |
| `node scripts/real-intelligence/browser-regression.mjs`，同3234，`TEST_REPORT_DIR=.../evidence/task-browser-regression` | 4检查通过、0页面错误、模型0；A经验跨B保留/纠正遗忘、源Task家庭回写与撤权403、赠礼独立实例/私密不回流 | [结果](evidence/task-browser-regression/browser.json) |
| 同上创造力入口 | 模型关闭时502/blocked_model_budget，未伪造创意成功；不能算真实创造力验收 | 同一结果文件`creativity`字段 |
| `node scripts/integrated/release-browser.mjs --stage=release-browser-v3` | 最终生产构建打开较早Task、恢复未失效的真实模型故事对话；桌面1440/手机390无溢出、0页面错误、0新增模型 | [最终浏览器](evidence/release-browser-v3.json) |
| 第一次/第二次发布浏览器 | 第一次发现8条显示截断，已补展开；第二次试图恢复已因遗忘而失效的旧对话，未绕过隐私；改用未失效Task完成验收 | [首次](evidence/release-browser.json)、[第二次](evidence/release-browser-v2.json) |

业务浏览器初次因当前worktree缺REA CLI失败，记录在[evidence/business-browser](evidence/business-browser/browser.json)；连接本机已有固定安装后复验，不重装全局工具、不把跳过写成通过。截图目录同时保留桌面、移动端、赠礼、分身、软件授权等真实页面。

## 真实千问与资料链路

使用`node scripts/integrated/preview.mjs --record-synthetic-evidence`启动合成证据预览，各脚本唯一阶段名避免覆盖。最终常规预览不带该记录参数。

| 旅程/脚本 | 真实上游数 | 完整回答/质量 |
|---|---:|---|
| `browser.mjs --stage=canon-r8-final` | 3（两问） | 13.369s/8.991s；无预置URL，目录→准确型号→正文→录像/快门章节，核心问题通过，图示未全面验证 |
| `browser.mjs --stage=sony-fallback` | 2（两问） | 明确使用验收者官方URL降级，核心配对通过；不宣称自动搜索通过 |
| `browser.mjs --stage=cross-bound-final` | 1 | 服务端完成约50.762s，计划排除已知失败资源并确认回同Task，尚非物理试验 |
| `experience.mjs --stage=r10-experience-fixed` | 8 | 合成失败报告→私人故事→授权下一Task→更正成功→新问题转回放→撤销/遗忘；核心闭环通过，扩写仍需审阅 |
| `browser.mjs --stage=new-combination-final` | 2 | 首答比例/控件错误，**不通过** |
| `followups.mjs --stage=geometry-followup` | 2 | 实际frame工具+重读官方开关章节，部分修正；非整体通过，无旧计划确认 |
| `followups.mjs --stage=natural-story-final` | 3 | 实际故事确认、领域Task回原会话、下一轮沿用通过；回答偏长，未全篇认证 |
| `direct-final.mjs` | 1 | 同版模型、同初始资料/消息、同768思考预算，44.744s，仍建议超重安装，失败原文保留 |
| `compare.mjs` | 2 | 原默认非思考与2048思考同资料直调，两者仍有越界；未据此认为思考等于修复 |

原默认路径的早期`cross-plan-v1/v2/v3/v4.json`与后来受控路径均在本目录，比较不是只拿历史V3作基准。嵌套Schema、超长片段、成本拒绝和浏览器超时分别记录；未把驱动器错误当模型失败，未只选最好答案抹掉反例。真实新型号来源包括：

- Canon EOS R8：[对应手册](https://cam.start.canon/en/C013/manual/html/index.html)、[快门功能](https://cam.start.canon/en/C013/manual/html/UG-04_Shooting-2_0140.html)、[录像开关](https://cam.start.canon/en/C013/manual/html/UG-04_Shooting-2_0010.html)。返回正文和实际readURLs在模型trace中。
- Sony SRS-XB100：[配对操作](https://helpguide.sony.net/speaker/7856/v1/en/contents/TP1000946321.html)。`acquisitionMode`明确为operator_provided_verified_url_not_autonomous。
- 米家台灯1S MJTD01SYL：[官方规格](https://www.mi.com/mjsmartlamp-1s/specs)，本轮实时导入。当前亮灯/画作40×30cm是模拟报告，不是厂家事实。
- Canon EOS R50、EOS R10及OM6继续使用准确型号官方章节。全量引用URL、适用型号/地区/版本与实际取回失败在原始JSON中；不能以引用存在代替语义核查。

## 费用与性能

独立轮次`integrated-agent-20261101-r1`，授权150请求/50元。交付快照 **58次：56 returned、2 failed**；失败/重试都计入。模型统一`qwen3.8-max-0902`；已观测输入812,179Token、输出43,640Token（不重复加计reasoning明细）。[当前官方价](https://help.aliyun.com/zh/model-studio/model-pricing)按该区域版本输入12/输出36元每百万估算；供应商账单优先。

已知用量估算 **11.317188元**；第3次Responses超时/中断、第25次流中断无完整用量，继续保留 **6.839088元**预留，总计 **18.156276元**。HTTP200后流失败也未算完成。剩92次/估算31.843724元，不意味着新一轮授权；后续预览继续本台账。无新增收费搜索服务。

14条选定真实浏览器回合（含失败新组合）完整回答P50 **9.429s**、P95 **71.857s**，不是首字时间、SLA或成功率。逐条时间/调用数见[USAGE_SUMMARY](evidence/USAGE_SUMMARY.json)，每次输入/输出/Token/错误见[原台账](evidence/model-calls.json)。汇总可用`node scripts/integrated/summarize.mjs`重新生成，绝不覆盖历史轮次。

历史60+20次台账SHA256与授权快照一致。仅合成验收记录正文，未提交密钥、Cookie、账号口令或私人数据库；最终扫描见[secret-scan](evidence/secret-scan.json)。本轮未获独立真人/实体设备验收，开放创意与通用品类知识仍有未达标项。
