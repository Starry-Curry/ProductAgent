# 电脑服务器固定入口 · 网关源代码参考

这是已实现的 Worker ESM 网关副本，App 和业务 SQLite 仍运行在 Mac。Worker 将请求暂存在私有 R2 mailbox，由电脑主动连接拉取并回传结果；公开 JS/图片独立缓存，电脑离线时返回离线提示。

本地验证：Node.js 24 下在本目录运行 `node --test tests.mjs`。没有额外依赖。

实际部署需要自己的 Worker/Sites 项目、名为 MAILBOX 的 R2 绑定、运行时 HOST_KEY secret。配置模板为 `.openai/hosting.example.json`，自行注册项目并填写部署身份后生成 `.openai/hosting.json`；不要复制原部署的项目 ID。`bash scripts/build.sh` 输出 dist/server/index.js。此模板不含站点账号、密钥和线上状态。

电脑端代码位于根目录 scripts/pc-host-relay.mjs 与 scripts/pc-host-install.mjs。安装前须先构建 App、配置本机模型 .env.local，并在本机生成与服务端一致的 256 位 host key，保护为 0600，放入 .runtime/pc-host/host-key；不要提交密钥。安装脚本仅适用于 macOS，生成当前用户的 LaunchAgent 与 Application Support 安装副本。

网关仅实现有界 HTTP 转发，不提供任意本机端口访问、命令执行、SSE 或 WebSocket；业务权限仍由原 App 校验。请求内容和 Cookie 会经过中转，不把“数据库在本机”理解为数据从不经过第三方。

已知问题：原 chatgpt.site 公网入口在用户手机网络下需要 VPN。因此这是技术与版本参考，不能承诺国内免 VPN 可达。要更换入口，应连同电脑端 APP_PUBLIC_ORIGIN、网关地址和二维码一起更新并重新实测。
