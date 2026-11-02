# 百炼托管能力的接入前提：官方只读核对

核对日期：2026-11-02。范围仅为免费读取阿里官方文档；**本子任务没有读取 `.env`、Key、账号、控制台或产品验收输出，没有创建/删除知识库，没有发布应用，付费 API 调用为 0**。官方列出某模型不等于本账户已开通或当前接口已实测；以下为可实施条件，不是运行成功证据。独立冻结题目/答案未被本次研究读取或修改。

## 1. file_search 不是一个空配置即可启用的能力

Responses 请求的工具形状是 `{"type":"file_search","vector_store_ids":["实际知识库ID"]}`；当前只允许一个库。需要先获得有效 API Key、对应地域/业务空间及已创建的库。官方当前示例的兼容接口 base URL 是 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；接口与模型支持列表须一起核对，不能将一个已成功的旧域名调用自动推广到新空间。当前列有 Qwen3.8-Max、3.7/3.6/3.5-Plus、3.8/3.7/3.6/3.5-Flash 等系列，**具体账户可用版本仍待实测**。[官方 file_search](https://help.aliyun.com/zh/model-studio/file-search)

特别重要：官方明确警告，空数组/无效库 ID 会让工具不生效，模型直接用自身知识回答，可能不报错。因此本地必须先校验非空 ID，再检查索引构建完成、实际检索工具事件/返回内容及对应文档；不能用 HTTP 200、好像正确的答案或“工具已配置”作为检索证明。库类型只按该工具支持的文档搜索/数据查询配置，不把图文并茂回复支持范围混入。[同页警告及前提](https://help.aliyun.com/zh/model-studio/file-search)

## 2. 新版 KB 创建、权限和安全清理

当前 RAG REST API 使用业务空间专属 `https://{workspace_id}.cn-beijing.maas.aliyuncs.com` 和 `Authorization: Bearer <API-Key>`。业务空间须在控制台核实，不从 Key 猜测。主账号与 RAM 的权限有区别：RAM 需 `AliyunBailianDataFullAccess` 且加入目标业务空间，Key 范围还受控制台配置限制。**本研究没有核实本地是否具备这些配置**，不能写成已具备或确实缺失。[认证](https://help.aliyun.com/zh/model-studio/rag-api-authentication)、[服务地址与接口概览](https://help.aliyun.com/zh/model-studio/rag-api-overview)

最小 API 链路（严格按单接口文档，不照抄概览的简化 payload）：

1. `applyFileUploadLease` 获租约 → 按返回 URL/要求 PUT 上传 OSS → `POST /api/v1/connector/dash/addFile` 注册。注册使用 `leaseId`、`category`（不是 `categoryId`）、`parser`；用于 KB 的类型是 `UNSTRUCTURED`。返回 `fileId`，还要检查业务 `status/code`，失败可能仍 HTTP 200。实际 OSS URL 只允许经过审核的返回上传目标，不能放宽到任意出站。[注册与完整上传顺序](https://help.aliyun.com/zh/model-studio/rag-api-add-file)
2. `POST /api/v1/indices/rag/index/create_v2`。完整文档要求名称、描述、`structureType`、`sinkType`、`sourceType`、`docIds`、`dataSources`；文件 ID 来自注册结果。`knowledgeType` 与 `knowledgeScene` 要同时给或同时省略；公开文本资料试点可选择文档基础问答。`docIds` 不是 `file_ids`，即使报错文字使用后者。返回库 `pipelineId` 和导入任务 `ingestionId`。[create_v2 参数](https://help.aliyun.com/zh/model-studio/rag-api-create-index)
3. `GET /api/v1/indices/rag/index_job/status?index_id=…&job_id=…`，两者必传。检查整体 `COMPLETED` 和每个文档 `FINISH`，不能把返回任务 ID 当索引就绪。[导入状态](https://help.aliyun.com/zh/model-studio/rag-api-get-sync-job-status)
4. 使用真实库 ID 进行公开商品知识检索，记录工具事件、召回原文定位、源链接、模型/地域/版本、请求与费用。库只含本次授权的公开产品资料；不导入私密物品备注、故事、家庭身份或整个数据库。
5. 仅清理**本次新建且登记 ID 的临时库**：`POST /api/v1/indices/rag/index/delete`，body 是 `{"index_id":"本轮新建ID"}`。不可恢复，绝不能按名字模糊删除旧库或用户数据；结束后查询确认已消失并保留删除回读。删除库是否连带清除数据中心注册文件要单独核实，不能把两种对象混同。[删除接口](https://help.aliyun.com/zh/model-studio/rag-api-delete-index)

费用不仅是检索模型 Token：标准版平台存储 **¥0.03/库/小时**，从创建开始累计，删除停止，另有解析/向量化/排序/回答费用；不能假定仍有免费时长。一个临时标准库保留一天的规格费约 ¥0.72。**本轮临时 KB 授权子上限 ¥10 还必须计入总 ¥80**；建议创建前固定 TTL、单独费用预留与 finally 清理，不购买资源包、不用旗舰版或自购 ADB。[官方 KB 计费](https://help.aliyun.com/zh/model-studio/billing-for-knowledge-base)

## 3. Agent 2.0：远端编排不等于自动访问本地领域服务

官方 Agent 2.0 将知识库/MCP 当工具，外部业务工具经 MCP 接入。API 调用前必须创建并发布应用，取得 App ID、Key；该 API 文档目前明确仅适用北京。HTTP 示例为 `POST https://dashscope.aliyuncs.com/api/v1/apps/{APP_ID}/completion`，请求含 `input.prompt`、必要会话状态；流式用 `X-DashScope-SSE: enable`，非默认空间按文档设置 `X-DashScope-WorkSpace`。这与 Responses 工具接口不是同一协议。[Agent 2.0 配置/发布](https://help.aliyun.com/zh/model-studio/new-single-agent-application)、[应用 API](https://help.aliyun.com/zh/model-studio/new-agent-application-api-reference)

本地 SQLite/Next.js 领域函数不能因为注册 MCP 名称就被云端访问。官方 FAQ 明确云托管 MCP 不能访问用户本地资源；自有服务须具备云端可达链路或另行部署，npx/uvx 托管还涉及 FC 权限/费用。暂不支持私有 npm 直接托管。SSE 与 Streamable HTTP 的端点/传输须匹配，鉴权错误与网络错误分开记录。[MCP 官方 FAQ](https://help.aliyun.com/zh/model-studio/mcp-faq)

因此，本地产品的合法最低成本路径仍可由本地成熟 SDK 调度现有领域服务，同时直接调用百炼官方搜索/解析等工具；**这是本部署条件的工程推论，不是已实证 SDK 比 Agent 2.0 智能**。Agent 2.0 的真实对照需已发布 App 和经过批准的可达 MCP 链路；没有这些前提时标 `not_run/configuration_missing_or_unverified`，不能拿远端无工具闲聊证明替换有效，也不能为测试偷开公网、上传私人数据库。

隐私接入要求（物间自己的边界，不宣称厂商自动保证）：MCP 每次从服务端绑定真实用户/Task/权限，不接受模型传入 ownerId 当授权；短期凭证只进可信传输层；写入仍走原事务、确认、幂等、撤销；工具仅返回当前任务最少字段。官方 Agent 2.0 短期记忆可设置 0–30 轮，长期记忆在该页仍为未来支持，不能代替物间可纠正/遗忘的本地记忆。远端 session 也不代表跨用户隔离已通过。[记忆与工具配置](https://help.aliyun.com/zh/model-studio/new-single-agent-application)

另有 **Managed Agents** 文档支持自定义 MCP 的会话动态 Header（注册 `${HeaderName}`，创建会话时传 `mcp_configs`），但它是另一产品/API 配置，不可未经确认把这些字段塞到 Agent 2.0 Apps completion 中。此项只作接入参考，未实测。[Managed Agents 自定义 MCP](https://help.aliyun.com/zh/model-studio/managed-agents-custom-mcp-skills)

## 4. Embedding/Rerank：准确接口与计费

以下为本次读到的**北京业务空间**官方地址，不代表已获账号路由验证；新加坡等地域按其官方配置单独核对。服务端应只允许经过核实的具体 workspace host，不允许模型填写任意 host。

| 服务 | 已核对的路径与字段 | 模型及边界 |
| --- | --- | --- |
| OpenAI 兼容 Embedding | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/embeddings`；`model`、`input`，可用 `dimensions`/`encoding_format` | `text-embedding-v4`：每条≤8192 Token，每批≤10条，默认1024维，可选64–2048的文档列举值。不是任意数值维度。 |
| DashScope Embedding | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding`；`input.texts`；`parameters.dimension` | 与兼容接口字段不同，不把 `dimensions` 和 `dimension` 混用。 |
| DashScope Rerank | `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank`；`model`、`input.query`、`input.documents`；可选 `parameters.top_n`、`instruct` | `qwen3-rerank`：≤500文档，单条查询/文档≤4000 Token；过长返回400，不会自动截断。结果按原候选 index 映射，不把相关性评分当事实认证。 |

这些 endpoint 与字段均来自 [Embedding 同步 API](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)、[Rerank API](https://help.aliyun.com/zh/model-studio/text-rerank-api)。最新同页还列出 `qwen3.7-text-embedding`、`qwen3.7-text-embedding-flash`、`qwen3.7-text-rerank`；未做本账户兼容调用，不以更新名字当质量结论。新型号参数限制应按模型分别配置，不沿用 v4/3 的硬上限。

当前北京刊例：`text-embedding-v4` **¥0.5/百万输入 Token**；`qwen3-rerank` **¥0.5/百万输入 Token**，均不收输出 Token 费用。向量 Batch 若适用按半价，但不为小实验额外引入 Batch；不假定免费额度有效。Rerank 费用计算不能只数一份 query：需考虑 query 与每个 document 配对输入，官方请求大小公式是 query Token×文档数+文档 Token 总和。其他地区价格不同，不能混用。[价格表](https://help.aliyun.com/zh/model-studio/model-pricing)、[v4 模型独立价格页](https://help.aliyun.com/en/model-studio/text-embedding-v4)、[Rerank 请求限制](https://help.aliyun.com/zh/model-studio/text-rerank-api)

## 5. 缺少配置时，怎样验证而不伪造完成

- 能零费用验证：精确型号/版本与来源投影、权限/撤销、短 Context 不丢关键条件、schema/协议请求形状、超时/业务失败/空库拒绝、候选 index 映射及缓存失效。替身必须标离线，不计官方工具真实验收。
- 已核实 Key/host 但暂无库：可以在本轮明确授权和子额度内仅创建公开资料临时库，先上传、就绪、实际召回，再比较短资料直供与 file_search；收益不足可退役集成，保留调用与清理证据。
- workspace 未核实、权限不够或服务未开通：停止该分支有副作用/收费调用，记录供应商原始错误；不猜库 ID、不改账户权限、不认为普通模型 HTTP 200 证明 KB 可用。单文档使用现有公开原文/百炼按正确接口的解析可作为明确降级，但不能报成 file_search 成功。
- 真实 Embedding/Rerank 只在明确召回/排序瓶颈的小候选集对照；可正确调用并不证明它比低成本精确章节/SQL 更好。冻结正式验收题不得拿来反复调排布和阈值。

所有链接均为本次免费实际打开的官方页面；未访问收费端点，也未修改任何服务配置。本研究到此收敛，未再扩张工具平台。
