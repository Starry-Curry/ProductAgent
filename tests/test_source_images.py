"""Source-bound image observations: fixtures exercise permissions and limits."""
import base64
import io
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image

from wujian import domain
from wujian.config import Settings
from wujian.database import Asset, SourceRecord, make_database, uid
from wujian.knowledge import fetch_source_image, validate_source_image
from wujian.source_content import public_image_candidates


class SourceImageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name))
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        with self.sessions() as db:
            domain.seed_demo(db)
        self.owner, self.friend = "person_demo_owner", "person_demo_friend"

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def source(self, image_url="https://example.com/product.png"):
        asset_id = uid()
        path = self.settings.data_dir / "assets" / asset_id
        path.write_text(f'<meta property="og:image" content="{image_url}"><main><p>商品介绍</p></main>', encoding="utf-8")
        with self.sessions() as db:
            db.add(Asset(id=asset_id, owner_id=self.owner, path=str(path), media_type="text/html", original_name="public source"))
            source = SourceRecord(owner_id=self.owner, url="https://example.com/product", title="商品", origin="public_web", content="商品介绍", pages=[], asset_id=asset_id)
            db.add(source)
            db.commit()
            return source.id

    async def test_image_hints_prioritize_actual_metadata_and_skip_recommendations(self):
        product = {"@type": "Product", "name": "手工杯", "image": "https://example.com/cup.png"}
        html = ('<meta property="og:image" content="/hero.jpg"><script type="application/ld+json">' + json.dumps(product) +
                '</script><main><img src="/detail.png" alt="杯子侧面"><aside><img src="/unrelated.png"></aside>'
                '<div class="recommendations"><img src="/other.png"></div></main>')
        hints = public_image_candidates(html.encode(), "https://example.com/product")
        self.assertEqual([row["url"] for row in hints], ["https://example.com/hero.jpg", "https://example.com/cup.png", "https://example.com/detail.png"])
        self.assertEqual(hints[2]["alt"], "杯子侧面")

    async def test_product_gallery_is_not_confused_with_header_promotion(self):
        html = ('<title>VARIERA 瓦瑞拉 搁板 - IKEA</title><main>'
                '<div class="nav-header-message-app-promotion"><img src="/qr.png"></div>'
                '<div class="carousel__item"><img src="/room.jpg" alt="ins-image"></div>'
                '<div class="parent-product"><img src="/shelf.jpg" alt="VARIERA 瓦瑞拉"></div></main>')
        hints = public_image_candidates(html.encode(), "https://example.com/product")
        self.assertEqual(hints[0]["url"], "https://example.com/shelf.jpg")
        self.assertEqual(hints[1]["url"], "https://example.com/room.jpg")
        self.assertNotIn("https://example.com/qr.png", [row["url"] for row in hints])

    async def test_unknown_image_and_another_users_source_rejected_before_download(self):
        source_id = self.source()
        with patch("wujian.knowledge.download_public", new=AsyncMock()) as download:
            for actor, url in [(self.owner, "https://example.com/not-declared.png"), (self.friend, "https://example.com/product.png")]:
                with self.assertRaises(domain.DomainError):
                    await fetch_source_image(self.settings, self.sessions, actor, source_id, url)
            download.assert_not_awaited()

    async def test_declared_private_image_still_fails_public_address_check(self):
        source_id = self.source("http://127.0.0.1/private.png")
        with self.assertRaisesRegex(domain.DomainError, "内网"):
            await fetch_source_image(self.settings, self.sessions, self.owner, source_id, "http://127.0.0.1/private.png")

    async def test_declared_image_redirect_cannot_enter_private_network(self):
        source_id = self.source()
        requests = []
        def serve(request):
            requests.append(request)
            return httpx.Response(302, headers={"location": "http://169.254.169.254/private.png"})
        client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), patch("wujian.public_network.socket.getaddrinfo", return_value=addresses):
            with self.assertRaises(domain.DomainError):
                await fetch_source_image(self.settings, self.sessions, self.owner, source_id, "https://example.com/product.png")
        self.assertEqual(len(requests), 1)

    async def test_validated_raster_retained_and_returned_without_vision_model(self):
        source_id = self.source()
        output = io.BytesIO()
        Image.new("RGB", (24, 18), "#a0b0c0").save(output, format="PNG")
        raw = output.getvalue()
        with patch("wujian.knowledge.download_public", new=AsyncMock(return_value=("https://example.com/product.png", "image/png", raw))) as download:
            result = await fetch_source_image(self.settings, self.sessions, self.owner, source_id, "https://example.com/product.png")
        self.assertEqual(base64.b64decode(result["base64"]), raw)
        self.assertEqual((result["width"], result["height"]), (24, 18))
        self.assertEqual(result["source_id"], source_id)
        download.assert_awaited_once_with("https://example.com/product.png", max_bytes=4 * 1024 * 1024)
        with self.sessions() as db:
            asset = db.get(Asset, result["asset_id"])
            self.assertEqual(asset.owner_id, self.owner)
            self.assertEqual(Path(asset.path).read_bytes(), raw)

    async def test_source_access_is_rechecked_after_download(self):
        source_id = self.source()
        output = io.BytesIO()
        Image.new("RGB", (12, 12), "white").save(output, format="PNG")
        async def changed_grant(*args, **kwargs):
            with self.sessions() as db:
                source = db.get(SourceRecord, source_id)
                source.owner_id = self.friend
                db.commit()
            return "https://example.com/product.png", "image/png", output.getvalue()
        with patch("wujian.knowledge.download_public", new=AsyncMock(side_effect=changed_grant)):
            with self.assertRaises(domain.DomainError):
                await fetch_source_image(self.settings, self.sessions, self.owner, source_id, "https://example.com/product.png")
        with self.sessions() as db:
            from sqlalchemy import select
            self.assertEqual(len(list(db.scalars(select(Asset)))), 1)

    async def test_html_and_oversized_images_do_not_create_raster_assets(self):
        source_id = self.source()
        for raw in [b"<html>login page</html>", b"x" * (4 * 1024 * 1024 + 1)]:
            with patch("wujian.knowledge.download_public", new=AsyncMock(return_value=("https://example.com/product.png", "image/png", raw))):
                with self.assertRaises(domain.DomainError):
                    await fetch_source_image(self.settings, self.sessions, self.owner, source_id, "https://example.com/product.png")

    async def test_excessive_dimensions_rejected(self):
        output = io.BytesIO()
        Image.new("RGB", (8193, 1), "white").save(output, format="PNG")
        with self.assertRaisesRegex(domain.DomainError, "8192"):
            validate_source_image(output.getvalue())

    async def test_pixel_bomb_header_rejected_before_raster_decoding(self):
        import struct
        import zlib
        output = io.BytesIO()
        Image.new("RGB", (1, 1), "white").save(output, format="PNG")
        raw = bytearray(output.getvalue())
        raw[16:24] = struct.pack(">II", 4001, 3000)
        raw[29:33] = struct.pack(">I", zlib.crc32(raw[12:29]))
        with self.assertRaisesRegex(domain.DomainError, "1200万"):
            validate_source_image(bytes(raw))


if __name__ == "__main__":
    unittest.main()
