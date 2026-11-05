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

from scripts.real_creative_eval import RequestBudget, execution_manifest
from wujian.config import Settings


class RequestBudgetTests(unittest.TestCase):
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
