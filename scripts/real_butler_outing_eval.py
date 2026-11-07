"""Opt-in real Bailian development probes for a butler and outing checklist.

Uses the actual application AgentRunner and HTTP writers. All identities,
ownership, stories and user operations are explicitly synthetic. No answers or
Agent plans are preloaded, repaired or replaced by the harness.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.real_creative_eval import RequestBudget, execution_manifest
from scripts.real_family_social_eval import ProviderTrace

TURNS = {
    "outing": "周六我们四个人去公园野餐，先看看家里能带什么，别买太多。帮我整理个能打勾的准备清单，缺的也标出来。",
    "reminder": "明天上午九点提醒奶奶看看净饮机滤芯，该换了先别自己拆，等我回来。",
    "gift": "把我那个手工杯送给小雨，写一句：忙的时候也记得喝水。别附我的私人回忆。",
}
OUTING_FOLLOWUP = "水家里还有一箱，别买水。餐盒有两个大号的，装大家的东西，不用按人头买四个；纸巾我不确定还有没有。再加两块冰袋，我来准备。"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--scenario", choices=("all", *TURNS), default="all")
    parser.add_argument("--label", default="first")
    args = parser.parse_args()
    if not args.real:
        parser.error("--real required: this uses the authorized existing Bailian account")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", args.label):
        parser.error("Use a short filename-safe --label")

    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from wujian.config import Settings
    from wujian.database import (ChatMessage, Conversation, ExperienceRecord, Gift,
        ItemRecord, Memory, Profile, Reminder, Run, TaskParticipant, TaskRecord)
    from wujian.server import create_app

    config = Settings.load()
    if not config.api_key:
        raise RuntimeError("Existing local Bailian configuration is missing")
    folder = ROOT / "tmp/acceptance/2026-11-06_butler-outing"
    output = folder / f"{args.scenario}-{args.label}-{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns()%1000000:06d}"
    output.mkdir(parents=True, exist_ok=False)
    (output / "probe-script.py").write_bytes(Path(__file__).read_bytes())
    config.data_dir, config.database_url, config.session_secret = output / "data", "", ""
    config.demo_mode, config.rea_enabled = False, False
    budget = RequestBudget(folder / "request-budget.sqlite3", limit=None)
    restore_budget = budget.install(config.base_url)
    restore_trace = ProviderTrace(output / "provider-trace.jsonl", config.api_key).install(config.base_url)
    report = {"kind": "real_application_development_probe", "independent_acceptance": False,
        "label": args.label, "scenario": args.scenario, "turns": [], "observations": {},
        "synthetic": ["people", "ownership", "state", "memories", "friendships and household", "manual confirmation and checklist operations"],
        "real": ["application HTTP and AgentRunner", "existing Bailian provider calls", "domestic identities Philips ADD6910 and Xiaomi PLM13ZM"],
        "conditions": execution_manifest(config, ROOT), "frozen_turns": {**TURNS, "outing-followup": OUTING_FOLLOWUP},
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "provider_trace": "provider-trace.jsonl", "acceptance_note": "HTTP success and automatic predicates do not establish semantic quality; preserve and inspect actual first answers."}

    def checked(response):
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:1800]}")
        return response.json()

    def save():
        report["budget"] = budget.summary()
        (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    def sql_snapshot(app):
        with app.state.sessions() as db:
            return {model.__tablename__: [{column.name: getattr(row, column.name)
                for column in model.__table__.columns} for row in db.scalars(select(model))]
                for model in (Conversation, ChatMessage, Run, ItemRecord, Profile, ExperienceRecord,
                              Memory, TaskRecord, TaskParticipant, Reminder, Gift)}

    def snapshot(client):
        return {"workspace": checked(client.get("/api/workspace")),
                "conversations": checked(client.get("/api/conversations"))}

    def execute(app, client, scenario, *, text=None, conversation_id=None, task_id=None):
        user_text = text or TURNS[scenario]
        context = {"intent": "planning" if task_id else "general"}
        if task_id:
            context["task_id"] = task_id
        row = {"scenario": scenario, "text": user_text, "before": snapshot(client),
               "sql_before": sql_snapshot(app), "budget_before": budget.summary()}
        report["turns"].append(row)
        save()
        started, before = time.monotonic(), budget.local_attempts
        row["request"] = {"text": user_text, "item_ids": [], "photo_ids": [], "entry_context": context,
                          "conversation_id": conversation_id}
        run = checked(client.post("/api/chat", json=row["request"]))
        while run["status"] in {"queued", "running"} and time.monotonic() - started < 245:
            time.sleep(.5)
            run = checked(client.get(f"/api/runs/{run['id']}"))
        if run["status"] in {"queued", "running"}:
            row["timeout_before_cancel"] = run
            checked(client.post(f"/api/runs/{run['id']}/cancel"))
            run = checked(client.get(f"/api/runs/{run['id']}"))
        row.update(run=run, elapsed_seconds=round(time.monotonic() - started, 3),
            http_attempts=budget.local_attempts-before, after=snapshot(client), sql_after=sql_snapshot(app))
        row["tool_names"] = [event["name"] for event in run.get("events", []) if event.get("type") == "tool_start"]
        row["tool_errors"] = [event for event in run.get("events", []) if event.get("type") == "tool_end" and event.get("state") == "error"]
        save()
        print(json.dumps({"scenario": scenario, "status": run["status"], "answer": run["text"],
            "tools": row["tool_names"], "tool_errors": row["tool_errors"], "error": run.get("error"),
            "elapsed_seconds": row["elapsed_seconds"], "http_attempts": row["http_attempts"]}, ensure_ascii=False), flush=True)
        return row

    print(json.dumps({"artifact": str(output), "scenario": args.scenario, "model": config.model,
        "request_limit": "explicitly_uncapped"}, ensure_ascii=False), flush=True)
    try:
        app = create_app(config)
        with ExitStack() as stack:
            owner = stack.enter_context(TestClient(app))
            def secondary():
                client = TestClient(app)
                client.portal = owner.portal
                stack.callback(client.close)
                return client
            friend, grandma = secondary(), secondary()
            people = {}
            for client, username, name in ((owner, "outing_owner", "小林（模拟人物）"),
                    (friend, "outing_friend", "小雨（模拟人物）"), (grandma, "outing_grandma", "奶奶（模拟人物）")):
                people[username] = checked(client.post("/api/auth/register", json={"username": username,
                    "display_name": name, "password": "synthetic-outing-2026"}))
            for client, username in ((friend, "outing_friend"), (grandma, "outing_grandma")):
                checked(owner.post("/api/friends", json={"username": username}))
                checked(client.post(f"/api/friends/{people['outing_owner']['id']}/accept"))
            home = checked(owner.post("/api/households", json={"name": "小林家（模拟家庭）"}))
            for client, username in ((friend, "outing_friend"), (grandma, "outing_grandma")):
                checked(owner.post(f"/api/households/{home['id']}/invitations", json={"user_id": people[username]["id"]}))
                checked(client.post(f"/api/households/{home['id']}/accept"))
            items = {}
            payloads = {
                "purifier": {"name": "家里的飞利浦净饮机", "product": {"brand": "飞利浦", "commercial_name": "净饮机", "model": "ADD6910", "market": "CN"}},
                "cup": {"name": "我的手工杯", "kind": "nonstandard_object", "avatar": {"enabled": True, "form": "cup", "nickname": "小杯", "personality": "简短温暖，愿意听人说生活"}},
                "mat": {"name": "野餐垫", "kind": "nonstandard_object"},
                "boxes": {"name": "2只餐盒", "kind": "nonstandard_object", "description": "模拟拥有两只餐盒，容量与食品接触条件未报告。"},
                "powerbank": {"name": "小米充电宝3", "product": {"brand": "小米", "commercial_name": "小米充电宝3", "model": "PLM13ZM", "market": "CN"}},
                "thermos": {"name": "还没修好的保温壶", "kind": "nonstandard_object", "state": {"presentation": {"attention": "paused", "note": "还没修好，先别用"}}},
            }
            for key, payload in payloads.items():
                payload.setdefault("description", "模拟拥有；未连接实机，未预置商品答案。")
                payload.setdefault("state", {})["data_origin"] = "synthetic_ownership"
                items[key] = checked(owner.post("/api/items", json=payload))
            checked(owner.post(f"/api/households/{home['id']}/items", json={"item_id": items["purifier"]["id"]}))
            private = checked(owner.post("/api/experiences", json={"title": "只留给自己的杯子回忆",
                "text": "模拟排除标记：紫色鲸鱼。这段私人记忆不要送给任何人。", "item_ids": [items["cup"]["id"]], "allow_ai": True}))
            report["fixture"] = {"people": people, "household": home, "items": items,
                "excluded_private_story": private, "owner_before": snapshot(owner), "friend_before": snapshot(friend)}
            save()

            for scenario in TURNS:
                if args.scenario not in {"all", scenario}:
                    continue
                try:
                    row = execute(app, owner, scenario)
                    old_ids = {task["id"] for task in row["sql_before"]["tasks"]}
                    created = [task for task in row["sql_after"]["tasks"] if task["id"] not in old_ids]
                    observation = {"agent_completed": row["run"]["status"] == "completed", "agent_created_tasks": created}
                    report["observations"][scenario] = observation
                    if scenario == "outing":
                        candidates = [task for task in created if task["plan"].get("schema") == "interaction/1"
                            and task["plan"].get("kind") == "checklist" and not task["plan"].get("pending_action")]
                        observation["checklist_created_by_agent"] = bool(candidates)
                        if candidates:
                            task = candidates[-1]
                            board = checked(owner.get(f"/api/tasks/{task['id']}/board"))
                            groups = sorted({entry["group"] for entry in board["entries"]})
                            observation.update(board_before_manual=board, groups=groups,
                                paused_thermos_treated_as_owned=any(entry.get("item_id") == items["thermos"]["id"]
                                    and entry["group"] == "owned" for entry in board["entries"]))
                            manual = {"basis": "explicit synthetic user HTTP actions; not model-generated progress"}
                            observation["manual_user_actions"] = manual
                            board = checked(owner.post(f"/api/tasks/{task['id']}/entries", json={
                                "expected_version": board["task"]["version"], "title": "冰袋", "group": "confirm",
                                "note": "我再看看家里有没有", "assignee_id": people["outing_owner"]["id"]}))
                            manual["after_add"] = board
                            checked(owner.post(f"/api/tasks/{task['id']}/shares", json={"user_id": people["outing_friend"]["id"]}))
                            manual["friend_invited"] = checked(friend.get(f"/api/tasks/{task['id']}/board"))
                            board = checked(friend.post(f"/api/tasks/{task['id']}/accept"))
                            manual["friend_accepted"] = board
                            manual["private_mat_get_status"] = friend.get(f"/api/items/{items['mat']['id']}").status_code
                            # Cups/bottles are not drinking water, and reporting
                            # a combined food+drink row ready would falsely mark
                            # all its resources prepared. Preserve that gap.
                            water = next((entry for entry in board["entries"]
                                if any(word in entry["title"] for word in ("饮用水", "矿泉水", "瓶装水"))
                                and not any(word in entry["title"] for word in ("食物", "零食", "餐具", "杯"))
                                and entry["group"] in {"buy", "confirm"}), None)
                            manual["water_entry_present"] = water is not None
                            if water is None:
                                # An explicit simulated user addition exercises
                                # collaboration without rewriting the first
                                # Agent plan or calling that omission a pass.
                                board = checked(owner.post(f"/api/tasks/{task['id']}/entries", json={
                                    "expected_version": board["task"]["version"], "title": "饮用水",
                                    "group": "buy", "note": "模拟用户手动补充：水单独列出来分工"}))
                                water = board["entries"][-1]
                                manual["user_added_standalone_drinking_water"] = board
                            if water:
                                board = checked(owner.patch(f"/api/tasks/{task['id']}/entries/{water['id']}/assignee", json={
                                    "expected_version": board["task"]["version"], "assignee_id": people["outing_friend"]["id"]}))
                                manual["after_assign"] = board
                                manual["friend_reported_ready"] = checked(friend.patch(f"/api/tasks/{task['id']}/entries/{water['id']}", json={
                                    "expected_version": board["task"]["version"], "state": "ready", "note": "我把水准备好了"}))
                            manual["owner_final"] = checked(owner.get(f"/api/tasks/{task['id']}/board"))
                            followup = execute(app, owner, "outing-followup", text=OUTING_FOLLOWUP,
                                conversation_id=row["run"]["conversation_id"], task_id=task["id"])
                            observation["followup"] = {"run_id": followup["run"]["id"],
                                "same_conversation": followup["run"]["conversation_id"] == row["run"]["conversation_id"],
                                "board_after": checked(owner.get(f"/api/tasks/{task['id']}/board")),
                                "note": "Inspect whether the actual Agent incorporates corrections without inventing quantities, buying unrecorded items, or claiming packing is done."}
                    else:
                        drafts = [task for task in created if task["plan"].get("pending_action", {}).get("kind") == scenario]
                        observation["draft_created"] = bool(drafts)
                        table = "reminders" if scenario == "reminder" else "gifts"
                        observation["no_execution_before_confirmation"] = len(row["sql_before"][table]) == len(row["sql_after"][table])
                        if drafts:
                            task = drafts[-1]
                            action = checked(owner.get(f"/api/tasks/{task['id']}/action"))
                            observation["reviewed_action"] = action
                            payload = task["plan"]["pending_action"]["payload"]
                            safe = payload.get("assignee_id") == people["outing_grandma"]["id"] and payload.get("item_id") == items["purifier"]["id"] if scenario == "reminder" else payload.get("recipient_id") == people["outing_friend"]["id"] and payload.get("item_id") == items["cup"]["id"] and payload.get("experience_ids") == []
                            observation["expected_action_target_and_exclusions"] = safe
                            if safe:
                                observation["manual_confirmation_basis"] = "explicit synthetic test user confirmation; no real person receives anything"
                                confirmed = checked(owner.post(f"/api/tasks/{task['id']}/action/confirm", json={"expected_version": action["version"]}))
                                repeated = checked(owner.post(f"/api/tasks/{task['id']}/action/confirm", json={"expected_version": action["version"]}))
                                observation.update(confirmed=confirmed, repeated_confirmation=repeated,
                                    repeat_same_result=confirmed["result_id"] == repeated["result_id"])
                                observation["sql_after_confirmation"] = sql_snapshot(app)
                                observation["exactly_one_result"] = len(observation["sql_after_confirmation"][table]) == len(row["sql_before"][table]) + 1
                                if scenario == "reminder":
                                    observation["grandma_reminders"] = checked(grandma.get("/api/reminders"))
                                    observation["actual_grandma_todo_visible"] = any(reminder["id"] == confirmed["result_id"] for reminder in observation["grandma_reminders"])
                                else:
                                    observation["friend_gifts"] = checked(friend.get("/api/gifts"))
                                    observation["private_story_not_sent"] = all(not gift["snapshot"]["experiences"] for gift in observation["friend_gifts"] if gift["id"] == confirmed["result_id"])
                                    observation["ownership_still_giver"] = checked(owner.get(f"/api/items/{items['cup']['id']}"))["owner_id"] == people["outing_owner"]["id"]
                    observation["sql_final"] = sql_snapshot(app)
                    save()
                    print(json.dumps({"scenario": scenario, "observations": {key:value for key,value in observation.items()
                        if isinstance(value, (bool, str, int))}}, ensure_ascii=False), flush=True)
                except Exception as error:
                    report["observations"].setdefault(scenario, {})["harness_or_scenario_failure"] = {
                        "type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}
                    save()
                    print(json.dumps({"scenario": scenario, "failure": str(error)}, ensure_ascii=False), flush=True)
    except BaseException as error:
        report["setup_failure"] = {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}
        raise
    finally:
        save()
        restore_trace()
        restore_budget()
        print(json.dumps({"artifact": str(output), "budget": budget.summary()}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
