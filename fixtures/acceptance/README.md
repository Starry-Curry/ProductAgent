# 历史独立验收样本与复现

这些文件是2026-11-06首测前冻结的原文，已经执行，不再是未见盲测。人物、拥有关系、状态回报和个人经历均为明确虚构；商品采用国内真实型号，公开资料由物间Agent实际搜索取得。`evaluator_only`、判据和setup说明只给评测人员，不进入Agent输入。

| 冻结文件 | SHA256 | 已执行范围 |
| --- | --- | --- |
| `2026-11-06_initial_cases.json` | `867d7a130b6ffd91b5f919a0d766f77081e7660be95f8dc0e62585a855d6ace0` | 游戏/组合、VARIERA替代用途、陶猫分身、电视资料研究，各3轮 |
| `2026-11-06_persona_cases.json` | `f40e381d38fdc402f78f3c5eb341ff9d5e1ee0c87a6beb85dc7e36bc4e7fb485` | 本人车票与收到的叶子书签，各3轮 |
| `2026-11-06_fresh_life_cases.json` | `9c3ae8e26d8493014b4c09ec6b5bef3131bd32fbfacedb8fbf0710797d778dcc` | Sony SRS-XB100安静玩法2轮；非标钩织鲸鱼陪聊/记录/重启接续3轮 |

配套criteria是当时的独立判据。其关于旧脚本缺少experiences/赠礼准备的说明也原样保留；当前脚本已通过真实HTTP完成这两种准备，并核对接收者默认AI关闭。文件状态字段是冻结当时的状态，实际运行与失败结论见 `docs/2026-11-06_创意回忆分身与名片实施记录.md`。

fresh_life配套criteria的SHA256为`ae772a874484ab793057891b4ce3c56c6d86c091da19a4006796163506d2b739`。该轮实际冻结代码为`9337890`，两组部分实现：玩法没有取得可支撑方案的原始社区案例；分身确实跨重启找回原句，但来自原聊天，未读取默认AI关闭的新墙记录。0008收据机制在首测之后补充，没有用后续修复覆盖首次结果。

普通CI、单元回归不调用真实模型。明确准备运行收费探测时，从仓库根目录执行，例如：

```powershell
.venv/Scripts/python.exe -m scripts.real_creative_eval --real --cases-file fixtures/acceptance/2026-11-06_persona_cases.json --case holdout-persona-keepsake-boundary-05 --label regression
```

`--independent`只用于评测人员确已在候选冻结前独立准备且未用于调参的新首测，不因为输入来自JSON文件就算独立。用本目录老题改进后重跑，应标regression/development；`--resume-from`只复制同一隔离评测目录下的合成库，保留原始失败。首次答复、修复复测和模型对照分开保存。

脚本读取本地密钥，不把密钥打印/提交；跨进程SQLite上限覆盖HTTPX/HTTPX2实际上游请求与重试。2026-11-06研发轮的600上限含一次早期保守预留200（非实测用量），不得删除账本或换目录重置预算。新增研发额度需负责人授权。原始资料、SQL、媒体和运行日志只在被忽略的本地目录保留。

工程绿灯、工具成功、有效引用、模拟观察和独立Agent评分均不能单独构成产品验收通过。保留当前NOT_ACCEPTED与未覆盖条件。
