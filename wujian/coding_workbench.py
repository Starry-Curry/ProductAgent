"""Item-bound source artifacts created by the main Agent, not preset consoles.

The existing SQL task owns source versions, checks and publication. Source files
are ordinary private Assets. Only HTML/CSS/JS are editable; there is no host shell
or arbitrary filesystem API. Physical writes remain explicit outer-UI actions.
"""
from __future__ import annotations

import hashlib
import html as html_escape
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from bs4 import BeautifulSoup
from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update

from . import domain
from .database import Asset, ChatMessage, Conversation, TaskRecord, now, uid

SCHEMA = "workbench/1"
MEDIA_TYPE = "application/vnd.wujian.workbench+json"
OPS = ("read_state", "read_volume", "set_noise_mode", "set_volume")


class WorkbenchSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    html: str = Field(default="", max_length=80000)
    css: str = Field(default="", max_length=50000)
    javascript: str = Field(default="", max_length=80000)


class DeviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    op: str
    args: dict = Field(default_factory=dict)


class WorkbenchView(BaseModel):
    task_id: str
    item_id: str
    version: int
    title: str
    published: bool
    source: WorkbenchSource
    source_sha256: str
    source_history: list[dict] = Field(default_factory=list)
    document_html: str
    checks: dict | None = None
    bridge: dict
    url: str


def bridge_contract():
    return {"version": 1, "operations": list(OPS), "client": "window.wujian.request(op,args) returns Promise<actual device result>",
        "request": {"type": "wujian:bridge-request", "version": 1, "request_id": "unique string", "op": "one listed operation", "args": {}},
        "result": {"type": "wujian:bridge-result", "version": 1, "request_id": "same string", "ok": True, "result": "actual EarbudResult"},
        "arguments": {"read_state": {}, "read_volume": {}, "set_noise_mode": {"mode": "off|light|balanced"}, "set_volume": {"level": "number 0..100"}},
        "promise_return": "IMPORTANT: await window.wujian.request(...) resolves DIRECTLY to the actual result object shown below. There is NO result.ok and NO result.result wrapper. Transport/error/device failures reject the Promise; catch and visibly show error.message.",
        "read_state_example": {"status": "observed", "observed_at": "timestamp", "state": {"battery": {"left": 72, "right": 68, "case": 90}, "noise_mode": "off"}},
        "read_state_result": "const result=await window.wujian.request('read_state',{}); use result.state.battery.left/right/case and result.state.noise_mode. Battery number|null; unknown shows 未知, never 0% by default. Mode labels: off=关闭降噪, light=轻度降噪, balanced=均衡降噪, never call light transparency/通透.",
        "volume_example": {"status": "observed", "state": {"volume": 35, "muted": False, "scope": "windows_output_endpoint"}},
        "volume_result": "const result=await window.wujian.request('read_volume',{}); use result.state.volume (NOT level and NOT result.result). It is Windows output endpoint volume, separate from earbud internal volume. set_volume args use level, but returned state still uses volume.",
        "write_rule": "Generated code may REQUEST changes only. Parent UI asks for a real user click; no write runs on page load. Display pending/denied/errors honestly.",
        "device_prerequisite": "A generated workbench does not itself bind hardware. Use connect_earbuds/read_earbuds to verify this same actual item if user requested live control. If binding/connection is still unavailable, publish the code but explicitly say 待连接; paired Bluetooth alone is not a Wujian binding or successful control.",
        "scope": "Only this task's owned item. No arbitrary URLs, item IDs, shell, Python, host filesystem or external network. Use inline HTML fragment, CSS and JavaScript with DOM APIs; no imports or framework build required."}


# A transport SDK, not application UI or behavior. Every visible control and
# interaction remains code authored by the actual application Agent.
CLIENT = r"""(()=>{let n=0;const pending=new Map();
window.wujian=Object.freeze({request(op,args={}){return new Promise((resolve,reject)=>{
const request_id='request-'+(++n)+'-'+Date.now();const timer=setTimeout(()=>{pending.delete(request_id);reject(new Error('操作等待确认或超时，请重试'));},60000);
pending.set(request_id,{resolve,reject,timer,op});parent.postMessage({type:'wujian:bridge-request',version:1,request_id,op,args},'*');});}});
addEventListener('message',e=>{if(e.source!==parent)return;const m=e.data;if(!m||m.type!=='wujian:bridge-result'||m.version!==1)return;
const p=pending.get(m.request_id);if(!p)return;clearTimeout(p.timer);pending.delete(m.request_id);
if(!m.ok){p.reject(new Error(m.error||'操作未完成'));return;}const r=m.result||{};
if(!['observed','verified'].includes(r.status)||((p.op==='set_noise_mode'||p.op==='set_volume')&&(r.status!=='verified'||r.state?.write_verified!==true))){p.reject(new Error(r.message||r.state?.message||'设备没有确认结果，请重试'));return;}p.resolve(r);});})();"""


def source_bytes(source):
    return json.dumps(WorkbenchSource.model_validate(source).model_dump(), ensure_ascii=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")


def validate_source(source, *, require_interface=True):
    source = WorkbenchSource.model_validate(source)
    if require_interface and not source.html.strip():
        raise domain.DomainError("工作台需要实际HTML界面，不能只发布说明文字")
    soup = BeautifulSoup(source.html, "html.parser")
    for node in soup.find_all(True):
        if node.name in {"script", "iframe", "frame", "object", "embed", "meta", "base", "link", "form"}:
            raise domain.DomainError("HTML只写界面片段，脚本放javascript字段，不嵌入外部页面或资源")
        for attribute, value in node.attrs.items():
            if attribute.startswith("on") or attribute in {"srcdoc", "action", "formaction", "href"}:
                raise domain.DomainError("请用javascript中的addEventListener绑定事件，不内嵌事件/链接或外部页面")
            if attribute == "src" and not (node.name == "img" and str(value).startswith("data:image/")):
                raise domain.DomainError("工作台不加载外部资源；请使用CSS或内嵌图片")
    if re.search(r"</style", source.css, re.I) or re.search(r"</script", source.javascript, re.I):
        raise domain.DomainError("CSS/JavaScript字段不能包含HTML闭合标签")
    if re.search(r"(?:@import|url\s*\()", source.css, re.I):
        raise domain.DomainError("请使用本地CSS，不引用网络字体、图片或样式")
    # Early feedback about unsupported features, NOT the security boundary.
    # Opaque-origin iframe, parent CSP and trusted bridge control that boundary.
    if re.search(r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|importScripts|eval|Function)\s*\(|\bimport\s|\b(?:location|sendBeacon|cookie)\b|window\s*\.\s*open", source.javascript):
        raise domain.DomainError("工作台只使用DOM与window.wujian.request桥，不使用网络、导航、Cookie或动态代码")
    return source


def document_html(source):
    source = validate_source(source)
    csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
    return ("<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<meta http-equiv='Content-Security-Policy' content=\"" + html_escape.escape(csp, quote=True) + "\">"
            + "<style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif;}" + source.css + "</style>"
            + "<script>" + CLIENT + "</script></head><body>" + source.html + "<script>" + source.javascript + "</script></body></html>")


def owned_task(db, user_id, task_id):
    task = domain.require(db.get(TaskRecord, task_id))
    if task.user_id != user_id or task.plan.get("schema") != SCHEMA or len(task.item_ids) != 1:
        raise domain.DomainError("没有找到这个工作台", 404)
    domain.accessible_item(db, user_id, task.item_ids[0], write=True)
    return task


def load_source(db, user_id, task, source_revision=0):
    revision = next((entry for entry in task.plan.get("source_history", []) if entry.get("revision") == source_revision), None) if source_revision else None
    if source_revision and revision is None:
        raise domain.DomainError("没有找到这个保留的源码版本", 404)
    asset_id = revision["asset_id"] if revision else task.plan.get("source_asset_id")
    if not asset_id:
        return WorkbenchSource()
    asset = domain.own_asset(db, user_id, asset_id)
    if asset.media_type != MEDIA_TYPE:
        raise domain.DomainError("工作台源码资产类型错误", 409)
    content = Path(asset.path).read_bytes()
    if hashlib.sha256(content).hexdigest() != (revision["sha256"] if revision else task.plan.get("source_sha256")):
        raise domain.DomainError("工作台源码校验不符，请重新生成并检查", 409)
    return WorkbenchSource.model_validate_json(content)


def view(db, user_id, task, *, include_document=False):
    source = load_source(db, user_id, task)
    return {"task_id": task.id, "item_id": task.item_ids[0], "version": task.version, "title": task.goal,
        "published": bool(task.plan.get("published")), "source": source.model_dump(),
        "source_sha256": task.plan.get("source_sha256", ""),
        "source_history": task.plan.get("source_history", []),
        "document_html": document_html(source) if include_document and task.plan.get("published") else "",
        "checks": task.plan.get("checks"), "bridge": bridge_contract(),
        "url": f"/#items?item={task.item_ids[0]}&panel=workbench&task={task.id}"}


def create(db, user_id, message_id, item_id, goal, source_quote):
    domain.accessible_item(db, user_id, item_id, write=True)
    message = domain.require(db.get(ChatMessage, message_id))
    conversation = domain.require(db.get(Conversation, message.conversation_id))
    if (message.role != "user" or conversation.user_id != user_id or not source_quote.strip()
            or source_quote not in message.text):
        raise domain.DomainError("建立工作台需要当前用户实际提出目标的原话", 403)
    existing = next((task for task in db.scalars(select(TaskRecord).where(
        TaskRecord.user_id == user_id, TaskRecord.source_message_id == message_id))
        if task.plan.get("schema") == SCHEMA and task.item_ids == [item_id]), None)
    if existing:
        return view(db, user_id, existing)
    if not goal.strip() or len(goal) > 4000:
        raise domain.DomainError("请保留具体且不超过4000字的工作台目标")
    # The dedicated business operation alone can create this reserved task
    # schema. Generic task/continuation writes cannot forge checked artifacts.
    task = TaskRecord(user_id=user_id, source_message_id=message_id, goal=goal,
        item_ids=[item_id], constraints={"request_quote": source_quote}, status="exploring",
        plan={"schema": SCHEMA, "kind": "workbench", "published": False,
            "source_asset_id": None, "source_sha256": "", "checks": None, "events": []})
    db.add(task); db.commit(); db.refresh(task)
    return view(db, user_id, task)


def _change(db, task, expected_version, plan, status="exploring"):
    changed = db.execute(update(TaskRecord).where(TaskRecord.id == task.id,
        TaskRecord.version == expected_version).values(plan=plan, status=status,
            version=TaskRecord.version + 1, updated_at=now()))
    if changed.rowcount != 1:
        raise domain.DomainError("工作台已更新，请先读取当前版本再继续", 409)
    db.commit(); db.expire_all()
    return db.get(TaskRecord, task.id)


def write(db, settings, user_id, task_id, expected_version, source):
    task = owned_task(db, user_id, task_id)
    source = validate_source(source, require_interface=False)
    if task.version != expected_version:
        raise domain.DomainError("工作台已更新，请先读取当前版本再继续", 409)
    content = source_bytes(source)
    identity = uid()
    path = settings.data_dir / "assets" / identity
    path.write_bytes(content)
    db.add(Asset(id=identity, owner_id=user_id, path=str(path), media_type=MEDIA_TYPE, original_name="workbench-source.json"))
    plan = {**task.plan, "source_asset_id": identity, "source_sha256": hashlib.sha256(content).hexdigest(),
        "source_history": [*task.plan.get("source_history", [])[-11:], {"asset_id": identity,
            "sha256": hashlib.sha256(content).hexdigest(), "revision": expected_version + 1, "written_at": now()}],
        "published": False, "checks": None, "events": [*task.plan.get("events", [])[-11:], {"type": "source_written", "at": now()}]}
    try:
        task = _change(db, task, expected_version, plan)
    except BaseException:
        db.rollback(); path.unlink(missing_ok=True)
        raise
    return view(db, user_id, task)


def run_checks(source):
    source = validate_source(source)
    node = shutil.which("node")
    if not node:
        return {"passed": False, "syntax": {"passed": False, "error": "本机缺少Node语法检查器"}, "browser": None}
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    syntax = subprocess.run([node, "--check", "--input-type=commonjs"], input=CLIENT + "\n" + source.javascript,
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, creationflags=flags)
    receipt = {"syntax": {"passed": syntax.returncode == 0, "output": syntax.stderr[-2500:]}, "browser": None,
        "scope": "JavaScript syntax + isolated browser DOM/bridge smoke; not hardware acceptance"}
    if syntax.returncode:
        return {**receipt, "passed": False}
    with tempfile.TemporaryDirectory(prefix="wujian-check-", dir=str(Path(tempfile.gettempdir()))) as temporary:
        path = Path(temporary) / "artifact.html"
        path.write_text(document_html(source), encoding="utf-8")
        process = subprocess.Popen([sys.executable, "-m", "wujian.workbench_check", str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"}, creationflags=flags)
        try:
            output, error = process.communicate(timeout=25)
        except subprocess.TimeoutExpired:
            import psutil
            for child in psutil.Process(process.pid).children(recursive=True):
                try: child.kill()
                except psutil.Error: pass
            process.kill(); process.communicate()
            return {**receipt, "passed": False, "browser": {"passed": False, "error": "浏览器检查超时，可能存在无限循环或未完成操作"}}
    try:
        receipt["browser"] = json.loads(output)
    except (ValueError, TypeError):
        receipt["browser"] = {"passed": False, "error": (error or output)[-1800:]}
    return {**receipt, "passed": bool(receipt["browser"].get("passed"))}


def check(db, user_id, task_id, expected_version):
    task = owned_task(db, user_id, task_id)
    if task.version != expected_version or not task.plan.get("source_asset_id"):
        raise domain.DomainError("请读取当前工作台版本并写入实际源码后检查", 409)
    source, digest = load_source(db, user_id, task), task.plan["source_sha256"]
    db.rollback()  # Do not keep a SQL read transaction during browser IO.
    checks = {**run_checks(source), "source_sha256": digest, "checked_at": now()}
    # Recheck ownership/version after the browser process, before saving its
    # receipt. A result for old code must never publish newly edited code.
    db.expire_all(); task = owned_task(db, user_id, task_id)
    task = _change(db, task, expected_version, {**task.plan, "checks": checks})
    return view(db, user_id, task)


def publish(db, user_id, task_id, expected_version):
    task = owned_task(db, user_id, task_id)
    checks = task.plan.get("checks") or {}
    if not checks.get("passed") or checks.get("source_sha256") != task.plan.get("source_sha256"):
        raise domain.DomainError("请先修正源码并通过当前版本检查，不能发布未检查或旧检查对应的源码", 409)
    # Validate current private asset content, too; the hash isn't just a label.
    validate_source(load_source(db, user_id, task))
    task = _change(db, task, expected_version, {**task.plan, "published": True, "published_at": now()}, "ready")
    return view(db, user_id, task, include_document=True)


def register_routes(app, current_user, db_session, settings):
    def bridge_result(result, *, writing=False):
        # The generated page receives no Bluetooth address, endpoint instance
        # path, private source text or session identity through the bridge.
        state = result.get("state") if isinstance(result.get("state"), dict) else {}
        status = result.get("status")
        if writing:
            if status != "verified" or state.get("write_verified") is not True:
                detail = result.get("message") or state.get("message") or "设备未返回已确认的写入结果"
                if status in {"not_bound", "not_paired", "disconnected", "wrong_target", "unsupported", "ambiguous_target", "invalid_volume"}:
                    raise domain.DomainError(detail + "。本次没有确认可用的控制连接，请先读取并检查连接。", 409)
                raise domain.DomainError(f"{detail}。设备可能已经改变，但回读尚未核验；请先刷新状态核对，不要重复触发。", 502)
        elif status not in {"observed", "verified"}:
            detail = result.get("message") or state.get("message") or "还没有读取到设备的当前状态，请检查连接后重试"
            raise domain.DomainError(detail, 409)
        return {key: result[key] for key in ("status", "message", "observed_at", "physical_effect_verified") if key in result} | {
            "state": {key: state[key] for key in ("status", "battery", "noise_mode", "write_verified",
                "requested_mode", "volume", "requested_volume", "previous_volume", "muted", "scope", "endpoint_name", "message") if key in state}}

    @app.get("/api/workbenches/{task_id}", response_model=WorkbenchView)
    def get_workbench(task_id: str, user=Depends(current_user), db=Depends(db_session)):
        return view(db, user.id, owned_task(db, user.id, task_id), include_document=True)

    @app.get("/api/items/{item_id}/workbenches", response_model=list[WorkbenchView])
    def list_workbenches(item_id: str, user=Depends(current_user), db=Depends(db_session)):
        domain.accessible_item(db, user.id, item_id, write=True)
        return [view(db, user.id, row) for row in db.scalars(select(TaskRecord).where(
            TaskRecord.user_id == user.id).order_by(TaskRecord.updated_at.desc()))
            if row.plan.get("schema") == SCHEMA and row.item_ids == [item_id]]

    @app.post("/api/workbenches/{task_id}/device")
    def device_operation(task_id: str, payload: DeviceRequest, user=Depends(current_user), db=Depends(db_session)):
        if not settings.rea_enabled:
            raise domain.DomainError("此环境未启用本机设备工具", 403)
        task = owned_task(db, user.id, task_id)
        if not task.plan.get("published") or task.version != payload.expected_version:
            raise domain.DomainError("工作台未发布或已更新，请重新打开", 409)
        # Exact allowlist, not generated URLs/commands. The opaque-origin
        # iframe cannot call this endpoint; the trusted outer UI confirms writes.
        from .earbuds import earbud_tool
        args = payload.args
        if payload.op in {"read_state", "read_volume"}:
            if args: raise domain.DomainError("读取操作不接收额外参数")
            return bridge_result(earbud_tool(db, user.id, "read" if payload.op == "read_state" else "read_volume", task.item_ids[0]))
        if payload.op == "set_noise_mode" and set(args) == {"mode"} and isinstance(args["mode"], str) and args["mode"] in {"off", "light", "balanced"}:
            return bridge_result(earbud_tool(db, user.id, "set_anc", task.item_ids[0], mode=args["mode"]), writing=True)
        if payload.op == "set_volume" and set(args) == {"level"} and type(args["level"]) in {int, float} and 0 <= args["level"] <= 100:
            current = earbud_tool(db, user.id, "read_volume", task.item_ids[0])
            endpoint_id = (current.get("state") or {}).get("endpoint_id")
            if not endpoint_id:
                bridge_result(current)
                raise domain.DomainError("未能确认这副耳机当前的Windows输出端点，本次未执行音量调整；请先读取输出音量。", 409)
            return bridge_result(earbud_tool(db, user.id, "set_volume", task.item_ids[0], volume=args["level"], endpoint_id=endpoint_id), writing=True)
        raise domain.DomainError("工作台请求不是已允许的设备操作或参数")
