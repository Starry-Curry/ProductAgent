"""Deterministic browser regressions for the creative/card/memory interactions.

Run with an existing Playwright installation, against a running Vite server:
  python tests/browser/creative_memory_ui.py --url http://127.0.0.1:5174

API responses are explicit fixtures. This checks real rendered frontend behavior,
not model intelligence or device results. All API calls are intercepted: no main
database is touched and no paid model is called. People/ownership are fictional;
the Haier model follows the domestic product shown in the product design brief.
"""
import argparse
import asyncio
import base64
import json
from pathlib import Path

from playwright.async_api import async_playwright, expect

PIXEL = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=")


def fixture():
    person = {"id": "ui_person", "username": "ui_review", "display_name": "测试用户（模拟）"}
    avatar = {"enabled": False, "form": "auto", "nickname": "", "personality": "", "color": "#7e9eac", "gift_from": "", "gift_message": "", "growth_note": "", "growth_source": ""}
    washer = {"id": "washer", "name": "阳台的洗衣机", "kind": "standard_product", "owner_id": person["id"], "version": 1, "access": "owner", "archived": False, "photo_id": None, "description": "搬家时一起带来的洗衣机。", "avatar": avatar, "state": {"presentation": {"location": "阳台", "attention": "normal"}}, "product": {"brand": "海尔", "commercial_name": "滚筒洗衣机", "model": "XQG80-B1286", "market": "CN", "edition": "", "firmware_version": None, "source_urls": []}}
    cup = {**washer, "id": "cup", "name": "小雨做的杯子", "kind": "nonstandard_object", "photo_id": "item_photo", "description": "毕业礼物，不想改变它的样子。", "avatar": {**avatar, "enabled": True, "nickname": "小陶", "personality": "温柔、简洁"}, "product": {**washer["product"], "brand": "", "model": "", "commercial_name": ""}, "state": {"presentation": {"location": "书房", "attention": "normal", "cherished": True}}}
    experience = {"id": "memory_own", "creator_id": person["id"], "title": "搬进新家的那一天", "text": "洗衣机装好了，小雨来帮忙，带了这个杯子。", "item_ids": ["washer", "cup"], "item_labels": {"washer": washer["name"], "cup": cup["name"]}, "photo_ids": [], "occurred_on": "2026-10-01", "origin_id": None, "provenance": {"kind": "authored_record", "author_name": person["display_name"]}, "version": 1, "allow_ai": False, "access": "owner"}
    received = {**experience, "id": "memory_received", "title": "小雨的毕业寄语", "text": "愿这个杯子一直陪你。", "origin_id": "original_story", "item_ids": ["cup"], "item_labels": {"cup": cup["name"]}, "provenance": {"kind": "received_story", "author_name": "小雨"}}
    shared = {**experience, "id": "memory_shared", "creator_id": "friend", "title": "朋友的海边故事", "access": "shared", "provenance": {"kind": "authored_record", "author_name": "小雨"}}
    workspace = {"preferences": {"companion_name": "阿圆", "display_mode": "normal"}, "items": [washer, cup], "experiences": [experience, received, shared], "households": [], "reminders": [], "tasks": [], "conversations": [], "friends": [], "gifts": [], "wishes": []}
    return person, workspace


async def main(url, output):
    output.mkdir(parents=True, exist_ok=True)
    person, workspace = fixture()
    results, browser_errors = [], []
    delayed_request = asyncio.Event()
    knowledge_mode = {"value": "normal"}
    upload_started = asyncio.Event()
    chat_started = asyncio.Event()
    chat_messages = {}
    chat_payloads = []
    gift_payloads = []
    chat_counter = {"value": 0}
    continuation_mode = {"enabled": False}
    board_sources = {}
    task_started = asyncio.Event()
    run_started = asyncio.Event()
    api_calls = []
    uploads = {"count": 0}
    understandings = [{"id": "understanding", "item_id": "cup", "content": "你不想改变这份毕业礼物的样子。", "basis": "inference", "source_message_id": "message_fixture", "updated_at": "2026-11-06T09:00:00Z", "expires_at": "2026-12-01T00:00:00Z", "supersedes_id": None, "attributes": {"kind": "meaning", "context": "讨论毕业礼物的新玩法时", "source_quote": "这是小雨送的，我不想拆它。"}}]
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000})
        page = await context.new_page()
        page.set_default_timeout(10000)
        page.on("pageerror", lambda error: browser_errors.append(str(error)))

        async def api(route):
            path = route.request.url.split("/api", 1)[1].split("?", 1)[0]
            api_calls.append(route.request.method + " " + path)
            status = 200
            if path == "/me":
                body = person
            elif path == "/health":
                body = {"model_configured": False, "demo_mode": False}
            elif path == "/workspace":
                body = workspace
            elif path.startswith("/items/") and route.request.method == "PUT":
                identity = path.split("/")[2]
                original = next(item for item in workspace["items"] if item["id"] == identity)
                payload = route.request.post_data_json
                assert payload["expected_version"] == original["version"]
                body = {**original, **payload, "avatar": {**original["avatar"], **payload["avatar"]}, "version": original["version"] + 1}
                workspace["items"][:] = [body if item["id"] == identity else item for item in workspace["items"]]
            elif path == "/chat" and route.request.method == "POST":
                chat_started.set()
                payload = route.request.post_data_json
                chat_payloads.append(payload)
                chat_counter["value"] += 1
                identity = payload.get("conversation_id") or f"chat_{chat_counter['value']}"
                message = {"id": f"message_{chat_counter['value']}", "role": "user", "text": payload["text"], "photo_ids": payload["photo_ids"], "run_id": None}
                chat_messages.setdefault(identity, []).append(message)
                if not any(value["id"] == identity for value in workspace["conversations"]):
                    workspace["conversations"].append({"id": identity, "title": payload["text"], "item_ids": payload["item_ids"], "entry_context": payload["entry_context"]})
                await asyncio.sleep(0.55)
                body = {"id": f"run_{chat_counter['value']}", "conversation_id": identity, "status": "completed", "text": "", "events": [{"type": "continuation_saved", "task_id": "idea_task"}] if continuation_mode["enabled"] else [], "error": "", "usage": {}}
            elif path.startswith("/conversations/") and path.endswith("/messages"):
                body = chat_messages.get(path.split("/")[2], [])
            elif path.startswith("/tasks/") and path.endswith("/board"):
                identity = path.split("/")[2]
                if identity == "task_A":
                    task_started.set()
                    await asyncio.sleep(0.7)
                task = next(task for task in workspace["tasks"] if task["id"] == identity)
                body = {"task": task, "kind": task["plan"].get("kind", "checklist"), "entries": task["plan"].get("entries", []), "sources": board_sources.get(identity, []), "participants": [], "access": "owner"}
            elif path.startswith("/tasks/") and path.endswith("/conversation"):
                identity = path.split("/")[2]
                body = {"conversation_id": identity + "_thread", "entry_context": {"intent": "planning", "task_id": identity}}
            elif path == "/runs/slow_run":
                run_started.set()
                await asyncio.sleep(0.7)
                body = {"id": "slow_run", "conversation_id": "slow_thread", "status": "running", "text": "", "events": [], "error": "", "usage": {}}
            elif path == "/assets" and route.request.method == "POST":
                uploads["count"] += 1
                identity = f"uploaded_photo_{uploads['count']}"
                upload_started.set()
                await asyncio.sleep(0.4)
                body = {"id": identity, "url": "/api/assets/" + identity}
            elif path.startswith("/assets/"):
                await route.fulfill(content_type="image/png", body=PIXEL)
                return
            elif path.endswith("/knowledge"):
                identity = path.split("/")[2]
                if knowledge_mode["value"] == "delayed" and identity == "washer":
                    delayed_request.set()
                    await asyncio.sleep(0.65)
                if knowledge_mode["value"] == "error":
                    status, body = 503, {"detail": "测试：资料暂时不可用"}
                else:
                    body = [{"id": identity + "_claim", "content": identity + "独有资料", "source_quote": "这是对应物品的资料测试标记。", "basis": "document"}]
            elif path == "/memories":
                body = understandings
            elif path.endswith("/correction"):
                payload = route.request.post_data_json
                original = understandings[0]
                body = {**original, "id": "understanding_corrected", "content": payload["content"], "basis": "user_report", "attributes": {**original["attributes"], "source_quote": payload["content"]}}
                understandings[:] = [body]
            elif path == "/memories/understanding_corrected" and route.request.method == "DELETE":
                understandings.clear()
                body = {"ok": True}
            elif path == "/experiences" and route.request.method == "POST":
                identity = "new_memory" if not any(exp["id"] == "new_memory" for exp in workspace["experiences"]) else f"new_memory_{len(workspace['experiences'])}"
                payload = route.request.post_data_json
                labels = {identity: next(item["name"] for item in workspace["items"] if item["id"] == identity) for identity in payload["item_ids"]}
                body = {**workspace["experiences"][0], **payload, "id": identity, "item_labels": labels}
                workspace["experiences"].append(body)
            elif path == "/gifts" and route.request.method == "POST":
                gift_payloads.append(route.request.post_data_json)
                body = {"id": "ui_gift", "status": "pending"}
            else:
                raise AssertionError("Unexpected API call: " + route.request.method + " " + path)
            await route.fulfill(status=status, content_type="application/json", body=json.dumps(body, ensure_ascii=False))

        await page.route("**/api/**", api)
        await page.goto(url + "/#items?scope=personal")
        await page.locator(".item-card").filter(has_text="阳台的洗衣机").click()
        await expect(page.locator(".item-profile-page")).to_be_visible()
        assert await page.locator(".items-browser").count() == 0
        profile = await page.locator(".item-profile-page").bounding_box()
        body = await page.locator(".app-body").bounding_box()
        assert profile["width"] >= body["width"] * 0.95
        await page.screenshot(path=str(output / "desktop-item-card.png"), full_page=True)
        results.append("desktop: item opens as primary full-width card; list is absent")

        await page.get_by_role("button", name="发现新玩法", exact=True).click()
        await expect(page.locator(".conversation-context")).to_contain_text("阳台的洗衣机")
        editor = page.get_by_role("textbox", name="对物伴说")
        await editor.fill("这台洗衣机先别改造，我想找点不用拆东西的玩法。")
        await page.locator(".conversation input[type=file]").set_input_files({"name": "photo.png", "mimeType": "image/png", "buffer": PIXEL})
        await upload_started.wait()
        await editor.fill("这台洗衣机别拆，我刚又补了一句话。")
        await expect(page.locator(".attached-photos img")).to_have_count(1)
        await expect(editor).to_have_value("这台洗衣机别拆，我刚又补了一句话。")
        # Re-enter the same item/creative intent through the actual card.
        await page.locator(".primary-navigation").get_by_role("button", name="物品", exact=True).click()
        await page.get_by_role("button", name="我的物品", exact=True).click()
        await page.locator(".item-card").filter(has_text="阳台的洗衣机").click()
        await page.get_by_role("button", name="发现新玩法", exact=True).click()
        await expect(editor).to_have_value("这台洗衣机别拆，我刚又补了一句话。")
        await expect(page.locator(".attached-photos img")).to_have_count(1)
        results.append("draft: re-entry and a delayed photo upload preserve text and photo")

        knowledge_mode["value"] = "delayed"
        await page.evaluate("location.hash = 'items?scope=personal&item=washer'")
        await delayed_request.wait()
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="用法与资料", exact=True).click()
        await expect(page.locator(".knowledge-section")).to_contain_text("cup独有资料")
        await page.wait_for_timeout(800)
        await expect(page.locator(".knowledge-section")).not_to_contain_text("washer独有资料")
        results.append("knowledge: a late item A response cannot overwrite item B")
        knowledge_mode["value"] = "error"
        await page.evaluate("location.hash = 'items?scope=personal&item=washer'")
        await page.get_by_role("button", name="用法与资料", exact=True).click()
        await expect(page.get_by_role("alert")).to_contain_text("资料暂时没有读取成功")
        await expect(page.locator(".knowledge-section")).not_to_contain_text("尚未取得适用资料")
        knowledge_mode["value"] = "normal"
        await page.get_by_role("button", name="重新读取", exact=True).click()
        await expect(page.locator(".knowledge-section")).to_contain_text("washer独有资料")
        results.append("knowledge: failed load is not reported as empty; retry recovers")

        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.locator(".story-timeline button").filter(has_text="搬进新家的那一天").click()
        await expect(page.locator(".memory-detail")).to_contain_text("洗衣机装好了，小雨来帮忙")
        await expect(page.locator(".memory-detail")).to_contain_text("不提供给物伴作为对话资料")
        await page.locator(".ant-modal-close").last.click()
        await page.get_by_role("button", name="我记录的", exact=True).click()
        await expect(page.locator(".memory-card")).to_have_count(1)
        await expect(page.locator(".memory-card")).not_to_contain_text("毕业寄语")
        await page.get_by_role("button", name="随礼物收到的", exact=True).click()
        await expect(page.locator(".memory-card")).to_have_count(1)
        await expect(page.locator(".memory-card")).to_contain_text("随礼物收到的原故事")
        await page.get_by_role("textbox", name="查找回忆").fill("从来没记录过的事情")
        await expect(page.locator(".empty-state")).to_contain_text("没有找到符合条件的回忆")
        results.append("memory: same record opens from item; received stories and AI permission stay distinct")

        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="记一段", exact=True).click()
        await expect(page.locator(".editor-photos img")).to_have_count(0)
        await page.get_by_label("给这一刻一个名字", exact=True).fill("今天用它喝了茶")
        await page.get_by_label("想留下的话", exact=True).fill("雨停了，坐在窗边喝茶。")
        await page.get_by_label("发生的日子", exact=False).fill("")
        upload_input = page.locator(".editor-photos input[type=file]").first
        await upload_input.set_input_files({"name": "first.png", "mimeType": "image/png", "buffer": PIXEL})
        await expect(page.locator(".editor-photos img")).to_have_count(1)
        upload_started.clear()
        await upload_input.set_input_files({"name": "second.png", "mimeType": "image/png", "buffer": PIXEL})
        await upload_started.wait()
        await expect(page.get_by_role("button", name="照片上传中…", exact=True)).to_be_disabled()
        await page.get_by_role("button", name="移除照片", exact=True).click()
        await expect(page.locator(".editor-photos img")).to_have_count(1)
        await expect(page.locator(".editor-photos img")).to_have_attribute("src", "/api/assets/uploaded_photo_3")
        await expect(page.get_by_label("允许物伴在相关对话中参考这段回忆", exact=True)).not_to_be_checked()
        await page.get_by_role("button", name="保存", exact=True).click()
        await expect(page.locator(".ant-modal")).to_have_count(0)
        assert workspace["experiences"][-1]["photo_ids"] == ["uploaded_photo_3"]
        assert workspace["experiences"][-1]["allow_ai"] is False
        assert workspace["experiences"][-1]["occurred_on"] is None
        await page.evaluate("location.hash = 'memories?experience=new_memory'")
        await expect(page.locator(".memory-detail time")).to_have_text("日期未记")
        await page.get_by_role("button", name="补充与纠正", exact=True).click()
        await expect(page.get_by_label("发生的日子", exact=False)).to_have_value("")
        await page.locator(".ant-modal-close").last.click()
        results.append("memory authoring: no fabricated item photo, no saving during upload, removed photos stay removed, AI use opt-in")
        results.append("unknown dates: clearing a memory date sends null and editing an unknown date does not invent today")

        await page.get_by_role("button", name="设置与个性化", exact=True).click()
        await expect(page.locator(".understanding-meta")).to_contain_text("待确认的推测")
        await expect(page.locator(".understanding-meta")).to_contain_text("讨论毕业礼物的新玩法时")
        await expect(page.locator(".understanding-meta")).to_contain_text("有效至")
        await page.get_by_text("当时的话", exact=True).click()
        await expect(page.locator(".understanding-meta")).to_contain_text("这是小雨送的，我不想拆它")
        await page.get_by_role("textbox", name="更正理解", exact=True).fill("杯子可以用来喝茶，但我不想改造它。")
        await page.get_by_role("button", name="保存更正", exact=True).click()
        await expect(page.locator(".understanding-meta")).to_contain_text("来自你的表达")
        await page.get_by_role("button", name="移除这条理解", exact=True).click()
        await expect(page.locator(".memory-setting")).to_have_count(0)
        await page.locator(".ant-modal-close").last.click()
        results.append("understanding controls: basis/context/source/expiry visible; correction and removal use returned record identity")

        await page.set_viewport_size({"width": 390, "height": 844})
        await page.evaluate("location.hash = 'companion'")
        await expect(page.get_by_role("button", name="找点新玩法", exact=True)).to_be_visible()
        await page.get_by_role("button", name="找点新玩法", exact=True).click()
        await expect(editor).to_have_value("最近有点无聊，身边这些东西还能怎么玩？")
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await expect(page.get_by_role("button", name="发现新玩法", exact=True)).to_be_visible()
        await expect(page.get_by_role("button", name="和它聊聊", exact=True)).to_be_visible()
        persona_entry = await page.get_by_role("button", name="和它聊聊", exact=True).bounding_box()
        bottom_nav = await page.locator(".bottom-navigation").bounding_box()
        assert persona_entry["y"] + persona_entry["height"] <= bottom_nav["y"], "the persona chat entry must appear in the first mobile screen"
        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "mobile horizontal overflow"
        await page.screenshot(path=str(output / "mobile-item-card.png"), full_page=True)
        await page.get_by_role("button", name="返回物品", exact=True).click()
        await expect(page.locator(".items-browser")).to_be_visible()
        results.append("mobile: creative entry, optional persona, full card and back navigation remain accessible")
        await page.evaluate("location.hash = 'companion'")
        await page.get_by_role("button", name="找点新玩法", exact=True).click()
        upload_started.clear()
        await page.locator(".conversation input[type=file]").set_input_files({"name": "late.png", "mimeType": "image/png", "buffer": PIXEL})
        await upload_started.wait()
        # Enter must not send an incomplete request while a photo is pending.
        await editor.press("Enter")
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.wait_for_timeout(600)
        assert "item=cup" in page.url, "a late upload pulled the user out of the item card"
        await page.get_by_role("button", name="发现新玩法", exact=True).click()
        await expect(page.locator(".attached-photos img")).to_have_count(0)
        await page.get_by_role("button", name="找点新玩法", exact=True).click()
        await expect(page.locator(".attached-photos img")).to_have_count(1)
        results.append("draft isolation: a late upload neither changes navigation nor attaches to another object's topic; Enter waits for upload")
        await page.evaluate("location.hash = 'items?scope=personal&item=washer'")
        await page.get_by_role("button", name="发现新玩法", exact=True).click()
        await editor.fill("先发洗衣机的问题。")
        chat_started.clear()
        await page.get_by_role("button", name="发送", exact=True).click()
        await chat_started.wait()
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="发现新玩法", exact=True).click()
        await editor.fill("现在只聊杯子，这段还没发送。")
        await page.wait_for_timeout(700)
        await expect(page.locator(".conversation-context")).to_contain_text("小雨做的杯子")
        await expect(editor).to_have_value("现在只聊杯子，这段还没发送。")
        await expect(page.locator(".chat-message")).to_have_count(0)
        # Edits during the acknowledgement delay must survive moving from a new
        # draft into its actual server conversation ID.
        await editor.fill("这是已经发送的一句。")
        chat_started.clear()
        await page.get_by_role("button", name="发送", exact=True).click()
        await chat_started.wait()
        await editor.fill("这是后来补写、还没发送的一句。")
        await expect(page.locator(".chat-message")).to_have_count(1)
        await expect(editor).to_have_value("这是后来补写、还没发送的一句。")
        await page.get_by_role("button", name="发送", exact=True).click()
        await expect(page.locator(".chat-message")).to_have_count(2)
        await expect(editor).to_have_value("")
        results.append("chat acknowledgement: late responses cannot steal a new topic; unsent edits survive; acknowledged existing-thread drafts clear")

        for identity, goal, item_id in [("task_A", "慢速事项A", "washer"), ("task_B", "当前事项B", "cup")]:
            workspace["tasks"].append({"id": identity, "goal": goal, "item_ids": [item_id], "constraints": {}, "plan": {"schema": "interaction/1", "kind": "checklist", "entries": []}, "status": "active", "feedback": [], "version": 1, "updated_at": "2026-11-06T09:00:00Z"})
        workspace["conversations"].append({"id": "slow_thread", "title": "恢复旧运行的对话", "item_ids": ["washer"], "entry_context": {"intent": "guidance"}})
        chat_messages["slow_thread"] = [{"id": "slow_user", "role": "user", "text": "继续处理洗衣机", "photo_ids": [], "run_id": "slow_run"}]
        await page.set_viewport_size({"width": 1440, "height": 1000})
        await page.goto(url + "/#companion")
        await page.reload()
        await page.locator(".sidebar-tasks").get_by_role("button", name="慢速事项A", exact=True).click()
        await task_started.wait()
        await page.locator(".sidebar-tasks").get_by_role("button", name="当前事项B", exact=True).click()
        await expect(page.locator(".task-canvas h2")).to_have_text("当前事项B")
        await page.wait_for_timeout(800)
        await expect(page.locator(".task-canvas h2")).to_have_text("当前事项B")
        results.append("task switch: a late A board cannot overwrite the selected B conversation or board")

        task_started.clear()
        await page.locator(".sidebar-tasks").get_by_role("button", name="慢速事项A", exact=True).click()
        await task_started.wait()
        await page.locator(".primary-navigation").get_by_role("button", name="回忆", exact=True).click()
        await page.wait_for_timeout(800)
        assert page.url.endswith("#memories"), "a late task request stole non-chat navigation"
        results.append("task navigation: selecting memories cancels late automatic task navigation")

        await page.locator(".recent-topics").get_by_role("button", name="恢复旧运行的对话", exact=True).click()
        await run_started.wait()
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="发现新玩法", exact=True).click()
        await page.wait_for_timeout(800)
        await expect(page.locator(".conversation-context")).to_contain_text("小雨做的杯子")
        await expect(page.get_by_role("button", name="停止生成", exact=True)).to_have_count(0)
        assert not any("/runs/slow_run/events" in call for call in api_calls)
        results.append("thread restore: a late old run cannot attach itself to the new object's conversation")

        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="它的模样与性格", exact=True).click()
        await page.get_by_label("它的名字", exact=True).fill("小满")
        await page.get_by_role("button", name="暖粉", exact=True).click()
        await page.get_by_role("button", name="温柔耐心", exact=True).click()
        await page.get_by_role("button", name="石头", exact=True).click()
        await expect(page.locator(".persona-preview .object-companion")).to_have_attribute("data-form", "stone")
        await page.get_by_role("button", name="随物品", exact=True).click()
        await expect(page.locator(".persona-preview .object-companion")).to_have_attribute("data-form", "cup")
        await page.get_by_role("button", name="小猫", exact=True).click()
        await expect(page.locator(".persona-preview .object-companion")).to_have_attribute("data-form", "cat")
        animation = await page.locator(".persona-preview .object-companion > svg").evaluate("element => getComputedStyle(element).animationName")
        assert animation == "wujian-companion-breathe"
        await page.emulate_media(reduced_motion="reduce")
        await expect(page.locator(".persona-preview .object-companion > svg")).to_have_css("animation-name", "none")
        await page.emulate_media(reduced_motion="no-preference")
        await page.get_by_role("button", name="和分身打个招呼", exact=True).click()
        await expect(page.locator(".persona-preview")).to_contain_text("在呢。今天也一起过吧。")
        await page.screenshot(path=str(output / "persona-studio-desktop.png"), full_page=True, animations="disabled")
        async with page.expect_download() as downloading:
            await page.get_by_role("button", name="保存这张形象", exact=True).click()
        download = await downloading.value
        await download.save_as(output / "persona-export.svg")
        exported = (output / "persona-export.svg").read_text(encoding="utf-8")
        assert "小满" in exported and "http://www.w3.org/2000/svg" in exported
        await page.get_by_role("button", name="保存", exact=True).click()
        await expect(page.locator(".persona-strip")).to_contain_text("小满")
        assert workspace["items"][1]["photo_id"] == "item_photo"
        assert workspace["items"][1]["avatar"]["color"] == "#c39897"
        assert workspace["items"][1]["avatar"]["personality"] == "温柔耐心"
        assert workspace["items"][1]["avatar"]["form"] == "cat"
        await expect(page.locator(".persona-strip .object-companion")).to_have_attribute("data-form", "cat")
        await expect(page.locator(".persona-strip .object-companion > svg")).to_have_css("animation-name", "none")
        workspace["friends"].append({"id": "ui_friend", "username": "ui_friend", "display_name": "小雨（模拟）", "accepted": True, "incoming": False, "sender_id": person["id"]})
        if await page.get_by_role("button", name="更多物品操作", exact=True).get_attribute("aria-expanded") != "true":
            await page.get_by_role("button", name="更多物品操作", exact=True).click()
        await page.get_by_role("button", name="编辑物品资料", exact=True).click()
        await page.get_by_label("常放在哪里", exact=True).fill("书房靠窗")
        await page.get_by_role("button", name="保存", exact=True).click()
        await expect(page.locator(".ant-modal")).to_have_count(0)
        assert workspace["items"][1]["avatar"]["form"] == "cat"
        if await page.get_by_role("button", name="更多物品操作", exact=True).get_attribute("aria-expanded") != "true":
            await page.get_by_role("button", name="更多物品操作", exact=True).click()
        await page.get_by_role("button", name="送出这件物品", exact=True).click()
        await page.get_by_label("交给谁", exact=False).select_option("ui_friend")
        await page.get_by_label("附上我选择的分身设定", exact=True).check()
        await page.get_by_role("button", name="预览这份心意", exact=True).click()
        await expect(page.locator(".persona-gift-preview .object-companion")).to_have_attribute("data-form", "cat")
        await page.get_by_role("button", name="确认送出心意", exact=True).click()
        await expect(page.locator(".ant-modal")).to_have_count(0)
        assert gift_payloads[-1]["avatar"]["form"] == "cat"
        results.append("avatar form: explicit choices override name hints, auto remains available, cat persists through item edits/gifts, large previews respect reduced motion and small cards stay still")
        await page.get_by_role("button", name="和它聊聊", exact=True).click()
        await expect(page.locator(".topbar h1")).to_have_text("和小满聊聊")
        await expect(page.locator(".persona-conversation-intro .object-companion")).to_be_visible()
        await expect(page.locator(".companion-home")).to_have_count(0)
        await expect(editor).to_have_attribute("placeholder", "说说你想做的事，和小满接着聊…")
        await page.set_viewport_size({"width": 390, "height": 844})
        await expect(page.locator(".ant-message-notice")).to_have_count(0)
        await page.screenshot(path=str(output / "persona-chat-mobile.png"), full_page=True, animations="disabled")
        results.append("optional object companion: dedicated preview/name/color/personality settings, SVG export, preserved object photo, distinct persona chat identity")

        await page.evaluate("location.hash = 'items?scope=personal&item=washer'")
        await expect(page.get_by_role("button", name="给它一个分身", exact=False)).to_be_visible()
        assert workspace["items"][0]["avatar"]["enabled"] is False
        results.append("optional companion guard: ordinary objects remain unpersonified until explicitly enabled")
        await page.get_by_role("button", name="更多物品操作", exact=True).click()
        await page.get_by_role("button", name="让它更合心意", exact=True).click()
        await expect(page.get_by_role("button", name="先和物伴聊聊怎么改", exact=True)).to_be_visible()
        assert not any("/devices/" in call for call in api_calls), "guidance entry must not start or require the device bridge"
        sent_count = chat_counter["value"]
        await page.get_by_role("button", name="先和物伴聊聊怎么改", exact=True).click()
        await expect(editor).to_have_value("我想让阳台的洗衣机更符合我的用法，先帮我查资料看看能改哪些，再一步步教我。")
        await expect(page.locator(".conversation-context")).to_contain_text("阳台的洗衣机")
        assert chat_counter["value"] == sent_count, "the personalized guidance draft must not auto-send"
        results.append("device guidance: a real item enters editable creative chat without starting a bridge or auto-sending")
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="和它聊聊", exact=True).click()
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="它的模样与性格", exact=True).click()
        await page.get_by_label("开启这件物品的分身", exact=True).uncheck()
        await page.get_by_role("button", name="保存", exact=True).click()
        await expect(page.locator(".persona-strip")).to_have_count(0)
        await page.evaluate("location.hash = 'companion'")
        await expect(page.get_by_role("button", name="回到阿圆继续聊", exact=True)).to_be_visible()
        await expect(page.get_by_role("button", name="发送", exact=True)).to_be_disabled()
        await page.get_by_role("button", name="回到阿圆继续聊", exact=True).click()
        await expect(page.get_by_role("button", name="回到阿圆继续聊", exact=True)).to_have_count(0)
        results.append("disabled persona: old context is explained and cannot silently send as the disabled identity; user can return to the main companion")

        entries = [
            {"id": "cup_stage", "title": "杯子和台灯搭一个桌边小舞台", "note": "杯子只作摆件，灯放在旁边；先试一个不遮挡出光的位置，不改造杯子。", "group": "step", "item_id": "cup", "state": "pending", "assignee_id": None, "updated_by": None},
            {"id": "cup_still", "title": "给这份毕业礼物拍一张小小静物照", "note": "留住朋友的手作痕迹，先用窗边自然光，不加热也不贴胶。", "group": "step", "item_id": "cup", "state": "pending", "assignee_id": None, "updated_by": None},
            {"id": "check_surface", "title": "先确认杯底和桌面都放稳", "note": "这是开始前待确认的条件，还没有操作或报告结果。", "group": "confirm", "item_id": None, "state": "pending", "assignee_id": None, "updated_by": None},
        ]
        workspace["tasks"].append({"id": "idea_task", "goal": "给杯子找点不改造的新玩法", "item_ids": ["cup"], "constraints": {}, "plan": {"schema": "interaction/1", "kind": "idea", "entries": entries}, "status": "ready", "feedback": [], "version": 1, "updated_at": "2026-11-06T09:00:00Z"})
        board_sources["idea_task"] = [{"id": "fixture_reference", "title": "B站手机摄影分享（仅UI链接样本）", "quote": "这里验证来源如何呈现，不作为玩法已验证的证据。", "url": "https://www.bilibili.com/video/BV1Py4y1b7Vc"}]
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="发现新玩法", exact=True).click()
        await editor.fill("给这个杯子找点不改造的新玩法。")
        continuation_mode["enabled"] = True
        await page.get_by_role("button", name="发送", exact=True).click()
        await expect(page.get_by_role("button", name="查看这次方案", exact=True)).to_be_visible()
        await expect(page.locator(".task-canvas")).to_have_count(0)
        await page.get_by_role("button", name="查看这次方案", exact=True).click()
        await expect(page.locator(".idea-option")).to_have_count(3)
        for entry in entries:
            await expect(page.locator(".idea-options")).to_contain_text(entry["title"])
            await expect(page.locator(".idea-options")).to_contain_text(entry["note"])
        await expect(page.locator(".idea-sources a")).to_have_attribute("href", board_sources["idea_task"][0]["url"])
        await page.locator(".conversation-scroll").evaluate("element => element.scrollTop = 0")
        await page.evaluate("scrollTo(0, 0)")
        await page.screenshot(path=str(output / "creative-idea-mobile.png"), full_page=True, animations="disabled")
        call_count = len(api_calls)
        await page.locator(".idea-option").first.get_by_role("button", name="就试这个", exact=True).click()
        await expect(editor).to_contain_text("我想试试「杯子和台灯搭一个桌边小舞台」")
        assert len(api_calls) == call_count, "choosing an idea must only prepare a draft"
        assert all(entry["state"] == "pending" for entry in entries)
        assert workspace["tasks"][-1]["status"] == "ready"
        await page.locator(".idea-option").nth(1).get_by_role("button", name="继续聊这个", exact=True).click()
        await expect(editor).to_contain_text("想继续聊聊「给这份毕业礼物拍一张小小静物照」")
        await expect(page.locator(".task-canvas h2")).to_have_text("给杯子找点不改造的新玩法")
        assert "task=idea_task" in page.url
        await page.get_by_role("button", name="发送", exact=True).click()
        await expect(page.locator(".chat-message")).to_have_count(1)
        assert chat_payloads[-1]["conversation_id"] == "idea_task_thread"
        assert chat_payloads[-1]["entry_context"]["task_id"] == "idea_task"
        assert all(entry["state"] == "pending" for entry in entries)
        assert workspace["tasks"][-1]["status"] == "ready"
        results.append("creative continuation: first saved plan has a manual entry; all idea steps/notes/sources render; choices draft within the same task and conversation without marking success")
        await page.screenshot(path=str(output / "creative-idea-selected-mobile.png"), full_page=True, animations="disabled")

        # Resume a real rendered conversation with explicitly fixed UI-only
        # utterances. This does not assess how the model responds to emotion.
        cup = next(item for item in workspace["items"] if item["id"] == "cup")
        cup["avatar"]["enabled"] = True
        for identity, updated, items in [
            ("persona_old", "2026-11-01T08:00:00Z", ["cup"]),
            ("persona_recent", "2026-11-06T08:00:00Z", ["cup"]),
            ("persona_other_objects", "2026-11-06T09:00:00Z", ["washer", "cup"]),
        ]:
            workspace["conversations"].append({"id": identity, "title": "较早那段聊天（UI固定样本）" if identity == "persona_old" else "和物品的对话（UI固定样本）", "item_ids": items, "updated_at": updated, "entry_context": {"intent": "persona"}})
        chat_messages["persona_recent"] = [
            {"id": "persona_user", "role": "user", "text": "今天有点累，不用讲道理，陪我待会儿就好。", "photo_ids": [], "run_id": None},
            {"id": "persona_reply", "role": "assistant", "text": "那就先歇会儿。我在这里，想说什么都可以慢慢来。", "photo_ids": [], "run_id": None},
        ]
        chat_messages["persona_old"] = [{"id": "old_persona_reply", "role": "assistant", "text": "这是较早那段聊天的固定测试文字。", "photo_ids": [], "run_id": None}]
        workspace["experiences"].append({**workspace["experiences"][0], "id": "washer_only", "title": "只属于洗衣机的记录", "item_ids": ["washer"], "item_labels": {"washer": "阳台的洗衣机"}})
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.reload()
        await page.get_by_role("button", name="和它聊聊", exact=True).click()
        await expect(page.locator(".chat-message")).to_have_count(2)
        await expect(page.locator(".chat-message.assistant")).to_contain_text("那就先歇会儿")
        await expect(page.locator(".chat-message.assistant .object-companion")).to_be_visible()
        await editor.fill("想再聊两句，这段还没有发。")
        initial_chat_count = len(chat_payloads)
        await page.get_by_role("button", name="记下这一刻", exact=True).click()
        await expect(page.get_by_label("给这一刻一个名字", exact=True)).to_have_value("")
        await expect(page.get_by_label("想留下的话", exact=True)).to_have_value("")
        await expect(page.get_by_role("checkbox", name="小雨做的杯子", exact=True)).to_be_checked()
        await expect(page.get_by_role("checkbox", name="阳台的洗衣机", exact=True)).not_to_be_checked()
        await page.get_by_label("给这一刻一个名字", exact=True).fill("坐在窗边的一会儿")
        await page.get_by_label("想留下的话", exact=True).fill("下班后用小雨送的杯子喝茶，窗外刚好停了雨。")
        await page.get_by_label("发生的日子", exact=False).fill("")
        await page.get_by_role("button", name="保存", exact=True).click()
        await expect(page.locator(".ant-modal")).to_have_count(0)
        assert workspace["experiences"][-1]["item_ids"] == ["cup"]
        assert workspace["experiences"][-1]["allow_ai"] is False
        assert len(chat_payloads) == initial_chat_count
        await expect(editor).to_have_value("想再聊两句，这段还没有发。")
        await page.get_by_role("button", name="一起的回忆", exact=True).click()
        await expect(page.locator(".page-heading h1")).to_have_text("和小满的回忆")
        await expect(page.locator(".memories-page")).not_to_contain_text("只属于洗衣机的记录")
        await page.locator(".memory-card").filter(has_text="坐在窗边的一会儿").click()
        await expect(page.locator(".memory-detail")).to_contain_text("下班后用小雨送的杯子喝茶")
        await page.locator(".ant-modal-close").last.click()
        assert "item=cup" in page.url
        await expect(page.locator(".memory-detail")).to_be_hidden()
        await page.get_by_role("button", name="记一刻", exact=True).click()
        await expect(page.get_by_role("checkbox", name="小雨做的杯子", exact=True)).to_be_checked()
        await expect(page.get_by_role("checkbox", name="阳台的洗衣机", exact=True)).not_to_be_checked()
        await page.get_by_role("button", name="取消", exact=True).click()
        await expect(page.locator(".editor-form")).to_be_hidden()
        await page.locator(".memories-page").evaluate("element => element.scrollTop = 0")
        await page.evaluate("scrollTo(0, 0)")
        await expect(page.locator(".ant-message-notice")).to_have_count(0)
        await page.screenshot(path=str(output / "persona-memories-mobile.png"), full_page=True, animations="disabled")
        await page.get_by_role("button", name="回去聊聊", exact=True).click()
        await expect(page.locator(".chat-message")).to_have_count(2)
        await expect(editor).to_have_value("想再聊两句，这段还没有发。")
        assert api_calls.count("GET /conversations/persona_recent/messages") >= 2
        assert "GET /conversations/persona_old/messages" not in api_calls
        assert "GET /conversations/persona_other_objects/messages" not in api_calls
        await page.locator(".conversation-scroll").evaluate("element => element.scrollTop = 0")
        await page.screenshot(path=str(output / "persona-resumed-mobile.png"), full_page=True, animations="disabled")
        results.append("persona continuity: item entry resumes its latest single-object persona thread; authored memories link the same object; memory wall return preserves history and unsent draft")
        await page.get_by_role("button", name="另起一段", exact=True).click()
        await expect(page.locator(".chat-message")).to_have_count(0)
        await editor.fill("这是一段新的，还没有发。")
        await page.evaluate("location.hash = 'items?scope=personal&item=cup'")
        await page.get_by_role("button", name="和它聊聊", exact=True).click()
        await expect(editor).to_have_value("这是一段新的，还没有发。")
        await expect(page.locator(".chat-message")).to_have_count(0)
        results.append("persona new-topic guard: an explicitly started unsent topic is restored instead of silently replaced by older history")
        await page.get_by_role("button", name="历史与正在做的事", exact=True).click()
        await page.locator(".recent-topics").get_by_role("button", name="较早那段聊天（UI固定样本）", exact=True).click()
        await expect(page.locator(".chat-message")).to_have_count(1)
        await page.get_by_role("button", name="一起的回忆", exact=True).click()
        await page.get_by_role("button", name="回去聊聊", exact=True).click()
        await expect(page.locator(".chat-message")).to_contain_text("这是较早那段聊天的固定测试文字")
        assert api_calls.count("GET /conversations/persona_old/messages") == 2
        results.append("persona historical return: a deliberately opened older thread remains selected after visiting memories, rather than jumping to newer history")
        empty_item = {**workspace["items"][1], "id": "quiet_stone", "name": "海边捡的纪念石", "avatar": {**workspace["items"][1]["avatar"], "enabled": False, "nickname": "", "form": "auto"}, "photo_id": None}
        workspace["items"].append(empty_item)
        await page.evaluate("location.hash = 'memories?item=quiet_stone'")
        await page.reload()
        await expect(page.locator(".empty-state")).to_contain_text("先留下一刻，不用想好故事")
        await expect(page.locator(".memory-tools")).to_have_count(0)
        await expect(page.locator(".page-heading > .primary-button")).to_have_count(0)
        await expect(page.get_by_role("button", name="记下一刻", exact=True)).to_have_count(1)
        await page.screenshot(path=str(output / "empty-object-memory-mobile.png"), full_page=True, animations="disabled")
        await page.get_by_role("button", name="记下一刻", exact=True).click()
        await expect(page.get_by_role("checkbox", name="海边捡的纪念石", exact=True)).to_be_checked()
        await expect(page.get_by_role("checkbox", name="小雨做的杯子", exact=True)).not_to_be_checked()
        await expect(page.get_by_label("想留下的话", exact=True)).to_have_value("")
        await page.get_by_role("button", name="取消", exact=True).click()
        results.append("mobile discoverability: persona chat fits the first card screen; an empty object memory wall removes unused controls and offers one contextual record action")
        assert not browser_errors, browser_errors
        report = {"scope": "frontend browser with explicit API fixtures; no model or device acceptance", "passed": results, "browser_errors": browser_errors}
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5174")
    parser.add_argument("--output", type=Path, default=Path("tmp/browser-creative-memory"))
    args = parser.parse_args()
    asyncio.run(main(args.url.rstrip("/"), args.output))
