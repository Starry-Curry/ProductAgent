"""Actual source persistence behind one native search tool; no paid/network calls."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy import select

from wujian import domain
from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.database import SourceRecord, make_database
from wujian.knowledge import source_excerpt


class SearchReadChainTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.settings=Settings(data_dir=Path(self.directory.name));self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings)
        with self.sessions() as db:
            domain.seed_demo(db)
        self.evidence=set()
        toolkit=make_tools(self.settings,self.sessions,"person_demo_owner","synthetic-message",
                           evidence_sources=self.evidence)
        self.tool=next(tool for tool in toolkit.tool_groups[0].tools if tool.name=="search_public_web")
        self.discovery={"results":[{"url":"https://example.invalid/a","title":"模拟公开案例"},
                                   {"url":"https://example.invalid/b","title":"受限页面"}],
                        "evidence_kind":"search_result_not_full_document"}

    def tearDown(self):
        self.engine.dispose();self.directory.cleanup()

    async def test_bilibili_backend_is_an_explicit_choice_and_does_not_call_paid_search(self):
        discovery = {"provider": "bilibili_public_search_via_ytdlp",
            "results": [{"url": "https://www.bilibili.com/video/BV1pa4y1B7f8/",
                "title": "4种方法，长尾夹秒变手机支架", "author": "顺手TV"}],
            "evidence_kind": "search_result_not_full_document"}
        with patch("wujian.community_search.search_bilibili", new=AsyncMock(return_value=discovery)) as community, \
             patch("wujian.agent_runtime.search_web", new=AsyncMock()) as paid, \
             patch("wujian.knowledge.download_public", new=AsyncMock()) as originals:
            chunk = await self.tool(query="长尾夹 手机支架", community="bilibili")
        self.assertEqual(str(chunk.state), "success")
        value = json.loads(chunk.content[0].text)
        self.assertEqual(value["results"][0]["author"], "顺手TV")
        self.assertEqual(value["results"][0]["read_state"], "not_read")
        self.assertEqual(value["evidence_kind"], "search_result_not_full_document")
        community.assert_awaited_once_with("长尾夹 手机支架", requester=None)
        paid.assert_not_awaited(); originals.assert_not_awaited()
        self.assertFalse(self.evidence)
        with self.sessions() as db:
            self.assertEqual(list(db.scalars(select(SourceRecord))), [])

    async def test_community_rejection_is_not_silently_replaced_by_paid_search(self):
        with patch("wujian.community_search.search_bilibili", new=AsyncMock(
            side_effect=domain.DomainError("公开资料读取受限（HTTP 412）", 502))), \
             patch("wujian.agent_runtime.search_web", new=AsyncMock()) as paid:
            chunk = await self.tool(query="杯子 创意玩法", community="bilibili")
        self.assertEqual(str(chunk.state), "error")
        self.assertIn("412", chunk.content[0].text)
        paid.assert_not_awaited()

    async def test_unknown_community_and_unauthorized_item_stop_before_any_search(self):
        with patch("wujian.community_search.search_bilibili", new=AsyncMock()) as community, \
             patch("wujian.agent_runtime.search_web", new=AsyncMock()) as paid:
            invalid = await self.tool(query="生活玩法", community="unknown-provider")
            forbidden = await self.tool(query="生活玩法", community="bilibili", item_id="not-readable")
        self.assertEqual(str(invalid.state), "error")
        self.assertEqual(str(forbidden.state), "error")
        community.assert_not_awaited(); paid.assert_not_awaited()

    async def test_actual_original_is_retained_and_can_be_expanded_after_compact_window(self):
        # Long synthetic transport fixture tests truncation, not intelligence.
        body="<html><title>模拟原文</title><main>"+"\n".join(f"<p>原文行{i}：这是测试内容，不是实测结果。</p>" for i in range(350))+"</main></html>"
        with patch("wujian.agent_runtime.search_web",new=AsyncMock(return_value=self.discovery)), \
             patch("wujian.knowledge.download_public",new=AsyncMock(return_value=(
                 self.discovery["results"][0]["url"],"text/html",body.encode()))):
            chunk=await self.tool(query="模拟生活创意请求",read_limit=1,item_id="item_demo_lamp")
        self.assertEqual(str(chunk.state),"success")
        value=json.loads(chunk.content[0].text)
        first,second=value["results"]
        self.assertEqual(first["read_state"],"retrieved")
        self.assertEqual(second["read_state"],"not_read")
        original=first["original"]
        self.assertTrue(original["truncated"])
        self.assertEqual(self.evidence,{original["source_id"]})
        with self.sessions() as db:
            saved=db.get(SourceRecord,original["source_id"])
            self.assertEqual(saved.item_id,"item_demo_lamp")
            self.assertIn("原文行349",saved.content)
            self.assertIn("原文行349",source_excerpt(saved,query="原文行349")["text"])

    async def test_failure_remains_a_reading_failure_not_search_summary_evidence(self):
        async def download(url,**_):
            if url.endswith("/b"):
                raise domain.DomainError("公开资料读取受限（HTTP 403）",502)
            return url,"text/html",b"<main><p>Actual synthetic original content only.</p></main>"
        with patch("wujian.agent_runtime.search_web",new=AsyncMock(return_value=self.discovery)), \
             patch("wujian.knowledge.download_public",new=download):
            chunk=await self.tool(query="模拟请求",read_limit=2)
        value=json.loads(chunk.content[0].text)
        self.assertEqual([row["read_state"] for row in value["results"]],["retrieved","unavailable"])
        self.assertIn("403",value["results"][1]["reading_error"])
        self.assertNotIn("original",value["results"][1])
        with self.sessions() as db:
            self.assertEqual(len(list(db.scalars(select(SourceRecord)))),1)

    async def test_discovery_only_and_bounds_do_not_fetch_or_retain_anything(self):
        with patch("wujian.agent_runtime.search_web",new=AsyncMock(return_value=self.discovery)), \
             patch("wujian.knowledge.download_public",new=AsyncMock()) as network:
            chunk=await self.tool(query="只要线索",read_limit=0)
            self.assertEqual([row["read_state"] for row in json.loads(chunk.content[0].text)["results"]],
                             ["not_read","not_read"])
            rejected=await self.tool(query="模拟请求",read_limit=20)
        self.assertEqual(str(rejected.state),"error")
        network.assert_not_called()
        self.assertFalse(self.evidence)

    async def test_unauthorized_item_is_rejected_before_search(self):
        with patch("wujian.agent_runtime.search_web",new=AsyncMock()) as search:
            chunk=await self.tool(query="模拟请求",item_id="not-readable")
        self.assertEqual(str(chunk.state),"error")
        search.assert_not_called()
