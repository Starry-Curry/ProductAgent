# 测试记录：统一家庭体验 Beta

基准、启动及产品限制见 [README](README.md)。测试使用隔离合成数据库；没有访问私人数据库，没有硬件执行或实际摆放验证。日期为2026-10-30（北京时间）。

|检查|实际执行与结果|
|---|---|
|离线回归|`npm test`：329项通过，其中本轮新增14项；[完整日志](../../../artifacts/unified-home/offline-tests.txt)|
|最后针对性复验|`node --experimental-strip-types --test tests/unified-home.test.ts`；[日志](../../../artifacts/unified-home/targeted-final.txt)|
|类型|`npm run typecheck`通过；[日志](../../../artifacts/unified-home/typecheck.txt)|
|生产构建|`npm run build`通过；[日志](../../../artifacts/unified-home/build.txt)|
|既有离线基准|`npm run test:benchmark`，regressions=0，真实模型调用0；[日志](../../../artifacts/unified-home/benchmark.txt)|
|实际公开网络|`node --experimental-strip-types scripts/unified-home/network.ts`，并针对网络及备用来源做必要复验；[最终来源快照](../../../artifacts/unified-home/network.json)|
|原纵向界面回归|`PERSONAL_OBJECTS_EVIDENCE_DIR` 指向本工作区隔离目录后运行 `node scripts/personal-objects/browser.mjs`，6条通过，全部替身；[日志](../../../artifacts/unified-home/personal-regression.txt)|
|公开演示安全回归|`npm run test:cloud`，8组通过、0真实调用；本机生产HTTP验证，不代表部署云平台或验证Docker；[日志](../../../artifacts/unified-home/cloud-regression.txt)|
|桌面与移动浏览器|`node scripts/unified-home/browser.mjs`，实际 Edge/Playwright、1440桌面和390移动视口、真实百炼；后续强模型小样本用 `--primary-only`，其失败单独保留|
|跨会话与隐私|`node scripts/unified-home/memory-browser.mjs`，在另一个明确合成角色中通过移动浏览器纠正、重新提问、遗忘、重新提问；实际通过（纠正后使用小雨、遗忘后未知、另一个角色读取403），见下方记录|

## 新增测试具体保护什么

精确SKU和幂等加载；重复加载不复活遗忘记忆；算法备案/法律/营销PDF不冒充说明书；备用官方页面的PDF链路；联网期间物品换主不写缓存；跨角色、临时、逐条云端及分身显式记忆许可；家庭许可关闭时零模型调用且不扩大单条记忆许可；实际工具结果进入下一模型回合、完整子任务及目标持久化；越权工具及伪造引用；在途遗忘/撤销许可；纠正后不从原故事复活旧关系；真实库存偏好不进入模拟家庭；命名函数仅首轮强制；原空间与模拟家庭的已有聊天不能直接互换。

这些是替身与业务不变量测试，**不证明模型理解正确、创意优秀或设备可控**。

## 浏览器证据与内容验收分开

- [浏览器最近一次记录](../../../artifacts/unified-home/browser-live.json)、[历次记录，包含完整成功流程及失败](../../../artifacts/unified-home/browser-run-history.json)。每条保留原始用户问题、实际API状态、回答、工具痕迹与模型调用数。
- [首次没有真正读取工具的失败](../../../artifacts/unified-home/browser-initial-failure.json)、[页面能显示但内容不合格的早期回答](../../../artifacts/unified-home/browser-draft-quality-failure.json)、[旧版审查输出结构不兼容失败](../../../artifacts/unified-home/browser-review-schema-failure.json)。不把这些替换成成功材料。
- [移动端纠正/遗忘记录](../../../artifacts/unified-home/memory-browser-live.json)。`friend`是另一个合成演示角色，原`lin`家庭不受该测试的关系修改影响。
- 截图：[首页桌面](../../../artifacts/unified-home/home-desktop.png)、[首页移动](../../../artifacts/unified-home/home-mobile.png)、[手账任务](../../../artifacts/unified-home/journey-a-desktop.png)、[赠画与布局](../../../artifacts/unified-home/journey-b-desktop.png)、[分身延续原任务](../../../artifacts/unified-home/journey-b-persona.png)、[台灯问答](../../../artifacts/unified-home/journey-c-desktop.png)。截图只证明页面实际渲染；内容判断见模型结果。

## 失败定位与修复范围

1. 旧路径在单一意图命中后提前结束。模拟家庭现使用统一调度/读取/综合路径；原有功能保留，不以更多题目正则补路由。
2. `tool_choice:auto` 允许模型只宣称将读取。首轮改为命名只读函数；之后解除强制，允许继续查询或结束读取。官方说明：<https://help.aliyun.com/en/model-studio/qwen-function-calling>。
3. 单件读取缺少桌面资源背景。现在返回八件模拟资源的有界物理摘要，关系仍按请求物品选择；无关真实库存偏好明确排除。
4. 原网络实现只设连接空闲时间，且某些官网先返回当前环境不稳定的IPv6地址。现在有DNS/请求总时限，并优先选择已通过所有公网地址校验的IPv4；依然固定DNS、拒绝内网及跨站跳转。默认PDF上限仍12MB，固定JBL官方手册读取允许16MB；失败不绕过登录或反爬。
5. 分身设置初次读取和快速编辑可能互相覆盖。配置载入完成前禁用表单，避免用户勾选后又被旧数据覆盖。
6. 原任务的多阶段完整草稿容易因非安全性的步骤格式失败。调度阶段不再输出完整答案，最终综合直接读当前工具数据；没有循环修补坏创意。
7. 来源编号校验与完整JSON只能阻止部分错误。真实回答仍出现不受依据支持的条件与操作，这是**未解决的产品问题**，不以测试数量掩盖。

## 真实模型记录

最终统计及每次输出由收尾脚本写入 [MODEL_RESULTS](MODEL_RESULTS.md) 与 [调用记录](../../../artifacts/unified-home/model-calls.json)。包括失败、重试及未展示草稿；账户模型列表是只读查询，不计作模型推理成功。没有复制或提交API配置、Cookie、访问令牌、私人数据库或原始整份说明书。

发布前对暂存区文件执行 `node scripts/unified-home/scan.mjs`：75个文件约3.56MB，未发现凭证特征、禁止跟踪的缓存/数据库或超过5MB的单文件。扫描报告自身不进入自校验清单。[扫描清单](../../../artifacts/unified-home/pre-push-scan.json)。原工作区仍只有此前未跟踪的 `deliverables/`，未修改。
