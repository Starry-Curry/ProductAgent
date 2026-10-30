# REA 有界预研（未接入产品运行时）

检查日期：2026-10-30。证据为 [morluto/rea](https://github.com/morluto/rea) 官方源码、README、package.json、MCP contracts、installation 与 CLI 文档；本轮读取版本 6.8.0，main 提交 `317bf3fe235e655b2d752d3be261cc0da7d00f2b`。未来执行必须重新核对固定版本，不运行不受控的 latest/setup。

## 实际能力与本机条件

REA 是把软件分析工具接到 Agent 的 CLI/MCP 能力层。官方实现覆盖 JavaScript/Electron、原生二进制、.NET、Android APK/ADB、网站及固件等目标，具体能力依赖对应分析工具。它不是通用家电控制协议，也不自动获得设备访问权。静态 JavaScript 分析不需要反编译引擎；原生分析需要 Hopper/Ghidra/IDA/Kuna 等，APK 需要 JADX/JDK，Android 连接使用调用方提供的 adb，固件提取依赖 Linux 上的 Binwalk/Unblob。

本机 Node **24.16.0**；该版 [package.json](https://github.com/morluto/rea/blob/317bf3fe235e655b2d752d3be261cc0da7d00f2b/package.json) engines 为 **^22.23.4 || ^24.22.1 || >=26.12.1**，因此未安装或执行 REA，未修改全局 Node、MCP 或 Codex 配置。Windows 原生工具还需单独核对支持范围。没有“已通过 REA 最小测试”的结论。

## 各工具负责什么

| 路线 | 负责 | 不代表 |
|---|---|---|
| 厂商 API / 已有适配器 | 已公开的设备功能与授权控制 | 所有型号、地区、固件都兼容 |
| [Home Assistant](https://contributors.home-assistant.io/core/internals/rest-api/) | 集成后的实体、服务、状态接口 | 替用户完成所有设备配网与授权 |
| [Matter](https://docs.espressif.com/projects/esp-matter/en/latest/esp32/introduction.html) | 支持设备的互操作与桥接 | 任意旧设备天然支持，或自动解密私有协议 |
| [Bleak](https://bleak.readthedocs.io/en/latest/) | 在本地蓝牙环境中读写 BLE GATT | 已知某个特征值的业务含义或有权写入 |
| [ADB](https://developer.android.com/tools/adb) | 授权 Android 设备/模拟器的调试通道 | 所有电视开放 ADB、无需配对授权 |
| REA | 分析授权软件、发现行为与证据 | 已验证控制能力、硬件安全保证 |
| MCP | Agent 调用工具的接口 | 设备协议、安全沙箱或用户许可本身 |

顺序：用户目标 → 型号/版本核对 → 官方 API 与既有适配器 → 明确的能力缺口 → 仅分析授权目标 → 候选适配器 → 人工审阅与授权 → 隔离测试 → 状态回读 → 保存版本化能力。没有缺口时不为使用 REA 而逆向。

## 后台接入与部署边界（设计，未实现）

可以由产品管理执行环境，避免终端用户自行装齐开发工具；但本地设备的发现、配对与运行权限仍需用户参与。后台进程只接收白名单操作，不把模型输出直接当 shell 命令。

```ts
type ExplorationJob = {
  owner: string; itemId: string;
  target: { kind: 'owned-source' | 'authorized-package'; sha256: string; version: string };
  permission: { scope: 'static-read'; expiresAt: string; evidenceId: string };
  requestedEffect: string;
};
type CapabilityCandidate = {
  model: string; firmwareRange: string;
  inputSchema: object; evidenceRefs: string[];
  status: 'hypothesis' | 'software-tested' | 'device-verified';
  executor: 'cloud-api' | 'local-worker' | 'home-gateway';
  readback: string; idempotency: string; rollback: string;
};
```

- **纯云端**：适合上传且获准分析的文件、公开资料、受授权云 API；无法凭空访问家庭 LAN、USB、BLE。
- **用户电脑**：可分析本地授权文件，连接其明确选择的模拟器/设备；需要隔离 worker、权限可撤回及可见日志。
- **家庭网关**：适合持续 LAN/BLE/Matter 连接，但不能假定每个网关能运行大型反编译工具；分析和执行可分开。

凭证只保存在执行器的秘密存储，能力记录不包含令牌；共享/赠送不转移设备控制权。重复写入必须有幂等键，成功必须有状态回读，超时按未知状态处理而非自动重发。

## 下一轮唯一建议 PoC（尚未执行）

在独立目录使用兼容的便携 Node，固定 REA 版本；创建本项目自有的微型 JS“灯具设置模拟器”，仅静态读取。让 REA 找到亮度输入范围、状态存储与读回调用，记录证据和遗漏，再由现有 LangGraph 调用只读工具。不得使用真实灯、私有 APK、真实账户或家庭数据库。

通过标准：正确定位已知接口；不存在的命令明确未知；越界路径和非白名单操作被拒绝；重复只读操作不产生写入；生成适配器只对模拟器运行并验证读回。该测试最多证明软件分析/适配链路，不能称为真实硬件控制或设备逆向成功。本轮到此停止预研，不扩展框架与设备部署。
