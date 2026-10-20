# 在线 Demo 部署准备 · 2026-10-21

从 `05e34ea` 增量开发；仅本地提交，未购买、推送或公开部署。本轮真实模型请求 **0**。原23项产品验收、历史失败和模型额度不变。此文描述部署边界，不代表商品答案或创意质量已经全部通过。

## 推荐部署与最少操作

推荐 **Railway Docker 单实例 + Volume**。继续使用当前 Next.js、LangGraph、Qwen、SQLite 与媒体/记忆体系。Railway [Volume](https://docs.railway.com/volumes) 在运行期挂载并跨重部署保留数据；[公网网络](https://docs.railway.com/networking/public-networking) 提供 HTTPS。单实例短暂停机可接受，不承诺零停机。

正式部署仍需用户确认平台、套餐与费用，并授权代码上传/部署。最少操作：

1. 将审核后的当前分支交给 Railway，使用根 `Dockerfile` / `railway.json`，保持 **1 replica**；不要上传本机数据或 `.env.local`。
2. 新建 Volume，挂载 **`/data`**；应用使用 **`/data/wujian`**。Docker 默认检查独立挂载，忘记挂载会拒绝启动。不要把数据写入镜像层，不设置 pre-deploy 数据迁移命令。
3. 注入变量：`APP_PUBLIC_ORIGIN=https://实际域名`、长随机 `DEMO_ACCESS_CODE`，先保留 `DEMO_AI_ENABLED=false`。示例见 `deploy/cloud.env.example`；生产镜像已指定 `AUTH_MODE=public-demo`、`WUJIAN_DEPLOYMENT=cloud` 和目录。域名必须精确匹配，不能带路径。入口默认需要邀请码；完全开放须另设 `DEMO_OPEN_ACCESS=true`。
4. 使用平台注入的 `PORT`，健康检查 `/api/health`。获取平台域名后更新精确 Origin，验证两浏览器隔离、重启、上传及费用关闭的降级体验。
5. 确认费用后在**平台受保护变量**中填 `AI_API_KEY`、`AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、`AI_MODEL=qwen-plus`；同时显式设置 `DEMO_AI_ENABLED=true`、`AI_ALLOW_PAID_CALLS=true`、`WUJIAN_ALLOW_PAID_CALLS=true`。这属于部署者授权，不应把 Key 发到聊天里。由 Codex 做新的真实模型验收仍需追加调用额度。

不要使用本地 `start:life --cloud` 作为公网启动命令。云端运行 `npm run start:cloud`，无交互口令；本机原启动脚本仍默认关闭费用。

## 阿里云香港 Docker 备选

提供 `deploy/compose.yaml` + Caddy HTTPS；需要用户购买 Linux 服务器、域名/DNS 和开放80/443。进入 `deploy`，从 example 复制未跟踪的 `cloud.env`，填实际域名、邀请码和受保护配置，限制文件权限后运行：

```sh
docker compose --env-file cloud.env up -d --build
docker compose --env-file cloud.env logs --tail=100 app
docker compose --env-file cloud.env stop app
```

应用3000端口只在容器网络内，Caddy自动管理证书；Caddy仅接收域名变量，不接收Qwen密钥。`life-data` 挂载 `/data`，Caddy有独立证书卷。**不要执行 `down -v`**。容器启动时只初始化指定子目录并降权到 node 用户；后续运行不需要 root。

本机未安装 Docker，因此镜像构建、Linux权限、实际挂载、Caddy发证和云端至北京百炼的网络尚未验证。没有把 Node 本机模拟写成 Docker 成功。生产镜像仅复制白名单代码/公开合成演示素材，排除环境文件、数据库、私人媒体、日志、测试替身和缓存。

## 持久化与迁移

| 数据 | Volume 中的位置 / 机制 |
|---|---|
| 会话哈希、有效期、限流计数、模型预算预留 | `visitors.sqlite`，WAL |
| 每访客物品、故事、章节、Memory、会话/Agent记录、知识来源缓存 | `visitors/<服务器随机ID>/demo.sqlite`，WAL |
| 照片、说明书材料、提取内容 | 既有数据库媒体/来源表，包括BLOB，不依赖Windows目录；照片只保留去EXIF后的压缩版本 |
| Schema迁移与迁移前备份 | 复用现有迁移，仅针对当前访客库；备份留在对应目录 |
| 运维完整快照 | `backups/<时间>/`，包括注册库及访客库、校验清单和费用急停状态 |
| OCR语言运行缓存 | 镜像内`.runtime`，可重建；公开模式默认关闭OCR，不承载业务资料 |

首次访问创建独立合成演示种子，不导入本机开发库或照片。数据库连接由请求的 AsyncLocalStorage 范围决定，请求结束关闭；未授权访问不打开业务库。本机生产测试只允许 `.runtime` 下独立目录。

### 运维：先停应用，再备份 / 恢复 / 清理

以下命令只在目标云端维护环境中运行，需已有相同 `AUTH_MODE` / `WUJIAN_DEPLOYMENT` / `PRODUCT_AGENT_DATA_DIR`。Compose示例先停止app；再使用共享卷的一次性容器：

```sh
docker compose --env-file cloud.env run --rm --no-deps app node scripts/cloud-ops.mjs backup --server-stopped
docker compose --env-file cloud.env run --rm --no-deps app node scripts/cloud-ops.mjs cleanup
docker compose --env-file cloud.env run --rm --no-deps app node scripts/cloud-ops.mjs cleanup --apply --server-stopped
```

备份执行 `VACUUM INTO`、完整性校验和SHA256。`--server-stopped` 是操作者声明，脚本不能远程证明服务已停；不要并行操作业务库。快照含私人演示内容，只能受保护保存、另做离站备份与保留期限。

恢复必须切换到**新的空卷**，把快照以只读目录提供给维护容器，再执行 `node scripts/cloud-ops.mjs restore --from <快照目录> --apply --server-stopped`。已有注册库或访客目录会拒绝覆盖。恢复保留原会话哈希、数据、预算和AI_STOP状态；环境密钥/邀请码不在备份中。不要将旧源码运行于已升级的数据库。

清理默认仅预览；应用停机且明确 `--apply` 才删除已到期的服务器随机访客目录及注册项，保留其他空间。清理不自动删除快照。当前未配置平台定时任务；维护者需安排到期清理和快照保留策略，达到存储/空间上限会拒绝新建，不自动清空用户数据。

## 公开模式安全与费用边界

- **身份**：服务器随机不可猜测Cookie；只存哈希，HTTPS下 `Secure; HttpOnly; SameSite=Strict`，绝对有效期默认24小时。有效期内刷新/服务重启可继续。退出立即撤销；清除Cookie或过期失去入口。不是实名账户，无法把Cookie额度宣称为真实人的唯一额度。
- **隔离**：每访客一个独立数据库。公开API忽略客户端角色/tenant参数，固定本人演示角色；查询、照片和记忆仍执行原领域权限。其他空间ID、会话ID、媒体ID不能切换数据库。公开模式隐藏演示身份切换，家庭成员仅合成数据；不提供跨访客家庭账户或跨空间赠礼领取。`/legacy`保留本人能力，不能模拟其他成员操作。
- **来源与权限**：所有业务API要求会话与精确Host/Origin，写操作需要同源Origin；健康检查仅返回布尔健康。JSON响应清除凭证、内部Trace及路径；日志只记请求ID、路由、状态、耗时、模型尝试及预算预留，不记提示词、Cookie或Key。平台访问日志权限另由部署者配置。
- **HTTP**：每访客90次/分钟（可降低），最多4个并发/全站24个；入口尝试全站30次/分钟，新空间5次/分钟，默认30个活跃、硬上限60个已存空间。邀请码+平台流量防护仍必要，应用限额不等于DDoS防护。
- **上传**：JSON正文256KB、multipart总正文8.5MB；单照片5MB且实际解码为JPEG/PNG/WebP、重编码，单资料8MB并校验。每访客上传原始字节累计20MiB、存储50MiB，全站默认512MiB（含备份）；上传最多每访客1个/全站2个。失败上传也占累计额度，避免反复消耗。存储在写入前检查，允许删除清理；不是磁盘配额级硬边界，需平台卷容量监控。
- **模型**：默认关闭；三开关、当前北京兼容接口及模型配置同时满足才可启用。默认每日全站40次/访客6次，失败也计数，最多2个全站并发、每访客1个；Agent公开回合最多1次模型尝试，工具后续请求仍逐次计数，不隐式无限重试。
- **Token**：单请求输入JSON60KB、输出最多1800tokens；全站每日500000保守预留，输入按完整请求UTF8字节数+256开销估算并加输出上限，失败不退。预算按UTC日重置，随数据库持久化。它是成本约束，不是精确账单或人民币硬上限；仍应在百炼/平台配置账户预算告警。价格与套餐由用户在购买时核实。
- **急停与降级**：设 `DEMO_AI_ENABLED=false` 并重启，或由维护者在数据根创建 `AI_STOP` 文件即时拒绝后续模型请求；已发送的请求无法取消计费。删除该文件不代表自动授权，三开关仍需满足。费用关闭或额度耗尽时资料、录入、故事和有限离线创意继续工作。
- **外部读取**：现有URL读取在DNS前限制允许主机，DNS检查及连接地址固定，拒绝内网/元数据/特殊IP，有限同主机重定向、大小和超时；默认每访客12次/小时、全站200次/天。`DEMO_SOURCE_HOSTS`只能由维护者配置。受限平台不绕过；关闭 `WUJIAN_ALLOW_PUBLIC_FETCH` 可完全停止资料联网。默认关闭额外付费搜索、视觉和OCR。

## 协议与失败处理

JSON模式明确在模型输入中要求合法JSON；普通对照可关闭JSON模式，避免仅设置 `response_format` 却缺少JSON约束。保留工具协议。安全分类400/401/403/429、上游408/504、网络中断、客户端超时、响应结构异常、额度限制和Agent校验失败。不会把上游原始错误正文回传浏览器或写日志。

删除原Provider `complete` 的40秒硬上限：默认模型60秒、最大90秒，并受Agent剩余时间限制；公开Graph最多75秒。代理须允许至少120秒（Compose已配置），Railway实际请求时限仍需平台验收。未新增队列。历史A5网络失败不能仅归因于此上限，历史普通对照400也没有保存可用于断定唯一原因的原始错误正文；本轮仅证明离线协议/错误路径，不冒称已在线修复。

## 已验证与未验证

结果见 [脱敏验收](cloud-demo-validation-2026-10-21.json)。独立Node生产服务、两访客、ID伪造/越权、重启、全量快照到空卷恢复、Edge故事刷新、HTML/JS/API假密钥哨兵扫描、额度跨重启、费用关闭、退出和清理均实际通过。费用开启分支仅用测试进程预加载的离线替身；它不在Docker镜像，也不是产品后门。

未验证：Docker构建/容器权限、Railway挂载与真实重部署、公网HTTPS和Secure Cookie实机传输、云区到百炼链路、真实Qwen本轮协议/超时效果；没有新的付费请求。原商品知识和创意质量缺口不因部署改造升级。Benchmark仍有1条正确改写误拒。

单实例SQLite适合本轮受控演示，尚不支持水平扩容。未来并发增长再迁移PostgreSQL：先以服务器租户身份为领域查询显式加tenant_id/RLS，迁移checkpoint和预算事务，再将媒体迁入授权对象存储；迁移前后做隔离/恢复对照。当前不引入新数据库、账户服务或队列。
