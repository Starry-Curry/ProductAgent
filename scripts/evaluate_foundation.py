"""Exercise the actual application and Bailian with realistic fictional living conditions.

Run explicitly: python scripts/evaluate_foundation.py --real
Artifacts preserve each first answer. This is development evidence, not a blind benchmark.
"""

import argparse
import json
import time
from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import select

from wujian.config import ROOT, Settings
from wujian.database import KnowledgeClaim
from wujian.retrieval import claim_view
from wujian.server import create_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", action="store_true")
    parser.add_argument(
        "--only", choices=["journey", "manual", "memory", "cases", "gift", "rea", "all"], default="all"
    )
    args = parser.parse_args()
    if not args.real:
        parser.error("--real is required: this uses the configured Bailian account")
    config = Settings.load()
    if not config.api_key:
        raise RuntimeError("Local Bailian key is not configured")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    folder = ROOT / "var/evaluations" / stamp
    folder.mkdir(parents=True)
    config.data_dir = folder / "data"
    config.database_url = ""
    config.session_secret = ""
    app = create_app(config)
    scenario = json.loads(
        (ROOT / "fixtures/development/foundation_scenarios.json").read_text(
            encoding="utf-8"
        )
    )
    if args.only in {'memory','cases'}:
        gaps = json.loads((ROOT/'fixtures/development/foundation_gaps.json').read_text(encoding='utf-8'))
        scenario['messages'] = gaps[args.only]
    report = {
        "kind": "development_real_model_application_journey",
        "model": config.model,
        "fixture": "foundation_scenarios.json",
        "selection": args.only,
        "independent_acceptance": False,
        "answers": [],
    }

    def save():
        (folder / "results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def checked(response):
        response.raise_for_status()
        return response.json()

    with TestClient(app) as client:
        checked(client.post("/api/auth/demo/xiaolin"))
        product = checked(client.post("/api/items", json=scenario["products"][0]))
        for obj in scenario["objects"]:
            checked(
                client.post("/api/items", json={"kind": "nonstandard_object", **obj})
            )
        report["inventory_count"] = len(checked(client.get("/api/items")))
        conversation = None
        for case in scenario["messages"]:
            if args.only == "manual" and case["id"] != "unseen_manual":
                continue
            if args.only == "journey" and case["id"] == "unseen_manual":
                continue
            if args.only in {"rea", "gift"}:
                break
            if case.get("new_conversation"):
                conversation = None
            initial = checked(
                client.post(
                    "/api/chat",
                    json={
                        "text": case["text"],
                        "conversation_id": conversation,
                        "item_ids": [product["id"]]
                        if case.get("focus_product")
                        else [],
                    },
                )
            )
            started = time.monotonic()
            run = initial
            while (
                run["status"] in {"queued", "running"}
                and time.monotonic() - started < 270
            ):
                time.sleep(0.3)
                run = checked(client.get("/api/runs/" + run["id"]))
            conversation = run["conversation_id"]
            report["answers"].append(
                {"case_id": case["id"], "user_text": case["text"], "run": run}
            )
            report["memories"] = checked(client.get("/api/memories"))
            report["experiences"] = checked(client.get("/api/experiences"))
            report["tasks"] = checked(client.get("/api/tasks"))
            with app.state.sessions() as db:
                report["knowledge"] = [
                    claim_view(r) for r in db.scalars(select(KnowledgeClaim))
                ]
            save()
            print(
                json.dumps(
                    {
                        "case": case["id"],
                        "status": run["status"],
                        "seconds": round(time.monotonic() - started, 2),
                        "tools": [
                            e["name"]
                            for e in run["events"]
                            if e["type"] == "tool_start"
                        ],
                        "answer": run["text"],
                    },
                    ensure_ascii=True,
                ),
                flush=True,
            )
        if args.only == "gift":
            checked(
                client.post(
                    "/api/experiences",
                    json={
                        "title": "窗边的小太阳",
                        "text": "今天没买新东西，也给自己留了一点光。",
                        "item_ids": ["item_demo_sunflower", "item_demo_lamp"],
                        "occurred_on": "2026-11-04",
                    },
                )
            )
        if args.only in {"journey", "gift", "all"}:
            experiences = checked(client.get("/api/experiences"))
            story = next((r for r in experiences if r["title"] == "窗边的小太阳"), None)
            report["gift_journey"] = {"attempted": bool(story)}
            if story:
                gift = checked(
                    client.post(
                        "/api/gifts",
                        json={
                            "item_id": "item_demo_sunflower",
                            "recipient_id": "person_demo_friend",
                            "experience_ids": [story["id"]],
                            "message": "这束小太阳，替我陪你一段。",
                            "avatar": {
                                "nickname": "小太阳",
                                "personality": "温柔、有点幽默，认真听朋友说话；保留赠送者的心意。",
                            },
                        },
                    )
                )
                checked(client.post("/api/auth/demo/xiaoxia"))
                checked(client.post("/api/gifts/" + gift["id"] + "/accept"))
                receiver_items = checked(client.get("/api/items"))
                receiver_memories = checked(client.get("/api/memories"))
                receiver_story = checked(client.get("/api/experiences"))
                report["gift_journey"].update(
                    {
                        "receiver_items": receiver_items,
                        "receiver_memories": receiver_memories,
                        "receiver_experiences": receiver_story,
                    }
                )
                run = checked(
                    client.post(
                        "/api/chat",
                        json={
                            "text": "小太阳，今天工作有点受挫，陪我聊几句吧，也说说你带来的那段故事。",
                            "item_ids": ["item_demo_sunflower"],
                        },
                    )
                )
                start = time.monotonic()
                while (
                    run["status"] in {"queued", "running"}
                    and time.monotonic() - start < 270
                ):
                    time.sleep(0.3)
                    run = checked(client.get("/api/runs/" + run["id"]))
                report["gift_journey"]["receiver_chat"] = run
                save()
        if args.only in {"rea", "all"}:
            report["rea"] = checked(client.get("/api/devices/status?connect=true"))
        save()
    print(
        json.dumps({"artifact": str(folder / "results.json")}, ensure_ascii=True),
        flush=True,
    )


if __name__ == "__main__":
    main()
