"""Versioned app instructions; never a second memory store or intent router."""
from copy import deepcopy

GUIDE_VERSION = "wujian-app/2026-11-07"

_TOPICS = {
    "overview": {
        "title": "物间与阿圆",
        "instructions": "物间通过理解人和物，把用好物品、发现新玩法、留下回忆、传递心意连接起来。阿圆是物伴页的主助手；物品分身是可选的独立聊天身份，按用户给它的昵称与设定表达。",
        "sections": ["物伴", "物品", "回忆", "朋友"], "entry": "#companion",
    },
    "assistant": {
        "title": "直接和阿圆说",
        "instructions": "在物伴页输入文字，或通过相机按钮附上照片。可以问东西怎么用、请阿圆找新玩法、准备一件事、记一段回忆、整理给家人的提醒或送礼心意。阿圆会复用现有物品、家庭、任务与回忆；需要时只询问缺少的关键信息。普通聊天不会自动发布到回忆墙。",
        "entry": "#companion",
        "examples": ["这个咖啡机怎么除垢？", "周末想在家玩点不一样的，看看我有什么能用。", "这张照片帮我记一下，今天和妈妈一起听了唱片。"],
    },
    "items": {
        "title": "我的物品与家庭用品",
        "instructions": "进入物品页切换我的物品、家庭用品。拍照录入时尽量补充真实品牌、型号和市场版本；手工礼物、石头等纪念物可以没有商品型号。打开物品卡查看身份、当前状态、位置和提醒、使用指导、回忆或分身入口。使用问题与新玩法会回到阿圆，并带上这件物品的上下文。",
        "entry": "#items", "tools": ["find_items", "read_item"],
    },
    "creative": {
        "title": "发现新玩法与一起做件事",
        "instructions": "从发现新玩法入口或直接对阿圆说想法。可以围绕一个物品找新用途，也可以围绕读书角、聚会等目标组合已有资源。灵感资料用于理解机制，仍要核对用户物品的材料、型号、状态与实际条件；不要求把纸杯、细绳等所有零碎都登记进库存。可继续的方案保存在同一份任务里，反馈会更新它。", "entry": "#companion",
    },
    "memories": {
        "title": "记下一刻与一起的回忆",
        "instructions": "在回忆页点记一刻，或直接向阿圆发送照片和想记的话。可以只记生活经历，也可主动关联已有物品；不用先录入一个物品才允许记录。日期未知就不编造往事日期，照片中的物品不会默认自动建档。保存记录和允许以后聊天参考是两件事，普通聊天有用的偏好可以安静积累，不反复追问每句话是否保存。",
        "entry": "#memories", "tools": ["record_experience", "recall_memories"],
        "execution": "用户明确说记录就调用record_experience，传本轮真实附件photo_ids；未指定关联物品可用item_ids=[]。私人记录是默认，不因为提到妈妈就发到家庭。",
    },
    "family": {
        "title": "家人交代的事与大字版",
        "instructions": "家人提醒在提醒/家人交代的事中查看；家庭用品与家人共用同一物品状态。可直接说提醒谁、什么事、什么时候，阿圆查找真实家庭成员后整理一张待确认卡；用户确认后才真正建立提醒。对象不明确时问一句，不虚构爸爸妈妈等联系人。大字版聚焦问问题和家人提醒，可查看简短步骤；语音是否可用取决于当前浏览器与权限。",
        "entry": "#care", "tools": ["list_households", "list_action_recipients", "prepare_reminder"],
        "execution": "准备草稿不是已通知，不额外复制为另一份任务。确认后建立对方在物间内可见的提醒记录和约定时间；没有系统级推送保证，不承诺到时自动发出消息。",
    },
    "gifts": {
        "title": "把礼物与一段心意送出去",
        "instructions": "朋友页可看好友、心愿和赠礼。可以直接对阿圆说把哪件物品送给哪位好友、想说什么；阿圆整理待确认心意卡。用户一次确认后形成待接收礼物；对方接收后由对方控制物品与分身后续改变。实体寄送要另行安排，应用不会自动购物、付款或寄快递。",
        "entry": "#friends", "tools": ["list_action_recipients", "prepare_gift"],
        "shadow": "赠送者的影子来自本次写给对方的话、专为礼物拟定的表达风格及明确选择的故事，不能复制整段私人聊天、私有成长理解或所有回忆。可在同一次礼物预览中确认，不逐段打断用户询问。分身表达的是留下的心意，不冒充赠送者实时本人。",
    },
    "companion": {
        "title": "物品自己的分身",
        "instructions": "物品卡中可以选择开启分身、昵称、形态与性格；不是所有物品都必须有分身。进入和它聊聊才采用这件物品的身份。用户明确设置为主干，获准的共同经历与表达习惯可以形成有情境的特点；可以暂停成长或修改。收到的故事保留原作者，不会变成收礼者亲历。", "entry": "#items",
    },
    "devices": {
        "title": "让设备更合自己的心意",
        "instructions": "从物品的新玩法/工作台入口或直接对阿圆描述具体改变。阿圆可以为同一物品亲自编写HTML/CSS/JavaScript小工具、检查并发布到工作台；已安装工具与阿圆制作的作品会区分，点继续改可接着完善同一份作品。先读取已有型号与状态、查证适用资料，再指导或使用已连接且获准的本机工具。连接蓝牙不保证协议可控，浏览器检查也不证明实物效果；设备模式/音量改变要由用户在外层确认。",
        "entry": "#companion", "tools": ["read_item", "device_connections", "inspect_earbuds", "connect_earbuds", "read_earbuds", "create_workbench", "write_workbench", "check_workbench", "publish_workbench"],
    },
}


def guide_index():
    """Prime a small capability index; retrieve detailed instructions on demand."""
    return {"version": GUIDE_VERSION, "name": "阿圆", "topics": {
        name: row["title"] for name, row in _TOPICS.items()
    }, "note": "询问物间怎么用或功能入口时用read_product_guide读取准确说明；用户要求办事时用实际业务工具，说明书不证明已执行。"}


def read_guide(topic="overview"):
    if topic not in _TOPICS:
        return {**guide_index(), "requested_topic": topic,
                "note": "请从topics选择主题；没有列出的功能不能当作已实现。"}
    return {"version": GUIDE_VERSION, "topic": topic, **deepcopy(_TOPICS[topic])}
