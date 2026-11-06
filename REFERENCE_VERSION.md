# 物间 · 手机版参考快照

分支：`reference/mobile-20261106`。保存日期：2026-11-06（北京时间）。这是完整手机网页 App，和电脑版共用响应式 Next.js 源码，不是 iOS/Android 安装包。此快照不替换原仓库主分支。

## 本机运行

使用 Node.js 24，首次运行：

```bash
npm ci
cp .env.example .env.local
npm run build:companion
npm run start:companion
```

打开 http://127.0.0.1:3210/ ，浏览器用 390px 宽度检查手机布局。默认本地资料模式；在自己电脑的 .env.local 填写北京百炼 AI_API_KEY，再运行 `node scripts/companion-start.mjs start --cloud` 启用真实 AI，模型请求由服务商计费。模型配置和密钥不在分支里。

## 手机公网与电脑服务器

真实手机需访问配置好的 HTTPS 入口，相机/麦克风能力由浏览器支持并授权；127.0.0.1 是访问者自己的设备，不是同学可访问的公网地址。

- scripts/mobile-demo-start.mjs：独立访客模式及模型额度、Cookie/来源检查。
- scripts/pc-host-relay.mjs：电脑主动连接公网网关，包含心跳、重连与短期去重。
- scripts/pc-host-install.mjs：macOS 登录自启与 Application Support 安装副本，需要已有构建、模型配置和主机密钥。
- deploy/pc-gateway/：实际固定入口的 Worker/R2 源码、测试、构建脚本及无部署身份的模板。
- scripts/mobile-qr.mjs：生成并解码校验 HTTPS 二维码；--persistent 输出固定入口说明。
- START/STOP_MOBILE_SHARE.command：启动/停止已安装的 Mac 服务，不会替新电脑自动注册云账号。
- scripts/mobile-share.mjs：旧临时隧道实现保留作历史参考，会更换地址，不用于固定二维码。

克隆 Git 不会复制原电脑已安装的服务。重新部署需要自己的公网入口和运行密钥，参见网关目录 README。业务 SQLite 在电脑，转发内容会经过公网入口，公开静态资源有缓存。

**最新已知问题：当前 chatgpt.site 入口在用户手机网络下需要 VPN，国内免 VPN 入口尚未完成。** public/share 中旧二维码保留该地址，仅供追溯，不以历史可达测试覆盖最新反馈。

## 保留功能与参考

完整保留手机输入布局、普通/大字版、连续问答、红箭头分步示意、照片定位、摄像头周期识别、浏览器演示视频、型号推测确认、家庭/私人物品分区、好友列表和加好友、心愿赠言与购买入口、待办日期和分工、两轮模型活动规划及库存核对。

参考截图：docs/reference/screenshots/mobile-home.png 与 mobile-elder.png。手机适配和技术报告见 docs/engineering/mobile-delivery-2026-11-06.md；电脑服务实现见 pc-host-fixed-entry-2026-11-06.md，并结合最新 VPN 限制阅读；归档验证见 reference-branches-2026-11-06.md。

默认公开访客空间 72 小时有效，不是永久账号同步；型号和操作示意可能为估计或演示，不声称全部实物和浏览器都已验证。源码不含私人数据、上传照片、node_modules、构建输出或密钥。后续开发请从此分支另建分支，保留本快照作参考。
