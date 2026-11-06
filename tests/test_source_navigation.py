"""Bounded transport keeps original navigation available; no paid/network calls."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from wujian import domain
from wujian.config import Settings
from wujian.database import Asset, SourceRecord, make_database
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
