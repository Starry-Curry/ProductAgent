# 部署说明

## 部署模式

| 模式 | 用途 | 身份 | 数据 |
| --- | --- | --- | --- |
| 本地开发 | 开发与演示 | 固定本机演示角色 | `data-life-v1/` |
| 本地生产 | 构建后验收 | 固定本机演示角色 | 隔离数据目录 |
| Docker / ModelScope | 公开体验 | Cookie 访客空间 | 独立持久化 Volume |

本地模式只监听 `127.0.0.1`。公开模式由 `scripts/cloud-start.mjs` 启动，并额外校验公开 Origin、持久化目录、费用和配额。

## 本地启动

```bash
npm ci
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

默认地址为 <http://127.0.0.1:3200>。`npm start` 使用 `life-local.mjs`，会为本机演示自动设置身份和数据目录。

## Docker

构建：

```bash
docker build -t product-agent:local .
```

仅用于本机验证的启动示例：

```bash
docker run --rm \
  --name product-agent \
  -p 7860:7860 \
  -v product-agent-data:/mnt/workspace/wujian \
  -e APP_PUBLIC_ORIGIN=http://localhost:7860 \
  -e DEMO_ALLOW_LOCAL_HTTP=true \
  -e DEMO_REQUIRE_VOLUME=false \
  -e DEMO_OPEN_ACCESS=true \
  product-agent:local
```

访问 <http://localhost:7860>。`DEMO_ALLOW_LOCAL_HTTP` 只用于本机 HTTP 验证；公开部署应使用 HTTPS。

Dockerfile 默认值：

- Node.js 24
- 端口 `7860`
- `AUTH_MODE=public-demo`
- `WUJIAN_DEPLOYMENT=cloud`
- `PRODUCT_AGENT_DATA_DIR=/mnt/workspace/wujian`
- AI 与付费调用关闭
- 健康检查访问 `/api/health`

## ModelScope 创空间

`ms_deploy.json` 使用 Docker SDK、2 vCPU / 16 GB 资源配置和 `7860` 端口。

### Secrets

只有在启用真实模型时需要：

| 名称 | 内容 |
| --- | --- |
| `AI_API_KEY` | 部署者自己的北京百炼 API Key |

不要把 ModelScope Token、GitHub Token 或任何平台凭据填入 `AI_API_KEY`。Key 不应出现在镜像、Git、日志或 `NEXT_PUBLIC_*` 变量中。

### Variables

| 名称 | 建议值 | 说明 |
| --- | --- | --- |
| `APP_PUBLIC_ORIGIN` | `https://<你的独立空间域名>` | 必须是无路径、无账号的 HTTPS Origin |
| `DEMO_OPEN_ACCESS` | `true` | 允许匿名访客创建隔离演示空间 |
| `DEMO_AI_ENABLED` | `false` | 默认关闭真实模型费用 |
| `AI_ALLOW_PAID_CALLS` | `false` | 第一层显式费用授权 |
| `WUJIAN_ALLOW_PAID_CALLS` | `false` | 第二层业务费用授权 |
| `AI_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 北京百炼兼容端点 |
| `AI_MODEL` | `qwen-plus` | 可按已验证模型调整 |
| `AI_JSON_MODE` | `true` | 结构化输出 |
| `AI_ENABLE_THINKING` | `false` | 公开演示默认关闭 |
| `AI_REQUEST_TIMEOUT_MS` | `60000` | 模型请求超时 |
| `DEMO_VISITOR_MODEL_CALLS` | `8` | 单访客每日模型调用上限 |
| `DEMO_GLOBAL_MODEL_CALLS` | `80` | 全站每日模型调用上限 |
| `DEMO_DAILY_TOKEN_BUDGET` | `500000` | 全站每日 Token 预留上限 |
| `DEMO_MODEL_CONCURRENCY` | `2` | 全站模型并发上限 |

`DEMO_OPEN_ACCESS=true` 时，不应再配置 `DEMO_ACCESS_CODE`。如果需要邀请码，则关闭开放访问并仅通过平台 Secret 提供 `DEMO_ACCESS_CODE`。

### 启用真实模型

同时完成以下设置：

```dotenv
DEMO_AI_ENABLED=true
AI_ALLOW_PAID_CALLS=true
WUJIAN_ALLOW_PAID_CALLS=true
AI_API_KEY=<仅放平台 Secret>
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen-plus
```

这会允许公开访客在额度内消耗真实费用。上线前请确认预算、并发和访问范围。

立即关闭：

```dotenv
DEMO_AI_ENABLED=false
AI_ALLOW_PAID_CALLS=false
WUJIAN_ALLOW_PAID_CALLS=false
```

然后重启服务。维护者也可以在持久化数据根目录创建 `AI_STOP` 文件；该文件存在时模型费用保持关闭。

### 持久化 Volume

公开模式要求 `PRODUCT_AGENT_DATA_DIR=/mnt/workspace/wujian` 位于真实独立挂载，而不是容器根文件系统。

Dockerfile 默认 `DEMO_REQUIRE_VOLUME=true`。如果平台没有实际挂载，服务应拒绝启动，而不是宣称数据已经持久化。

关闭 `DEMO_REQUIRE_VOLUME` 只适用于本机模拟，不应作为公开部署修复手段。

### 部署后检查

1. 查看构建日志，确认 `npm ci` 和 Next.js 构建成功。
2. 访问 `/api/health`，确认返回 `{"ok":true}`。
3. 使用全新无痕窗口访问首页，点击“开始我的演示”。
4. 确认载入 25 件物品、4 个预置创意、4 段故事和 2 个章节。
5. 刷新后内容不重复，用户新建内容仍存在。
6. 使用第二个独立浏览器验证看不到第一个访客的修改。
7. 测试上传限制、退出空间和连续请求限流。
8. 仅在显式开启模型后测试一次受控请求，并核对结果来源与费用记录。

`/api/health` 返回成功只代表服务和 SQLite 可用，不代表模型、外网资料、HTTPS 或业务答案已经验证。

## 反向代理与 HTTPS

- `APP_PUBLIC_ORIGIN` 必须与浏览器实际访问 Origin 一致。
- 平台代理如改写 Host，只在 ModelScope 专用镜像中通过 `WUJIAN_MODELSCOPE_PROXY=true` 处理。
- 不要为了兼容任意代理而关闭 Origin 或跨站检查。
- 公开入口应使用 HTTPS；访客 Cookie 在 HTTPS 下自动设置 `Secure`。

## 数据备份

持久化目录包含访客注册表、个人工作区和上传媒体。备份前应：

- 停止写入或使用一致的 SQLite 备份方式；
- 将数据库和媒体一起备份；
- 检查恢复环境的目录权限；
- 不把备份提交到 Git；
- 定期清理过期访客，避免无界增长。

## 当前验收状态

当前快照记录了 Windows 本机生产构建和 Edge 浏览器验收，未在当前环境完成 Docker/Linux、ModelScope HTTPS 与真实 Volume 验收。部署者必须按上面的检查清单重新验证。
