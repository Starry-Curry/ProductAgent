"""Offline Chromium check of the production SDK's device-outcome Promise contract."""
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from playwright.async_api import async_playwright, expect
from wujian.coding_workbench import document_html


async def main():
    cases = [
        ("read_disconnected", "read_state", {"status": "disconnected", "message": "耳机未连接"}, False),
        ("read_observed", "read_state", {"status": "observed", "state": {"battery": {"left": 60}}}, True),
        ("write_unknown", "set_noise_mode", {"status": "outcome_unknown", "message": "可能已改变，尚未核验", "state": {"write_verified": False}}, False),
        ("write_unverified", "set_noise_mode", {"status": "unverified", "state": {"write_verified": False}}, False),
        ("write_false_verified", "set_noise_mode", {"status": "verified", "state": {"write_verified": False}}, False),
        ("write_integer_truth", "set_noise_mode", {"status": "verified", "state": {"write_verified": 1}}, False),
        ("write_verified", "set_noise_mode", {"status": "verified", "state": {"write_verified": True}}, True),
    ]
    results = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel="chrome", headless=True)
        try:
            page = await browser.new_page()
            await page.set_content("<meta http-equiv='Content-Security-Policy' content=\"frame-src 'none'\"><iframe sandbox='allow-scripts'></iframe>")
            await page.evaluate("""()=>addEventListener('message',event=>{
              if(event.source!==document.querySelector('iframe').contentWindow)return;
              const m=event.data;if(m?.type!=='wujian:bridge-request')return;
              event.source.postMessage({type:'wujian:bridge-result',version:1,request_id:m.request_id,ok:true,result:window.testResult},'*');
            })""")
            for name, operation, result, should_resolve in cases:
                await page.evaluate("value=>window.testResult=value", result)
                source = {"html": "<button>Try</button><p id='result'>waiting</p>", "css": "", "javascript":
                    "document.querySelector('button').addEventListener('click',async()=>{try{await window.wujian.request("
                    + json.dumps(operation) + ",{mode:'light'});document.querySelector('#result').textContent='resolved';}"
                    + "catch(error){document.querySelector('#result').textContent='rejected:'+error.message;}});"}
                await page.locator("iframe").evaluate("(frame,html)=>frame.srcdoc=html", document_html(source))
                frame = page.frame_locator("iframe")
                await frame.get_by_role("button", name="Try").click()
                await expect(frame.locator("#result")).not_to_have_text("waiting")
                text = await frame.locator("#result").inner_text()
                passed = text.startswith("resolved") if should_resolve else text.startswith("rejected")
                results.append({"case": name, "passed": passed, "text": text})
            print(json.dumps({"passed": all(row["passed"] for row in results), "cases": results,
                "scope": "production SDK in opaque iframe; simulated outcomes, no real device calls"}, ensure_ascii=False))
            if not all(row["passed"] for row in results):
                raise AssertionError("SDK device outcome contract failed")
        finally:
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    asyncio.run(main())
