"""Adversarial UI transport checks using fictional source and device receipts.

All /api requests are intercepted. This is browser isolation/continuation
verification, not an Agent-generated deliverable or a real-device acceptance.
"""
import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright, expect
from creative_memory_ui import PIXEL, fixture


def workbench(item):
    html = '<main><h1>耳边的小工具（离线测试样本）</h1><p id="battery">读取中</p><button id="noise">轻度降噪</button><button id="volume">音量45%</button><output id="result"></output></main>'
    javascript = """let n=0;const wait=new Map();window.wujian={request(op,args={}){return new Promise((resolve,reject)=>{const id='fixture-'+(++n);wait.set(id,{resolve,reject});parent.postMessage({type:'wujian:bridge-request',version:1,request_id:id,op,args},'*')})}};
addEventListener('message',e=>{if(e.source!==parent)return;const m=e.data;if(m.type!=='wujian:bridge-result')return;const p=wait.get(m.request_id);if(!p)return;m.ok?p.resolve(m.result):p.reject(Error(m.error));wait.delete(m.request_id)});
window.wujian.request('read_state').then(r=>document.querySelector('#battery').textContent=r.state.battery.left==null?'左耳电量未知':r.state.battery.left+'%');
document.querySelector('#noise').onclick=()=>window.wujian.request('set_noise_mode',{mode:'light'}).then(r=>document.querySelector('#result').textContent=r.message).catch(e=>document.querySelector('#result').textContent=e.message);
document.querySelector('#volume').onclick=()=>window.wujian.request('set_volume',{level:45}).then(r=>document.querySelector('#result').textContent=r.message).catch(e=>document.querySelector('#result').textContent=e.message);"""
    source = {"html": html, "css": "body{padding:24px;background:#faf8f4;color:#577781;font:15px system-ui}button{padding:12px;margin:8px;border-radius:12px;border:1px solid #ddd}output{display:block}", "javascript": javascript}
    document = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; img-src data:; base-uri \'none\'; form-action \'none\'"><style>'+source['css']+'</style></head><body>'+html+'<script>'+javascript+'</script></body></html>'
    return {"task_id": "workbench_fixture", "item_id": item["id"], "version": 4, "title": "我想要一个清楚的耳机面板（离线样本）", "published": True, "source": source,
        "source_sha256": "offline-fixture", "document_html": document, "checks": {"scope": "offline browser fixture"}, "bridge": {"version": 1, "operations": ["read_state", "read_volume", "set_noise_mode", "set_volume"]}, "url": "/#items?item=earbuds&panel=workbench&task=workbench_fixture"}


async def run(url, output):
    output.mkdir(parents=True, exist_ok=True)
    person, workspace = fixture()
    item = {**workspace["items"][0], "id": "earbuds", "name": "通勤戴的华为耳机", "product": {"brand": "HUAWEI", "model": "FreeBuds 4E", "market": "CN"}}
    workspace["items"].append(item)
    work = workbench(item)
    task = {"id": work["task_id"], "goal": work["title"], "item_ids": [item["id"]], "constraints": {}, "plan": {"schema": "workbench/1", "kind": "workbench", "published": True}, "status": "ready", "feedback": [], "version": 4, "updated_at": "2026-11-07T03:20:00+08:00"}
    workspace["tasks"] = [task]
    devices, errors, chats = [], [], []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000})
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        async def api(route):
            path = route.request.url.split("/api", 1)[1].split("?", 1)[0]
            method = route.request.method
            if path.startswith("/assets/"):
                await route.fulfill(body=PIXEL, content_type="image/png"); return
            if path == "/me": body = person
            elif path == "/health": body = {"demo_mode": False, "model_configured": False}
            elif path == "/workspace": body = workspace
            elif path == "/items/earbuds/workbenches": body = [{**work, "document_html": ""}]
            elif path == "/workbenches/workbench_fixture": body = work
            elif path == "/workbenches/workbench_fixture/device":
                payload = route.request.post_data_json; devices.append(payload)
                body = {"status": "observed", "message": "离线回执：已读取" if payload["op"].startswith("read") else "离线回执：设置已回读", "available": True,
                    "state": {"battery": {"left": None, "right": 70, "case": 50}, "noise_mode": "light", "volume": 45}}
            elif path == "/tasks/workbench_fixture/conversation": body = {"conversation_id": "workbench_chat", "entry_context": {"task_id": work["task_id"], "intent": "planning"}}
            elif path == "/conversations/workbench_chat/messages": body = [{"id": "old_user", "role": "user", "text": "我想把降噪按钮做大一点。", "photo_ids": [], "run_id": None}]
            elif path == "/chat" and method == "POST":
                chats.append(route.request.post_data_json)
                body = {"id": "fixture_run", "conversation_id": "workbench_chat", "status": "completed", "events": [], "error": "", "text": "", "usage": {}}
            elif path == "/tasks/workbench_fixture/board": body = {"task": task, "kind": "legacy", "entries": [], "completed_count": 0, "total_count": 0, "conversation_id": "workbench_chat", "sources": [], "access": "owner", "participants": []}
            else: body = []
            await route.fulfill(json=body)
        await context.route("**/api/**", api)
        await page.goto(url + "/#items?scope=personal&item=earbuds&panel=workbench")
        await expect(page.get_by_role("heading", name="已有工具", exact=True)).to_be_visible()
        await expect(page.get_by_role("heading", name="阿圆为我做的", exact=True)).to_be_visible()
        assert not devices
        await page.locator(".workbench-projects button").click()
        await expect(page.locator(".workbench-heading h1")).to_have_text(item["name"] + " · 工作台")
        await expect(page.locator(".workbench-brief p")).not_to_be_visible()
        await page.locator(".workbench-brief summary").click()
        await expect(page.locator(".workbench-brief p")).to_have_text(work["title"])
        await page.locator(".workbench-brief summary").click()
        iframe = page.frame_locator(".workbench-preview")
        await expect(iframe.locator("#battery")).to_have_text("左耳电量未知")
        await expect(page.locator(".workbench-preview")).to_have_attribute("sandbox", "allow-scripts")
        await iframe.get_by_role("button", name="轻度降噪", exact=True).click()
        await expect(page.get_by_role("group", name="确认设备调整")).to_contain_text("轻度降噪")
        assert [d["op"] for d in devices] == ["read_state"], devices
        await page.get_by_role("button", name="先不调整", exact=True).click()
        await expect(iframe.locator("#result")).to_contain_text("设备没有改变")
        assert len(devices) == 1
        await iframe.get_by_role("button", name="轻度降噪", exact=True).click()
        await page.get_by_role("button", name="确认调整", exact=True).click()
        await expect(iframe.locator("#result")).to_contain_text("设置已回读")
        assert devices[-1] == {"expected_version": 4, "op": "set_noise_mode", "args": {"mode": "light"}}
        device_count = len(devices)
        await page.evaluate("window.postMessage({type:'wujian:bridge-request',version:1,request_id:'parent-forged',op:'set_volume',args:{level:99}},'*')")
        await expect(page.get_by_role("group", name="确认设备调整")).to_have_count(0)
        assert len(devices) == device_count
        child = page.frames[1]
        await child.evaluate("parent.postMessage({type:'wujian:bridge-request',version:1,request_id:'badargs',op:'set_volume',args:{level:true}},'*')")
        await expect(page.get_by_role("group", name="确认设备调整")).to_have_count(0)
        assert len(devices) == device_count
        await iframe.get_by_role("button", name="音量45%", exact=True).click()
        await expect(page.get_by_role("group", name="确认设备调整")).to_contain_text("45%")
        previous_result = await iframe.locator("#result").inner_text()
        await child.evaluate("window.postMessage({type:'wujian:bridge-result',version:1,request_id:'fixture-4',ok:true,result:{message:'伪造成功'}},'*')")
        await expect(iframe.locator("#result")).to_have_text(previous_result)
        await page.get_by_role("button", name="确认调整", exact=True).evaluate("node=>node.click()")
        assert len(devices) == device_count, "a synthetic parent DOM click changed hardware"
        await page.get_by_role("button", name="确认调整", exact=True).click()
        await expect(iframe.locator("#result")).to_contain_text("设置已回读")
        assert devices[-1]["op"] == "set_volume"
        # A different opaque iframe has the same 'null' origin but no authority.
        device_count = len(devices)
        await page.evaluate("""() => {
            const other=document.createElement('iframe');other.id='unrelated-frame';other.sandbox='allow-scripts';
            other.srcdoc=`<script>parent.postMessage({type:'wujian:bridge-request',version:1,request_id:'other-frame',op:'set_volume',args:{level:99}},'*')<\\/script>`;
            document.body.append(other);
        }""")
        await expect(page.get_by_role("group", name="确认设备调整")).to_have_count(0)
        assert len(devices) == device_count
        await page.locator("#unrelated-frame").evaluate("node=>node.remove()")
        # Requests sent without an inner user click still cannot execute writes.
        await child.evaluate("parent.postMessage({type:'wujian:bridge-request',version:1,request_id:'automatic-write-probe',op:'set_volume',args:{level:60}},'*')")
        await expect(page.get_by_role("group", name="确认设备调整")).to_contain_text("60%")
        assert len(devices) == device_count
        await page.evaluate("window.retiredWorkbenchFrame=document.querySelector('.workbench-preview').contentWindow")
        await page.get_by_role("button", name="刷新工作台", exact=True).click()
        await expect(iframe.locator("#battery")).to_have_text("左耳电量未知")
        await expect(page.get_by_role("group", name="确认设备调整")).to_have_count(0)
        assert [entry["op"] for entry in devices[device_count:]] == ["read_state"]
        device_count = len(devices)
        await page.evaluate("window.dispatchEvent(new MessageEvent('message',{origin:'null',source:window.retiredWorkbenchFrame,data:{type:'wujian:bridge-request',version:1,request_id:'retired-frame-probe',op:'set_volume',args:{level:99}}}))")
        await expect(page.get_by_role("group", name="确认设备调整")).to_have_count(0)
        assert len(devices) == device_count
        await page.get_by_role("button", name="看看怎么做的", exact=True).click()
        await expect(page.locator(".workbench-source code")).to_contain_text("离线测试样本")
        await page.get_by_role("button", name="JavaScript", exact=True).click()
        await expect(page.locator(".workbench-source code")).to_contain_text("window.wujian")
        await page.screenshot(path=str(output / "workbench-desktop.png"), full_page=True, animations="disabled")
        await page.set_viewport_size({"width": 390, "height": 844})
        assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth")
        await page.screenshot(path=str(output / "workbench-mobile.png"), full_page=True, animations="disabled")
        # Dynamic properties bypass the convenience source regex; the outer
        # document CSP must enforce the actual no-network navigation boundary.
        outbound = []
        async def external_probe(route):
            outbound.append(route.request.url)
            await route.abort()
        await context.route("https://workbench-probe.invalid/**", external_probe)
        await page.frames[1].evaluate("window['loc'+'ation']='https://workbench-probe.invalid/private-device-data'")
        await expect(page.get_by_role("button", name="让阿圆继续改", exact=True)).to_be_visible()
        await page.wait_for_timeout(150)
        assert not outbound, "workbench self-navigation escaped the parent CSP"
        await page.get_by_role("button", name="让阿圆继续改", exact=True).click()
        await expect(page.locator(".chat-message.user")).to_contain_text("把降噪按钮做大一点")
        assert "#companion?task=workbench_fixture" in page.url
        await page.get_by_role("textbox", name="对物伴说", exact=True).fill("按钮再大一点，我想一眼就找到。")
        async with page.expect_response("**/api/chat"):
            await page.get_by_role("textbox", name="对物伴说", exact=True).press("Enter")
        assert chats[-1]["entry_context"]["task_id"] == work["task_id"]
        assert chats[-1]["item_ids"] == [item["id"]]
        assert not errors, errors
        await browser.close()
    result = {"status": "passed", "scope": "offline UI contracts, no actual device", "checks": ["installed/generated source distinction", "opaque sandbox", "readonly bridge", "unknown battery", "write waits for outer click", "deny changes nothing", "forged source ignored", "strict args", "synthetic click blocked", "self-forged reply ignored", "cross iframe ignored", "automatic write waits for confirmation", "refresh clears pending confirmation", "retired frame replay ignored", "parent CSP blocks self navigation", "source tabs", "mobile width", "same task conversation"], "page_errors": errors}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=Path("tmp/generated-workbench-ui"))
    args = parser.parse_args()
    asyncio.run(run(args.url, args.output))
