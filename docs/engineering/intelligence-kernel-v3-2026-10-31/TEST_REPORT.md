# 实际测试、环境与恢复

环境：Windows、Node 24.22.2、Next.js 15.5.28、SQLite、原 LangGraph；没有依赖/框架或生产schema迁移。所有命令在本轮独立工作区执行。私有配置仅由已授权的网关在内部认证时使用，未复制、打印或提交。无私人数据库、硬件或生产部署。

## 离线与工程检查

| 实际命令/过程 | 结果 | 证据 |
|---|---|---|
| `npm ci --cache .runtime/npm-cache` | 安装项目锁定依赖；锁文件未改 | 独立node_modules未跟踪 |
| `npm test` | 最终442/442，0失败0跳过；相对基线新增33项 | `evidence/offline-final.txt` |
| `npm run typecheck` | 通过，含最后补充的评测/恢复脚本 | `evidence/typecheck-final.txt` |
| `$env:WUJIAN_BUILD_DIR='.next-kernel-v3'; npm run build` | 生产构建通过；自动生成的next-env/tsconfig路径变更已还原，不提交缓存 | `evidence/build-final.txt` |
| `npm run test:benchmark` | 离线回归无新增退化；不是模型质量/有效时延 | `evidence/benchmark.txt` |
| 原集成六组 | 前四通过；共享知识、Alpha两组遇旧SSE/折叠面板测试假设，修测试后分别通过 | `legacy-integration.txt`、`shared-knowledge-retest-v2.txt`、`alpha-retest-v3.txt` |
| `TEST_BASE_URL=http://127.0.0.1:3228` + `scripts/real-intelligence/browser-regression.mjs`（日志中的PowerShell实际设置） | 独立账号、桌面/390px，四项检查，无页面异常 | `browser-offline.txt`、`browser.json` |
| 原REA软件实验集成命令 | 自有软件测试目标，真实REA 6.8 CLI授权/回读/重放/撤销通过 | `software-lab.txt`；不是硬件验证 |

新增测试覆盖逐子问不整体丢弃、引用/型号/地区/数值单位、合法计算不放行其他伪造数字、二维不证明稳定、来源缺席不证明否定、保修政策门禁、关系来源、经验调整、未变条件不重复失败动作、记忆关闭/临时会话/忘记竞态/撤权、旧任务目标私人信息失效，以及JSON/SSE最终消息解析。替身provider用于离线机制验证，未计作真实模型通过。

初始离线430项中有一次可选REA环境跳过；复用既有只读工具目录后最终442项无跳过。旧失败日志完整保留。未为每次小改动反复全量构建；最终业务源码集中回归后，仅评测脚本/文档元数据又作检查。

## 四条跨模块旅程

| 旅程 | 实际执行结果 | 验证层次与缺口 |
|---|---|---|
| A 耳机资料→反馈→无关台灯→再次耳机→纠正/忘记 | UI/存储召回和失效通过；付费UI再次验证短长按、10秒初始化 | 合成持有/报告；真实模型经验消融失败或错误归因，不能说后续指导可靠 |
| B 跨物品创造→条件→反馈 | 原桥接实际运行；离线模型关闭明确502且任务阻塞；本轮付费创造超时/大部误拦 | 未通过，不能用Task ID或mock替代 |
| C 帮爸爸→授权摘要→接手反馈→原任务更新→撤权 | 两个实际测试账号、原任务更新、私人目标隔离、撤权403通过 | 真实本地业务事务；人物合成，非现实家庭操作 |
| D 故事确认→选择分享→赠礼认领→接收者独立实例 | 真实浏览器认领与隔离通过，双方私人经历不自动转移 | 合成故事/持有人；非真实物理移交 |

真实浏览器截图：`experience-desktop.png`、`experience-mobile.png`、`family-progress-desktop.png`、`gift-mobile.png`、`live-v3-desktop.png`、`live-v3-mobile.png`。新内核实时UI两问4次付费，完整SSE回答呈现、桌面/390px、页面错误与横向溢出为0；其语义内容另外审阅，不靠页面成功判模型通过。

## 真实资料与付费测试

`prepare.ts` / `supplement.ts` / 新增来源记录实际访问7个新型号，6款读到正文，LEGO受限/超时。旧9型号明确用公开正文缓存；不冒称全是实时检索。`rebuild-corpus.ts --stage=recovery-check-v1`实际重建20份可读公开正文，零付费，失败也保留；该恢复语料不是旧评测的相同哈希快照。

真实模型全部固定 `qwen-plus-2025-12-01`，每次上游在发送前记账，包含失败、超时。新轮次247/250次，239次返回、8次失败，输入2,093,389 / 输出235,121 tokens；8次usage未知使用预留，合计估算/预留 **7.5944012元**，非实际账单。无新轮次重置。历史旧轮次另使用9次至146/150，前137条保持不变。

| 真实阶段 | 请求数 | 实际覆盖 |
|---|---:|---|
| `eight-v2` | 37 | 8题V3/直接/旧默认，新鲜三臂，早期版本 |
| `historical-final-v3` | 95 | 原34题，V3/直接双臂；文件名不代表最终源码认证 |
| `holdout-frozen-v1` | 85 | 30冻结题双臂，不按结果定向修规则 |
| `experience-v1` | 12 | 8行有/无经验、纠正、遗忘、直接、个性化创造 |
| `development-final-v1` | 12 | 六款新型号6题V3，不是三方 |
| 实时浏览器（账本`unlabeled`） | 4 | 两问，真实UI→上游→SSE最终呈现 |
| `policy-final-check-v1` | 2 | 最后代码挡住模型再次编造的“拆机即失保”；不是全题答对。仍有“索尼未在公开资料提供”过宽来源范围说法 |

原8题/34题/30留出所有失败及原始输入输出、版本和调用编号不覆盖。剩下3次新轮次请求、4次旧轮次请求不再使用；已关闭付费预览，完整三方缺口标未执行。最终各案审阅与盲评原材料在 `v3-case-reviews.json` / `blind-samples.jsonl`，外部独立盲评未做。

## 本地打开与恢复

从本分支新建隔离工作区，使用Node24与锁文件安装。以下只创建本工作区下的新测试库；不会读取原私人数据库。PowerShell：

```powershell
npm ci
$env:PRODUCT_AGENT_DATA_DIR="$PWD/.runtime/v3-local-review"
$env:AUTH_MODE='authenticated'
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
$env:WUJIAN_EXPERIMENTAL_KERNEL_V3='false'
$env:WUJIAN_EXPERIMENTAL_FACT_QA='false'
$env:WUJIAN_BUILD_DIR='.next-kernel-v3'
npm run build
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3231
```

打开 `http://127.0.0.1:3231` 创建本地测试身份。默认保留原版；模型关闭时不冒充智能回答。实验实测由 `scripts/kernel-v3/preview.mjs --authorized-v3-250-cny50` 使用同轮受限网关/独立测试库，真实浏览器脚本是 `scripts/kernel-v3/browser-live.mjs`；已执行记录不能被覆盖。不要为了重测删除账本、授权记录或已有测试数据库。

无旧公开语料缓存的新环境先执行：

```powershell
node --experimental-strip-types scripts/kernel-v3/rebuild-corpus.ts --stage=<唯一新阶段名>
```

真实脚本需当前有效授权、余额及本地安全配置；本轮已经247次，不应重新跑全套。`compare.ts` 有保护，不覆盖已存在阶段。复核评分无需调用：`node scripts/kernel-v3/review.mjs`。秘密与新增Git历史扫描：`node scripts/kernel-v3/scan.mjs`。回到基线请在另一个工作区检出4d210bcd，不reset、迁移或删除现有数据。

## 尚未完成

完整64题新鲜三方、外部盲评、75%官方可答项门禁、真实物理验证、可靠经验因果利用、创造性可执行方案和专业动作全桥接均未通过/未完成。模型仍可能引用正确文字却错误归因；标题/正文出现型号也不完全排除导航混入、型号或地区适用误判。当前服务端检查是必要条件，绝非事实认证。保持两个实验默认关闭。
