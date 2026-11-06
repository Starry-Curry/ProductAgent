"""Explicit real Bailian probes of family care and an attributed gift companion.

All people, ownership, stories and utterances are synthetic development fixtures.
No device is operated. The application uses its actual AgentRunner and HTTP API;
answers and tool failures are retained without an evaluator model or answer edits.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import re
import sys
import threading
import time
import traceback
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.real_creative_eval import RequestBudget, execution_manifest


GIFT_TURNS = [
    "小杯，今天真的有点累，不想做什么计划，你就陪我待一会儿吧。",
    "礼物上写着‘搬家那晚留了一点光’，我有点好奇，能打开这个彩蛋，听听小雨留下的那段故事吗？",
    "那天小雨是一个人来的吗？这个你有记得吗？",
    "以后我说累了的时候，你先听我说一会儿就好，别急着列清单。这个小默契可以慢慢变成你的性格。",
    "不过我现在想动一动了，帮我列三个今晚就能做完的小待办，简单点。",
]
FAMILY_TURNS = [
    "女儿给我留了个台灯的提醒，我没看清，她让我注意什么呀？",
    "上周日咱们在台灯旁一起读书的那段，女儿是不是记下来了？帮我找找，我想再看看。",
]
FAMILY_RECORD_TURNS = [
    "刚刚和妈妈坐在台灯旁，各读了一会儿书，我觉得挺踏实的。帮我记到家里的共同回忆里，让家人也能看见。这条先不要用在以后的聊天里。",
    "刚刚去公园走了十分钟，心情好多了，帮我给自己记一段，别放到家庭里。",
]


class ProviderTrace:
    """Opt-in isolated evaluation trace; never inspect headers or consume SSE.

    Public HTTPX send returns a buffered response for non-streaming calls. The
    wrapper reads that existing buffer only, preserving bytes and SDK behavior.
    It is deliberately separate from RequestBudget's transport instrumentation.
    """

    def __init__(self, path: Path, api_key: str):
        self.path, self.api_key = path, api_key
        self.lock = threading.Lock()
        self.sequence = 0

    def write(self, event):
        # Trace filesystem errors must never turn a provider answer into a
        # failed application answer. Only the error type is printed.
        try:
            line = json.dumps(event, ensure_ascii=False)
            if self.api_key:
                line = line.replace(self.api_key, "[REDACTED_API_KEY]")
            with self.lock:
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
        except Exception as error:
            print(json.dumps({"provider_trace_write_error": type(error).__name__}), file=sys.stderr, flush=True)

    def install(self, base_url):
        import httpx
        import httpx2
        host = urlsplit(base_url).hostname
        trace = self
        restorers = []
        for library in (httpx, httpx2):
            sync_send, async_send = library.Client.send, library.AsyncClient.send

            def begin(request, kwargs, library_name=library.__name__):
                if request.url.host != host or not request.url.path.endswith("/chat/completions"):
                    return None
                try:
                    body = json.loads(request.content)
                except (ValueError, TypeError, RuntimeError):
                    body = {}
                if not isinstance(body, dict):
                    body = {}
                with trace.lock:
                    trace.sequence += 1
                    identity = trace.sequence
                streaming = bool(kwargs.get("stream", False) or body.get("stream", False))
                trace.write({"event": "request", "id": identity, "time_unix": time.time(),
                    "library": library_name, "endpoint_path": request.url.path,
                    "streaming": streaming,
                    "request": {key: body[key] for key in ("model", "messages", "tools", "tool_choice", "response_format", "stream") if key in body}})
                return identity, streaming

            def finish(token, response):
                if token is None:
                    return
                identity, streaming = token
                event = {"event": "response", "id": identity, "time_unix": time.time(), "http_status": response.status_code}
                if streaming:
                    event["trace_scope"] = "streaming_response_not_consumed_or_changed; raw SSE unsupported"
                else:
                    try:
                        event["response_json"] = response.json()
                    except (ValueError, RuntimeError) as error:
                        event["trace_scope"] = "response_not_readable_json; body left unchanged"
                        event["trace_error_type"] = type(error).__name__
                trace.write(event)

            # Bind functions per library so the loop cannot redirect httpx
            # clients into httpx2 or accidentally invoke a wrapper recursively.
            def send(client, request, *positional, _send=sync_send, _begin=begin, _finish=finish, **kwargs):
                token = _begin(request, kwargs)
                try:
                    response = _send(client, request, *positional, **kwargs)
                except BaseException as error:
                    if token is not None:
                        trace.write({"event": "transport_error", "id": token[0], "error_type": type(error).__name__})
                    raise
                _finish(token, response)
                return response

            async def asend(client, request, *positional, _send=async_send, _begin=begin, _finish=finish, **kwargs):
                token = _begin(request, kwargs)
                try:
                    response = await _send(client, request, *positional, **kwargs)
                except BaseException as error:
                    if token is not None:
                        trace.write({"event": "transport_error", "id": token[0], "error_type": type(error).__name__})
                    raise
                _finish(token, response)
                return response

            library.Client.send, library.AsyncClient.send = send, asend
            restorers.append((library, sync_send, async_send))

        def restore():
            for library, sync_send, async_send in reversed(restorers):
                library.Client.send, library.AsyncClient.send = sync_send, async_send
        return restore


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--scenario", choices=("all", "gift", "family", "family-record"), default="all")
    parser.add_argument("--label", default="first")
    parser.add_argument("--gift-turns", type=int, default=5)
    parser.add_argument("--family-turns", type=int, default=2)
    parser.add_argument("--continue-after-failure", action="store_true",
        help="Explicit development coverage: continue later user turns after a terminal failed answer; preserve that failure")
    parser.add_argument("--trace-provider", action="store_true",
        help="Write actual non-streaming chat request/response JSON into this isolated run; never record headers or consume streaming bodies")
    args = parser.parse_args()
    if not args.real:
        parser.error("--real required: this calls the authorized existing Bailian account")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", args.label):
        parser.error("--label must be a short filename-safe experiment label")
    if not 1 <= args.gift_turns <= 5 or not 1 <= args.family_turns <= 2:
        parser.error("--gift-turns must be 1..5 and --family-turns 1..2")

    # Import the actual application before reserving any provider request. A
    # parallel edit leaving an invalid import is a setup failure, not an answer.
    from fastapi.testclient import TestClient
    from sqlalchemy import delete, select
    from wujian.api_models import AvatarSpec
    from wujian.config import Settings
    from wujian.database import (ChatMessage, Conversation, ExperienceRecord,
        Friendship, Memory, Profile, TaskRecord)
    from wujian.server import create_app

    config = Settings.load()
    if not config.api_key:
        raise RuntimeError("Existing local Bailian API configuration is missing")
    folder = ROOT / "tmp/acceptance/2026-11-06_family-social"
    output = folder / f"{args.scenario}-{args.label}-{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns()%1000000:06d}"
    output.mkdir(parents=True, exist_ok=False)
    (output / "probe-script.py").write_bytes(Path(__file__).read_bytes())
    config.data_dir, config.database_url, config.session_secret = output / "data", "", ""
    config.demo_mode, config.rea_enabled = False, False
    budget = RequestBudget(folder / "request-budget.sqlite3", limit=None)
    restore = budget.install(config.base_url)
    restore_trace = ProviderTrace(output / "provider-trace.jsonl", config.api_key).install(config.base_url) if args.trace_provider else None
    report = {
        "kind": "real_model_application_development_probe", "independent_acceptance": False,
        "label": args.label, "scenario": args.scenario,
        "continue_after_terminal_failure": args.continue_after_failure,
        "provider_trace": "provider-trace.jsonl" if args.trace_provider else None,
        "synthetic": ["people", "ownership", "authored memories", "utterances", "friendship fixture removal"],
        "real": ["actual application HTTP handlers and AgentRunner", "existing Bailian provider calls",
                 "domestic product identity 米家台灯1S MJTD01SYL; no device connected"],
        "conditions": execution_manifest(config, ROOT),
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "frozen_turns": {"gift": GIFT_TURNS, "family": FAMILY_TURNS, "family-record": FAMILY_RECORD_TURNS},
        "setups": {}, "turns": [], "observations": {},
    }

    def checked(response):
        if not response.is_success:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:1600]}")
        return response.json()

    def save():
        report["budget"] = budget.summary()
        (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    def snapshot(client):
        return {"workspace": checked(client.get("/api/workspace")),
                "conversations": checked(client.get("/api/conversations")),
                "personal_memories": checked(client.get("/api/memories"))}

    def sql_snapshot(app):
        # Canonical synthetic business facts, never users' hashes/session keys.
        with app.state.sessions() as db:
            return {model.__tablename__: [{column.name: getattr(row, column.name)
                for column in model.__table__.columns} for row in db.scalars(select(model))]
                for model in (Conversation, ChatMessage, ExperienceRecord, Profile, Memory, TaskRecord)}

    def register(client, username, name):
        return checked(client.post("/api/auth/register", json={"username": username,
            "display_name": name, "password": "synthetic-local-probe-2026"}))

    def friends(left, right, left_user, right_user):
        checked(left.post("/api/friends", json={"username": right_user["username"]}))
        checked(right.post(f"/api/friends/{left_user['id']}/accept"))

    def execute(app, client, scenario, text, index, item_ids, conversation=None, intent="general"):
        before = budget.local_attempts
        row = {"scenario": scenario, "index": index, "text": text,
               "before": snapshot(client), "budget_before": budget.summary(),
               "request": {"conversation_id": conversation, "item_ids": item_ids,
                           "entry_context": {"intent": intent}}}
        report["turns"].append(row)
        save()
        started = time.monotonic()
        run = checked(client.post("/api/chat", json={"text": text,
            "conversation_id": conversation, "item_ids": item_ids,
            "photo_ids": [], "entry_context": {"intent": intent}}))
        while run["status"] in {"queued", "running"} and time.monotonic() - started < 310:
            time.sleep(.5)
            run = checked(client.get(f"/api/runs/{run['id']}"))
        if run["status"] in {"queued", "running"}:
            row["timeout_before_cancel"] = run
            checked(client.post(f"/api/runs/{run['id']}/cancel"))
            run = checked(client.get(f"/api/runs/{run['id']}"))
        row.update(run=run, elapsed_seconds=round(time.monotonic() - started, 3),
            http_attempts=budget.local_attempts - before, after=snapshot(client),
            sql_after=sql_snapshot(app))
        row["tool_names"] = [event["name"] for event in run.get("events", []) if event.get("type") == "tool_start"]
        row["tool_errors"] = [event for event in run.get("events", []) if event.get("type") == "tool_end" and event.get("state") == "error"]
        save()
        print(json.dumps({"scenario": scenario, "turn": index, "text": text,
            "status": run["status"], "answer": run["text"], "tools": row["tool_names"],
            "tool_errors": row["tool_errors"], "error": run.get("error"),
            "elapsed_seconds": row["elapsed_seconds"], "http_attempts": row["http_attempts"],
            "budget_attempted": budget.summary()["attempted"]}, ensure_ascii=False), flush=True)
        return run

    print(json.dumps({"artifact": str(output), "model": config.model,
                      "scenario": args.scenario, "request_limit": "explicitly_uncapped"}, ensure_ascii=False), flush=True)
    try:
        app = create_app(config)
        with ExitStack() as stack:
            owner = stack.enter_context(TestClient(app))
            def secondary():
                client = TestClient(app)
                client.portal = owner.portal
                stack.callback(client.close)
                return client

            if args.scenario in {"all", "gift"}:
                giver, receiver = owner, secondary()
                giver_user = register(giver, "gift_giver", "小雨（模拟人物）")
                receiver_user = register(receiver, "gift_receiver", "阿宁（模拟人物）")
                friends(giver, receiver, giver_user, receiver_user)
                cup = checked(giver.post("/api/items", json={"name": "小雨做的手工杯",
                    "kind": "nonstandard_object", "description": "模拟持有：小雨手作的陶杯，杯底有蓝点；食品接触与耐热条件未知。",
                    "avatar": {"enabled": True, "nickname": "小杯", "form": "cup", "color": "#7e9eac",
                        "personality": "温暖安静，愿意先听人说话，带一点小雨留下的心意，不冒充小雨实时本人。"}}))
                story = checked(giver.post("/api/experiences", json={"title": "搬家那晚的光",
                    "text": "搬家那晚，我把这个手工杯放到阿宁的新书桌上，杯底画了一颗蓝点。我希望她在新家慢慢安顿下来，也别忘了给自己倒杯水。",
                    "item_ids": [cup["id"]], "occurred_on": "2026-10-25", "allow_ai": True}))
                private = checked(giver.post("/api/experiences", json={"title": "只留给自己的片段",
                    "text": "模拟私密排除标记：紫色鲸鱼。那天我独自在阳台整理旧信，这段不送给阿宁。",
                    "item_ids": [cup["id"]], "allow_ai": True}))
                gift = checked(giver.post("/api/gifts", json={"item_id": cup["id"], "recipient_id": receiver_user["id"],
                    "message": "忙累的时候，让小杯陪你歇一会儿。", "experience_ids": [story["id"]],
                    "avatar": {key: value for key, value in cup["avatar"].items() if key in AvatarSpec.model_fields}, "surprises": [{"experience_id": story["id"],
                        "hint": "搬家那晚留了一点光", "trigger_words": ["搬家", "那晚", "蓝点"]}]}))
                accepted = checked(receiver.post(f"/api/gifts/{gift['id']}/accept", json={"wake_avatar": True, "allow_story_ai": True}))
                report["setups"]["gift"] = {"giver": giver_user, "receiver": receiver_user,
                    "item": cup, "selected_story": story, "excluded_private_story": private,
                    "gift": gift, "acceptance": accepted,
                    "before": {"giver": snapshot(giver), "receiver": snapshot(receiver)}}
                save()
                conversation = None
                for index, text in enumerate(GIFT_TURNS[:args.gift_turns], 1):
                    run = execute(app, receiver, "gift", text, index, [cup["id"]], conversation, "persona")
                    conversation = run["conversation_id"]
                    if run["status"] != "completed" and not args.continue_after_failure:
                        break
                giver_final, receiver_final = snapshot(giver), snapshot(receiver)
                report["observations"]["gift"] = {
                    "giver_after": giver_final, "receiver_after": receiver_final,
                    "receiver_conversation_visible_to_giver": any(row["id"] == conversation for row in giver_final["conversations"]),
                    "excluded_private_story_visible_to_receiver": any(row["id"] == private["id"] or row.get("origin_id") == private["id"]
                        for row in receiver_final["workspace"]["experiences"]),
                    "note": "These boolean transport observations are not a judgment of conversational quality or acceptance."}
                save()

            if args.scenario in {"all", "family", "family-record"}:
                daughter, mother = secondary(), secondary()
                daughter_user = register(daughter, "family_daughter", "女儿小晴（模拟人物）")
                mother_user = register(mother, "family_mother", "妈妈（模拟人物）")
                friends(daughter, mother, daughter_user, mother_user)
                house = checked(daughter.post("/api/households", json={"name": "一起读书的家（模拟家庭）"}))
                checked(daughter.post(f"/api/households/{house['id']}/invitations", json={"user_id": mother_user["id"]}))
                checked(mother.post(f"/api/households/{house['id']}/accept"))
                # There is no HTTP friendship-removal API. Explicitly remove
                # this synthetic pair after real HTTP invitation/acceptance to
                # test family authorization independently of direct friendship.
                with app.state.sessions() as db:
                    removed = db.execute(delete(Friendship).where(
                        Friendship.sender_id.in_([daughter_user["id"], mother_user["id"]]),
                        Friendship.recipient_id.in_([daughter_user["id"], mother_user["id"]])))
                    removed_count = removed.rowcount
                    db.commit()
                lamp = checked(daughter.post("/api/items", json={"name": "书桌上的米家台灯1S",
                    "product": {"brand": "米家", "commercial_name": "米家台灯1S", "model": "MJTD01SYL", "market": "CN"},
                    "description": "模拟家庭持有，未连接实机。", "state": {"presentation": {"location": "客厅靠窗书桌", "attention": "normal"}}}))
                checked(daughter.post(f"/api/households/{house['id']}/items", json={"item_id": lamp["id"], "shared": True}))
                reminder = checked(daughter.post("/api/reminders", json={"title": "妈妈，晚上看书先打开台灯，觉得晃眼就把亮度调低一点；旋钮在底座上。",
                    "due_at": "2026-11-06T19:00:00+08:00", "assignee_id": mother_user["id"],
                    "item_id": lamp["id"], "household_id": house["id"]}))
                shared = checked(daughter.post("/api/experiences", json={"title": "周日在台灯旁读书",
                    "text": "周日晚上，妈妈和我坐在米家台灯旁，各读了一会儿自己的书。妈妈念了一句喜欢的话，我们一起笑了。",
                    "item_ids": [lamp["id"]], "household_id": house["id"], "occurred_on": "2026-11-01", "allow_ai": True}))
                private = checked(daughter.post("/api/experiences", json={"title": "我自己的读书笔记",
                    "text": "模拟私人排除标记：橙色小岛。我一个人读到某一页有点难过，这段只留给自己。",
                    "item_ids": [lamp["id"]], "household_id": None, "allow_ai": True}))
                report["setups"]["family"] = {"daughter": daughter_user, "mother": mother_user,
                    "household": house, "item": lamp, "reminder": reminder, "shared_story": shared,
                    "excluded_private_story": private, "fixture_injection": {"kind": "synthetic_SQL_friendship_removal_after_HTTP_household_accept", "rows": removed_count},
                    "friends_after_removal": checked(daughter.get("/api/friends")),
                    "before": {"daughter": snapshot(daughter), "mother": snapshot(mother)}}
                save()
                if args.scenario == "family-record":
                    from wujian.agent_runtime import personal_context
                    from wujian.retrieval import authorized_documents
                    observations = []
                    for index, text in enumerate(FAMILY_RECORD_TURNS, 1):
                        before_ids = {row["id"] for row in snapshot(daughter)["workspace"]["experiences"]}
                        run = execute(app, daughter, "family-record", text, index,
                            [lamp["id"]] if index == 1 else [], None, "story" if index == 1 else "general")
                        row = report["turns"][-1]
                        row["other_household_member_after"] = snapshot(mother)
                        with app.state.sessions() as db:
                            row["other_household_member_ai_context"] = personal_context(db, mother_user["id"], [lamp["id"]])
                        row["other_household_member_ai_retrieval_projection"] = authorized_documents(app.state.sessions, mother_user["id"])
                        created = [entry for entry in row["after"]["workspace"]["experiences"] if entry["id"] not in before_ids]
                        wall_ids = {entry["id"] for entry in row["other_household_member_after"]["workspace"]["experiences"]}
                        projected = row["other_household_member_ai_retrieval_projection"]
                        receipts = [entry for entry in row["sql_after"]["messages"]
                            if entry["conversation_id"] == run["conversation_id"] and entry.get("recorded_experiences")]
                        row["actual_record_receipts"] = receipts
                        observations.append({"turn": index, "new_records": created,
                            "other_member_wall_visible_ids": [entry["id"] for entry in created if entry["id"] in wall_ids],
                            "other_member_ai_projection_visible_ids": [entry["id"] for entry in created if f"experience/{entry['id']}" in projected],
                            "note": "Exact authored text, family scope and AI permission are observed facts; no answer is rewritten or model-graded."})
                        report["observations"]["family_record"] = observations
                        save()
                        print(json.dumps({"scenario": "family-record", "turn": index,
                            "actual_new_records": created, "other_member_wall_visible_ids": observations[-1]["other_member_wall_visible_ids"],
                            "other_member_ai_projection_visible_ids": observations[-1]["other_member_ai_projection_visible_ids"]}, ensure_ascii=False), flush=True)
                        if run["status"] != "completed" and not args.continue_after_failure:
                            break
                else:
                    conversation = None
                    for index, text in enumerate(FAMILY_TURNS[:args.family_turns], 1):
                        run = execute(app, mother, "family", text, index, [lamp["id"]], conversation, "general")
                        conversation = run["conversation_id"]
                        if run["status"] != "completed" and not args.continue_after_failure:
                            break
                mother_final = snapshot(mother)
                report["observations"]["family"] = {"daughter_after": snapshot(daughter), "mother_after": mother_final,
                    "private_story_visible_to_mother": any(row["id"] == private["id"] for row in mother_final["workspace"]["experiences"]),
                    "note": "Story presence and HTTP success alone do not establish truthful retrieval or usability."}
                save()
    except BaseException as error:
        report["setup_or_harness_failure"] = {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}
        raise
    finally:
        save()
        if restore_trace:
            restore_trace()
        restore()
        print(json.dumps({"artifact": str(output), "budget": budget.summary()}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
