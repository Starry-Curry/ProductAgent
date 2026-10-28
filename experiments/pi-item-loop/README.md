# 物间只读工具的 Pi 最小实验

这是隔离的研发实验，**没有接入生产 Agent，也不使用真实模型或硬件**。生产根目录的 package.json/package-lock.json 不依赖 Pi。

固定 npm 包版本：Pi Core / Pi AI / Pi Durable / Chord **1.4.0**；独立锁文件。Node 24 满足这些包声明的 Node >=22.19.0。

在仓库根目录复现：

```powershell
npm ci --prefix experiments/pi-item-loop --ignore-scripts --no-audit --no-fund --cache .runtime/npm-cache --registry https://registry.npmjs.org
node --experimental-strip-types experiments/pi-item-loop/poc.mjs
```

复用本轮 `read_item_context` 的相同业务数据与权限检查，验证 Core 的两回合工具往返、工具执行时撤权拒绝，以及 Durable 的 Node SQLite 持久化、正常关闭重开、相同 requestId 不重复执行已完成的读取。模型替身能看到实际工具返回的材质和未知项。

结果写入 `.runtime/item-v1/pi/result.json`，发布副本见本轮测试证据。首次试验用不完整 Models 替身触发 getAuth 接口错误，改用官方 createModels + 离线 Provider 后通过；保留失败日志。npm 最初尝试写全局默认缓存被系统拒绝，随后显式使用仓库运行缓存成功，没有扩大文件权限。

**界限**：这没有验证百炼协议适配、模型生成质量、写入审批、外部动作幂等或强杀进程后的恢复。没有部署 Cloudflare。安全重放的读取不代表设备控制也能安全重放。

当前官方 main 查询到 `df9275d4347f187610804c71d52e7c46bfd14848`；npm 1.4.0 与移动中的 main 不假定相同。Durable 官方明确标为实验 API，后续需要固定版本并重新执行契约和故障测试。
