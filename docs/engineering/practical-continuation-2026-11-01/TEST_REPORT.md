# 本轮测试、运行与恢复

## 用户实际得到的变化

- 现有统一对话能显示带原文与用户报告来源的必要条件；310g与170–290g的比较确实由服务端计算，而非只检查回答是否包含数字。模型自填区间不能被认作设备事实。
- 同一Task能够串起两件物品的资料、方案、用户报告和未来Task。真实模型使用了获准的合成经历，改变为定点分段，避开移动长镜头；仍未形成完全可靠的拍摄指导。
- 经验纠正、撤销和遗忘实际影响另一Task的可用Context；另一账号读取被拒。新报告和切换任务不再继承上一条的云端同意。
- 陌生音箱自主资料获取**未达标**。新搜索协议仅离线验证。没有用Sony/Canon已有固定链接成功冒充通用发现成功。

## 环境和代码

工作区`D:\ProductAgent-LifeContext\.runtime\practical-agent-v1`；分支`codex/wujian-practical-agent-v1`；起点`042eae3ccea79351dabb736fad8e2ee21d05c6a0`。开始时该工作区干净，原项目的`deliverables/`未触碰。Node 24.22.2，现有依赖与package-lock不变。所有写入仅在`.runtime/practical-preview`及离线fixture目录；没有真实用户数据库迁移。

关键业务源码：`src/lib/life/acquisition.ts`、`sources.ts`修复失效种子、实际章节与图示读取；`src/lib/ai/provider.ts`修复Qwen多模态搜索协议；`src/lib/agent/kernel/context.ts`限制泛词错误选物；`practical.ts`接通条件并修复长上下文工具往返费用估计，资料缺失不标完整成功；`practical-constraints.ts`执行来源绑定计算；`AssistantConversation.tsx`展示条件/原文缺口；`life/TaskContinuity.tsx`清除残留授权。业务写入仍走既有Task/Outcome事务与服务端权限，没有新增Agent或数据表。

## 实际命令与结果

| 命令/证据 | 类型 | 结果 |
|---|---|---|
| `node --experimental-strip-types --test tests/practical-constraints.test.ts tests/practical-continuation.test.ts tests/practical-agent.test.ts` | 离线替身/确定性 | 21项通过，新增12项。含完整型号/来源过滤、SSE分块、区域路由、数值篡改、越权条件ID、长手册费用往返、错误选物；不证明模型懂物理。 |
| `npm test` → `evidence/regression-final.txt` | 全量离线 | 464项，463通过、1既有跳过；真实调用0。包括原有记忆、家庭、赠礼、任务与权限。 |
| `npm run test:benchmark` → `benchmark-final.txt` | 离线基准 | regressions=0，realModelCalls=0，不是实际智能评分。 |
| `npm run typecheck` → `typecheck-final.txt` | 静态 | 通过；最终生产构建再次检查类型。 |
| `WUJIAN_BUILD_DIR=.next-practical npm run build` → `build-consent-final.txt` | 生产构建 | 通过，未部署。PowerShell实际用`$env:WUJIAN_BUILD_DIR='.next-practical'`。 |
| `node scripts/practical/continuation-discovery-browser.mjs --stage=discovery-v1` | 真浏览器+真千问 | 6次请求；SRS-XB100无预设URL，实际官方发现失败。原文与桌面/移动截图保留。 |
| `node scripts/practical/continuation-loop-browser.mjs --stage=cross-loop-v2 --fresh-fixture` | 真浏览器+真千问 | 2次请求，资料→同TaskRun→确认合成报告→显式授权→另一Task使用经历；行动质量仍失败。 |
| 同脚本`--stage=cross-plan-v3 --plan-only` | 真模型候选 | 1次；计算后被本地费用预留错误挡住最终回答；保留故障，已修复估算。 |
| 同脚本`--stage=cross-plan-v4 --plan-only` | 真模型候选 | 2次；工具→最终文本18.767秒；减少矛盾组合，但仍有编造动作。强制计算回合默认关闭，复现实验需`--experimental-constraint-round`启动预览；当前额度已耗尽，勿直接复跑。 |
| `node scripts/practical/continuation-permissions-browser.mjs` | 真浏览器业务，模型关闭 | 6项通过：纠正、未来Context、撤销、遗忘、幂等、跨账号隔离及移动端；模型0次。 |
| `node scripts/practical/continuation-consent-browser.mjs --stage=consent-reset-v3` | 真浏览器业务，模型关闭 | 关闭复用清除隐藏云端同意、切换Task不带旧同意、390px无溢出；模型0次。 |
| 额度耗尽启动检查 → `exhausted-preview.txt` | 确定性防护 | 达到60次后，在读取凭证与联网前拒绝付费预览。 |

中途失败也保留：`cross-loop-v1`是正常Cookie过期，无模型调用；重新通过正常注册进入合成空间，未延长Cookie或绕过认证。`consent-reset`首次因旧预览未重启，`consent-reset-v2`因测试脚本抢在账号水合完成前填登录表单失败；修正为等`/api/account`真实响应后，v3通过。这些失败没有算作产品通过。旧服务已停止，最终只读预览使用新构建。

## 真实模型与质量

同一固定模型`qwen3.8-max-0902`，本轮新增11次上游（10返回/1失败），已含重试与失败；原49条哈希未变，轮次共60/60。新增已返回输入195,527 Token、输出4,004 Token；失败无Token回执，仍预留5.01632元。新增估算7.506788元，整轮估算12.2246元，**含未知失败费用预留，不是实际账单**。详见`evidence/usage-summary.json`、上一轮`evidence/model-calls.json`追加记录。

完整文字显示时间为8.005、15.741、18.767秒；这是显示耗时，因回答未完全可靠，不能称为“有效任务完成延迟”。上游成功请求P50=1.903秒/P95=16.545秒，样本很小，不作性能普遍结论。没有新增大规模评测、模型自评分或伪造同模型对照；本轮只针对已复现问题做真实纵向复验。

逐句问题见`QUALITY_REVIEW.md`。没有真实硬件成功案例；成功报告为明确标注的合成输入。纠正/撤销/遗忘后的新模型回答未再次执行，业务Context及原有离线回归通过不等于模型一定正确。

## 打开与恢复

本机`http://127.0.0.1:3232`为隔离、**禁止付费的新构建回看服务**，不是已重新授权的在线Agent。测试账号仍按正常独立身份登录，Cookie会过期，身份文件和口令仅在忽略的`.runtime`内，不公开。可以查看物品、任务、报告及界面；新模型提问不可用。

重新启动只读服务（Node24、在上述隔离工作区中）：

```powershell
$env:PRODUCT_AGENT_DATA_DIR=Join-Path (Get-Location) '.runtime/practical-preview'
$env:WUJIAN_BUILD_DIR='.next-practical'
$env:AUTH_MODE='authenticated'
$env:AI_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_PAID_CALLS='false'
$env:WUJIAN_ALLOW_SEARCH='false'
$env:WUJIAN_AGENT_RUNTIME='native'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3232
```

这是读取现有合成测试数据的服务，不对旧账号、物品、家庭、赠礼数据做迁移。没有忽略目录时按正常流程建立新测试账号即可，但不会自动获得另一个身份的私有样本。公开原始结果、截图和质量复核直接在本分支阅读，不需要搬运私有状态文件。

代码恢复点：`042eae3c`为上一轮；`7be025a`为资料发现修复；`08f1f18`为来源绑定条件及真实跨Task证据。需要比较时从对应commit建立另一个仅用于检查的worktree，使用全新合成数据目录；不要对原项目执行reset/clean，不把历史数据库拷回真实环境。最终提交补齐授权界面复位和真实浏览器证据。

## 未达标与下一步

1. 陌生商品发现：已修正协议，需真实SSE搜索→官方原文→操作章节的复测；尚未排除账户区域、权限或部分官网访问问题。
2. 多物品规划：计算正确不等于动作正确，仍会把相机操作、支撑与故障后果无依据补全。仅保留来源绑定基础，失败的强制回合默认不启用。
3. 经验：真实模型已经改变了拍法，但仍会曲解报告（“不能安装”变“连接失败”）；需要有额度的纠正后行为复验。
4. 数值绑定目前只覆盖本轮明确的手机区间和已有二维登记尺寸；不是通用参数提取，也未持久化所有对话中的参数变更，不扩写成世界模型完成。

付费额度已到请求上限，未获新的追加批准。下一轮最小实证建议最多20次/10元：先1次搜索协议冒烟，再陌生SKU完整浏览器流程，最后针对动作来源与纠正后经验做有限复验。**未执行、未建立新授权台账、未自动重置额度。**
