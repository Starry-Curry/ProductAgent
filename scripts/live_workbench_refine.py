"""Opt-in same-task natural refinement of a real Agent-authored workbench.

The harness reads before/after evidence but never supplies or edits panel code.
No hardware write is requested or confirmed here.
"""
import argparse
import json
from pathlib import Path
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
REQUEST = (
    "阿圆，刚才这个耳机小面板用起来有几处不太顺，帮我接着改这一个就好。"
    "我在音量还没读完时拖滑条，过一会儿它又突然跳回去了；读取或设置还没结束时，先把相关操作锁住，等完成再让我继续，别让前后两次互相覆盖。"
    "设置音量、切换降噪以后，显示设备真正回读的结果，不要直接把我选的数当作已生效；比如Windows实际回读63.78，就显示63.78%，最多两位小数。"
    "右耳暂时没读到电量就写‘未知’，不要显示‘—%’。主色换成物间那种雾蓝配奶白，其他功能留着。"
    "你把原来的界面自己改好并检查发布，先不要替我操作任何硬件设置。"
)
CORRECTION_REQUEST = (
    "阿圆，我又打开试了一下，右耳还是显示‘未知 %’，未知后面的百分号也得去掉。"
    "还有刚打开时电量和音量一起读，不能只读完其中一个就把控件放开；要等正在处理的操作都结束后再恢复按钮和滑条，忙的时候别再启动新的读写。"
    "请你检查一下自己实际生成的页面，把这两处修好就行，雾蓝配色和其他功能都保留。先不要改真实耳机设置。"
)
MUTE_REQUEST = (
    "阿圆，有时候调完音量却还是听不到声音，想在这个耳机操控台里直接看到电脑当前是不是静音。"
    "只显示系统实际状态，读不到就写未知，别替我取消静音。"
    "保留其他功能、已有的忙碌保护、未知电量显示和真实音量回读；请你自己修改原来的作品，检查好再发布。"
)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-write", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--correction", action="store_true")
    parser.add_argument("--mute-status", action="store_true")
    args = parser.parse_args()
    if not args.live_write:
        parser.error("--live-write required for authorized same-task source mutations")
    output = ROOT / "var/evaluations/2026-11-07-live-refine" / (time.strftime("%H%M%S")+f"-{time.time_ns()%1000000:06d}")
    output.mkdir(parents=True)
    text = MUTE_REQUEST if args.mute_status else CORRECTION_REQUEST if args.correction else REQUEST
    report = {"kind": "live_same_task_refinement", "request": text, "preloaded_or_harness_edited_source": False,
        "automatic_device_writes_requested": False}
    def checked(response):
        response.raise_for_status(); return response.json()
    def save():
        (output/"results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2),encoding="utf-8")
    with httpx.Client(base_url=args.base_url,timeout=30,trust_env=False) as client:
        checked(client.post("/api/auth/demo/xiaolin"))
        before = checked(client.get(f"/api/workbenches/{args.task_id}"))
        resume = checked(client.post(f"/api/tasks/{args.task_id}/conversation"))
        report.update(before=before, resume=resume,
            workbenches_before=checked(client.get(f"/api/items/{before['item_id']}/workbenches")))
        print(json.dumps({"artifact":str(output),"task_id":args.task_id,"conversation":resume["conversation_id"]},ensure_ascii=False),flush=True)
        started=time.monotonic()
        run=checked(client.post("/api/chat",json={"text":text,"item_ids":[before["item_id"]],"photo_ids":[],
            "conversation_id":resume["conversation_id"],"entry_context":resume["entry_context"]}))
        report["run"]=run;save()
        while run["status"]in{"queued","running"} and time.monotonic()-started<500:
            time.sleep(.7);run=checked(client.get(f"/api/runs/{run['id']}"))
        if run["status"]in{"queued","running"}:
            checked(client.post(f"/api/runs/{run['id']}/cancel"));run=checked(client.get(f"/api/runs/{run['id']}"))
        after=checked(client.get(f"/api/workbenches/{args.task_id}"))
        works=checked(client.get(f"/api/items/{before['item_id']}/workbenches"))
        report.update(run=run,after=after,workbenches_after=works,elapsed_seconds=round(time.monotonic()-started,2),
            checks={"same_task":after["task_id"]==before["task_id"],"same_conversation":run["conversation_id"]==resume["conversation_id"],
                "no_parallel_workbench":{w["task_id"]for w in works}=={w["task_id"]for w in report["workbenches_before"]},
                "version_advanced":after["version"]>before["version"],"source_changed":after["source_sha256"]!=before["source_sha256"],
                "previous_history_retained":all(entry in after["source_history"]for entry in before["source_history"]),
                "published":after["published"],"browser_checks_passed":bool((after.get("checks")or{}).get("passed"))})
        save()
        print(json.dumps({"status":run["status"],"answer":run["text"],"error":run.get("error"),"checks":report["checks"],
            "seconds":report["elapsed_seconds"],"tools":[e["name"]for e in run.get("events",[])if e.get("type")=="tool_start"]},ensure_ascii=False),flush=True)


if __name__=="__main__":
    main()
