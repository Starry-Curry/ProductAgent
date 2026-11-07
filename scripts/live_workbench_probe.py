"""Opt-in authorized live demo probe: the running Agent writes its own artifact.

No source code is preloaded or repaired. This mutates the selected demo user's
existing database through normal authenticated application endpoints. It asks
for a real device read and code generation, never an automatic hardware write.
"""
import argparse
import json
from pathlib import Path
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-write", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--item-id", required=True)
    parser.add_argument("--address", required=True)
    args = parser.parse_args()
    if not args.live_write:
        parser.error("--live-write required for normal authorized live demo mutations")
    output = ROOT / "var/evaluations/2026-11-07-live-workbench" / (time.strftime("%H%M%S")+f"-{time.time_ns()%1000000:06d}")
    output.mkdir(parents=True)
    report = {"kind":"live_application_development_probe", "independent_acceptance":False,
        "preloaded_source":False, "automatic_hardware_write_requested":False, "base_url":args.base_url}
    def checked(response):
        response.raise_for_status()
        return response.json()
    def save():
        (output/"results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with httpx.Client(base_url=args.base_url,timeout=30,trust_env=False) as client:
        user=checked(client.post("/api/auth/demo/xiaolin"))
        item=checked(client.get(f"/api/items/{args.item_id}"))
        if item["owner_id"]!=user["id"] or "4E" not in item["product"]["model"].upper():
            raise RuntimeError("Target isn't this demo user's real owned FreeBuds 4E item")
        text=(f"阿圆，我的华为耳机就是蓝牙地址 {args.address} 这一副 FreeBuds 4E。先连上读一下确认，"
            "再给我做个和物间风格一样简洁温暖的耳机小操控台：能看左耳、右耳和充电盒的电量，"
            "有降噪切换按钮，还能调 Windows 里这副耳机的输出音量。界面你自己编好、检查好，"
            "放到这件耳机的工作台里让我直接打开。先不要替我改任何硬件设置，我打开后自己点。")
        report.update(user=user,item=item,request=text)
        print(json.dumps({"artifact":str(output),"request":text},ensure_ascii=False),flush=True)
        started=time.monotonic()
        run=checked(client.post("/api/chat",json={"text":text,"item_ids":[item["id"]],"photo_ids":[],"entry_context":{"intent":"general"}}))
        report["run"]=run;save()
        while run["status"]in{"queued","running"} and time.monotonic()-started<500:
            time.sleep(.7);run=checked(client.get(f"/api/runs/{run['id']}"))
        if run["status"]in{"queued","running"}:
            checked(client.post(f"/api/runs/{run['id']}/cancel"));run=checked(client.get(f"/api/runs/{run['id']}"))
        report.update(run=run,elapsed_seconds=round(time.monotonic()-started,2))
        report["workbenches"]=checked(client.get(f"/api/items/{item['id']}/workbenches"))
        for work in report["workbenches"]:
            if work["published"]:
                report.setdefault("published_artifacts",[]).append(checked(client.get(f"/api/workbenches/{work['task_id']}")))
        save()
        print(json.dumps({"status":run["status"],"answer":run["text"],"error":run.get("error"),
            "seconds":report["elapsed_seconds"],"tools":[e["name"]for e in run.get("events",[])if e.get("type")=="tool_start"],
            "published":[w["task_id"]for w in report["workbenches"]if w["published"]]},ensure_ascii=False),flush=True)


if __name__=="__main__":
    main()
