"""Opt-in real-model probes of app help, natural actions and authored photo memory.

The people, ownership and life events are synthetic. Device/product identities
are real domestic models; an optional supplied photo is real user-provided media.
No production data is changed. Raw runs and SQL facts remain in ignored tmp/.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.real_creative_eval import RequestBudget, execution_manifest


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--photo", type=Path)
    args = parser.parse_args()
    if not args.real:
        parser.error("--real required: uses the existing authorized Bailian account")

    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from wujian.config import Settings
    from wujian.database import ExperienceRecord, Gift, Reminder, TaskRecord
    from wujian.server import create_app

    config = Settings.load()
    if not config.api_key:
        raise RuntimeError("No existing Bailian key configured")
    folder = ROOT / "tmp/acceptance/2026-11-07_assistant"
    output = folder / (time.strftime("%H%M%S") + f"-{time.time_ns()%1000000:06d}")
    output.mkdir(parents=True)
    config.data_dir, config.database_url, config.session_secret = output / "data", "", ""
    config.demo_mode, config.rea_enabled = False, False
    budget = RequestBudget(folder / "request-budget.sqlite3", limit=None)
    restore = budget.install(config.base_url)
    report = {"kind": "development_real_provider_probe", "independent_acceptance": False,
              "synthetic": ["people", "ownership", "life events", "manual confirmation"],
              "conditions": execution_manifest(config, ROOT), "turns": []}

    def checked(response):
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:800]}")
        return response.json()

    def save():
        report["budget"] = budget.summary()
        (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    def facts(app):
        with app.state.sessions() as db:
            return {model.__tablename__: [{column.name: getattr(row, column.name)
                for column in model.__table__.columns} for row in db.scalars(select(model))]
                for model in (ExperienceRecord, TaskRecord, Reminder, Gift)}

    print(json.dumps({"artifact": str(output), "model": config.model}, ensure_ascii=False), flush=True)
    try:
        app = create_app(config)
        with ExitStack() as stack:
            owner = stack.enter_context(TestClient(app))
            def other():
                client = TestClient(app)
                client.portal = owner.portal
                stack.callback(client.close)
                return client
            mom, friend = other(), other()
            people = {}
            for client, username, name in ((owner, "round_owner", "小林"), (mom, "round_mom", "妈妈"), (friend, "round_friend", "小雨")):
                people[username] = checked(client.post("/api/auth/register", json={
                    "username": username, "display_name": name, "password": "synthetic-round-2026"}))
            for client, username in ((mom, "round_mom"), (friend, "round_friend")):
                checked(owner.post("/api/friends", json={"username": username}))
                checked(client.post(f"/api/friends/{people['round_owner']['id']}/accept"))
            home = checked(owner.post("/api/households", json={"name": "小林家"}))
            checked(owner.post(f"/api/households/{home['id']}/invitations", json={"user_id": people["round_mom"]["id"]}))
            checked(mom.post(f"/api/households/{home['id']}/accept"))
            purifier = checked(owner.post("/api/items", json={"name": "厨房的飞利浦净饮机", "product": {
                "brand": "飞利浦", "model": "ADD6910", "commercial_name": "净饮机", "market": "CN"}}))
            checked(owner.post(f"/api/households/{home['id']}/items", json={"item_id": purifier["id"], "shared": True}))
            cup = checked(owner.post("/api/items", json={"name": "我做的手工杯", "kind": "nonstandard_object",
                "avatar": {"enabled": True, "form": "cup", "nickname": "小杯", "personality": "这是仅给自己看的私人设定。"}}))
            private = checked(owner.post("/api/experiences", json={"title": "私人记录", "text": "私密测试标记：紫鲸鱼。",
                "item_ids": [cup["id"]], "allow_ai": True}))
            photo_ids = []
            if args.photo:
                photo = checked(owner.post("/api/assets", files={"file": (args.photo.name, args.photo.read_bytes(), "image/jpeg")}))
                photo_ids = [photo["id"]]
            cases = [
                ("help", "阿圆，我第一次用物间。照片回忆在哪儿记？给家人留提醒也可以直接跟你说吗？", []),
                ("reminder", "明天早上九点提醒妈妈看看厨房净饮机的滤芯，该换的话等我回来处理，先别拆。", []),
                ("gift", "把我做的手工杯送给小雨，写上忙归忙也要记得喝水。让小杯说话有点我这种爱开玩笑又关心她的感觉，但不要带我以前的私聊和私人回忆。", []),
                ("memory", "今天下午和妈妈在客厅坐了一会儿，一起听了唱片。帮我把这张照片和这句话记下来，先放我自己的回忆里。", photo_ids),
            ]
            for name, text, photos in cases:
                before = facts(app)
                started = time.monotonic()
                run = checked(owner.post("/api/chat", json={"text": text, "photo_ids": photos, "item_ids": [],
                    "entry_context": {"intent": "general"}}))
                while run["status"] in {"queued", "running"} and time.monotonic() - started < 245:
                    time.sleep(.4)
                    run = checked(owner.get(f"/api/runs/{run['id']}"))
                if run["status"] in {"queued", "running"}:
                    checked(owner.post(f"/api/runs/{run['id']}/cancel"))
                    run = checked(owner.get(f"/api/runs/{run['id']}"))
                row = {"name": name, "input": text, "photo_ids": photos, "run": run,
                       "elapsed_seconds": round(time.monotonic()-started, 2), "before": before, "after": facts(app)}
                report["turns"].append(row)
                if name in {"reminder", "gift"}:
                    drafts = [task for task in row["after"]["tasks"] if task["plan"].get("pending_action", {}).get("kind") == name]
                    if drafts:
                        task = drafts[-1]
                        action = checked(owner.get(f"/api/tasks/{task['id']}/action"))
                        row["confirmed"] = checked(owner.post(f"/api/tasks/{task['id']}/action/confirm",
                            json={"expected_version": action["version"]}))
                        row["after_confirmation"] = facts(app)
                        row["recipient_view"] = checked((mom if name == "reminder" else friend).get(
                            "/api/reminders" if name == "reminder" else "/api/gifts"))
                if name == "memory":
                    created = [story for story in row["after"]["experiences"] if story["id"] not in {s["id"] for s in before["experiences"]}]
                    row["checks"] = {"exactly_one_entry": len(created) == 1,
                        "photo_retained": len(created) == 1 and created[0]["photo_ids"] == photos,
                        "private_by_default": len(created) == 1 and not created[0]["household_id"],
                        "no_forced_item": len(created) == 1 and created[0]["item_ids"] == [],
                        "no_ai_permission_invented": len(created) == 1 and not created[0]["allow_ai"]}
                save()
                print(json.dumps({"case": name, "status": run["status"], "answer": run["text"],
                    "tools": [event["name"] for event in run.get("events", []) if event.get("type") == "tool_start"],
                    "elapsed_seconds": row["elapsed_seconds"], "checks": row.get("checks")}, ensure_ascii=False), flush=True)
            report["fixture"] = {"people": people, "purifier": purifier["id"], "cup": cup["id"], "private_story": private["id"]}
    finally:
        save()
        restore()
        print(json.dumps({"artifact": str(output), "budget": budget.summary()}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
