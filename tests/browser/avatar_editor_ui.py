"""Offline Chrome checks for portrait races, failures and calendar-day display.

Uses fictional people/ownership and intercepted API fixtures; no paid calls.
Run with PYTHONPATH=tmp/browser-test-deps against a running frontend.
"""
import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright, expect
from creative_memory_ui import PIXEL, fixture


async def run(url, output):
    output.mkdir(parents=True, exist_ok=True)
    person, workspace = fixture()
    cup = workspace["items"][1]
    cup["avatar"]["image_id"] = "old_missing_portrait"
    pending, release = asyncio.Event(), asyncio.Event()
    state = {"fail": True, "writes": 0}
    errors = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)

        async def api(route):
            path = route.request.url.split("/api", 1)[1].split("?", 1)[0]
            method = route.request.method
            if path == "/assets/old_missing_portrait":
                await route.fulfill(status=404, json={"detail": "图片不可读取"})
                return
            if path.startswith("/assets/"):
                await route.fulfill(body=PIXEL, content_type="image/png")
                return
            if path == "/items/cup/avatar-image":
                if state["fail"]:
                    await route.fulfill(status=502, json={"detail": "测试：形象生成失败，可重试"})
                    return
                pending.set()
                await release.wait()
                await route.fulfill(json={"asset_id": "new_portrait", "model": "offline-fixture"})
                return
            if path == "/items/cup" and method == "PUT":
                state["writes"] += 1
                cup.update(route.request.post_data_json)
                cup["version"] += 1
                await route.fulfill(json=cup)
                return
            body = person if path == "/me" else workspace if path == "/workspace" else {
                "demo_mode": False, "model_configured": False} if path == "/health" else []
            await route.fulfill(json=body)

        context = await browser.new_context(timezone_id="America/Los_Angeles")
        await context.route("**/api/**", api)
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto(url + "/#items?scope=personal&item=cup")
        await page.get_by_role("button", name="它的模样与性格", exact=True).click()
        await expect(page.locator(".persona-preview svg")).to_be_visible()
        await page.get_by_role("button", name="再长一个样子", exact=True).click()
        await expect(page.locator(".persona-photo-create [role=alert]")).to_contain_text("形象生成失败")
        await expect(page.locator(".persona-preview svg")).to_be_visible()
        state["fail"] = False
        await page.get_by_role("button", name="再长一个样子", exact=True).click()
        await asyncio.wait_for(pending.wait(), 5)
        await expect(page.locator(".dialog-footer .primary-button")).to_be_disabled()
        # Form submit (including an implicit Enter) must share the busy guard.
        await page.locator("#interaction-editor").evaluate(
            "form => form.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}))")
        await page.wait_for_timeout(100)
        assert state["writes"] == 0, "pending render must not save the stale portrait"
        release.set()
        await expect(page.locator(".persona-preview .object-portrait>img")).to_have_attribute(
            "src", "/api/assets/new_portrait")
        await expect(page.locator(".persona-preview .object-portrait>img")).to_have_attribute(
            "alt", "小陶的AI创作分身，非实物照片")
        await page.locator(".dialog-footer .primary-button").click()
        await expect(page.locator("#interaction-editor")).to_have_count(0)
        assert state["writes"] == 1 and cup["avatar"]["image_id"] == "new_portrait"
        await page.reload()
        await expect(page.locator('.object-portrait img[src="/api/assets/new_portrait"]').first).to_be_visible()
        await page.goto(url + "/#memories")
        await expect(page.locator(".memory-day-heading h2")).to_have_text("2026年10月1日")
        await page.locator(".memory-open-page").click()
        await expect(page.locator(".memory-detail time")).to_have_text("2026年10月1日")
        await page.locator(".ant-modal-close").last.click()
        await page.locator(".memory-filmstrip button").filter(has_text="小雨的毕业寄语").click()
        await expect(page.locator(".memory-page-attribution")).to_have_text("随礼物收到的原故事 · 小雨")
        await page.locator(".memory-open-page").click()
        await expect(page.locator(".memory-detail-attribution")).to_have_text("随礼物收到的原故事 · 小雨")
        await page.locator(".ant-modal-close").last.click()
        await page.locator(".memory-filmstrip button").filter(has_text="朋友的海边故事").click()
        await expect(page.locator(".memory-page-attribution")).to_have_text("来自小雨的分享")
        await page.locator(".memory-view-switch button").nth(1).click()
        await expect(page.locator(".memory-card time").first).to_have_text("2026年10月1日")
        await page.screenshot(path=str(output / "los-angeles-dates.png"), full_page=True)
        await context.close()
        eastern = await browser.new_context(timezone_id="Asia/Shanghai")
        await eastern.route("**/api/**", api)
        east_page = await eastern.new_page()
        await east_page.goto(url + "/#memories")
        await expect(east_page.locator(".memory-day-heading h2")).to_have_text("2026年10月1日")
        assert not errors, errors
        await browser.close()
    result = {"status": "passed", "checks": ["missing legacy image falls back", "failure keeps old portrait and retries",
        "form submit waits for image", "preview only applied on save", "saved portrait survives reload",
        "AI image identified separately from photo", "received and shared stories retain attribution",
        "Los Angeles calendar date in box/detail/grid", "Shanghai same date"],
        "page_errors": errors}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5182")
    parser.add_argument("--output", type=Path, default=Path("tmp/avatar-editor-review"))
    args = parser.parse_args()
    asyncio.run(run(args.url, args.output))
