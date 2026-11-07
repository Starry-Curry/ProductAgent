"""Real optional yt-dlp + public-reader transport regression, no paid/network API."""
import importlib.util
import json
import socket
import unittest
import uuid
from unittest.mock import patch

import httpx

from wujian.community_search import SEARCH_BODY_LIMIT, search_bilibili
from wujian.domain import DomainError

HAS_VIDEO = importlib.util.find_spec("yt_dlp") is not None
PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]


def video(index=0, **changes):
    row = {"arcurl": f"http://www.bilibili.com/video/av{100+index}", "aid": 100+index,
        "bvid": f"BV1pa4y1B7f{8-index}", "title": "<em>长尾夹</em>小玩法",
        "author": "真实响应字段（合成测试）", "description": "夹子与纸；仅简介"}
    return row | changes


@unittest.skipUnless(HAS_VIDEO, "optional video dependency not installed")
class CommunitySearchTransportTests(unittest.IsolatedAsyncioTestCase):
    """Uses installed BiliBiliSearchIE, not a fake extractor or fake download_public."""
    async def run_with_transport(self, handler, query="长尾夹 手机支架", limit=1):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=PUBLIC):
            return await search_bilibili(query, limit)

    async def test_sdk_to_public_reader_and_real_metadata_mapping(self):
        requests = []
        def respond(request):
            requests.append(request)
            self.assertEqual(request.url.host, "8.8.8.8")
            self.assertEqual(request.headers["Host"], "api.bilibili.com")
            self.assertEqual(request.extensions["sni_hostname"], "api.bilibili.com")
            self.assertEqual(request.url.params["keyword"], "长尾夹 手机支架")
            self.assertEqual(request.url.params["search_type"], "video")
            self.assertNotIn("Authorization", request.headers)
            cookie = request.headers["Cookie"]
            self.assertTrue(cookie.startswith("buvid3="))
            self.assertNotIn(";", cookie)
            self.assertEqual(uuid.UUID(cookie[len("buvid3="):-5]).version, 4)
            return httpx.Response(200, json={"code": 0, "data": {"result": [video()]}})
        result = await self.run_with_transport(respond)
        self.assertEqual(len(requests), 1)
        self.assertEqual(result["results"][0]["url"], "https://www.bilibili.com/video/BV1pa4y1B7f8/")
        self.assertEqual(result["results"][0]["title"], "长尾夹小玩法")
        self.assertEqual(result["results"][0]["author"], "真实响应字段（合成测试）")
        self.assertEqual(result["evidence_kind"], "search_result_not_full_document")
        self.assertNotIn("source_id", result["results"][0])
        self.assertNotIn("buvid3", json.dumps(result))

    async def test_no_cookie_file_or_browser_read_and_each_search_is_a_fresh_session(self):
        cookies = []
        def respond(request):
            cookies.append(request.headers["Cookie"])
            return httpx.Response(200, json={"code": 0, "data": {"result": [video()]}})
        import yt_dlp.cookies
        original_load = yt_dlp.cookies.load_cookies
        def check_load(cookie_file, browser_specification, downloader):
            self.assertIsNone(cookie_file)
            self.assertIsNone(browser_specification)
            return original_load(cookie_file, browser_specification, downloader)
        with patch("yt_dlp.cookies.extract_cookies_from_browser", side_effect=AssertionError("must not read browser")), \
             patch("yt_dlp.YoutubeDL.load_cookies", side_effect=check_load):
            await self.run_with_transport(respond)
            await self.run_with_transport(respond)
        self.assertEqual(len(cookies), 2)
        self.assertNotEqual(cookies[0], cookies[1])

    async def test_cross_origin_redirect_does_not_send_anonymous_identifier_to_second_host(self):
        for location in ["https://other.example/search", "http://api.bilibili.com/next", "https://api.bilibili.com:444/next"]:
            requests = []
            def respond(request):
                requests.append(request)
                return httpx.Response(302, headers={"Location": location})
            with self.subTest(location=location), self.assertRaises(DomainError):
                await self.run_with_transport(respond)
            self.assertEqual(len(requests), 1)

    async def test_same_origin_explicit_default_port_redirect_remains_allowed(self):
        requests = []
        def respond(request):
            requests.append(request)
            if len(requests) == 1:
                return httpx.Response(302, headers={"Location": "https://api.bilibili.com:443/public-result"})
            return httpx.Response(200, json={"code": 0, "data": {"result": [video()]}})
        result = await self.run_with_transport(respond)
        self.assertEqual(len(requests), 2)
        self.assertEqual(len(result["results"]), 1)

    async def test_412_is_one_refusal_not_a_login_cookie_or_fallback(self):
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(412, text="access denied")
        with self.assertRaisesRegex(DomainError, "412"):
            await self.run_with_transport(respond)
        self.assertEqual(len(requests), 1)

    async def test_application_refusal_and_non_json_are_not_successful_searches(self):
        for response in [httpx.Response(200, json={"code": -352, "message": "risk control"}),
                         httpx.Response(200, text="<html>请先登录</html>")]:
            with self.subTest(response=response.text[:30]), self.assertRaises(DomainError):
                await self.run_with_transport(lambda request: response)

    async def test_network_stream_limit_stops_before_complete_response(self):
        yielded = []
        class TooLarge(httpx.AsyncByteStream):
            async def __aiter__(self):
                for index in range(6):
                    yielded.append(index)
                    yield b"x" * (SEARCH_BODY_LIMIT // 2)
        with self.assertRaises(DomainError):
            await self.run_with_transport(lambda request: httpx.Response(200, stream=TooLarge()))
        self.assertEqual(len(yielded), 3)

    async def test_result_bound_and_no_title_invention(self):
        result = await self.run_with_transport(lambda request: httpx.Response(200, json={"code": 0,
            "data": {"result": [video(0, title=None, author=None), video(1), video(2)]}}), limit=1)
        self.assertEqual(len(result["results"]), 1)
        self.assertNotIn("title", result["results"][0])
        self.assertNotIn("author", result["results"][0])
        self.assertTrue(result["additional_results_not_read"])

    async def test_sparse_result_page_does_not_trigger_another_page_download(self):
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"code": 0, "data": {"result": [video()]}})
        result = await self.run_with_transport(respond, limit=5)
        self.assertEqual(len(requests), 1)
        self.assertEqual(result["search_pages_read"], 1)
        self.assertEqual(len(result["results"]), 1)
        self.assertTrue(result["search_page_limit_reached"])
        self.assertFalse(result["additional_results_not_read"])

    async def test_private_dns_cannot_receive_a_session_cookie(self):
        requests = []
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: requests.append(request)))
        private = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=private):
            with self.assertRaises(DomainError):
                await search_bilibili("纸杯 小玩法", 1)
        self.assertEqual(requests, [])


class CommunitySearchBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_input_stops_before_optional_sdk_loading(self):
        for query, limit in [("", 1), ("x"*201, 1), ("杯子\n玩法", 1), ("杯子", 0), ("杯子", 6), ("杯子", True)]:
            with self.subTest(query=query[:10], limit=limit), patch("wujian.community_search._sdk_types") as sdk:
                with self.assertRaises(DomainError):
                    await search_bilibili(query, limit)
                sdk.assert_not_called()

    async def test_missing_optional_component_is_explicit(self):
        with patch.dict("sys.modules", {"yt_dlp": None}):
            from wujian.community_search import _sdk_types
            with self.assertRaisesRegex(DomainError, "可选"):
                _sdk_types()


if __name__ == "__main__":
    unittest.main()
