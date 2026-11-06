"""Opt-in live UI read-only probe of an actual Agent-published workbench.

Does not confirm mode/volume writes. This is not part of ordinary offline CI.
"""
import argparse
import asyncio
import json
from pathlib import Path
import re

from playwright.async_api import async_playwright


async def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    errors, device_calls, blocked = [], [], []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel="chrome", headless=True)
        try:
            context = await browser.new_context(viewport={"width": 1440, "height": 1100})
            response = await context.request.post(args.base_url + "/api/auth/demo/xiaolin")
            if response.status != 200:
                raise RuntimeError("Live demo login failed")
            async def guard(route):
                payload = route.request.post_data_json
                device_calls.append(payload)
                if payload.get("op") not in {"read_state", "read_volume"}:
                    blocked.append(payload); await route.abort(); return
                await route.continue_()
            await context.route("**/api/workbenches/*/device", guard)
            page = await context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.goto(f"{args.base_url}/#items?item={args.item_id}&panel=workbench&task={args.task_id}")
            await page.locator("iframe").wait_for(timeout=15000)
            frame = page.frame_locator("iframe")
            await frame.locator("body").wait_for()
            await page.wait_for_timeout(1000)
            buttons = await frame.locator("button").all_text_contents()
            # Read-only button action only; no outer confirmation button.
            read_button = frame.get_by_role("button", name=re.compile("刷新|读取|读电量"))
            if await read_button.count():
                await read_button.first.click()
                await page.wait_for_timeout(5000)
            text = await frame.locator("body").inner_text()
            await page.screenshot(path=str(args.output/"workbench-desktop.png"), full_page=True)
            await page.set_viewport_size({"width":390,"height":844})
            await page.screenshot(path=str(args.output/"workbench-mobile.png"), full_page=True)
            result={"kind":"actual_published_app_ui_probe", "task_id":args.task_id,"item_id":args.item_id,
                "buttons":buttons,"rendered_text":text,"page_errors":errors,"device_calls":device_calls,
                "blocked_write_attempts":blocked,"actual_hardware_write_performed":False,
                "screenshot_files":["workbench-desktop.png","workbench-mobile.png"]}
            (args.output/"ui-results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
            print(json.dumps(result,ensure_ascii=False),flush=True)
        finally:
            await browser.close()


if __name__=="__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8",errors="backslashreplace")
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-device-reads",action="store_true")
    parser.add_argument("--base-url",default="http://127.0.0.1:8000")
    parser.add_argument("--item-id",required=True)
    parser.add_argument("--task-id",required=True)
    parser.add_argument("--output",type=Path,required=True)
    arguments=parser.parse_args()
    if not arguments.live_device_reads:
        parser.error("--live-device-reads required: this reads the authorized live device")
    asyncio.run(run(arguments))
