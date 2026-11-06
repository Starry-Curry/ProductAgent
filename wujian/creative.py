"""Creative entry and research receipts in the existing conversation/run records."""
from sqlalchemy import select

from . import domain
from .database import ChatMessage, Run, SourceRecord, now
from .source_access import readable_source

RESEARCH_EVENTS = {"research_search", "research_source", "research_unavailable"}


def exploration_text(payload):
    return ("我想进入新玩法探索。\n想获得的体验：" + payload.goal.strip()
        + "\n我的条件和限制：" + (payload.constraints.strip() or "尚未补充，必要条件请核对")
        + "\n请先查找相关公开分享、实践案例或原理，再读取能访问的原文；"
          "不能访问的社区内容换公开来源，不绕过登录。结合我的实际物品与当前状态，"
          "给少量有区别的新玩法、启发来源、适用差异、最低试法和待核条件。"
          "把明确值得继续的方向保存为同一套事项的 idea 方案；未试过的条目保持 pending。"
          "如果资料不足，明确说明或补问，不把搜索摘要当作已读原文，不虚构分享链接。")


def record_research(sessions, user_id, message_id, name, value):
    if name not in {"search_public_web", "fetch_document", "read_source", "view_source_page"}:
        return
    if not isinstance(value, dict):
        return
    with sessions() as db:
        message = domain.require(db.get(ChatMessage, message_id))
        run = db.get(Run, message.run_id) if message.run_id else None
        if not run or run.user_id != user_id or run.status != "running":
            return
        if value.get('available') is False:
            receipt={'type':'research_unavailable','at':now(),'operation':name,'reason':value.get('reason','unavailable'),
                'query':value.get('query'),'url':value.get('url'),'http_status':value.get('http_status')}
        elif name == "search_public_web":
            receipt = {"type": "research_search", "at": now(), "query":value.get('query',''), "sources": value.get("results", [])[:15]}
        else:
            source = readable_source(db, user_id, value.get("source_id", ""))
            if source.origin != "public_web":
                return
            receipt = {"type": "research_source", "at": now(), "source_id": source.id,
                       "title": source.title, "url": source.url}
        # UI and the runtime read the same actual successful tool receipts.
        run.events = [*run.events, receipt]
        db.commit()


def require_research(db, run, result):
    if result.continuation is None:
        return  # Clarification or an honest unavailable-source answer is allowed.
    receipts = [event for row in db.scalars(select(Run).where(
        Run.user_id == run.user_id, Run.conversation_id == run.conversation_id))
        for event in row.events if event.get("type") in RESEARCH_EVENTS]
    searched = any(event["type"] == "research_search" for event in receipts)
    readable = False
    for event in receipts:
        if event["type"] == "research_source":
            try:
                readable = readable_source(db, run.user_id, event["source_id"]).origin == "public_web"
                if readable:
                    break
            except domain.DomainError:
                pass
    if not searched or not readable:
        raise domain.DomainError("还没取得可读取的公开案例，暂未生成玩法方案。可以换个方向或补充公开链接后继续。", 502)
