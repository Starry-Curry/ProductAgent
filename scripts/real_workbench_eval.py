"""Explicit real-provider, empty-source Agent workbench development probe.

The Agent receives a natural request and real model identity, not panel code.
People/ownership are synthetic and the DB is isolated. With --hardware it may
inspect/connect/read the actual locally paired earbud; no automatic writes are
provided to the Agent or performed by this harness.
"""
from contextlib import ExitStack
import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts.real_creative_eval import RequestBudget, execution_manifest

REQUEST = "我的华为 FreeBuds 4E 已经和电脑蓝牙连上了。帮我做个温柔一点的耳机操控台吧，我想看左右耳和盒子的电量，能点按钮切换降噪，还能调 Windows 里这副耳机的音量。先不要替我改任何设置，做好以后让我打开自己操作。能自己做的你就先做完，不要只给我一段教程。"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--hardware", action="store_true")
    args = parser.parse_args()
    if not args.real:
        parser.error("--real is required for existing authorized Bailian calls")
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from wujian.config import Settings
    from wujian.database import DeviceObservation, DeviceTarget, TaskRecord
    from wujian.coding_workbench import load_source
    from wujian.server import create_app

    config = Settings.load()
    if not config.api_key:
        raise RuntimeError("Missing configured Bailian API key")
    output = ROOT / "tmp/acceptance/2026-11-07_workbench" / (time.strftime("%H%M%S")+f"-{time.time_ns()%1000000:06d}")
    output.mkdir(parents=True)
    config.data_dir, config.database_url, config.session_secret = output / "data", "", ""
    config.demo_mode, config.rea_enabled = False, args.hardware
    budget = RequestBudget(output.parent / "request-budget.sqlite3", limit=None)
    restore = budget.install(config.base_url)
    report = {"kind": "real_agent_empty_source_development_probe", "independent_acceptance": False,
        "synthetic": ["account and ownership"], "request": REQUEST,
        "conditions": execution_manifest(config, ROOT), "hardware_reads_enabled": args.hardware,
        "preloaded_artifact_source": False, "hardware_writes_performed_by_harness": False}
    def checked(response):
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:1200]}")
        return response.json()
    def save():
        report["budget"] = budget.summary()
        (output/"results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"artifact":str(output),"model":config.model},ensure_ascii=False),flush=True)
    try:
        app = create_app(config)
        with TestClient(app) as client:
            user = checked(client.post("/api/auth/register", json={"username":"workbench_owner", "display_name":"小林", "password":"synthetic-workbench-2026"}))
            item = checked(client.post("/api/items", json={"name":"我的华为耳机", "product":{
                "brand":"HUAWEI 华为", "commercial_name":"FreeBuds 4E 无线耳机", "model":"FreeBuds 4E", "market":"CN"}}))
            report["fixture"] = {"user":user,"item":item}
            started=time.monotonic()
            run=checked(client.post("/api/chat",json={"text":REQUEST,"item_ids":[item["id"]],"photo_ids":[],"entry_context":{"intent":"general"}}))
            while run["status"] in {"queued","running"} and time.monotonic()-started<500:
                time.sleep(.4); run=checked(client.get(f"/api/runs/{run['id']}"))
            if run["status"] in {"queued","running"}:
                checked(client.post(f"/api/runs/{run['id']}/cancel"));run=checked(client.get(f"/api/runs/{run['id']}"))
            report.update(run=run,elapsed_seconds=round(time.monotonic()-started,2))
            with app.state.sessions() as db:
                workbenches=[]
                for task in db.scalars(select(TaskRecord).where(TaskRecord.user_id==user["id"])):
                    if task.plan.get("schema")=="workbench/1":
                        workbenches.append({"id":task.id,"version":task.version,"status":task.status,"plan":task.plan,
                            "source":load_source(db,user["id"],task).model_dump()})
                report["workbenches"]=workbenches
                report["device_targets"]=[{"id":target.id,"item_id":target.item_id,"kind":target.kind} for target in db.scalars(select(DeviceTarget))]
                report["device_observations"]=[{"tool":observation.tool,"evidence":observation.evidence} for observation in db.scalars(select(DeviceObservation))]
            report["checks"]={"completed":run["status"]=="completed", "created_same_item_task":len(workbenches)==1,
                "agent_wrote_source":len(workbenches)==1 and bool(workbenches[0]["source"]["javascript"]),
                "browser_check_passed":len(workbenches)==1 and bool((workbenches[0]["plan"].get("checks")or{}).get("passed")),
                "published":len(workbenches)==1 and bool(workbenches[0]["plan"].get("published")),
                "no_hardware_write":all("set_" not in obs["tool"] for obs in report["device_observations"])}
            save()
            print(json.dumps({"status":run["status"],"answer":run["text"],"error":run.get("error"),"checks":report["checks"],
                "tools":[e["name"]for e in run.get("events",[])if e.get("type")=="tool_start"],"seconds":report["elapsed_seconds"]},ensure_ascii=False),flush=True)
    finally:
        save();restore()
        print(json.dumps({"artifact":str(output),"budget":budget.summary()},ensure_ascii=False),flush=True)


if __name__=="__main__":
    main()
