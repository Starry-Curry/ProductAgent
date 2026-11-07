"""Opt-in read-only live probe: delayed actual volume read must keep UI locked."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

from playwright.async_api import async_playwright, expect


async def main(args):
    state_done, volume_seen, volume_done = asyncio.Event(), asyncio.Event(), asyncio.Event()
    calls, blocked = [], []
    args.output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel="chrome", headless=True)
        try:
            context = await browser.new_context(viewport={"width":1440,"height":1000})
            await context.request.post(args.base_url + "/api/auth/demo/xiaolin")
            async def control(route):
                payload = route.request.post_data_json
                calls.append(payload)
                if payload.get("op") not in {"read_state", "read_volume"}:
                    blocked.append(payload); await route.abort(); return
                response = await route.fetch()
                if payload["op"] == "read_volume":
                    volume_seen.set()
                    await asyncio.sleep(2)
                    await route.fulfill(response=response)
                    volume_done.set()
                else:
                    await route.fulfill(response=response)
                    state_done.set()
            await context.route("**/api/workbenches/*/device", control)
            page = await context.new_page()
            await page.goto(f"{args.base_url}/#items?item={args.item_id}&panel=workbench&task={args.task_id}")
            await page.locator("iframe").wait_for(timeout=15000)
            frame = page.frame_locator("iframe")
            await asyncio.wait_for(asyncio.gather(state_done.wait(), volume_seen.wait()), timeout=15)
            await page.wait_for_timeout(100)
            slider = frame.locator("#volume-slider")
            locked = await slider.is_disabled()
            all_buttons_locked = await frame.locator("button").evaluate_all("buttons=>buttons.every(button=>button.disabled)")
            await asyncio.wait_for(volume_done.wait(), timeout=10)
            await expect(slider).to_be_enabled()
            initial = await slider.input_value()
            await slider.focus(); await slider.press("ArrowLeft")
            moved = await slider.input_value()
            await page.wait_for_timeout(500)
            stayed = await slider.input_value()
            result = {"kind":"live_actual_read_delayed_transport_ui_probe", "task_id":args.task_id,
                "volume_response_delayed_seconds":2,"locked_until_both_reads_complete":locked,
                "all_buttons_locked":all_buttons_locked,"range_initial":initial,"range_after_user_key":moved,
                "range_after_settle":stayed,"no_late_overwrite":moved==stayed,
                "device_calls":calls,"blocked_write_attempts":blocked,"actual_hardware_writes":False}
            (args.output/"busy-results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
            print(json.dumps(result,ensure_ascii=False),flush=True)
            if not locked or not all_buttons_locked or moved != stayed or blocked:
                raise AssertionError("Actual workbench read/busy behavior failed")
        finally:
            await browser.close()


if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8",errors="backslashreplace")
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-device-reads",action="store_true")
    parser.add_argument("--base-url",default="http://127.0.0.1:8000")
    parser.add_argument("--task-id",required=True)
    parser.add_argument("--item-id",required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    if not args.live_device_reads:
        parser.error("--live-device-reads required; this fetches actual device read results")
    asyncio.run(main(args))
