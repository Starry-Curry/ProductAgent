"""Shared-PDF page access must be rechecked after actual rendering awaits.

Actual PDFium rendering, HTTP sharing/revocation and native SDK tool calls.
Only the external vision HTTP transport is replaced; no paid model is used.
"""

import asyncio
import base64
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from openai import AsyncOpenAI as RealAsyncOpenAI
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import select

from wujian import domain, foundation
from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.continuity import public_product_sources
from wujian.database import Asset, ChatMessage, Conversation, Grant, ItemRecord, SourceRecord
from wujian.knowledge import render_source_page as actual_render_source_page
from wujian.server import create_app
from wujian.source_access import readable_source


VISION_MARKER = "Synthetic model response to the actual authorized PDF page"


class SourcePageObservationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), api_key="offline-no-network",
            rea_enabled=False, demo_mode=False))
        self.owner_context = TestClient(self.app)
        self.owner = self.owner_context.__enter__()
        self.friend = TestClient(self.app)
        self.friend.portal = self.owner.portal
        self.owner_user = self.ok(self.owner.post("/api/auth/register", json={
            "username": "pdf_owner", "display_name": "模拟资料物主", "password": "offline-fixture-only-123"}))
        self.friend_user = self.ok(self.friend.post("/api/auth/register", json={
            "username": "pdf_reader", "display_name": "模拟家庭成员", "password": "offline-fixture-only-123"}))
        self.ok(self.owner.post("/api/friends", json={"username": "pdf_reader"}))
        self.ok(self.friend.post(f"/api/friends/{self.owner_user['id']}/accept"))
        self.item = self.ok(self.owner.post("/api/items", json={"name": "书房米家台灯1S",
            "product": {"brand": "米家", "model": "MJTD01SYL", "market": "CN"}}))
        path = Path(self.temp.name) / "assets" / "actual-fixture.pdf"
        writer = PdfWriter()
        page = writer.add_blank_page(width=240, height=180)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({
            NameObject("/F1"): DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})})})
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 14 Tf 20 100 Td (MJTD01SYL TEST PDF) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(content)
        with path.open("wb") as output:
            writer.write(output)
        with self.app.state.sessions() as db:
            asset = Asset(id="shared-pdf-fixture", owner_id=self.owner_user["id"], path=str(path),
                media_type="application/pdf", original_name="actual-fixture.pdf")
            db.add(asset)
            source = SourceRecord(owner_id=self.owner_user["id"], item_id=self.item["id"],
                origin="public_web", url="https://example.invalid/offline-pdf-fixture", title="MJTD01SYL fixture PDF",
                content="MJTD01SYL TEST PDF", pages=[{"page": 1, "text": "MJTD01SYL TEST PDF"}], asset_id=asset.id)
            db.add(source)
            db.commit()
            self.source_id = source.id
            foundation.save_claim(db, self.owner_user["id"], "offline-source-fixture", self.item["id"],
                "MJTD01SYL TEST PDF", {"identity_match": "model_text_matched"},
                "document", "product", source.id, "MJTD01SYL TEST PDF")
            self.assertEqual([s.id for s, _ in public_product_sources(db, self.owner_user["id"],
                db.get(ItemRecord, self.item["id"]))], [source.id])
            conversation = Conversation(user_id=self.friend_user["id"], title="看看这一页",
                item_ids=[self.item["id"]], entry_context={"intent": "general"})
            db.add(conversation)
            db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text="这页上的按钮图帮我看一下。")
            db.add(message)
            db.commit()
            self.message_id = message.id
        toolkit = make_tools(self.app.state.settings, self.app.state.sessions,
            self.friend_user["id"], self.message_id)
        self.tool = next(t for t in toolkit.tool_groups[0].tools if t.name == "view_source_page")

    def tearDown(self):
        self.friend.close()
        self.owner_context.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def share(self, mode):
        if mode == "grant":
            self.ok(self.owner.post(f"/api/items/{self.item['id']}/shares", json={"user_id": self.friend_user["id"]}))
        else:
            house = self.ok(self.owner.post("/api/households", json={"name": "模拟共用家庭"}))
            self.house_id = house["id"]
            self.ok(self.owner.post(f"/api/households/{house['id']}/invitations", json={"user_id": self.friend_user["id"]}))
            self.ok(self.friend.post(f"/api/households/{house['id']}/accept"))
            self.ok(self.owner.post(f"/api/households/{house['id']}/items", json={"item_id": self.item["id"]}))
            with self.app.state.sessions() as db:
                self.assertIsNone(db.get(Grant, (self.item["id"], self.friend_user["id"])))
        with self.app.state.sessions() as db:
            self.assertEqual(readable_source(db, self.friend_user["id"], self.source_id).id, self.source_id)

    def revoke(self, mode):
        if mode == "grant":
            self.ok(self.owner.delete(f"/api/items/{self.item['id']}/shares/{self.friend_user['id']}"))
        else:
            self.ok(self.owner.post(f"/api/households/{self.house_id}/items",
                json={"item_id": self.item["id"], "shared": False}))
        with self.app.state.sessions() as db:
            with self.assertRaises(domain.DomainError):
                readable_source(db, self.friend_user["id"], self.source_id)

    def vision_boundary(self, observed):
        async def serve(request):
            body = json.loads(request.content)
            url = body["messages"][0]["content"][1]["image_url"]["url"]
            actual_png = base64.b64decode(url.split(",", 1)[1])
            self.assertTrue(actual_png.startswith(b"\x89PNG\r\n\x1a\n"))
            observed.append({"png_bytes": len(actual_png), "network": "in-process MockTransport only"})
            return httpx.Response(200, json={"id": "offline-vision-fixture", "object": "chat.completion",
                "created": 1, "model": "offline-only", "choices": [{"index": 0,
                    "message": {"role": "assistant", "content": VISION_MARKER}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}})

        def construct(**kwargs):
            return RealAsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(serve)))
        return patch("openai.AsyncOpenAI", side_effect=construct)

    async def revoked_during_render(self, mode):
        self.share(mode)
        rendered = threading.Event()
        release = threading.Event()
        observed = []
        actual_rendered = []

        def render_then_wait(*args):
            # Render the real retained PDF using actual PDFium; the hook adds
            # scheduling only, never substitutes content or permission logic.
            image = actual_render_source_page(*args)
            actual_rendered.append(image)
            rendered.set()
            if not release.wait(4):
                raise AssertionError("Test did not release the actual rendered page")
            return image

        with self.vision_boundary(observed), patch("wujian.agent_runtime.render_source_page", side_effect=render_then_wait):
            task = asyncio.create_task(self.tool(source_id=self.source_id, page=1))
            try:
                self.assertTrue(await asyncio.to_thread(rendered.wait, 3), "Actual PDF rendering did not complete")
                self.revoke(mode)
            finally:
                release.set()
            reply = await asyncio.wait_for(task, 5)
        self.assertTrue(actual_rendered)
        self.assertEqual(str(reply.state), "error", {
            "mode": mode, "provider_requests_after_revoke": len(observed),
            "tool_text": [getattr(b, "text", "") for b in reply.content]})
        self.assertEqual(observed, [], "A revoked page must not be sent to an additional vision model")
        self.assertNotIn(VISION_MARKER, json.dumps([b.model_dump(mode="json") for b in reply.content]))

    async def test_direct_shared_pdf_revoke_during_render_blocks_observation(self):
        await self.revoked_during_render("grant")

    async def test_household_only_pdf_revoke_during_render_blocks_observation(self):
        await self.revoked_during_render("household")

    async def test_authorized_shared_pdf_page_remains_observable(self):
        self.share("grant")
        observed = []
        with self.vision_boundary(observed):
            reply = await self.tool(source_id=self.source_id, page=1)
        self.assertEqual(str(reply.state), "success", reply)
        text = "\n".join(getattr(block, "text", "") for block in reply.content)
        self.assertIn(self.source_id, text)
        # Both legacy vision-text and the planned native page image path can
        # satisfy this positive; it does not require retaining the extra model.
        from agentscope.message import DataBlock
        native_images = [block for block in reply.content if isinstance(block, DataBlock)]
        self.assertTrue(native_images or (observed and VISION_MARKER in text))

    async def test_actual_page_png_reaches_native_formatter_without_another_vision_request(self):
        from agentscope.formatter import DashScopeChatFormatter
        from agentscope.message import AssistantMsg, DataBlock, ToolResultBlock

        self.share("grant")
        with self.app.state.sessions() as db:
            source = readable_source(db, self.friend_user["id"], self.source_id)
            asset = db.get(Asset, source.asset_id)
            asset_id = asset.id
            expected = actual_render_source_page(self.app.state.settings, source, asset, 1)
        observed = []
        with self.vision_boundary(observed) as provider:
            reply = await self.tool(source_id=self.source_id, page=1)
        self.assertEqual(str(reply.state), "success", reply)
        self.assertEqual(observed, [], "The main model must receive the page directly")
        provider.assert_not_called()
        images = [block for block in reply.content if isinstance(block, DataBlock)]
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0].source.media_type, "image/png")
        self.assertEqual(images[0].source.data, expected, "Do not replace the original page with model prose")
        actual_png = base64.b64decode(images[0].source.data)
        self.assertTrue(actual_png.startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(io.BytesIO(actual_png)) as actual, Image.open(io.BytesIO(base64.b64decode(expected))) as original:
            self.assertEqual(actual.size, original.size)
            self.assertEqual(actual.size, (336, 252))
        metadata = json.loads(reply.content[0].text)
        self.assertEqual({key:value for key,value in metadata.items() if key!='applicability'}, {
            "source_id": self.source_id, "url": "https://example.invalid/offline-pdf-fixture",
            "page": 1, "asset_id": asset_id, "evidence_kind": "original_pdf_page_image",
            "content_level": "single_pdf_page_not_full_document"})
        self.assertEqual(metadata['applicability']['targets'],[{
            'item_id':self.item['id'],'model':'MJTD01SYL','market':'CN',
            'model_in_source_text':True,'status':'model_mentioned_requires_procedure_check'}])
        self.assertFalse(metadata['applicability']['procedure_compatibility_verified'])
        self.assertEqual(reply.metadata["evidence"], metadata)
        formatted = await DashScopeChatFormatter().format([AssistantMsg(name="offline-pdf-probe", content=[
            ToolResultBlock(id="real-page", name="view_source_page", output=reply.content, state=reply.state)])])
        transported = [block for message in formatted for block in (message.get("content") or [])
            if isinstance(block, dict) and block.get("type") == "image_url"]
        self.assertEqual(len(transported), 1)
        self.assertEqual(transported[0]["image_url"]["url"], "data:image/png;base64," + expected)

    async def test_rebound_original_asset_during_render_does_not_return_stale_page(self):
        from agentscope.message import DataBlock

        self.share("grant")
        rendered = threading.Event()
        release = threading.Event()
        observed = []

        def render_then_wait(*args):
            image = actual_render_source_page(*args)
            rendered.set()
            if not release.wait(4):
                raise AssertionError("Test did not release the rendered original")
            return image

        with self.vision_boundary(observed), patch("wujian.agent_runtime.render_source_page", side_effect=render_then_wait):
            task = asyncio.create_task(self.tool(source_id=self.source_id, page=1))
            try:
                self.assertTrue(await asyncio.to_thread(rendered.wait, 3))
                with self.app.state.sessions() as db:
                    source = db.get(SourceRecord, self.source_id)
                    original = db.get(Asset, source.asset_id)
                    replacement_path = Path(self.temp.name) / "assets" / "replacement-fixture.pdf"
                    replacement_path.write_bytes(Path(original.path).read_bytes())
                    replacement = Asset(id="replacement-pdf-fixture", owner_id=self.owner_user["id"],
                        path=str(replacement_path), media_type="application/pdf", original_name="replacement-fixture.pdf")
                    db.add(replacement)
                    source.asset_id = replacement.id
                    db.commit()
                with self.app.state.sessions() as db:
                    # Same user remains authorized; only the retained original
                    # binding changed. This cannot pass merely via revoke logic.
                    self.assertEqual(readable_source(db, self.friend_user["id"], self.source_id).asset_id,
                        "replacement-pdf-fixture")
            finally:
                release.set()
            reply = await asyncio.wait_for(task, 5)
        self.assertEqual(str(reply.state), "error", reply)
        self.assertIn("原件已更新", reply.content[0].text)
        self.assertFalse(any(isinstance(block, DataBlock) for block in reply.content))
        self.assertEqual(observed, [])
