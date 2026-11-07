"""A search model's fluent synthesis must not become source evidence."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from wujian.config import Settings
from wujian.domain import DomainError
from wujian.knowledge import search_web


class SearchEvidenceTests(unittest.IsolatedAsyncioTestCase):
    def client(self, output):
        client=MagicMock()
        client.__aenter__=AsyncMock(return_value=client)
        client.__aexit__=AsyncMock(return_value=False)
        response=SimpleNamespace(model_dump=lambda **_: {"output":output})
        client.responses.create=AsyncMock(return_value=response)
        return client

    async def test_only_observed_search_references_survive_not_generated_claims(self):
        generated="未经原文核实的永久有效保证，以及https://example.invalid/invented。"
        output=[{"type":"web_search_call","status":"completed","action":{"sources":[
            {"url":"https://example.invalid/actual","title":"实际搜索线索"}]}},
            {"type":"message","content":[{"type":"output_text","text":generated,
                "annotations":[{"url":"https://example.invalid/actual","title":"实际搜索线索"},
                               {"url":"https://example.invalid/also-observed","title":"另一条实际引用"}]}]}]
        with patch("wujian.knowledge.AsyncOpenAI",return_value=self.client(output)):
            result=await search_web(Settings(api_key="offline-no-network"),"模拟搜索请求")
        self.assertEqual(len(result["results"]),2)
        self.assertEqual(result["evidence_kind"],"search_result_not_full_document")
        self.assertNotIn("永久有效",json.dumps(result,ensure_ascii=False))
        self.assertNotIn("invented",json.dumps(result))
        self.assertNotIn("search_summary",result)

    async def test_generated_urls_without_an_observed_search_call_are_rejected(self):
        output=[{"type":"message","content":[{"type":"output_text",
                "text":"https://example.invalid/fabricated","annotations":[]}]}]
        with patch("wujian.knowledge.AsyncOpenAI",return_value=self.client(output)):
            with self.assertRaises(DomainError):
                await search_web(Settings(api_key="offline-no-network"),"模拟请求")
