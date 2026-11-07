"""Real optional Bili SDK/public-reader cancellation, no external network."""

import asyncio
import importlib.util
import socket
import threading
import unittest
from unittest.mock import patch

import httpx

from wujian.community_search import _search_sync as actual_search_sync, search_bilibili


@unittest.skipUnless(importlib.util.find_spec("yt_dlp"), "optional video dependency not installed")
class CommunitySearchCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_public_search_does_not_start_another_redirect_request(self):
        started = threading.Event()
        release = threading.Event()
        cancelled = threading.Event()
        finished = threading.Event()
        requests = []

        async def serve(request):
            requests.append({"path": request.url.path, "after_outer_cancel": cancelled.is_set()})
            if len(requests) == 1:
                started.set()
                if not await asyncio.to_thread(release.wait, 3):
                    raise AssertionError("Test did not release the in-flight HTTP response")
                return httpx.Response(302, headers={"Location": "https://api.bilibili.com/public-result"})
            return httpx.Response(200, json={"code": 0, "data": {"result": [{
                "arcurl": "http://www.bilibili.com/video/av100", "aid": 100,
                "bvid": "BV1pa4y1B7f8", "title": "长尾夹小玩法（合成响应）"}]}})

        def traced_search(*args):
            # Completion signal only: execute the actual SDK search unchanged.
            try:
                return actual_search_sync(*args)
            finally:
                finished.set()

        client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=public), \
             patch("wujian.community_search._search_sync", side_effect=traced_search):
            task = asyncio.create_task(search_bilibili("长尾夹 手机支架", 1))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 3))
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                cancelled.set()
            finally:
                release.set()
            self.assertTrue(await asyncio.to_thread(finished.wait, 4), "SDK worker did not finish")
        self.assertEqual(len(requests), 1,
            "A new HTTP hop was sent after the user-scoped search had been cancelled: " + repr(requests))
        self.assertFalse(any(row["after_outer_cancel"] for row in requests))
