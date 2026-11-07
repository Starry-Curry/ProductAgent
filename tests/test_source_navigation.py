"""Bounded transport keeps original navigation available; no paid/network calls."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from wujian import domain
from wujian.config import Settings
from wujian.database import Asset, ChatMessage, Conversation, Run, SourceRecord, make_database
from wujian.knowledge import fetch_source, source_navigation


class SourceNavigationTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.settings=Settings(data_dir=Path(self.folder.name))
        self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings)
        with self.sessions() as db:
            domain.seed_demo(db)
        self.owner="person_demo_owner"

    def tearDown(self):
        self.engine.dispose()
        self.folder.cleanup()

    def fetch(self, body, **kwargs):
        with patch("wujian.knowledge.download_public",new=AsyncMock(return_value=(
                "https://example.org/index","text/html",body))) as download:
            result=asyncio.run(fetch_source(self.settings,self.sessions,self.owner,
                "https://example.org/index",**kwargs))
        return result,download.await_count

    def read_tool(self):
        from wujian.agent_runtime import make_tools
        toolkit = make_tools(self.settings, self.sessions, self.owner, "synthetic-message")
        return next(tool for tool in toolkit.tool_groups[0].tools if tool.name == "read_source")

    def read(self, tool, source_id, **kwargs):
        chunk = asyncio.run(tool(source_id=source_id, **kwargs))
        self.assertEqual(str(chunk.state), "success", chunk)
        return json.loads(chunk.content[0].text)

    def test_fetched_navigation_survives_default_reopen_and_failed_run_recovery(self):
        from wujian.conversation_context import build_conversation_context
        first, calls = self.fetch(b'<title>Synthetic manual index</title><main>Manual download</main><a href="files/manual.pdf">Download now</a>')
        self.assertEqual(calls, 1)
        target = first["links"][0]["url"]
        tool = self.read_tool()
        with patch("wujian.knowledge.download_public", new=AsyncMock()) as download:
            reopened = self.read(tool, first["source_id"], query="Manual download")
            self.assertEqual(reopened["links"], first["links"])
            self.assertEqual(reopened["content_level"], first["content_level"])
            self.assertEqual(reopened["evidence_kind"], first["evidence_kind"])
            with self.sessions() as db:
                chat = Conversation(user_id=self.owner)
                db.add(chat); db.flush()
                db.add(Run(user_id=self.owner, conversation_id=chat.id, status="failed",
                    created_at="2026-11-06T09:00:00+00:00", events=[
                        {"type": "tool_start", "id": "fetch", "name": "fetch_document"},
                        {"type": "tool_end", "id": "fetch", "state": "success",
                         "evidence": {"source_id": first["source_id"]}}]))
                current = ChatMessage(conversation_id=chat.id, role="user", text="Continue after the timeout",
                    created_at="2026-11-06T10:00:00+00:00")
                db.add(current); db.flush()
                pointer = build_conversation_context(db, self.owner, chat, current).source_index[0]
                db.commit()
            current_read = self.read(tool, pointer["source_id"], query="Manual download")
            self.assertEqual(current_read["links"][0]["url"], target)
            download.assert_not_awaited()

    def test_default_navigation_keeps_twelve_link_window_and_explicit_query_offset(self):
        first, _ = self.fetch(('<main>Actual document body</main>' + ''.join(
            f'<a href="files/chapter-{number}.pdf">chapter {number}</a>' for number in range(15))).encode())
        tool = self.read_tool()
        default = self.read(tool, first["source_id"])
        self.assertEqual(len(default["links"]), 12)
        self.assertEqual(default["links_next_offset"], 12)
        filtered = self.read(tool, first["source_id"], link_query="chapter-14")
        self.assertEqual([row["url"] for row in filtered["links"]], ["https://example.org/files/chapter-14.pdf"])
        tail = self.read(tool, first["source_id"], link_offset=12)
        self.assertEqual(len(tail["links"]), 3)

    def test_default_missing_navigation_preserves_text_and_curated_assetless_source(self):
        first, _ = self.fetch(b'<main>Retained body must survive a missing original file.</main>')
        with self.sessions() as db:
            source = db.get(SourceRecord, first["source_id"])
            Path(db.get(Asset, source.asset_id).path).unlink()
            db.add(SourceRecord(id="curated-no-asset", owner_id=self.owner, origin="curated_reference",
                title="Synthetic editorial", url="https://example.org/reference", content="Retained editorial body.", pages=[]))
            db.add(SourceRecord(id="public-no-asset", owner_id=self.owner, origin="public_web",
                title="Legacy public original", url="https://example.org/legacy", content="Retained public body.", pages=[]))
            db.commit()
        tool = self.read_tool()
        reopened = self.read(tool, first["source_id"])
        self.assertIn("Retained body", reopened["text"])
        self.assertIn("navigation_error", reopened)
        self.assertIn("reading_note", reopened)
        self.assertIsNone(reopened["links_total"])
        self.assertIn("Retained editorial body.", self.read(tool, "curated-no-asset")["text"])
        assetless = self.read(tool, "public-no-asset")
        self.assertIn("Retained public body.", assetless["text"])
        self.assertIn("navigation_error", assetless)
        explicit = asyncio.run(tool(source_id=first["source_id"], link_query=""))
        self.assertEqual(str(explicit.state), "error")

    def test_default_navigation_rechecks_private_original_asset_before_reading_bytes(self):
        first, _ = self.fetch(b'<main>Authorized retained body.</main><a href="manual.pdf">Manual</a>')
        with self.sessions() as db:
            source = db.get(SourceRecord, first["source_id"])
            db.get(Asset, source.asset_id).owner_id = "person_demo_friend"
            db.commit()
        tool = self.read_tool()
        with patch("wujian.knowledge.Path.read_bytes", side_effect=AssertionError("Foreign asset bytes must not be read")):
            result = self.read(tool, first["source_id"])
        self.assertIn("Authorized retained body.", result["text"])
        self.assertIn("navigation_error", result)
        self.assertEqual(result["images"], [])
        with self.sessions() as db:
            db.get(SourceRecord, first["source_id"]).owner_id = "person_demo_friend"
            db.commit()
        with patch("wujian.knowledge._retained_links") as original_read:
            revoked = asyncio.run(tool(source_id=first["source_id"]))
            self.assertEqual(str(revoked.state), "error")
            original_read.assert_not_called()

    def test_compact_fetch_and_cached_fetch_keep_late_pdf_link_reopenable(self):
        body=('<title>Manual index</title><main>'+"x"*15000+"</main>"+
              "".join(f'<a href="/news/{i}">动态{i}</a>' for i in range(47))+
              '<a href="/manual/CN.pdf">大陆型号说明书PDF</a>').encode()
        first,calls=self.fetch(body,excerpt_chars=3500)
        self.assertEqual(calls,1)
        self.assertEqual(len(first["links"]),12)
        self.assertEqual(first["links_total"],48)
        self.assertTrue(first["links_truncated"])
        self.assertEqual(first["links_next_offset"],12)
        with self.sessions() as db:
            source=db.get(SourceRecord,first["source_id"])
            self.assertGreater(len(source.content),15000)
            asset=db.get(Asset,source.asset_id)
            self.assertEqual(Path(asset.path).read_bytes(),body)
            found=source_navigation(db,self.owner,source.id,link_query="说明书")
            self.assertEqual(found["links"][0]["url"],"https://example.org/manual/CN.pdf")
            self.assertEqual(found["links_total"],1)
            tail=source_navigation(db,self.owner,source.id,link_offset=47)
            self.assertEqual(found["links"],tail["links"])
            self.assertIsNone(tail["links_next_offset"])
        with patch("wujian.knowledge.download_public",new=AsyncMock()) as download:
            cached=asyncio.run(fetch_source(self.settings,self.sessions,self.owner,
                "https://example.org/index",excerpt_chars=3500))
            expanded=asyncio.run(fetch_source(self.settings,self.sessions,self.owner,
                "https://example.org/index",link_limit=100))
            download.assert_not_awaited()
        self.assertEqual(first["links"],cached["links"])
        self.assertEqual(len(expanded["links"]),48)
        self.assertGreater(len(expanded["text"]),11000)
        self.assertEqual(first["source_id"],expanded["source_id"])

    def test_actual_howto_fixture_retains_step_navigation_and_scope(self):
        body=Path(__file__).with_name("fixtures").joinpath("instructables_howto_reduced.html").read_bytes()
        first,_=self.fetch(body,link_limit=1)
        self.assertTrue(first["links_truncated"])
        self.assertIn("HowTo 步骤",first["text"])
        with self.sessions() as db:
            second=source_navigation(db,self.owner,first["source_id"],link_query="#step2")
            self.assertEqual(len(second["links"]),1)
            self.assertTrue(second["links"][0]["url"].endswith("#step2"))
            self.assertIn("不是链接目标正文",second["navigation_scope"])

    def test_current_permission_precedes_original_asset_read(self):
        first,_=self.fetch(b'<title>Own source</title><a href="/manual.pdf">Manual</a>')
        with self.sessions() as db,patch("wujian.knowledge._retained_links") as read:
            with self.assertRaises(domain.DomainError):
                source_navigation(db,"person_demo_friend",first["source_id"])
            read.assert_not_called()

    def test_missing_original_navigation_does_not_erase_retained_source_text(self):
        first,_=self.fetch(b'<title>Own source</title><main>retained explanation</main>')
        with self.sessions() as db:
            source=db.get(SourceRecord,first["source_id"])
            Path(db.get(Asset,source.asset_id).path).unlink()
            with self.assertRaises(domain.DomainError):
                source_navigation(db,self.owner,source.id)
        with patch("wujian.knowledge.download_public",new=AsyncMock()) as download:
            cached=asyncio.run(fetch_source(self.settings,self.sessions,self.owner,
                "https://example.org/index"))
            download.assert_not_awaited()
        self.assertIn("retained explanation",cached["text"])
        self.assertIsNone(cached["links_total"])
        self.assertIn("不可用",cached["navigation_error"])

    def test_invalid_budget_is_rejected_before_download_or_write(self):
        with patch("wujian.knowledge.download_public",new=AsyncMock()) as download:
            for kwargs in ({"link_limit":0},{"link_limit":101},{"link_limit":True},
                           {"link_offset":-1},{"link_query":"x"*201}):
                with self.subTest(kwargs=kwargs),self.assertRaises(domain.DomainError):
                    asyncio.run(fetch_source(self.settings,self.sessions,self.owner,
                        "https://example.org/index",**kwargs))
            download.assert_not_awaited()
