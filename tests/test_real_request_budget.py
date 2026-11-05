"""Offline checks for a real-evaluation spending ceiling, using mock transports."""
import asyncio
import concurrent.futures
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import httpx
import httpx2
from openai import OpenAI, AsyncOpenAI

from scripts.real_creative_eval import RequestBudget, execution_manifest
from wujian.config import Settings


class RequestBudgetTests(unittest.TestCase):
    def test_actual_openai_sdk_retry_uses_another_transport_attempt(self):
        for use_async in (False, True):
            with self.subTest(use_async=use_async), tempfile.TemporaryDirectory() as folder:
                budget = RequestBudget(Path(folder) / "budget.sqlite3", limit=2)
                observed = []
                def transport(request):
                    observed.append(request.url.path)
                    if len(observed) == 1:
                        return httpx2.Response(500, json={"error": {"message": "offline transient failure"}})
                    return httpx2.Response(200, json={"id": "offline", "object": "chat.completion",
                        "created": 0, "model": "offline", "choices": []})
                restore = budget.install("https://api.example.invalid/v1")
                async def probe():
                    async with AsyncOpenAI(api_key="offline-no-key", base_url="https://api.example.invalid/v1", max_retries=1,
                        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(transport))) as client:
                        await client.chat.completions.create(model="offline", messages=[{"role": "user", "content": "你好"}])
                try:
                    if use_async:
                        asyncio.run(probe())
                    else:
                        with OpenAI(api_key="offline-no-key", base_url="https://api.example.invalid/v1", max_retries=1,
                            http_client=httpx2.Client(transport=httpx2.MockTransport(transport))) as client:
                            client.chat.completions.create(model="offline", messages=[{"role": "user", "content": "你好"}])
                    self.assertEqual(len(observed), 2)
                    self.assertEqual(budget.summary()["attempted"], 2)
                    self.assertEqual({row[1] for row in budget.summary()["groups"]}, {"500", "200"})
                finally:
                    restore()

    def test_stream_body_failure_is_one_attempt_not_a_successful_generation(self):
        for library in (httpx, httpx2):
            with self.subTest(library=library.__name__), tempfile.TemporaryDirectory() as folder:
                class InterruptedBody(library.SyncByteStream):
                    def __iter__(self):
                        yield b"partial response"
                        raise library.ReadError("offline interrupted body")
                budget = RequestBudget(Path(folder) / "budget.sqlite3", limit=1)
                original = (library.Client._send_single_request, library.AsyncClient._send_single_request)
                restore = budget.install("https://api.example.invalid/v1")
                try:
                    with library.Client(transport=library.MockTransport(lambda _: library.Response(200, stream=InterruptedBody()))) as client:
                        with self.assertRaises(library.ReadError):
                            with client.stream("GET", "https://api.example.invalid/v1/chat/completions") as response:
                                list(response.iter_bytes())
                    self.assertEqual(budget.summary()["attempted"], 1)
                    # Headers arrived; this is deliberately not a claim that
                    # the response body or a model generation completed.
                    self.assertEqual(budget.summary()["groups"][0][1], "200")
                finally:
                    restore()
                self.assertEqual((library.Client._send_single_request, library.AsyncClient._send_single_request), original)

    def test_redirect_hops_each_consume_budget_and_stop_before_an_extra_transport(self):
        for library in (httpx, httpx2):
            with self.subTest(library=library.__name__), tempfile.TemporaryDirectory() as folder:
                budget = RequestBudget(Path(folder) / "budget.sqlite3", limit=1)
                observed = []
                def transport(request):
                    observed.append(request.url.path)
                    return library.Response(307, headers={"Location": "/v1/redirected"}) if request.url.path.endswith("start") else library.Response(200)
                restore = budget.install("https://api.example.invalid/v1")
                try:
                    with library.Client(follow_redirects=True, transport=library.MockTransport(transport)) as client:
                        with self.assertRaises(RuntimeError):
                            client.get("https://api.example.invalid/v1/start")
                    self.assertEqual(observed, ["/v1/start"])
                    self.assertEqual(budget.summary()["attempted"], 1)
                finally:
                    restore()

    def test_async_redirect_into_provider_is_counted_at_the_actual_target(self):
        for library in (httpx, httpx2):
            with self.subTest(library=library.__name__), tempfile.TemporaryDirectory() as folder:
                budget = RequestBudget(Path(folder) / "budget.sqlite3", limit=2)
                def transport(request):
                    if request.url.host == "public.example.invalid":
                        return library.Response(307, headers={"Location": "https://api.example.invalid/v1/start"})
                    if request.url.path.endswith("start"):
                        return library.Response(307, headers={"Location": "/v1/final"})
                    return library.Response(200)
                restore = budget.install("https://api.example.invalid/v1")
                async def probe():
                    async with library.AsyncClient(follow_redirects=True, transport=library.MockTransport(transport)) as client:
                        response = await client.get("https://public.example.invalid/redirect")
                        self.assertEqual(response.status_code, 200)
                try:
                    asyncio.run(probe())
                    self.assertEqual(budget.summary()["attempted"], 2)
                finally:
                    restore()

    def test_probe_conditions_capture_actual_flags_and_ignore_private_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "wujian").mkdir()
            runtime = root / "wujian" / "agent_runtime.py"
            runtime.write_text("# isolated implementation fixture\n", encoding="utf-8")
            (root / ".env").write_text("DASHSCOPE_API_KEY=must-never-be-copied", encoding="utf-8")
            (root / "var").mkdir()
            (root / "var" / "private.txt").write_text("a person's private story", encoding="utf-8")
            settings = Settings(api_key="must-never-be-copied", session_secret="session-must-be-omitted",
                base_url="https://api.example.invalid/v1?token=omit-this-too",
                thinking_enabled=False, thinking_budget=2048, provider_stream=True)
            manifest = execution_manifest(settings, root)
            self.assertFalse(manifest["thinking_enabled"])
            self.assertTrue(manifest["provider_stream"])
            self.assertEqual(manifest["thinking_budget"], 2048)
            self.assertTrue(manifest["packages"]["reme-ai"])
            self.assertIn("yt-dlp", manifest["packages"])
            self.assertEqual(manifest["implementation_sha256"], {
                "wujian/agent_runtime.py": hashlib.sha256(runtime.read_bytes()).hexdigest()})
            payload = json.dumps(manifest)
            for private in (settings.api_key, settings.session_secret, "omit-this-too", "a person's private story"):
                self.assertNotIn(private, payload)

    def test_effective_run_conditions_distinguish_local_source_and_thinking_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            skill = root / "agent_skills" / "creative-use" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("用户主动要灵感时再找玩法。", encoding="utf-8")
            settings = Settings(thinking_enabled=True)
            before = execution_manifest(settings, root)
            skill.write_text("用户主动要灵感时再找玩法，保留原案例条件。", encoding="utf-8")
            settings.thinking_enabled = False
            after = execution_manifest(settings, root)
            self.assertNotEqual(before["thinking_enabled"], after["thinking_enabled"])
            self.assertNotEqual(before["implementation_sha256"], after["implementation_sha256"])
            self.assertEqual(before["packages"], after["packages"])

    def test_concurrent_reservations_cannot_overrun_the_ceiling(self):
        with tempfile.TemporaryDirectory() as folder:
            budget = RequestBudget(Path(folder)/"budget.sqlite3", limit=3)
            def attempt(_):
                try:
                    budget.reserve("/mock")
                    return True
                except RuntimeError:
                    return False
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                self.assertEqual(sum(pool.map(attempt, range(20))),3)
            self.assertEqual(budget.summary()["attempted"],3)
            # Opening a second harness cannot silently increase an old limit.
            self.assertEqual(RequestBudget(budget.path, limit=600).summary()["ceiling"],3)

    def test_both_current_and_legacy_sdk_transports_are_counted(self):
        with tempfile.TemporaryDirectory() as folder:
            budget = RequestBudget(Path(folder)/"budget.sqlite3", limit=2)
            restore = budget.install("https://api.example.invalid/v1")
            async def probe():
                async with httpx2.AsyncClient(transport=httpx2.MockTransport(lambda req:httpx2.Response(200,json={"ok":True}))) as client:
                    await client.get("https://api.example.invalid/v1/embeddings")
            try:
                with httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(200))) as client:
                    client.get("https://api.example.invalid/v1/chat/completions")
                asyncio.run(probe())
                with httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(200))) as client:
                    with self.assertRaises(RuntimeError):
                        client.get("https://api.example.invalid/v1/responses")
                    client.get("https://public.example.invalid/article")
                self.assertEqual(budget.summary()["attempted"],2)
            finally:
                restore()
