# 实测与复现

日期 2026-10-30（北京时间）。隔离路径 `D:/ProductAgent-LifeContext/.runtime/creativity-v2-app`，分支 `codex/wujian-creativity-engine-v2`；基线 `origin/codex/wujian-unified-home-beta` = `a2a9a23d5d05bc187300c57aaa01b400772d727e`，交付前复核一致。远端 main 为 `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`，没有合并或修改。原目录及其 `deliverables/` 未提交内容保留。

## 工程与浏览器

| 实际命令 | 结果与证据 |
|---|---|
| `npm ci --no-audit --no-fund --cache D:/ProductAgent-LifeContext/.runtime/npm-cache` | Node 24.16.0 安装完成；首次默认 npm 缓存权限失败后改用隔离缓存，没有修改全局 Node/npm |
| `node --experimental-strip-types --test tests/creative-engine-v2.test.ts tests/open-exploration.test.ts` | 新增 22 项离线检查；模拟提供者明确标注 fixture |
| `npm test` | **362/362**；[日志](evidence/offline.txt)。原先绑定两回合JSON的测试显式指定 legacy，新默认另有自然语言、多方向、反馈、撤权和跨记忆版本回归 |
| `npm run typecheck` | 通过，[日志](evidence/typecheck.txt) |
| `npm run build` | 生产构建通过，[日志](evidence/build.txt) |
| `TEST_BASE_URL=http://127.0.0.1:3206 npm run test:integration` | 独立 integration-preview 数据；API 权限、跨域、回放、赠送作者、桌面/移动浏览器通过，**真实模型0次**，[日志](evidence/integration.txt) |
| `npm run test:benchmark` | regressions=0；离线基准，[日志](evidence/benchmark.txt) |
| `node scripts/creativity-v2/browser.mjs` | 真实 qwen-plus 探索、收藏、否定、私密备注、明确授权后新方向、移动布局成功；深入阶段首次失败，未伪报通过，[原记录](evidence/browser-first-failure.json) |
| `node scripts/creativity-v2/resume-browser.mjs` | 修复后真实深入→概念（0操作步骤）→统一家庭对话完成；桌面和390px移动无页面错误/横向溢出，[复验](evidence/browser-resume.json) |

首次深入失败：模型 `question:null` 被严格字符串契约拒绝。修复为可空的非语义字段；未知动作资源仍判为概念，绝不因此获得物品权限或操作步骤。复验还修正浏览器脚本遗漏演示身份请求头的问题，保留[脚本失败记录](evidence/browser-resume-harness-failure.json)。软件流程成功不代表“地平线折叠”等创意有价值或可行。

## 真实模型实验

实际发现接口：对既有安全配置的兼容 `/models` 发起 GET，HTTP200，返回 qwen-plus、qwen3.7-plus 等；目录可见不等于可调用，因此又用实际推理确认。未重试历史已知404的 qwen3-max。凭证仅由网关进程使用，应用只持有无效占位值，不复制配置或记录认证头。

- **A/B/C**：24个相同任务 × 自由发散 / 案例类比 / 混合 = **72次**。含陌生长尾夹、绣绷、裤夹衣架、冷却架、硅胶垫、纸筒、网袋等，以及既有失败条件。全是合成持有与用户报告，不冒充真实家庭。
- 同模型 qwen-plus、温度0.85、无JSON、无固定点子数量。网关当时实际输出上限3200 token，所有三组一致；这属于传输预算，不是600字产品要求。A是单回合物间自由提示；另用最简直接提示作消融，不能把A冒充完全没有产品提示的直接问答。
- 传输/生成返回：A **23/24**、B **22/24**、C **24/24**。失败3次为超时；不自动重试。中位耗时分别42.7、44.1、44.2秒。这些不是质量通过率。
- **20次消融**：4个相同任务 × qwen-plus最简自由/思考/轻JSON + qwen3.7-plus自由/思考，均返回。统一4000输出token预算；思考预算2048，流式结果经网关聚合为应用可读的最终文本，未保存推理链。中位耗时28.3 / 65.1 / 8.4 / 20.2 / 51.7秒。和72次主对照的输出预算不同，不将跨实验差异只归因于某一个因素。
- 前指令被替换前 **8次**，与真实浏览器 **7次**，同属本轮台账。前8次保留原始结果，未继续扩展旧任务。旧引擎实验误用 validateOnly=true 导致聚合 ideas 未展开，不能据此声称旧产品有该失败率；这是实验方法问题，已明确排除质量比较。

**总计107次请求，103次API返回、3次超时、1次因任务替换中止。估算含失败预留约人民币1.2396元；不是账户实扣账单。** 已知用量101953输入、164713输出token；不把无用量的失败计为免费。采用官方原价估算、未扣优惠或缓存，未触及150次/50元上限，历史账目未覆盖。[完整台账](evidence/model-calls.json)、[汇总](evidence/summary.json)、[模型目录](evidence/model-availability.json)。

## 原始样本与独立评价边界

[72条原始对照](evidence/open-comparison.json)、[20条配置消融](evidence/model-variants.json)、[替换前实验](evidence/comparison.json)。匿名排版与日志仅规范行尾空白，逐字模型文本保留在JSON。匿名材料在 `evidence/blind/01.md` 至 `24.md`，同页提供完整已知事实/偏好；[真人评审CSV](evidence/human-review.csv)为空，[对照键](evidence/blind-key.json)应在评审后查看。尚无独立真人盲评结果，没有模型自评分胜率或创新提升百分比。

## 隔离与运行

新工作区 `.runtime/` 下的 test.sqlite、home-preview、integration-preview 全为独立合成数据；没读取或修改私人数据库，没有硬件验证。未引入依赖/框架/向量平台，没有生产数据库迁移。

离线预览：`node scripts/creativity-v2/preview.mjs --port=3207`。本轮受限真实预览：`node scripts/creativity-v2/preview.mjs --cloud --config=D:/ProductAgent-LifeContext/.env.local --port=3207`。需在该工作区运行；安全配置仅由本地进程读取，不需拷贝密钥。台账位于相邻 `.runtime/creativity-v2-evidence`，达到本轮总上限后会拒绝新增付费调用，不得删除台账绕过。

真实实验复现命令：`node --experimental-strip-types scripts/creativity-v2/compare.ts --cloud --config=...`、`variants.ts --cloud --config=...`。默认跳过已记录样本，不自动重试失败；重新实验必须另立经授权阶段而非覆盖本轮。发布前对暂存字节执行秘密/大文件扫描，结果见 `evidence/pre-push-scan.json`；该扫描不是数学上的无秘密证明。
