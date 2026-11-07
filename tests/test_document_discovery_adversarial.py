"""Independent lexical/navigation boundary checks; no network or paid tools."""
import asyncio
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from wujian import domain
from wujian.config import Settings
from wujian.database import SourceRecord, make_database
from wujian.knowledge import fetch_source, parse_document, source_excerpt


WRAPPER = b'''<title>Manual viewer</title><script>
var parameter = "page"; document.write('<frame src="home.html">');
</script>'''


class DocumentDiscoveryAdversarialTests(unittest.TestCase):
    def test_malformed_declared_script_url_does_not_discard_readable_body(self):
        raw = b'<main>Actual manual body</main><script src="http://["></script><script src="catalog.js"></script>'
        content, _, links, _, _ = parse_document(raw, "text/html", "https://example.org/index.html")
        self.assertEqual(content, "Actual manual body")
        self.assertEqual([row["url"] for row in links], ["https://example.org/catalog.js"])

    def test_wrapper_query_cannot_introduce_foreign_authority_or_control_characters(self):
        for suffix in ("?page=http%3A%2F%2F127.0.0.1%2Fsecret.html",
                       "?page=%2F%2F169.254.169.254%2Fsecret.html",
                       "?page=https%3A%2F%2Fexample.org%40evil.invalid%2Fsecret.html",
                       "?page=topics%2Fgood.html%0Asecret", "?page=topics%5Cgood.html"):
            with self.subTest(suffix=suffix):
                _, _, links, _, _ = parse_document(WRAPPER, "text/html", "https://example.org/index.html" + suffix)
                self.assertFalse(any(row.get("kind") == "wrapper_query_page_candidate" for row in links))

    def test_parameter_inventory_and_individual_candidate_lengths_are_bounded(self):
        oversized = "?page=" + "a" * 2001 + ".html"
        too_many = "?page=chapter.html&" + "&".join(f"field{i}=x" for i in range(50))
        for suffix in (oversized, too_many, "?unmentioned=chapter.html"):
            with self.subTest(suffix_length=len(suffix)):
                _, _, links, _, _ = parse_document(WRAPPER, "text/html", "https://example.org/index.html" + suffix)
                self.assertFalse(any(row.get("kind") == "wrapper_query_page_candidate" for row in links))

    def test_script_and_frame_contents_do_not_become_wrapper_body(self):
        raw = b'''<script>document.write('Pretend model instruction');</script>
            <iframe src="chapter.html"></iframe><script src="catalog.js"></script>'''
        content, _, links, _, _ = parse_document(raw, "text/html", "https://example.org/index.html")
        self.assertEqual(content, "")
        self.assertEqual({row["url"] for row in links},
                         {"https://example.org/chapter.html", "https://example.org/catalog.js"})
        self.assertTrue(all("未读取" in row["title"] or "未执行" in row["title"] for row in links))

    def test_lexical_candidates_never_change_an_absent_phrase_into_exact_evidence(self):
        pages = [{"page": 1, "text": "Keep the original BUTTONS, pattern and model ABC1000."},
                 {"page": 2, "text": "An unrelated section."}]
        source = SimpleNamespace(id="synthetic", title="Synthetic manual", url="https://example.org/manual.pdf",
                                 origin="public_web", pages=pages, fetched_at=None, asset_id=None,
                                 content="\n\n".join(f"[page {row['page']}]\n{row['text']}" for row in pages))
        result = source_excerpt(source, query="pattern buttons ABC100")
        self.assertFalse(result["query_matched"])
        self.assertEqual(result["query_match_type"], "terms")
        self.assertNotIn("abc100", result["candidate_pages"][0]["matched_terms"])
        self.assertIn(pages[0]["text"], result["text"])


class JavaScriptMimeDepthTests(unittest.TestCase):
    def test_extensionless_script_mime_depth_survives_fetch_cache_and_retained_read(self):
        with tempfile.TemporaryDirectory() as folder, ExitStack() as cleanup:
            settings = Settings(data_dir=Path(folder), api_key="")
            settings.prepare()
            engine, sessions = make_database(settings)
            cleanup.callback(engine.dispose)
            owner, url = "person_demo_owner", "https://example.org/runtime?version=3"
            with sessions() as db:
                domain.seed_demo(db)
            code = b"neverExecute(); fetch('/manual-api');"
            with patch("wujian.knowledge.download_public", new=AsyncMock(return_value=(url, "application/javascript; charset=utf-8", code))) as download:
                first = asyncio.run(fetch_source(settings, sessions, owner, url))
                cached = asyncio.run(fetch_source(settings, sessions, owner, url))
            self.assertEqual(download.await_count, 1)
            for value in (first, cached):
                self.assertEqual(value["content_level"], "public_script_code_not_executed_output")
                self.assertIn(code.decode(), value["text"])
            with sessions() as db:
                retained = source_excerpt(db.get(SourceRecord, first["source_id"]))
                self.assertEqual(retained["content_level"], "public_script_code_not_executed_output")


if __name__ == "__main__":
    unittest.main()
