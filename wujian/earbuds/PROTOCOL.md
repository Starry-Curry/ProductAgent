# FreeBuds 4E 电脑工作台

这个连接器只适配 Windows 已配对的 HUAWEI FreeBuds 4E。由 Python 标准库 Winsock Bluetooth Classic RFCOMM 访问控制通道 16；不需要刷机、新驱动或管理员后台程序。网页浏览器本身不直接访问耳机，实际执行端是用户电脑上运行的物间 Python 服务。

## 借鉴与选择

- [OpenFreebuds](https://github.com/melianmiko/OpenFreebuds/tree/0b4f14c0b500d491f0fb4ea38f2984ec334e3649)：成熟 Windows/Linux 耳机项目，其 `spp_transport.py` 使用 Python 标准库；其 Huawei `package.py`、`handler/battery.py`、`handler/anc.py` 提供带校验的 TLV 帧、电量和降噪回读证据。当前上游完整 GUI 要求 Python 3.13+，物间运行 Python 3.12，因此没有引入一整套重复桌面程序。
- [HuaweiPods](https://github.com/Nshpiter/HuaweiPods/tree/dc5b9d14e9030be95b178699d674d1a3217e1e6d)：`HuaweiAncLevelProfile.kt` 明确 FreeBuds 4E `000135/00` 对应轻度01、均衡00；`HuaweiAncPackets.kt` 提供查询、关闭、轻度、均衡帧；`HuaweiRfcommResponseParser.kt` 和 `BatteryParams.kt` 说明耳机电量0在部分路径代表不可用，不能直接显示为0%。
- [TWS-Pods-PC](https://github.com/Zhaoyi-ya/TWS-Pods-PC/tree/3350f424c1ab69c4bc6cff92dd7b603fb0025db2)：核对 Windows 注册表设备枚举思路。其 Huawei 握手此前未经作者实机验证，而且仅按名字路由/乐观更新模式不足以验收，未照搬这些行为。

这里是根据公开协议事实独立写的小型适配器，未复制上游 GPL 源码；没有引入另一个 Agent、数据库、任务队列或向量库。CRC16/XMODEM 使用标准库 `binascii.crc_hqx`。所有功能共享已有业务库的 `DeviceTarget`、`DeviceObservation` 和物品权限。

## 状态规则

1. 名称只筛选已配对候选；还要查询 `0107` 的产品代码0135，才允许使用4E降噪指令。
2. 电量查询 `0108`，参数2为左/右/盒；缺失、非法值、耳机0占位显示未知。原始 reported_levels 和校验通过的帧留在观察中。充电盒真实0保留。
3. 降噪写 `2b04` 参数1，值为 `0000`关闭、`0101`轻度、`0100`均衡。读取 `2b2a` 返回顺序为(档位,模式)，与写入相反；模式字节为0即关闭，设备可能保留上一档位，例如轻度后关闭回读 `01 00`。不能把保留档位误读为仍开降噪或未知；其他不支持的模式仍显示未知。
4. 写入必须收到成功ACK，然后再次查询状态。只有回读符合请求，才 `write_verified=true`；仍不冒充用户亲耳确认了声学效果。断开/不支持/超时没有编造电量或乐观成功。
5. 默认不运行轮询守护程序，用户或主Agent按需刷新。每台设备有短时互斥锁，完成后关闭socket，不占住手机控制通道。
6. 每次查询前丢弃已排队通知及旧分片；同批状态取最后一条匹配帧。该协议没有请求序号，不能据此声称排除了所有并发外部控制；回执证明的是随后观察到的状态，不是独占控制或声学效果。
7. 多台配对候选必须选明确地址；同一实际地址不能被另一个仍归原主人的物品重复认领。创建绑定的进程内锁覆盖数据库提交；部署多个独立服务进程时仍需数据库级唯一性设计，当前本地单进程不作跨进程保证。
8. 写入后丢失ACK、无有效ACK状态或回读断开时返回 `outcome_unknown`，不自动重写。缓存 `status` 不报告当前在线；明确刷新才读取真实设备。设备路由受既有 `rea_enabled` 开关控制。

## Windows 耳机输出音量

采用 [Pycaw](https://github.com/AndreMiras/pycaw) 20260926及其comtypes依赖访问成熟Windows Core Audio接口，锁文件只对Windows启用该依赖。这里控制的是当前Windows播放输出端点的主音量，不是Huawei私有协议里的耳机内部音量，也不切换默认输出、不控制麦克风。

名称相同不足以选中目标：默认输出名称需匹配FreeBuds4E，且OS端点属性中的BTHENUM实物路径必须含所绑定的准确蓝牙地址。写入还要求带回刚读取的 `endpoint_id`，写前复查默认输出未改变；不把失败回退到电脑扬声器。0–100标量设定后独立回读，保留原先的静音状态。实机发现蓝牙驱动的标量写会隐式解除静音，因此写后立即显式恢复原静音并一并验证；它不保证两次系统调用之间完全没有瞬时变化，也未测量实际声压。

## 本轮真实验证

2026-11-07 凌晨，在用户已连接的 FreeBuds 4E 上，物间模块读到了产品0135、HarmonyOS 2.1.0.232(F001H003C00)、左耳电量、充电盒电量、右耳不可用占位。轻度、均衡、关闭各自得到ACK及独立状态回读，最后恢复关闭。未联网到其他耳机、未改固件。

原始帧证据位于本机忽略目录 `tmp/freebuds-research/live-4e-anc.json`、`wujian-native-read.json`，不进入公共仓库。实物声学感受仍由用户佩戴验收。

独立审查后的2026-11-07 03:00（中国时间）只读复测，左耳57%、右耳0占位未知、盒32%、降噪关闭；见 `independent-review-live-read.json`。音量首次实测暴露驱动隐式解除静音，保留失败 `independent-review-live-volume.json`；修正后分别回读63.78%→62.78%→63.78%，两次写后静音均为true，见 `independent-review-live-volume-corrected.json`。末态恢复原音量及静音，没有把首轮失败改写为成功。

## 接线合同

`register_routes(app,current_user,db_session,settings)` 注册 authenticated HTTP 路由。`earbud_tool(db,user_id,operation,item_id=None,address=None,mode=None,volume=None,endpoint_id=None)` 是主Agent与HTTP共享的操作：inspect、status、create_console、read、set_anc、read_volume、set_volume。音量读写也复用已有DeviceObservation记录实际结果。创建只配置已实现的本地连接器和面板，并不授予模型任意shell权限。Agent运行时负责核对当前轮用户要求后才调用写操作；业务层再次核对物品所有权、绑定、配对、实际身份。

现成面板和连接器只是可复用能力，不能代替“物间Agent自己生成代码工作台”的验收。生成物的代码、隔离运行、有限宿主能力和实测结果需要另外核对。

本轮随后完成了真实Agent生成作品验收：千问在物间主循环中从空源码逐文件编写、检查并发布耳机界面，后续自然反馈仍修改同一Task，源码版本6→11→15→20。版本15及补真实静音显示的最终版本20都在生成界面中确认轻度／关闭及音量改变，均有真实连接器回执与独立回读，最后恢复原降噪、音量和静音；页面无JavaScript错误，未手工改写生成源码。Windows蓝牙输出端点存在音量量化，报告保留请求值、实际值及1个百分点容差，界面展示实际回读。证据在本机 `var/evaluations/2026-11-07-live-workbench/`、`2026-11-07-live-refine/`、`2026-11-07-generated-live-write/`；早期误读关闭状态与读取竞态失败也分别保留。未以此声称任意耳机可控或声学听感已测。
