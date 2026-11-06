"""Real rendered gift flow forwarded to isolated FastAPI, with two demo users.

The browsers load the built frontend from --url, while every API request is
handled by the current source app in a temporary database. This never touches
the running service's private database or restarts it. No model is invoked.
User-provided photos and generated portraits remain private test inputs.
"""
import argparse
import asyncio
import json
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from fastapi.testclient import TestClient
from playwright.async_api import async_playwright, expect

from wujian.config import ROOT, Settings
from wujian.server import create_app


async def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="gift-portrait-") as private_dir:
        app = create_app(Settings(data_dir=Path(private_dir), api_key="", rea_enabled=False))
        with TestClient(app) as sender, TestClient(app) as recipient:
            sender.post("/api/auth/demo/xiaolin"); recipient.post("/api/auth/demo/xiaoxia")
            def upload(path):
                response = sender.post("/api/assets", files={"file": (path.name, path.read_bytes(), "image/png" if path.suffix == ".png" else "image/jpeg")})
                assert response.status_code == 200, response.text
                return response.json()["id"]
            physical = upload(ROOT / "var/intake/2026-11-07-final-round/06_红色illy咖啡机实拍.jpg")
            portrait = upload(ROOT / "var/evaluations/2026-11-07-avatar-images/illy-21/portrait.png")
            response = sender.post("/api/items", json={"name": "小咖，送给你的早晨", "photo_id": physical,
                "product": {"brand": "illy", "model": "Y3.3", "market": "CN"},
                "avatar": {"enabled": True, "nickname": "小咖", "image_id": portrait,
                    "personality": "私密测试内容：最近在和它讨论我的工作压力", "growth_dismissed_ids": ["private-id"]}})
            assert response.status_code == 200, response.text
            item = response.json()
            errors, api_calls, blocked_models = [], [], []
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
                sender_context = await browser.new_context(viewport={"width": 1440, "height": 1000})
                recipient_context = await browser.new_context(viewport={"width": 390, "height": 844})
                def forwarding(client, actor):
                    async def route_api(route):
                        parsed = urlsplit(route.request.url)
                        path = parsed.path + (("?" + parsed.query) if parsed.query else "")
                        api_calls.append({"actor": actor, "method": route.request.method, "path": path})
                        if path == "/api/chat" or path.endswith("/avatar-image") or path.endswith("/photo-matches"):
                            blocked_models.append(path)
                            await route.fulfill(status=503, json={"detail": "这次浏览器验收不调用模型"}); return
                        headers = {"content-type": route.request.headers["content-type"]} if "content-type" in route.request.headers else {}
                        actual = await asyncio.to_thread(client.request, route.request.method, path,
                            content=route.request.post_data_buffer, headers=headers)
                        await route.fulfill(status=actual.status_code, body=actual.content,
                            headers={"content-type": actual.headers.get("content-type", "application/octet-stream")})
                    return route_api
                await sender_context.route("**/api/**", forwarding(sender, "sender"))
                await recipient_context.route("**/api/**", forwarding(recipient, "recipient"))
                left = await sender_context.new_page(); right = await recipient_context.new_page()
                left.on("pageerror", lambda error: errors.append(str(error)))
                right.on("pageerror", lambda error: errors.append(str(error)))
                await left.goto(args.url + f'/#items?scope=personal&item={item["id"]}')
                await left.get_by_role("button", name="更多物品操作", exact=True).click()
                await left.get_by_role("button", name="送出这件物品", exact=True).click()
                await expect(left.get_by_label("分身的性格与说话习惯", exact=True)).to_have_value("")
                await expect(left.locator(".persona-gift-preview .object-portrait>img").first).to_have_attribute("src", f"/api/assets/{portrait}")
                await left.get_by_label("交给谁", exact=False).select_option("person_demo_friend")
                await left.get_by_label("想对他说的话", exact=True).fill("愿小咖陪你把每个早晨过得轻松一点。")
                await left.get_by_role("button", name="预览这份心意", exact=True).click()
                await expect(left.locator(".gift-preview")).not_to_contain_text("工作压力")
                await expect(left.locator(".gift-preview .object-portrait>img").first).to_have_attribute("src", f"/api/assets/{portrait}")
                await left.screenshot(path=str(args.output / "sender-gift-preview.png"), full_page=True, animations="disabled")
                async with left.expect_response("**/api/gifts"):
                    await left.get_by_role("button", name="确认送出心意", exact=True).click()
                await expect(left.locator(".editor-form")).to_have_count(0)
                sent = sender.get("/api/gifts").json()[0]
                assert sent["snapshot"]["avatar"]["image_id"] == portrait
                assert sent["snapshot"]["avatar"]["personality"] == ""
                assert sent["snapshot"]["avatar"]["growth_dismissed_ids"] == []
                await right.goto(args.url + "/#friends")
                await right.get_by_role("button", name="往来的心意", exact=False).click()
                await right.locator(".gift-card").filter(has_text=item["name"]).click()
                await expect(right.locator(".gift-experience .object-portrait>img").first).to_have_attribute("src", f"/api/assets/{portrait}")
                await right.get_by_role("button", name="拆开这份心意", exact=True).click()
                await right.screenshot(path=str(args.output / "recipient-gift-open.png"), full_page=True, animations="disabled")
                await right.get_by_role("button", name="收下并开启故事对话", exact=True).click()
                await expect(right.locator(".gift-experience")).to_have_count(0)
                received = recipient.get(f'/api/items/{item["id"]}').json()
                cloned_id = received["avatar"]["image_id"]
                assert cloned_id and cloned_id != portrait
                await expect(right.locator(".persona-conversation-intro .object-portrait>img").first).to_have_attribute("src", f"/api/assets/{cloned_id}")
                await expect(right.get_by_role("textbox", name="对物伴说", exact=True)).to_have_value("我收下这份礼物了，想认识一下你。有什么留给我的小心意吗？")
                await right.screenshot(path=str(args.output / "recipient-own-persona.png"), full_page=True, animations="disabled")
                assert recipient.get(f"/api/assets/{cloned_id}").status_code == 200
                assert sender.get(f"/api/assets/{cloned_id}").status_code == 404
                assert not blocked_models, blocked_models
                assert not errors, errors
                await browser.close()
            result = {"status": "passed", "scope": "real Chrome + current FastAPI source, temporary DB, two fictional demo accounts",
                "model_calls": 0, "main_database_touched": False,
                "checks": ["gift editor defaults to selected appearance", "private self-use voice excluded", "sender previews same portrait", "recipient pending gift reads portrait", "accept makes independent private portrait", "received persona uses cloned portrait", "sender cannot read recipient portrait"],
                "item_id": item["id"], "gift_id": sent["id"], "source_portrait_id": portrait, "received_portrait_id": cloned_id,
                "api_calls": api_calls, "page_errors": errors}
            (args.output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({key: value for key, value in result.items() if key != "api_calls"}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/gift-avatar-api-ui")
    asyncio.run(run(parser.parse_args()))
