# 隔离环境与后续接手

- 当前工作区：`D:\ProductAgent-LifeContext\.runtime\outcome-qwen-v3`；原项目/旧worktree不覆盖。
- Node24.22.2在本机既有工具目录：`D:\ProductAgent-LifeContext\.runtime\product-foundation-app\.runtime\tools\node-v24.22.2-win-x64`。仅每条测试命令临时置于PATH，不改全局环境。换机器使用正常Node24与`npm ci`。
- 当前node_modules为同锁文件既有依赖的本地链接，未新增生产依赖；AgentScope0.0.15只装在忽略目录用于实测，不是运行必需。REA6.8本地工具链接用于既有软件实验；若别机没有，明确标软件实验未跑，不安装或连接硬件来凑通过。
- 合成数据库：`.runtime/outcome-preview`，独立场景`.runtime/acceptance-*`。截图和模型结果在docs/evidence；数据库、媒体、登录storageState、费用网关锁、依赖、构建、源码比较快照都不提交。
- SDK经网关使用原有安全配置认证；应用只接收fixture占位凭证。网关校验唯一官方HTTPS主机和授权轮次，禁止重定向、自动重试及第三方收费服务。没有读api.txt或将Key放入Prompt/报告。
- 费用轮次250/100已满，`outcomeGateway`在新请求前硬拒绝。不得修改当前authorization或删除ledger后继续；新授权必须新ID/新文件并保留当前哈希与全部历史。`--offline`不创建费用网关，`AI_ALLOW_PAID_CALLS`/`WUJIAN_ALLOW_PAID_CALLS`为false、Key为空；不冒充模型在线。
- `WUJIAN_EXPERIMENTAL_FACT_QA`、旧Kernel V3保持false；native运行时复用领域权限/事务，LangGraph旧业务能力保留。主动作全结构化试验只在隔离脚本中，未强推默认创意路径。
- 本轮浏览器用Edge/Playwright、真实服务端账户，桌面1440×1000与移动390×844。截图是实际界面，模拟持有/故事/结果不称实体试验。最后浏览恢复模式不产生新千问响应。
- `npm test`与benchmark离线；生产构建用独立`WUJIAN_BUILD_DIR`。Next自动改写的next-env/tsconfig最终恢复仓库版本，不把构建缓存路径提交为源码。
- 各候选采样有版本配置差异；未提交代码曾用于中间实验，无法保证每次临时采样都有位级源码快照。最终提交、脚本、原始输入输出和构建日志可恢复；不将这种局限包装为严格发布证明。
- 公开台账不重复发布整段厂家说明书：请求INPUT中的厂家原文以原URL、段落位置和SHA引用，完整原始字节保留忽略目录`.runtime/outcome-raw/model-calls.json`。合成用户输入、原始模型输出、请求序号/用量/费用/失败未改，前后计费字段哈希一致。公开版明确标注projection，不能冒充字节完全相同的请求体；历史台账不改。
