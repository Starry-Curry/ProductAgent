# 编者灵感参考

`catalog.json` 在独立审查后保留 **102 个活跃候选应用**，覆盖 12 类场景：41 条从项目维护者的公开文档机制迁移，61 条只借用了 B 站真实标题/简介的方向，动作与组合由编者明确提出，全部待当前实物试用。它不是 102 份已看完的教程，也不是 102 次成功试用。

初稿 104 条中，剩菜可见区与先吃区重复、用灯找小零件与吸尘器参考关联过弱，已撤回，不为数量补弱案例。`retired_entries` 保存键、原因与旧正文摘要。导入会将对应旧编者行标为 `curated_reference_retired`，保留旧 ID/正文供历史引用，已有 ReMe 投影在下一次检索中移除这些行；再次导入不会重新激活它们。

每条含资源条件、具体机制、第一步、观察点、未知、证据等级和原始来源。参考正文保存到业务库 `SourceRecord(origin="curated_reference")`，不创建物品、用户记忆、经历或型号知识。原始 `public_web` 记录保持独立；导入逐一校验原始 SQL ID、所有者、URL、标题与正文 SHA256。该清单中的 ID 指向本轮已采集公开资料，不能在另一空数据库里凭空生成原始证据。

运行前使用现有已迁移数据库。默认仅核查；`--apply` 会先备份 SQLite，再幂等导入。既有编者 key 的内容变化会拒绝覆盖，需审查新版本/key。

```powershell
.venv/Scripts/python.exe scripts/import_creative_catalog.py --user-id person_demo_owner
.venv/Scripts/python.exe scripts/import_creative_catalog.py --user-id person_demo_owner --apply
```

主 Agent 继续使用已有 `search_world(kinds=["source","knowledge"])` 与 `read_source`；ReMe 只投影已授权 SQL，参考不是另一套记忆库。检索词不意味着用户拥有这些物品，现有案例也不证明当前国内型号兼容。不需要登录 B 站即可检索已留存正文；确实需要原作者动作时，应读取相应原页或有界抽帧，不能从本清单补写已观看内容。

离线验证：

```powershell
.venv/Scripts/python.exe -m unittest tests.test_creative_catalog -v
```
