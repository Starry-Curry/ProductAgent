# 第一轮测试报告

测试日：2026-10-29，北京时间；Windows、Node v24.16.0、npm 11.13.0、Next.js 15.5.28、已安装 Microsoft Edge。产品起点 `ea32c3f4c9e18992ca267b6dd74e26e418c9e95a`。源码与证据哈希见 [source-manifest.json](evidence/source-manifest.json) 和 [发布扫描记录](evidence/publication-scan.json)。原始用户工作区与真实数据库未打开或迁移。

公开文本日志统一 LF、去掉行尾空格和末尾空白行；未删除失败内容。原日志保留在本机 `.runtime/item-v1`，原始和发布文本哈希见 [log-manifest.json](evidence/log-manifest.json)。模型原始 JSON 内容不作上述文本整理。

## 离线测试和页面验收

最终统一入口：`node scripts/finals-item-verify.mjs`。各命令返回码、耗时、日志位置见 [commands.json](evidence/commands.json)。下列测试均 **0 次真实模型请求**，包含模型替身。

| 实际命令                                                                                     | 结果与覆盖                                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci --cache D:/ProductAgent-LifeContext/.runtime/finals-audit/.npm --no-audit --no-fund` | 安装成功；根 package-lock 未变；不代表完成漏洞审计                                                                             |
| `npm test`                                                                                   | **256/256 通过**；原 191 项加 65 项新回归，不是 256 次真实模型                                                                 |
| `npm run typecheck`                                                                          | 通过                                                                                                                           |
| `npm run test:benchmark`                                                                     | 新版 0 regressions；旧基线仍有 1 falseRejection，未删历史结果                                                                  |
| `npm run build`                                                                              | 生产构建通过                                                                                                                   |
| `npm run test:cloud`                                                                         | 访客隔离、重启、备份恢复、限流、预算跨重启、公开 HTTP 两回合工具链、重复请求不再扣额度；8 组检查；**非公网／Docker／真实模型** |
| `npm run test:acceptance -- life`                                                            | 物品、资料、故事、发现、家庭；OCR／PDF／码识别和桌面／移动端两组验收                                                           |
| `npm run test:acceptance`                                                                    | integration、foundation、household、home 四组                                                                                  |
| `npm run test:task-planning`                                                                 | 准备、依赖、逐步确认、刷新、时间调整、物品排除、权限与 390px                                                                   |
| `npm run test:care`                                                                          | 关怀版导航、提醒、事项、物品帮助、390px                                                                                        |
| `node scripts/verify-local.mjs storybook`                                                    | 故事阅读布局和交互                                                                                                             |
| `node --experimental-strip-types experiments/pi-item-loop/poc.mjs`                           | Pi 1.4.0 的 4 项隔离检查；8 个假模型回合、4 次只读工具执行；没有真实请求                                                       |

浏览器环境显式设置 `EDGE_PATH=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`，复用已装浏览器，没有下载另一套运行时。服务随机端口、独立 `.runtime` 数据目录，结束自己启动的进程。公开页面增加 pageerror 断言和截图；截图见 [screenshots](evidence/screenshots/)，其中均为合成物品／故事。

新增 65 项主要覆盖：12 种库存指代、否定活动和限制；物品 ID／属性／未知与隐私契约；分页；不存在／越权 ID；本地与公开 Graph 工具往返；预算耗尽；等待期间属性变化／撤权；创意修正超时不落库；真实模型误拒与漏检反例；型号登记与实物状态区别；资源不合格的明确本地降级。原安全测试另增加“联网关闭”和“来源未授权”两个分支的独立断言。

## 真实百炼：148 次请求，估算 0.433 元

这轮用户额度为 150 次／30 元，以先到者为准。实际 **148 次**，剩余两次没有使用；主动停止，没有换账号或追加预算。所有请求先写共享台账再发送，超时／重试也占额度；失败没有 usage 时保留保守预留费用。本轮没有传输超时，超时恢复另用替身验证。

- 配置模型 **qwen-plus**，同一个既有北京兼容接口；不宣称获得了实际后端快照 ID。
- 148 次 HTTP 200，**117 个 stop、25 个 tool_calls、6 个 length 截断**，传输错误 0，usage 缺失 0。
- 输入 **444,076 tokens**，输出 **38,862 tokens**。按官方非思考标准价输入 0.8／输出 2 元每百万 tokens 估算 **0.4329848 元**，不扣缓存优惠，**不是账户账单**。[官方价格](https://help.aliyun.com/zh/model-studio/qwen-plus)
- API 200 不等于产品回答合格；截断、格式不合格、条件校验、候选降级分别保留。公开模式真实 HTTP 的模型测试仍是替身；真实模型比较在本地隔离业务服务完成。

运行命令：

```powershell
# 只有带本轮明确授权参数才会发送真实请求；不把 .env.local 放进仓库。
node --experimental-strip-types scripts/finals-item-eval.mjs --live-max=150-cny=30 --config=D:/ProductAgent-LifeContext/.env.local --baseline=D:/ProductAgent-LifeContext/.runtime/finals-audit
node --experimental-strip-types scripts/finals-item-eval.mjs --live-max=150-cny=30 --arm=fixed-final --config=D:/ProductAgent-LifeContext/.env.local --baseline=D:/ProductAgent-LifeContext/.runtime/finals-audit
node --experimental-strip-types scripts/finals-item-eval.mjs --live-max=150-cny=30 --arm=fixed-targeted --cases=F01,F02,F03,F04,F05,F07,F08,F12,C06,T01 --config=D:/ProductAgent-LifeContext/.env.local --baseline=D:/ProductAgent-LifeContext/.runtime/finals-audit
node --experimental-strip-types scripts/finals-item-eval.mjs --live-max=150-cny=30 --arm=fixed-guard-recheck --cases=F03,F04 --config=D:/ProductAgent-LifeContext/.env.local --baseline=D:/ProductAgent-LifeContext/.runtime/finals-audit
```

凭证只由应用进程加载已指定 `.env.local` 用于鉴权，未读取 api.txt、复制文件或输出密钥。共享台账在 `.runtime/item-v1/live/ledger.json`，重复运行续接额度；不得删除台账重置本轮预算。新任务须另行约定预算，不能照抄本轮授权。

## 对照设计与实际结果

冻结 24 场景：12 个型号／材质／结构／温度／承重／食品接触／状态／数量／信息不足问题，8 个否定限制／跨物品／创意问题，4 个工具与真实数据问题。三组用同一库存、用户目标、模型、temperature=0.3、关闭思考，每请求统一最多 1200 输出 tokens。直接模型拿完整物品事实；两个 Agent 从相同数据库按原路径读取。提示、工具、JSON 格式和回合数不是完全相同——这些正是产品实现的变量。

| 运行阶段                     | 场景数 | 请求数 | 产品实际状态（不表示质量评分）                               |
| ---------------------------- | -----: | -----: | ------------------------------------------------------------ |
| 直接模型                     |     24 |     24 | 24 次模型正文返回，未作为自动质量通过                        |
| 审计基准 Agent               |     24 |     29 | answered 19、needs_info 5；含 5 个本地规则、6 个本地规划结果 |
| 首轮修复中间版 fixed         |     24 |     45 | answered 14、needs_info 10；暴露误拒，完整保留               |
| 第二轮完整复验 fixed-final   |     24 |     37 | answered 15、unavailable 6、needs_info 2、候选异常 1         |
| 定向修正 fixed-targeted      |     10 |     10 | answered 6、needs_info 2、unavailable 2                      |
| 漏检复核 fixed-guard-recheck |      2 |      3 | F03 answered；F04 unavailable，拒绝未确认条件的步骤          |

**不能把这些状态数字当作优胜率。** 基准可能因漏检把坏回答标 answered，修复版也可能误拒。三候选基准在 1200 token 上限下更容易截断；改成默认一候选本身是改动变量，不能据此证明模型创造力更强。修复后场景已用于调试，不是独立留出集；最新 24 行汇总混合了有标识的复验阶段，不能称为最终版本整套独立盲测。没有使用模型评分，更没有自行打分后宣布创新度提升。

F08 冻结真实调用夹具使用了历史无效 availability 字符串 `unavailable`；其 `usable=false` 拒用路径有效，但它不是当前录入 API 允许的新状态。新夹具生成器已改为合法 `broken`，离线状态变化回归使用 `broken`。原始夹具未被悄悄覆盖，两组一直使用同一份冻结输入；这项限制不得省略。

原始输入输出见 [EXAMPLES.md](evidence/EXAMPLES.md) 与 [results.json](evidence/live/results.json)；逐 HTTP 请求的工具定义、工具返回、模型正文、tokens、耗时和估算费用见 [ledger.json](evidence/live/ledger.json)。[analysis.json](evidence/analysis.json) 按结果字段重新分类；早期终端对无 code 的异常曾打印 provider-returned，**统计没有据此计成功**，脚本日志分类已修正。

## 能证明的改善和仍失败的例子

- **F01**：基准问登记品牌型号却答 USB 连接方式；现在直接按登记返回 Logitech／M-R0061，并说明不证明实物正常。这是 0 模型的元数据修复。
- **F02**：首轮读到属性后，正确的“不确定是否 304”被正则误拒；定向复验返回“仅登记不锈钢，不能推定食品级”。新增真实文本反例防回归。
- **T02**：基准工具清单缺尺寸信息，修复版真实工具往返后读到旧纸盒登记的 20×15×10 厘米；仍不能由尺寸推出承重。
- **C06**：未知材质盒的新用途曾被送去问型号；修正路由后真实生成候选。只说明路径和候选已出现，不证明点子新颖或物理机制正确。
- **F04／F07／T01**：模型仍可能在指出未知后推荐温水等用法，或者反复选择未确认适用的水杯。部分已被挡住，最终为 unavailable；**没有把拒绝当成好用答案**。最后两场复核继续保留失败。
- **F03**：输出能表述几何未知，但仍可能夹带未经独立核对的光学解释；规则不证明原理正确。需要独立领域审阅，不能宣称已经解决物理推理。

## 失败定位与修复记录

保留开发过程日志，便于看清问题来自哪里：

1. 初始新测试 37/39；补齐谨慎否定语言处理。后续真实输出又发现“无法从资料确定”“能否”“先装温水”等误拒／漏检，新增回归再调整，没有只展示最终成功。
2. 旧工具循环用“3 次调用内结束”的断言与新预算不符；工具循环改为 4 回合，坏 JSON 只允许 1 次修正，相关断言更新。预算耗尽明确 unavailable。
3. 公开页面旧标题／正文定位器过期；更新到当前页面。新公开工具测试最初默认只读首页，未找到后创建物品；改为显式请求 40 件。另一次测试误读应隐藏的 trace；修正为断言公开 API 不暴露 trace，并从隔离额度库验证确实只有两个请求。
4. 最终离线入口设置了联网关闭，既有安全测试却把提示词固定为另一分支的“尚未开放”；显式分测 source_disabled 和未授权域名，不放松生产限制。失败日志保留为 final-verifier-unit-initial。
5. Pi 首次不完整 Models 替身缺 getAuth；改用官方 createModels 加离线 Provider，通过。安装默认 npm 缓存被权限拒绝后换仓库缓存，未提升权限。
6. 新测试的 `unavailable` 状态与严格类型冲突；改合法 `broken`。不完整 ServiceSession 测试夹具改为完整结构，类型检查复验通过。
7. 发布前另发现“确认食品接触”可能错误放行耐热、光学或破损状态条件；新增作用域回归，将前提按性质分别检查。最终共 256 项离线通过。这一最后修补没有再消耗付费请求，不冒充经过新一轮完整模型复验。

## 隔离与公开边界

全部业务测试库、迁移备份、Pi 库和访客卷位于隔离目录的 `.runtime`；数据库与运行缓存不入 Git。未打开用户私人库，没有真实设备操作。迁移备份仍保留，不为测试清掉原文件。公开普通报告、完整合成输入输出与截图；推送前扫描拟提交内容中的凭证、秘密、缓存与大文件。
