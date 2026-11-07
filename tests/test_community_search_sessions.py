"""Temporary collector protocol tests with actual synthetic stdio children.

No browser, account login, model API or external request is made here.
"""
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import psutil

from wujian.community_search import search_bilibili
from wujian.domain import DomainError
from wujian.mediacrawler_session import MediaCrawlerSessions, _public_operation


class TemporaryCommunitySessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        image = io.BytesIO()
        Image.new("RGB", (1, 1)).save(image, "PNG")
        qr = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
        self.qr_image_body = image.getvalue()
        self.started, self.continued = self.root / "started", self.root / "continued"
        self.worker = self.root / "synthetic_worker.py"
        self.worker.write_text(
            "import json,sys,os,time\nfrom pathlib import Path\n"
            "def emit(value): print(json.dumps(value),flush=True)\n"
            f"emit({{'event':'stage','stage':'waiting_scan','qr_data_url':{qr!r},'Cookie':'synthetic-secret'}})\n"
            "time.sleep(.02)\nemit({'event':'stage','stage':'connected'})\n"
            "for line in sys.stdin:\n"
            " request=json.loads(line)\n"
            " if request['operation']=='close': break\n"
            " if request.get('query')=='slow':\n"
            f"  Path({str(self.started)!r}).write_text('started')\n"
            "  time.sleep(1)\n"
            f"  Path({str(self.continued)!r}).write_text('continued')\n"
            " data={'items':[{'bvid':'BV1Py4y1b7Vc','title':'synthetic source'}], 'pid':os.getpid()}\n"
            " emit({'request_id':request['request_id'],'status':'ok','data':data})\n", encoding="utf-8")
        self.launch_patch = patch("wujian.mediacrawler_session.worker_launch", return_value=(
            [sys.executable, "-u", str(self.worker)], {key: os.environ[key] for key in ("SYSTEMROOT", "PATH", "TEMP", "TMP") if key in os.environ}))
        self.launch_patch.start()
        self.manager = MediaCrawlerSessions()

    async def asyncTearDown(self):
        await self.manager.close_all()
        self.launch_patch.stop()
        self.temporary.cleanup()

    async def wait_connected(self, user):
        await self.manager.start(user)
        for _ in range(300):
            status = await self.manager.status(user)
            if status["connected"]:
                return status
            await asyncio.sleep(.01)
        self.fail(f"synthetic session not ready: {status}")

    async def test_per_user_sessions_serialized_public_operations_and_no_account_export(self):
        status = await self.wait_connected("owner-a")
        self.assertNotIn("synthetic-secret", json.dumps(status))
        self.assertIsNone(status["qr_data_url"])
        with self.assertRaises(DomainError):
            await self.manager.request("owner-b", {"operation": "search", "query": "台灯", "limit": 1})
        await self.wait_connected("owner-b")
        first, second = await asyncio.gather(*(
            self.manager.request(user, {"operation": "search", "query": "台灯", "limit": 1})
            for user in ("owner-a", "owner-b")))
        self.assertNotEqual(first["pid"], second["pid"])
        results = await asyncio.gather(*(
            self.manager.request("owner-a", {"operation": "search", "query": f"台灯{i}", "limit": 1}) for i in range(3)))
        self.assertTrue(all(row["pid"] == first["pid"] for row in results))
        result = await search_bilibili("台灯 摄影", 1, requester=lambda request: self.manager.request("owner-a", request))
        self.assertEqual(result["results"][0]["bvid"], "BV1Py4y1b7Vc")
        self.assertEqual(result["provider"], "mediacrawler_public_bilibili_client")
        await self.manager.close("owner-a")
        self.assertFalse((await self.manager.status("owner-a"))["connected"])
        self.assertTrue((await self.manager.status("owner-b"))["connected"])

    async def test_cancelling_real_operation_reaps_child_and_prevents_late_side_effect(self):
        await self.wait_connected("owner-a")
        session = self.manager._sessions["owner-a"]
        task = asyncio.create_task(self.manager.request("owner-a", {"operation": "search", "query": "slow", "limit": 1}))
        for _ in range(200):
            if self.started.exists():
                break
            await asyncio.sleep(.01)
        self.assertTrue(self.started.exists())
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertIsNotNone(session.process.returncode)
        await asyncio.sleep(1.3)
        self.assertFalse(self.continued.exists())
        self.assertFalse((await self.manager.status("owner-a"))["connected"])

    async def test_cancelled_close_keeps_session_until_shared_cleanup_finishes(self):
        content = self.worker.read_text(encoding="utf-8").replace(
            "if request['operation']=='close': break", "if request['operation']=='close': time.sleep(.4);break")
        self.worker.write_text(content, encoding="utf-8")
        await self.wait_connected("owner-a")
        session = self.manager._sessions["owner-a"]
        closing = asyncio.create_task(self.manager.close("owner-a"))
        await asyncio.sleep(.05)
        closing.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await closing
        self.assertIn("owner-a", self.manager._sessions)
        self.assertFalse(session._cleanup_task.done())
        await self.manager.close_all()
        self.assertEqual(session.process.returncode, 0)
        self.assertTrue(session._cleanup_task.done())
        self.assertNotIn("owner-a", self.manager._sessions)

    async def test_cleanup_os_error_retains_session_and_next_close_can_retry(self):
        await self.wait_connected("owner-a")
        session = self.manager._sessions["owner-a"]
        with patch("wujian.mediacrawler_session.psutil.Process", side_effect=psutil.AccessDenied()):
            with self.assertRaises(DomainError):
                await self.manager.close("owner-a")
        self.assertIn("owner-a", self.manager._sessions)
        self.assertIsNone(session.process.returncode)
        await self.manager.close("owner-a")
        self.assertEqual(session.process.returncode, 0)
        self.assertNotIn("owner-a", self.manager._sessions)

    async def start_browser_like_operation(self):
        descendant_file = self.root / "descendant-pid"
        self.worker.write_text(
            "import json,sys,time,subprocess\nfrom pathlib import Path\n"
            "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],"
            "stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n"
            "print(json.dumps({'event':'stage','stage':'connected'}),flush=True)\n"
            "try:\n"
            " for line in sys.stdin:\n"
            "  request=json.loads(line)\n"
            "  if request['operation']=='close': break\n"
            f"  Path({str(descendant_file)!r}).write_text(str(child.pid))\n"
            "  time.sleep(30)\n"
            "finally:\n child.kill();child.wait()\n", encoding="utf-8")
        await self.wait_connected("owner-a")
        session = self.manager._sessions["owner-a"]
        task = asyncio.create_task(self.manager.request("owner-a", {"operation": "search", "query": "slow", "limit": 1}))
        for _ in range(300):
            if descendant_file.exists():
                break
            await asyncio.sleep(.01)
        self.assertTrue(descendant_file.exists())
        descendant_pid = int(descendant_file.read_text())
        return session, task, descendant_pid

    async def test_cancellation_reclaims_real_browser_like_grandchild(self):
        session, task, descendant_pid = await self.start_browser_like_operation()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertIsNotNone(session.process.returncode)
        if psutil.pid_exists(descendant_pid):
            self.assertEqual(psutil.Process(descendant_pid).status(), psutil.STATUS_ZOMBIE)

    async def test_failed_cleanup_retains_descendant_identity_after_worker_exit_for_retry(self):
        session, task, descendant_pid = await self.start_browser_like_operation()
        ignored = {descendant_pid} | {child.pid for child in psutil.Process(descendant_pid).children(recursive=True)}
        original_kill = psutil.Process.kill
        def temporarily_no_effect(process):
            if process.pid not in ignored:
                return original_kill(process)
        with patch.object(psutil.Process, "kill", temporarily_no_effect):
            task.cancel()
            result = await asyncio.gather(task, return_exceptions=True)
        self.assertIsInstance(result[0], DomainError)
        self.assertIsNotNone(session.process.returncode)
        self.assertIn("owner-a", self.manager._sessions)
        self.assertTrue(any(identity[0] == descendant_pid for identity in session._descendants))
        await self.manager.close("owner-a")
        self.assertEqual(session._descendants, {})
        self.assertNotIn("owner-a", self.manager._sessions)
        if psutil.pid_exists(descendant_pid):
            self.assertEqual(psutil.Process(descendant_pid).status(), psutil.STATUS_ZOMBIE)

    async def test_ttl_closes_real_idle_process_and_clears_qr(self):
        await self.manager.close_all()
        self.manager = MediaCrawlerSessions(ttl_seconds=1)
        await self.wait_connected("owner-a")
        session = self.manager._sessions["owner-a"]
        await asyncio.sleep(1.2)
        status = await self.manager.status("owner-a")
        self.assertEqual(status["stage"], "expired")
        self.assertIsNone(status["qr_data_url"])
        self.assertIsNotNone(session.process.returncode)

    async def test_failure_diagnostics_are_fixed_enums_without_raw_login_errors(self):
        self.worker.write_text(
            "import json\n"
            "print(json.dumps({'event':'stage','stage':'login_failed','failure_phase':'qr_capture',"
            "'failure_reason':'timeout','raw_error':'secret-login-url-and-cookie'}),flush=True)\n",
            encoding="utf-8")
        await self.manager.start("owner-a")
        for _ in range(200):
            status = await self.manager.status("owner-a")
            if status["stage"] == "login_failed":
                break
            await asyncio.sleep(.01)
        self.assertEqual(status["failure_phase"], "qr_capture")
        self.assertEqual(status["failure_reason"], "timeout")
        self.assertNotIn("secret-login", json.dumps(status))

    async def test_real_worker_session_protocol_with_synthetic_browser_and_login_dependencies(self):
        # Exercises the actual --session stdin/async-pipe lifecycle on Windows,
        # but all browser/login/HTTP behavior is explicitly synthetic.
        self.launch_patch.stop()
        source = self.root / "synthetic-upstream"
        files = {
            "config.py": "# synthetic upstream config\n",
            "media_platform/bilibili/client.py": (
                "import json,sys\n"
                "async def transport(url,**kwargs):\n"
                " assert kwargs['headers']['Cookie']=='SESSDATA=synthetic-auth'\n"
                " data={'isLogin':True} if url.endswith('/nav') else {'result':[{'bvid':'BV1Py4y1b7Vc',"
                "'title':'synthetic lamp','private':'do-not-export'}]}\n"
                " return url,'application/json',json.dumps({'code':0,'data':data}).encode()\n"
                "sys.modules['__main__'].download_public=transport\n"
                "class BilibiliClient:\n"
                " def __init__(self,**kwargs): pass\n"
                " async def search_video_by_keyword(self,*args,**kwargs):\n"
                "  return await self.request('GET','https://api.bilibili.com/x/web-interface/wbi/search/type?q=synthetic')\n"),
            "media_platform/bilibili/login.py": (
                "from tools import utils\n"
                "class BilibiliLogin:\n"
                " def __init__(self,*args,**kwargs): self.page=args[2]\n"
                " async def begin(self):\n"
                "  qr=await utils.find_login_qrcode(self.page,'synthetic-selector')\n"
                "  utils.show_qrcode(qr)\n"),
            "tools/__init__.py": "",
            "tools/utils.py": (
                "async def find_login_qrcode(*args,**kwargs):\n"
                " raise AssertionError('old src helper must not be used')\n"
                "async def convert_browser_context_cookies(*args,**kwargs):\n"
                " return 'SESSDATA=synthetic-auth',{'SESSDATA':'synthetic-auth'}\n"),
            "playwright/__init__.py": "",
            "playwright/async_api.py": (
                "from pathlib import Path\n"
                "class QRImage:\n"
                " @property\n"
                " def first(self): return self\n"
                " async def screenshot(self,**kwargs):\n"
                "  assert kwargs['type']=='png'\n"
                f"  Path({str(self.root / 'qr-screenshot')!r}).write_text('captured')\n"
                f"  return {self.qr_image_body!r}\n"
                "class Assertion:\n"
                " async def to_have_js_property(self,key,value,**kwargs): assert (key,value)==('complete',True)\n"
                " async def not_to_have_js_property(self,key,value,**kwargs): assert (key,value)==('naturalWidth',0)\n"
                "def expect(image): return Assertion()\n"
                "class Browser:\n"
                " async def launch(self,**kwargs):\n"
                "  assert kwargs=={'channel':'msedge','headless':True}\n"
                "  return self\n"
                " async def new_context(self,**kwargs): return self\n"
                " async def new_page(self): return self\n"
                " def locator(self,selector): return QRImage()\n"
                " async def goto(self,*args,**kwargs): pass\n"
                f" async def close(self): Path({str(self.root / 'browser-closed')!r}).write_text('closed')\n"
                "class async_playwright:\n"
                " async def __aenter__(self):\n"
                "  self.chromium=Browser()\n"
                "  return self\n"
                " async def __aexit__(self,*args): pass\n"),
        }
        for relative, content in files.items():
            path = source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        with patch.dict(os.environ, {"WUJIAN_MEDIACRAWLER_PYTHON": sys.executable,
                                     "WUJIAN_MEDIACRAWLER_SOURCE": str(source)}):
            status = await self.wait_connected("owner-a")
            self.assertNotIn("synthetic-auth", json.dumps(status))
            result = await self.manager.request("owner-a", {"operation": "search", "query": "台灯", "limit": 1})
            self.assertEqual(result["items"][0]["title"], "synthetic lamp")
            self.assertNotIn("do-not-export", json.dumps(result))
            process = self.manager._sessions["owner-a"].process
            await self.manager.close("owner-a")
            self.assertEqual(process.returncode, 0)
            self.assertTrue((self.root / "browser-closed").exists())
            self.assertTrue((self.root / "qr-screenshot").exists())


class TemporaryOperationValidationTests(unittest.TestCase):
    def test_agent_cannot_submit_cookie_paths_commands_or_unknown_operations(self):
        for request in ({"operation": "login", "Cookie": "secret"},
                        {"operation": "detail", "bvid": "BV1Py4y1b7Vc", "path": "private"},
                        {"operation": "search", "query": "x", "limit": True},
                        {"operation": "search", "query": "x", "limit": 1, "command": "anything"}):
            with self.subTest(request=request), self.assertRaises(DomainError):
                _public_operation(request)


if __name__ == "__main__":
    unittest.main()
