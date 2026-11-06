"""Rendered date/permission regression, with API fixtures and no paid calls.

Run against the current built app. Simulated people/stories are explicitly
fixtures; dates and photos must keep their factual linkage through navigation.
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
    original = workspace["experiences"][0]
    original["photo_ids"] = ["scene_photo"]
    workspace["experiences"].append({**original, "id": "undated",
        "title": "忘了日期的晚茶", "text": "那天一起坐了很久，日期已经不记得。", "occurred_on": None})
    errors = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000})
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        async def api(route):
            path = route.request.url.split("/api", 1)[1].split("?", 1)[0]
            if path.startswith("/assets/"):
                await route.fulfill(body=PIXEL, content_type="image/png")
                return
            body = person if path == "/me" else workspace if path == "/workspace" else {"demo_mode": False, "model_configured": False} if path == "/health" else []
            await route.fulfill(json=body)
        await context.route("**/api/**", api)
        await page.goto(url + "/#memories")
        await expect(page.locator(".memory-box")).to_be_visible()
        await expect(page.locator(".memory-grid")).to_have_count(0)
        await expect(page.locator(".memory-day-heading h2")).to_have_text("2026年10月1日")
        await expect(page.locator(".memory-page-photo img")).to_have_attribute("src", "/api/assets/scene_photo")
        await page.screenshot(path=str(output / "memory-box-desktop.png"), full_page=True, animations="disabled")
        await page.get_by_role("button", name="未记日期 也值得留下 1段").click()
        await expect(page.locator(".memory-day-heading h2")).to_have_text("日期未记")
        await expect(page.locator(".memory-page-copy h3")).to_have_text("忘了日期的晚茶")
        await page.locator(".memory-open-page").click()
        await expect(page.locator(".memory-detail time")).to_have_text("日期未记")
        await expect(page.locator(".memory-original")).to_have_text("那天一起坐了很久，日期已经不记得。")
        await page.locator(".ant-modal-close").last.click()
        await page.locator(".memory-view-switch button").nth(1).click()
        await expect(page.locator(".memory-card")).to_have_count(4)
        await page.get_by_role("button", name="朋友分享的", exact=True).click()
        await expect(page.locator(".memory-card")).to_have_count(1)
        await page.locator(".memory-view-switch button").first.click()
        await expect(page.locator(".memory-filmstrip")).to_have_count(0)
        await expect(page.locator(".memory-page-copy h3")).to_have_text("朋友的海边故事")
        workspace["experiences"] = [exp for exp in workspace["experiences"] if exp["id"] != "memory_shared"]
        await page.reload()
        await expect(page.locator(".memories-page")).not_to_contain_text("朋友的海边故事")
        await page.set_viewport_size({"width": 390, "height": 844})
        await expect(page.locator(".memory-box")).to_be_visible()
        assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth")
        await page.screenshot(path=str(output / "memory-box-mobile.png"), full_page=True, animations="disabled")
        assert not errors, errors
        await browser.close()
    result = {"status": "passed", "checks": ["date-linked main viewer", "unknown dates retained", "same detail record", "secondary grid", "sharing filters", "revoked story absent", "mobile width"], "page_errors": errors}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=Path("tmp/memory-box-ui"))
    args = parser.parse_args()
    asyncio.run(run(args.url, args.output))
