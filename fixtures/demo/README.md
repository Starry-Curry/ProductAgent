# 本地模拟家庭库存

`2026-11-06_household_inventory.json` 用于扩充小林演示账号值得管理的商品、日常耐用品，为真实联网测试提供国内可核对的完整品牌、型号和用途。拥有关系、数量、位置均是模拟设定；没有虚构固件、连接状态、实机观察或成功结果。用户原有物品、故事和偏好不被清单覆盖。

本清单的标准商品核对国内官方页面、明确型号或商品货号，附主要用途与功能介绍。普通纸杯、细绳、购物纸袋等零碎材料无需录入库存，按当前任务临时询问有无即可；此前清单中12项这类材料（含绘画纸、封箱胶带）已移除。业务本身仍支持手作礼物、石头等值得珍藏的非标物品。照片采用对应型号官方真实产品照，保留来源。照片不随 Git 提交，下载在 `tmp/demo-inventory/photos/`；导入后存入已有 Asset 系统。界面正常展示照片，来源记录在内部，不添加“产品示意图”角标。旧款只声明国内官方可查，不声称当前仍在售。当前清单共30件明确商品模板：26件既有模板加4件家电数码（空气净化器、投影仪、音箱、扫地机器人）。电饭煲因官方外观图同时展示两种规格，本轮不纳入；旧照片缓存可保留，但不作为当前清单导入。

在项目根目录执行：

```powershell
.venv/Scripts/python.exe scripts/import_demo_inventory.py --prepare-photos
.venv/Scripts/python.exe scripts/import_demo_inventory.py --dry-run --user-id person_demo_owner --household household_demo_home --refresh-demo-photos
.venv/Scripts/python.exe scripts/import_demo_inventory.py --apply --user-id person_demo_owner --household household_demo_home --refresh-demo-photos
```

默认只预览，不自动建库、迁移、创建用户或家庭。使用前核对目标账号和家庭。`--apply` 会先用 SQLite backup API 保存一致性数据库快照，并在同目录保存导入回执；旧照片和 Asset 保留。它复用 `domain.create_item`、`domain.change_item` 和 `interactions.household_item`，不创建另一套业务数据。

重复运行跳过已经导入的记录及已存在的同型号；`--refresh-demo-photos` 只允许小林账号中有原演示标记、且唯一匹配已核对型号的记录，用版本检查替换照片并更新 `photo_origin`、`photo_source_url` 两个照片来源字段，不改变其他状态、名字、故事、描述或分身。同内容照片不反复更新。其他真实记录不会因名字相似而被覆盖。

本清单只验证型号身份与照片，不能替代物间 Agent 自行搜索、读取资料和形成建议的真实验收。照片中的摆拍背景、其他道具不等于用户额外拥有这些东西；建议仍以物品档案与当前用户说明为准。
