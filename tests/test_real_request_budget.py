"""Offline checks for a real-evaluation spending ceiling, using mock transports."""
import asyncio
import concurrent.futures
import tempfile
import unittest
from pathlib import Path

import httpx
import httpx2

from scripts.real_creative_eval import RequestBudget


class RequestBudgetTests(unittest.TestCase):
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
