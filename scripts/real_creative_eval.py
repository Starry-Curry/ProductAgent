"""Explicit real-model application probes with a process-safe HTTP request ceiling.

Run with --real. The application Agent searches/reads sources itself; this script
creates only explicitly synthetic ownership/utterances, never preloads answers.
Raw runs, sources and knowledge remain in the isolated evaluation directory.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import shutil
import sqlite3
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx


class RequestBudget:
    """Count HTTP attempts, including SDK retries and embedding health checks.

    Only installed by this explicitly invoked evaluation harness. No key,
    Authorization header, URL query or request body is retained in the ledger.
    """

    def __init__(self, path: Path, limit: int | None = 600, initial=0):
        if limit is not None and (isinstance(limit, bool) or limit < 1):
            raise ValueError("Request limit must be positive or explicitly None")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.limit = limit
        self.local_attempts = 0
        self._lock = threading.Lock()
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, used INTEGER NOT NULL, ceiling INTEGER NOT NULL)")
            # -1 records an explicitly uncapped NEW authorization. Opening an
            # existing bounded ledger never raises or removes its old ceiling.
            db.execute("INSERT OR IGNORE INTO counter VALUES (1, ?, ?)", (initial, -1 if limit is None else limit))
            if limit is not None:
                db.execute("UPDATE counter SET ceiling = CASE WHEN ceiling < 0 THEN ? ELSE MIN(ceiling, ?) END WHERE id=1", (limit, limit))
            db.execute("CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, started REAL, endpoint TEXT, status TEXT, elapsed REAL)")

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def reserve(self, endpoint):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            used, ceiling = db.execute("SELECT used, ceiling FROM counter WHERE id=1").fetchone()
            if ceiling >= 0 and used >= ceiling:
                raise RuntimeError("Real evaluation API request budget exhausted")
            db.execute("UPDATE counter SET used=used+1 WHERE id=1")
            cursor = db.execute("INSERT INTO attempts(started,endpoint,status) VALUES (?,?,?)", (time.time(), endpoint, "started"))
            with self._lock:
                self.local_attempts += 1
            return cursor.lastrowid

    def finish(self, identity, status, elapsed):
        with self.connect() as db:
            db.execute("UPDATE attempts SET status=?,elapsed=? WHERE id=?", (str(status), round(elapsed, 3), identity))

    def summary(self):
        with self.connect() as db:
            used, ceiling = db.execute("SELECT used,ceiling FROM counter WHERE id=1").fetchone()
            groups = db.execute("SELECT endpoint,status,count(*) FROM attempts GROUP BY endpoint,status").fetchall()
        return {"attempted": used, "ceiling": None if ceiling < 0 else ceiling, "groups": groups}

    def install(self, base_url, library=httpx):
        """Instrument HTTPX used by AgentScope, OpenAI search/vision and ReMe.

        Disable inherited proxy settings here for reproducible local evaluation;
        the normal application's network configuration is not monkey-patched.
        """
        host = urlsplit(base_url).hostname
        # `send` can follow several redirects internally. Count the actual
        # transport request for each hop, not only the outer SDK operation.
        # These private methods are checked against both locked HTTPX versions
        # by the offline redirect/retry/stream tests below this harness.
        sync_send, async_send = library.Client._send_single_request, library.AsyncClient._send_single_request
        sync_init, async_init = library.Client.__init__, library.AsyncClient.__init__
        budget = self

        def paid(request):
            return request.url.host == host or request.url.host.endswith(".dashscope.aliyuncs.com") or request.url.host == "dashscope.aliyuncs.com"

        def initialize_sync(client, *args, **kwargs):
            kwargs.setdefault("trust_env", False)
            return sync_init(client, *args, **kwargs)

        def initialize_async(client, *args, **kwargs):
            kwargs.setdefault("trust_env", False)
            return async_init(client, *args, **kwargs)

        def send(client, request, *args, **kwargs):
            if not paid(request):
                return sync_send(client, request, *args, **kwargs)
            identity = budget.reserve(request.url.path)
            started = time.monotonic()
            try:
                response = sync_send(client, request, *args, **kwargs)
            except BaseException as error:
                budget.finish(identity, type(error).__name__, time.monotonic()-started)
                raise
            budget.finish(identity, response.status_code, time.monotonic()-started)
            return response

        async def asend(client, request, *args, **kwargs):
            if not paid(request):
                return await async_send(client, request, *args, **kwargs)
            identity = budget.reserve(request.url.path)
            started = time.monotonic()
            try:
                response = await async_send(client, request, *args, **kwargs)
            except BaseException as error:
                budget.finish(identity, type(error).__name__, time.monotonic()-started)
                raise
            budget.finish(identity, response.status_code, time.monotonic()-started)
            return response

        library.Client.__init__, library.AsyncClient.__init__ = initialize_sync, initialize_async
        library.Client._send_single_request, library.AsyncClient._send_single_request = send, asend
        restore_other = None
        if library is httpx:
            # Current OpenAI SDK uses httpx2; explicit legacy clients still use
            # httpx. Instrument both actual transports, never just SDK events.
            import httpx2
            restore_other = self.install(base_url, httpx2)

        def restore():
            if restore_other:
                restore_other()
            library.Client.__init__, library.AsyncClient.__init__ = sync_init, async_init
            library.Client._send_single_request, library.AsyncClient._send_single_request = sync_send, async_send
        return restore


def scenarios():
    return {
        "product_visual": {
            "items":[{"name":"宜家瓦瑞拉搁板", "product":{"brand":"IKEA 宜家","model":"501.777.27","market":"CN"},
                      "description":"模拟拥有：白色瓦瑞拉搁板插件，正常装好，用于柜内叠放盘子。"},
                     {"name":"小摆件和白纸","kind":"nonstandard_object","description":"模拟拥有：鸡蛋大小的手工作品和几张A4白纸。"}],
            "turns":["这个宜家瓦瑞拉搁板，货号501.777.27，我想拿来拍小摆件。你先找它的商品资料和图片看看，别把它跟那种多层收纳架弄混了。不想粘胶或者拆它，用几张白纸能搭个干净背景吗？",
                     "我就用手机拿在手里拍。先试哪个摆法最省事？"],
            "focus":True,"intent":"creative",
        },
        "television": {
            "items": [{"name": "客厅的小米电视", "product": {"brand": "小米", "model": "L55M5-AZ", "market": "CN"}, "state": {"data_origin": "synthetic_ownership_real_domestic_model", "firmware_version_status": "not_reported"}}],
            "turns": [
                "家里这台小米电视，背面写着L55M5-AZ。每次开机的广告挺烦，我想弄掉。系统版本我还没看，你先自己上网找适用的说明和资料，看看能做到哪一步，带我一步步来。别直接让我刷机，也别假装你连上了我家的电视。",
                "客服那条路先放一边。我也想学学能不能用电脑和开源工具研究它。你自己找协议文档或工具说明看看，先教我做只读检查，不要照搬其他型号的包名，也别替我猜系统版本。",
            ],
            "focus": True, "intent": "creative",
        },
        "rea_research": {
            "items": [{"name":"客厅的小米电视", "product":{"brand":"小米","model":"L55M5-AZ","market":"CN"},
                       "state":{"data_origin":"synthetic_ownership_real_domestic_model","firmware_version_status":"unknown"}}],
            "turns":[
                "我想用Windows电脑研究这台L55M5-AZ电视的广告，不是让你帮我连电视。你自己去找协议、官方工具说明或者维护中的开源项目，把能公开取得的原文取回来分析，再告诉我能研究什么、不能确定什么。先不要刷机、卸载，也先别改电视设置。",
                "你刚才找到的工具说明，哪些是通用Android的方法，哪些真的有我这台电视的证据？下一步先教我在电视上看哪个信息，别一次让我做一长串。",
            ], "focus":True,"intent":"creative",
        },
        "creative": {
            "items": [
                {"name": "米家台灯1S", "product": {"brand": "小米", "model": "MJTD01SYL", "market": "CN"}, "state": {"data_origin": "synthetic_ownership_real_domestic_model"}},
                {"name": "两个透明玻璃杯", "kind": "nonstandard_object", "description": "模拟持有：两个普通透明玻璃饮水杯，不知道耐热温度。"},
                {"name": "长尾夹", "kind": "nonstandard_object", "description": "模拟持有：几个办公长尾夹，不知道额定承重。"},
                {"name": "书和白纸", "kind": "nonstandard_object", "description": "模拟持有：几本书和几张A4白纸。"},
            ],
            "turns": [
                "最近有点无聊，家里有米家台灯1S、玻璃杯、几个长尾夹和书。有没有让我觉得‘还能这么玩’的点子？别让我拆东西，也不用全都用上。你去B站或者公开社区找点真实分享借鉴一下，别光凭空编。",
                "拍照那个有点意思。夹子别用了，我怕夹坏。再说具体点，先让我试一个最简单的。",
                "刚试了，玻璃杯的影子挺好看，但是字拍不清楚。下一步怎么调？",
            ], "focus": False, "intent": "creative",
        },
        "memory": {
            "items": [{"name": "小雨送的手作杯子", "kind": "nonstandard_object", "description": "模拟持有：朋友送的手作陶杯，食品接触及耐热条件未知。"}],
            "turns": [
                "这个杯子是小雨毕业那天送我的，我挺舍不得。平时我喜欢简单一点的东西，不爱折腾。",
                "今天是个例外，我想摆得热闹一点，拍张照片发给她。别把今天这个当成我平时的喜好。",
                "之前那句‘不爱折腾’说得不准，我只是最近忙，别一直按这个理解我。",
                "把毕业那天她送我杯子的这件事记到回忆里，写简单一点就行，不要替我编当时发生了什么。",
            ], "focus": True, "intent": "general",
        },
        "persona": {
            "items": [{"name":"小雨送的手作杯子", "kind":"nonstandard_object",
                "description":"模拟持有：小雨送的手作陶杯，耐热和食品接触条件未知。",
                "avatar":{"enabled":True,"nickname":"小瓷","personality":"话少但温暖，有点好奇，喜欢听人讲生活，不总讲大道理。","color":"#a0b9bd"}}],
            "experiences": [{"title":"毕业礼物", "text":"毕业那天，小雨送我这只杯子，说以后也要常联系。",
                             "occurred_on":"2026-06-25","allow_ai":True}],
            "turns":[
                "小瓷，今天工作不太顺，不想听建议，就陪我待一会儿。",
                "看到你就想到毕业那天。你还记得那段我写下来的事吗？",
                "以后你说话再短一点就好，别一直问我问题。",
                "今天这一小段我想记下来：虽然累，但看到这个杯子心情好一点。就用我这句话，不要帮我编故事。",
            ], "focus":True,"intent":"persona",
        },
    }


def materialize_case(client, clients, app, case, checked):
    """Create only declared synthetic business facts via the actual HTTP API."""
    from fastapi.testclient import TestClient
    fixture=case.get("fixture",{})
    owner=client
    setup={}
    if fixture.get("sender_experiences"):
        owner=TestClient(app)
        owner.portal=client.portal
        clients.callback(owner.close)
        sender=checked(owner.post("/api/auth/register",json={"username":"probe_sender",
            "display_name":fixture.get("fictional_sender","模拟赠送者").split("，")[0],
            "password":"local-probe-only-123"}))
        recipient=checked(client.get("/api/me"))
        checked(owner.post("/api/friends",json={"username":recipient["username"]}))
        checked(client.post(f"/api/friends/{sender['id']}/accept"))
        setup["sender_id"]=sender["id"]
    items=[checked(owner.post("/api/items",json=payload)) for payload in case["items"]]
    item_map={row.get("key",str(index)):item["id"] for index,(row,item) in
              enumerate(zip(fixture.get("items",[{}]*len(items)),items))}
    experiences=[]
    for row in fixture.get("sender_experiences",fixture.get("experiences",case.get("experiences",[]))):
        body={key:value for key,value in row.items() if key not in {"key","item_keys"}}
        body["item_ids"]=[item_map[key] for key in row["item_keys"]] if "item_keys" in row else [items[0]["id"]]
        experiences.append(checked(owner.post("/api/experiences",json=body)))
    if owner is not client:
        gift=checked(owner.post("/api/gifts",json={"item_id":items[0]["id"],"recipient_id":recipient["id"],
            "message":fixture.get("gift_message",""),"experience_ids":[row["id"] for row in experiences],
            "avatar":case["items"][0].get("avatar",{})}))
        checked(client.post(f"/api/gifts/{gift['id']}/accept"))
        received=checked(client.get("/api/experiences",params={"item_id":items[0]["id"]}))
        originals={row["id"] for row in experiences}
        received=[row for row in received if row["origin_id"] in originals]
        assert len(received)==len(experiences),"Gift story was not actually materialized"
        assert all(not row["allow_ai"] for row in received),"Sender consent must not authorize receiver AI use"
        if fixture.get("receiver_ai_consent"):
            for row in received:
                body={key:row[key] for key in ("title","text","item_ids","photo_ids","occurred_on")}
                checked(client.put(f"/api/experiences/{row['id']}",json={**body,
                    "allow_ai":True,"expected_version":row["version"]}))
        items=[checked(client.get("/api/items/"+row["id"])) for row in items]
        assert all(row["owner_id"]==recipient["id"] for row in items)
        setup.update(gift_id=gift["id"],received_story_ids=[row["id"] for row in received],
                     receiver_ai_was_false_before_explicit_consent=True)
    setup["created_experience_ids"]=[row["id"] for row in experiences]
    return items,setup


def execution_manifest(config, root):
    """Record effective probe conditions without serializing Settings/secrets.

    A Git SHA alone misses local edits. Hash only an explicit implementation
    allowlist, never .env, private data, media, logs or arbitrary root files.
    These fields describe future runs; old frozen reports are not rewritten.
    """
    root = Path(root)
    paths = [*sorted((root / "wujian").glob("*.py")),
             *sorted((root / "agent_skills").glob("*/SKILL.md")),
             *(root / name for name in ("pyproject.toml", "uv.lock", "scripts/real_creative_eval.py"))]
    hashes = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in paths if path.is_file()}
    packages = {}
    for name in ("agentscope", "reme-ai", "openai", "httpx", "httpx2", "SQLAlchemy", "pydantic", "yt-dlp"):
        try:
            packages[name] = version(name)
        except PackageNotFoundError:
            packages[name] = None
    return {"schema": "wujian-probe-conditions/1", "model": config.model,
            "thinking_enabled": config.thinking_enabled, "thinking_budget": config.thinking_budget,
            "provider_stream": config.provider_stream, "embedding_model": config.embedding_model,
            "python_version": sys.version.split()[0], "packages": packages,
            "implementation_sha256": hashes}


def resumed_context(sessions, conversation_id):
    """Resume the cloned conversation's actual entry, not the CLI case default.

    Explicitly sending a generic entry/focus would overwrite the application
    context and turn a creative/persona repair probe into another product path.
    """
    from wujian.database import Conversation
    with sessions() as db:
        row = db.get(Conversation, conversation_id)
        if row is None:
            raise RuntimeError("Resumed evaluation conversation is missing")
        return json.loads(json.dumps(row.entry_context or {"intent": "general"})), list(row.item_ids or [])


def main():
    # Windows redirected stdout otherwise defaults to GBK: one model emoji can
    # stop a multi-turn probe after a paid response. The UTF-8 artifact is saved
    # separately, and console presentation must not control the experiment.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--case", required=True)
    parser.add_argument("--cases-file", type=Path, help="Independent frozen fixture; evaluator_only never enters the application")
    parser.add_argument("--independent", action="store_true",
                        help="Explicitly identify a previously frozen independent case, not an ordinary development fixture")
    parser.add_argument("--label", default="first")
    parser.add_argument("--turns", type=int, default=0)
    parser.add_argument("--request-limit", default="600",
                        help="Authorized total ceiling or explicit 'unlimited'; never raises an existing ledger's ceiling")
    parser.add_argument("--evaluation-root", type=Path,
                        help="Separate local evaluation directory for a new authorized phase; preserves historical ledgers")
    parser.add_argument("--thinking-budget", type=int, default=None,
                        help="Explicit performance experiment; leaves normal default unchanged")
    parser.add_argument("--model", help="Explicit same-provider comparison; does not edit .env or the application default")
    parser.add_argument("--provider-stream", action="store_true",
                        help="Bounded transport experiment; leaves the application's default unchanged")
    parser.add_argument("--resume-from", type=Path, help="Clone a completed development report's synthetic database; preserve the original evidence")
    parser.add_argument("--follow-up", help="Natural follow-up for the cloned development conversation")
    args = parser.parse_args()
    if not args.real:
        parser.error("--real required; this uses the authorized Bailian account")
    try:
        args.request_limit = None if args.request_limit == "unlimited" else int(args.request_limit)
        if args.request_limit is not None and args.request_limit < 1:
            raise ValueError()
    except ValueError:
        parser.error("--request-limit must be positive or 'unlimited' under explicit authorization")
    if args.independent and (not args.cases_file or args.resume_from):
        parser.error("--independent requires a frozen --cases-file and cannot be used for resumed development")
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from wujian.config import ROOT, Settings
    from wujian.database import KnowledgeClaim, Memory, SourceRecord
    from wujian.retrieval import claim_view
    from wujian.server import create_app

    folder = args.evaluation_root.resolve() if args.evaluation_root else ROOT / "var/evaluations/2026-11-06-creative-memory-rea"
    if not folder.resolve().is_relative_to(ROOT.resolve()):
        parser.error("--evaluation-root must stay within the project workspace")
    config = Settings.load()
    if args.model:
        config.model=args.model
    if args.provider_stream:
        config.provider_stream=True
    if args.thinking_budget is not None:
        if args.thinking_budget < 1:
            parser.error("--thinking-budget must be positive")
        config.thinking_budget = args.thinking_budget
    if not config.api_key:
        raise RuntimeError("Local API key missing")
    initial_ledger = folder / "api-budget.json"
    initial = json.loads(initial_ledger.read_text(encoding="utf-8"))["reserved_or_attempted"] if initial_ledger.exists() else 0
    budget = RequestBudget(folder / "request-budget.sqlite3", limit=args.request_limit, initial=initial)
    restore = budget.install(config.base_url)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    output = folder / f"{args.case}-{args.label}-{stamp}"
    output.mkdir(parents=True)
    config.data_dir, config.database_url, config.session_secret = output/"data", "", ""
    config.demo_mode = False
    resumed=None
    if args.resume_from:
        if not args.follow_up:
            parser.error("--resume-from requires --follow-up")
        parent=args.resume_from.resolve()
        if not parent.is_relative_to(folder.resolve()) or parent.name!="results.json":
            parser.error("Resume only a synthetic evaluation results.json under this run's isolation directory")
        resumed=json.loads(parent.read_text(encoding="utf-8"))
        shutil.copytree(parent.parent/"data",config.data_dir)
        # All models reuse the same original state, and later writes affect only
        # this clone. Rehome retained assets rather than read/write the parent.
        with sqlite3.connect(config.data_dir/"wujian.sqlite3") as clone:
            for identity,old_path in clone.execute("SELECT id,path FROM assets").fetchall():
                new_path=config.data_dir/"assets"/Path(old_path).name
                if new_path.exists():
                    clone.execute("UPDATE assets SET path=? WHERE id=?",(str(new_path),identity))
    if args.cases_file:
        case_file = json.loads(args.cases_file.read_text(encoding="utf-8"))
        selected = next((row for row in case_file["cases"] if row["id"] == args.case), None)
        if selected is None:
            parser.error("Case ID not found in fixture")
        case = {"items": [{key:value for key,value in row.items() if key != "key"}
                          for row in selected["fixture"]["items"]],
                "turns": selected["turns"], "fixture":selected["fixture"],
                "focus":False,"intent":"general"}
        fixture_keys = [row["key"] for row in selected["fixture"]["items"]]
    else:
        if args.case not in scenarios():
            parser.error("Unknown development case")
        case = scenarios()[args.case]
        fixture_keys = []
    if resumed:
        case["turns"]=[args.follow_up]
    report = {"kind": "real_model_application_development_probe", "case": args.case, "label": args.label,
              "synthetic": ["people", "ownership", "utterances", "physical trial reports"],
              "real": ["domestic product identities subject to source verification", "provider calls", "Agent-fetched sources"],
              "independent_acceptance": args.independent, "model": config.model,
              "thinking_budget": config.thinking_budget, "thinking_enabled": config.thinking_enabled,
              "conditions": execution_manifest(config, ROOT), "turns": []}
    report["provider_stream"] = config.provider_stream
    if resumed:
        report.update(independent_acceptance=False,parent_development_report=str(args.resume_from),
                      original_evidence_preserved=True)

    def checked(response):
        response.raise_for_status()
        return response.json()

    def save():
        report["budget"] = budget.summary()
        (output/"results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        app = create_app(config)
        with ExitStack() as clients:
            client = clients.enter_context(TestClient(app))
            if resumed:
                checked(client.post("/api/auth/login", json={"username":"probe_user","password":"local-probe-only-123"}))
                items=resumed["items"]
            else:
                display=case.get("fixture",{}).get("fictional_user","模拟测试者").split("，")[0]
                checked(client.post("/api/auth/register", json={"username":"probe_user", "display_name":display, "password":"local-probe-only-123"}))
                items,report["materialized_fixture"]=materialize_case(client,clients,app,case,checked)
            report["account_created"] = not bool(resumed)
            report["items"] = items
            conversation = resumed["turns"][-1]["run"]["conversation_id"] if resumed else None
            item_map = dict(zip(fixture_keys, [row["id"] for row in items]))
            entry = {"intent":case["intent"]}
            focused = [items[0]["id"]] if case["focus"] else []
            if resumed:
                entry, focused = resumed_context(app.state.sessions, conversation)
                report["resumed_entry_context"] = entry
                report["resumed_focused_item_ids"] = focused
            for index, turn in enumerate(case["turns"][:args.turns or None]):
                text = turn["text"] if isinstance(turn,dict) else turn
                if isinstance(turn,dict):
                    if "new" in turn.get("conversation", ""):
                        conversation = None
                    if "restart" in turn.get("conversation", ""):
                        clients.close()
                        app = create_app(config)
                        client = clients.enter_context(TestClient(app))
                        checked(client.post("/api/auth/login", json={"username":"probe_user","password":"local-probe-only-123"}))
                        report["application_restarted_before_turn"] = index
                    if "entry" in turn:
                        entry={"intent":turn["entry"]["intent"]}
                        focused=[item_map[key] for key in turn["entry"]["focus_item_keys"]]
                before = budget.local_attempts
                run = checked(client.post("/api/chat", json={"text":text, "conversation_id":conversation,
                    "item_ids":focused, "photo_ids":[], "entry_context":entry}))
                started = time.monotonic()
                while run["status"] in {"queued", "running"} and time.monotonic()-started<310:
                    time.sleep(0.5)
                    run = checked(client.get(f"/api/runs/{run['id']}"))
                if run["status"] in {"queued", "running"}:
                    checked(client.post(f"/api/runs/{run['id']}/cancel"))
                conversation = run["conversation_id"]
                report["turns"].append({"index":index, "text":text, "elapsed":round(time.monotonic()-started,2),
                                        "http_attempts":budget.local_attempts-before, "run":run,
                                        "workspace_snapshot":checked(client.get("/api/workspace"))})
                save()
                print(json.dumps({"case":args.case,"turn":index,"status":run["status"],"elapsed":round(time.monotonic()-started,1),"http_attempts":budget.local_attempts-before,"answer":run["text"],"error":run.get("error"),"budget":budget.summary()["attempted"]}, ensure_ascii=False),flush=True)
                if run["status"] != "completed":
                    break
            with app.state.sessions() as db:
                report["sources"] = [{"id":s.id,"url":s.url,"title":s.title,"content":s.content,"pages":s.pages} for s in db.scalars(select(SourceRecord))]
                report["knowledge"] = [claim_view(row) for row in db.scalars(select(KnowledgeClaim))]
                report["memories"] = [app_record_view(row) for row in db.scalars(select(Memory))]
            report["workspace"] = checked(client.get("/api/workspace"))
    finally:
        save()
        restore()
        print(json.dumps({"artifact":str(output),"budget":budget.summary()},ensure_ascii=False),flush=True)


def app_record_view(row):
    from wujian.domain import memory_view
    return {**memory_view(row), "active":row.active}


if __name__ == "__main__":
    main()
