"""Optional collector boundaries; synthetic HTTP data, no model/account calls."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import select

from wujian import domain
from wujian.community_search import search_bilibili
from wujian.community_sources import fetch_bilibili_source
from wujian.config import Settings
from wujian.database import SourceRecord, make_database
from wujian.mediacrawler_adapter import request_public
from wujian.mediacrawler_worker import execute

BVID = "BV1Py4y1b7Vc"
URL = f"https://www.bilibili.com/video/{BVID}/"


class MediaCrawlerSearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_optional_provider_maps_public_fields_without_inventing_observation(self):
        response = {"items": [{"bvid": BVID, "title": "<em>台灯</em>摄影", "author": "合成作者",
                              "description": "简介", "cookie": "do-not-export"}, {"bvid": "wrong"}]}
        with patch.dict(os.environ, {"WUJIAN_COMMUNITY_PROVIDER": "mediacrawler"}), \
             patch("wujian.mediacrawler_adapter.request_public", new=AsyncMock(return_value=response)) as client:
            result = await search_bilibili("台灯 摄影", 2)
        client.assert_awaited_once_with({"operation": "search", "query": "台灯 摄影", "limit": 2})
        self.assertEqual(result["results"][0]["title"], "台灯摄影")
        self.assertEqual(result["search_pages_read"], 1)
        self.assertNotIn("cookie", json.dumps(result))
        self.assertIn("not_video_observation", result["results"][0]["content_level"])

    async def test_unknown_provider_and_invalid_query_do_not_launch_worker(self):
        with patch.dict(os.environ, {"WUJIAN_COMMUNITY_PROVIDER": "unknown"}), \
             patch("wujian.mediacrawler_adapter.request_public", new=AsyncMock()) as worker:
            for query in ("台灯", "private\naddress"):
                with self.assertRaises(domain.DomainError):
                    await search_bilibili(query)
            worker.assert_not_awaited()


class MediaCrawlerProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_operator_config_only_and_child_does_not_inherit_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            python = root / "python.exe"
            python.write_bytes(b"operator chosen synthetic executable")
            source = root / "source"
            (source / "media_platform/bilibili").mkdir(parents=True)
            (source / "media_platform/bilibili/client.py").write_text("# synthetic", encoding="utf-8")
            environment = {"WUJIAN_MEDIACRAWLER_PYTHON": str(python), "WUJIAN_MEDIACRAWLER_SOURCE": str(source),
                           "DASHSCOPE_API_KEY": "must-not-inherit", "HTTP_PROXY": "must-not-inherit",
                           "BILIBILI_COOKIE": "must-not-inherit"}
            response = type("Process", (), {"returncode": 0, "communicate": AsyncMock(
                return_value=(b'{"status":"ok","data":{"items":[]}}', None))})()
            with patch.dict(os.environ, environment), patch("wujian.mediacrawler_adapter.asyncio.create_subprocess_exec",
                                                                          new=AsyncMock(return_value=response)) as run:
                self.assertEqual(await request_public({"operation": "search", "query": "台灯", "limit": 1}), {"items": []})
            options = run.call_args.kwargs
            self.assertNotIn("shell", options)  # create_subprocess_exec never runs a shell
            self.assertNotIn("must-not-inherit", json.dumps(options["env"]))
            self.assertEqual(json.loads(response.communicate.await_args.args[0])["limit"], 1)

    async def test_missing_configuration_and_login_are_explicit(self):
        with patch.dict(os.environ, {"WUJIAN_MEDIACRAWLER_PYTHON": "relative.exe", "WUJIAN_MEDIACRAWLER_SOURCE": "relative"}):
            with self.assertRaises(domain.DomainError):
                await request_public({"operation": "search"})

    async def test_spawn_race_and_timeout_still_kill_and_reap(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "media_platform/bilibili").mkdir(parents=True)
            (source / "media_platform/bilibili/client.py").write_text("# synthetic", encoding="utf-8")
            environment = {"WUJIAN_MEDIACRAWLER_PYTHON": sys.executable, "WUJIAN_MEDIACRAWLER_SOURCE": str(source)}
            class Process:
                returncode = None
                def __init__(self):
                    self.communicate = AsyncMock(side_effect=asyncio.TimeoutError)
                    self.wait = AsyncMock(return_value=-9)
                    self.killed = False
                def kill(self):
                    self.killed, self.returncode = True, -9
            for during_spawn in (True, False):
                process = Process()
                started, release = asyncio.Event(), asyncio.Event()
                async def spawn(*args, **kwargs):
                    started.set()
                    if during_spawn:
                        await release.wait()
                    return process
                with self.subTest(during_spawn=during_spawn), patch.dict(os.environ, environment), \
                     patch("wujian.mediacrawler_adapter.asyncio.create_subprocess_exec", side_effect=spawn):
                    task = asyncio.create_task(request_public({"operation": "search", "query": "台灯", "limit": 1}))
                    await started.wait()
                    if during_spawn:
                        task.cancel()
                        release.set()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                        process.communicate.assert_not_awaited()
                    else:
                        with self.assertRaises(domain.DomainError):
                            await task
                    self.assertTrue(process.killed)
                    process.wait.assert_awaited_once()

    async def test_cancelled_request_kills_and_reaps_real_child_before_late_write(self):
        # Retains the independent review's real-process counterexample, but the
        # expected behavior now requires the late side effect to be prevented.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "synthetic-mc"
            package = source / "media_platform/bilibili"
            package.mkdir(parents=True)
            (source / "config.py").write_text("# synthetic, no network\n", encoding="utf-8")
            started, continued = root / "started", root / "continued-after-cancel"
            (package / "client.py").write_text(
                "import asyncio\nfrom pathlib import Path\nclass BilibiliClient:\n"
                " def __init__(self, **kwargs): pass\n"
                " async def search_video_by_keyword(self, *args, **kwargs):\n"
                f"  Path({str(started)!r}).write_text('started')\n"
                "  await asyncio.sleep(1)\n"
                f"  Path({str(continued)!r}).write_text('continued')\n"
                "  return {'result': []}\n", encoding="utf-8")
            real_create = asyncio.create_subprocess_exec
            children = []
            async def capture(*args, **kwargs):
                child = await real_create(*args, **kwargs)
                children.append(child)
                return child
            with patch.dict(os.environ, {"WUJIAN_MEDIACRAWLER_PYTHON": sys.executable,
                                         "WUJIAN_MEDIACRAWLER_SOURCE": str(source)}), \
                 patch("wujian.mediacrawler_adapter.asyncio.create_subprocess_exec", side_effect=capture):
                task = asyncio.create_task(request_public({"operation": "search", "query": "台灯", "limit": 1}))
                for _ in range(500):
                    if started.exists():
                        break
                    await asyncio.sleep(.01)
                self.assertTrue(started.exists(), "real subprocess did not start")
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertEqual(len(children), 1)
                self.assertIsNotNone(children[0].returncode)
                await asyncio.sleep(1.3)
                self.assertFalse(continued.exists(), "cancelled child continued work")


class MediaCrawlerTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_upstream_requests_are_bounded_public_get_and_no_cookie_forwarding(self):
        class Client:
            def __init__(self, **kwargs): pass
            async def search_video_by_keyword(self, query, page, page_size):
                self.assertions = (page, page_size)
                return await self.request("GET", "https://api.bilibili.com/x/web-interface/wbi/search/type?keyword=lamp",
                                          headers={"Cookie": "not-allowed", "Authorization": "not-allowed"})
        async def serve(url, **kwargs):
            self.assertTrue(kwargs["same_origin"])
            self.assertNotIn("Cookie", kwargs["headers"])
            self.assertNotIn("Authorization", kwargs["headers"])
            return url, "application/json", json.dumps({"code": 0, "data": {"result": [
                {"bvid": BVID, "title": "合成响应", "account": "private"}]}}).encode()
        with patch("wujian.mediacrawler_worker.download_public", new=AsyncMock(side_effect=serve)) as download:
            result = await execute(Client, {"operation": "search", "query": "台灯", "limit": 1})
        self.assertEqual(result["network_requests"], 1)
        self.assertNotIn("account", result["items"][0])
        self.assertEqual(download.await_count, 1)

    async def test_foreign_private_auth_and_write_operations_stop_before_network(self):
        for method, url in (("GET", "https://127.0.0.1/x/web-interface/nav"),
                            ("POST", "https://api.bilibili.com/x/web-interface/nav"),
                            ("GET", "https://api.bilibili.com/x/member/web/account"),
                            ("GET", "https://api.bilibili.com:444/x/web-interface/nav")):
            class Client:
                def __init__(self, **kwargs): pass
                async def search_video_by_keyword(self, *args, **kwargs):
                    return await self.request(method, url)
            with self.subTest(method=method, url=url), patch("wujian.mediacrawler_worker.download_public", new=AsyncMock()) as download:
                with self.assertRaises(domain.DomainError):
                    await execute(Client, {"operation": "search", "query": "台灯", "limit": 1})
                download.assert_not_awaited()


class CommunitySourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_cached_canonical_source_survives_login_expiry_refresh_is_explicit_and_owner_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Settings(data_dir=Path(directory))
            settings.prepare()
            engine, sessions = make_database(settings)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                detail = {"bvid": BVID, "title": "合成教程", "desc": "简介", "parts": []}
                with patch("wujian.community_sources.request_public", new=AsyncMock(return_value=detail)) as worker:
                    first = await fetch_bilibili_source(sessions, "person_demo_owner", URL)
                    second = await fetch_bilibili_source(sessions, "person_demo_owner", URL + "?p=1&share_source=copy_web")
                    self.assertEqual(first["source_id"], second["source_id"])
                    self.assertEqual(worker.await_count, 1)
                    worker.side_effect = domain.DomainError("needs_login", 503)
                    third = await fetch_bilibili_source(sessions, "person_demo_owner", URL)
                    self.assertEqual(third["source_id"], first["source_id"])
                    self.assertEqual(worker.await_count, 1)
                    with self.assertRaises(domain.DomainError):
                        await fetch_bilibili_source(sessions, "person_demo_owner", URL, refresh=True)
                    with self.assertRaises(domain.DomainError):
                        await fetch_bilibili_source(sessions, "person_demo_friend", URL)
                    worker.side_effect = None
                    refreshed = await fetch_bilibili_source(sessions, "person_demo_owner", URL, refresh=True)
                    self.assertNotEqual(refreshed["source_id"], first["source_id"])
                    with sessions() as db:
                        rows = list(db.scalars(select(SourceRecord)))
                        self.assertEqual(len(rows), 2)
                        self.assertTrue(all(row.owner_id == "person_demo_owner" for row in rows))
            finally:
                engine.dispose()

    async def test_same_source_store_and_pre_io_item_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Settings(data_dir=Path(directory))
            settings.prepare()
            engine, sessions = make_database(settings)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                detail = {"bvid": BVID, "title": "合成台灯教程", "author": "合成作者", "desc": "作者简介",
                          "duration": 449, "parts": [{"page": 1, "part": "教程首P", "duration": 449}]}
                with patch("wujian.community_sources.request_public", new=AsyncMock(return_value=detail)) as reader:
                    value = await fetch_bilibili_source(sessions, "person_demo_owner", URL)
                    self.assertFalse(value["case_evidence"]["video_observed"])
                    self.assertEqual(value["content_level"], "public_video_page_or_metadata_not_video_observation")
                    with self.assertRaises(domain.DomainError):
                        await fetch_bilibili_source(sessions, "person_demo_owner", URL, "nonexistent-item")
                    self.assertEqual(reader.await_count, 1)
                with sessions() as db:
                    rows = list(db.scalars(select(SourceRecord)))
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0].origin, "public_web")
                    self.assertIn("未观看视频或音频", rows[0].content)
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
