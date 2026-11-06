"""Independent, offline counterexamples for the bounded manual reader.

All URLs, content, and people are synthetic. Only TemporaryDirectory data is
written; the transport is mocked and neither models nor devices are invoked.
"""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from pypdf import PdfWriter

from wujian import domain, knowledge
from wujian.config import Settings
from wujian.database import Asset, SourceRecord, make_database


LANDING = "https://example.org/synthetic-landing"
TARGET = "https://example.org/explicit-download"
OWNER = "person_demo_owner"


def html(body, title="Synthetic user manual"):
    return f"<title>{title}</title><main>{body}</main>".encode()


def pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=120, height=120)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class ManualAttachmentAdversarialTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.directory.name))
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        with self.sessions() as db:
            domain.seed_demo(db)

    def tearDown(self):
        self.engine.dispose()
        self.directory.cleanup()

    async def read(self, body, title="Synthetic user manual", mutate=None, user_id=OWNER, item_id=None):
        async def download(url, **_):
            if url == LANDING:
                return url, "text/html", html(body, title)
            self.assertEqual(url, TARGET)
            if mutate:
                mutate()
            return url, "application/pdf", pdf()

        with patch("wujian.knowledge.download_public", new=AsyncMock(side_effect=download)) as transport:
            value = await knowledge.fetch_manual_source(self.settings, self.sessions, user_id, LANDING, item_id=item_id)
        return value, transport

    async def test_repeated_same_declared_url_is_one_candidate(self):
        value, transport = await self.read(
            f'<h1>Synthetic user manual</h1><a href="{TARGET}">Download</a>'
            f'<a href="{TARGET}" type="application/pdf">PDF version</a>')
        self.assertEqual(transport.await_count, 2)
        self.assertEqual(value["manual_resolution"]["status"], "retrieved_pdf")
        self.assertFalse(value["manual_resolution"]["compatibility_verified"])

    async def test_footer_other_pdf_does_not_pollute_main_unique_candidate(self):
        value, transport = await self.read(
            f'<h1>Synthetic user manual</h1><a href="{TARGET}">Download</a>'
            '<footer><a href="/privacy.pdf">Legal terms</a></footer>')
        self.assertEqual(transport.await_count, 2)
        self.assertEqual(value["manual_resolution"]["candidate_count"], 1)

    async def test_manual_as_adjective_is_not_a_manual_document_heading(self):
        value, transport = await self.read(
            f'<h1>Manual firmware update</h1><p>Install the firmware package.</p>'
            f'<a href="{TARGET}">Download</a>', title="Manual firmware update")
        self.assertEqual(transport.await_count, 1,
                         "The adjective manual does not identify a manual document")
        self.assertFalse(value["manual_resolution"]["pdf_obtained"])

    async def test_template_markup_cannot_label_unrelated_body_as_manual(self):
        value, transport = await self.read(
            '<template><h2>Synthetic user manual</h2></template>'
            f'<h1>Firmware release</h1><p>New firmware package.</p><a href="{TARGET}">Download</a>',
            title="Firmware release")
        self.assertEqual(transport.await_count, 1,
                         "Inert template headings are not the page's manual heading")
        self.assertFalse(value["manual_resolution"]["pdf_obtained"])

    async def test_replaced_landing_original_during_read_is_rejected(self):
        def mutate():
            with self.sessions() as db:
                source = db.query(SourceRecord).filter_by(url=LANDING).one()
                replacement = Asset(owner_id=OWNER, path="synthetic-replacement", media_type="text/html",
                                    original_name="replacement")
                db.add(replacement)
                db.flush()
                source.asset_id = replacement.id
                db.commit()

        with self.assertRaises(domain.DomainError) as raised:
            await self.read(f'<h1>Synthetic user manual</h1><a href="{TARGET}">Download</a>', mutate=mutate)
        self.assertIn("原件已更新", raised.exception.message)

    async def test_removed_landing_original_during_read_cannot_claim_retained_chain(self):
        def mutate():
            with self.sessions() as db:
                source = db.query(SourceRecord).filter_by(url=LANDING).one()
                Path(db.get(Asset, source.asset_id).path).unlink()

        with self.assertRaises(domain.DomainError):
            await self.read(f'<h1>Synthetic user manual</h1><a href="{TARGET}">Download</a>', mutate=mutate)

    async def test_landing_original_owner_change_during_read_is_rejected(self):
        def mutate():
            with self.sessions() as db:
                source = db.query(SourceRecord).filter_by(url=LANDING).one()
                db.get(Asset, source.asset_id).owner_id = "person_demo_friend"
                db.commit()

        with self.assertRaises(domain.DomainError):
            await self.read(f'<h1>Synthetic user manual</h1><a href="{TARGET}">Download</a>', mutate=mutate)

    async def test_item_grant_revoked_during_attachment_read_stops_chain_and_write(self):
        recipient = "person_demo_friend"
        item_id = "item_demo_lamp"
        with self.sessions() as db:
            domain.share_item(db, OWNER, item_id, recipient)

        def mutate():
            with self.sessions() as db:
                domain.share_item(db, OWNER, item_id, recipient, revoke=True)

        with self.assertRaises(domain.DomainError):
            await self.read(f'<h1>Synthetic user manual</h1><a href="{TARGET}">Download</a>',
                            mutate=mutate, user_id=recipient, item_id=item_id)
        with self.sessions() as db:
            self.assertEqual(db.query(SourceRecord).count(), 1,
                             "Only the landing read before revocation may have been recorded")


if __name__ == "__main__":
    unittest.main()
