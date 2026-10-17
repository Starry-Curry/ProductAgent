# 本次交接验证（2026-10-17）

在项目外的独立源码副本执行，Node v24.16.0 / Windows；测试服务端口 3147；PRODUCT_AGENT_DATA_DIR 指向独立 synthetic-data。原业务服务与数据库未用于这些测试。

| 命令/检查 | 本次结果 | 证据 |
|---|---|---|
| npm ci | 成功，按锁文件安装 31 packages；未改变依赖版本 | install.log |
| npm test | 26/26 通过，0 失败/跳过；约 863.9ms | test.log |
| npm run test:benchmark | 完成；5 个错误放行→0，1 个正确改写误拒 | benchmark.log、benchmark.json |
| npm run build | 成功，静态页面与 API 路由生成 | build.log |
| npm run typecheck | 成功 | typecheck.log |
| npm run start:local | 独立服务成功启动，HTTP/API 与浏览器可访问 | 集成测试与截图 |
| TEST_BASE_URL=http://127.0.0.1:3147 npm run test:integration | 通过，4958ms | integration.log/json |
| node review-tools/capture.mjs | 最终通过，12 张截图，0 pageerror、0 横向溢出 | capture.log、screenshots.json、screenshots/ |
| 额外缺配置错误请求 | 503 not_configured；回放不请求模型 | agent-unconfigured-example.json |
| 实际千问/付费 API | 未执行，真实调用次数0 | 无成功在线调用证据 |
| 实物/设备测试 | 未执行 | 不宣称已验收 |
| npm audit/渗透测试/负载测试 | 本次未执行 | 不将源码安全扫描等同安全审计 |

本次 benchmark elapsedMs=6.824900000000014，仅本机离线校验/测试替身，不是模型性能或费用。

截图首次尝试脚本在采图后读测试物品失败：该物品已赠送，原 actor 的可见列表不含它。辅助脚本改为收礼人读取后通过；业务代码未改。首次失败原始日志 capture-first-attempt.log 保留。其后的请求正确返回 needs_identity，因为认领已清除原绑定；另建测试物品记录 not_configured 分支。

截图包含虚构初始化内容与集成测试物品。首页与“使用帮助”是同一主视图。实际查看了桌面家庭页与移动发现页截图；其余做页面运行/溢出自动检查，未声称逐像素验收。

来源校验工具依赖未打包的外层原 ZIP/.git，本次未在独立包重跑；保留此前 baseline-provenance.json。总任务书与上游仓库仍缺失。

本次没有修改业务逻辑，没有调用模型，没有迁移/清空原用户数据库。构建缓存、安装依赖与测试库都排除于 ZIP。
