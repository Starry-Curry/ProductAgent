"""Bounded isolated Chromium smoke check; never has app cookies or device tools."""
import json
from pathlib import Path
import re
import secrets
import sys


def valid_bridge_request(request):
    """Match the production bridge's exact operations and JSON arguments."""
    op, args = request.get("op"), request.get("args")
    if not isinstance(op, str) or not isinstance(args, dict):
        return False
    if op in {"read_state", "read_volume"}:
        return not args
    if op == "set_noise_mode":
        return (set(args) == {"mode"} and isinstance(args["mode"], str)
                and args["mode"] in {"off", "light", "balanced"})
    if op == "set_volume":
        return (set(args) == {"level"} and type(args["level"]) in {int, float}
                and 0 <= args["level"] <= 100)
    return False


def inspect_document(path):
    from playwright.sync_api import sync_playwright
    errors, requests, blocked = [], [], []
    fixture = {"left": 70+secrets.randbelow(20), "right": 40+secrets.randbelow(20),
        "case": 90+secrets.randbelow(9), "volume": 20+secrets.randbelow(15)}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, timeout=10000)
        try:
            context = browser.new_context(viewport={"width": 1000, "height": 720})
            context.route("**/*", lambda route: (blocked.append(route.request.url[:160]), route.abort()))
            page = context.new_page()
            page.set_default_timeout(4000)
            page.on("pageerror", lambda error: errors.append(str(error)[:500]))
            def record_request(request):
                requests.append(request)
                return valid_bridge_request(request)
            page.expose_function("record_request", record_request)
            page.set_content("<html><head><meta http-equiv='Content-Security-Policy' content=\"frame-src 'none'\"></head><body><iframe id='artifact' sandbox='allow-scripts' style='width:1000px;height:720px;border:0'></iframe></body></html>")
            page.evaluate("value=>window.deviceFixture=value", fixture)
            page.evaluate("""() => addEventListener('message', async event => {
                if(event.source!==document.querySelector('iframe').contentWindow)return;
                const m=event.data;if(!m||m.type!=='wujian:bridge-request'||m.version!==1)return;
                const valid=await window.record_request({op:m.op,args:m.args,phase:window.checkPhase||'load'});
                const allowed=['read_state','read_volume','set_noise_mode','set_volume'];
                const write=m.op==='set_noise_mode'||m.op==='set_volume';
                const sample=window.deviceFixture;
                const state=m.op==='read_volume'||m.op==='set_volume'
                  ? {volume:window.fixtureUnknown?null:m.op==='set_volume'?m.args?.level:sample.volume,muted:false,status:write?'verified':'observed',write_verified:write}
                  : {battery:window.fixtureUnknown?{left:null,right:null,case:null}:{left:sample.left,right:sample.right,case:sample.case},noise_mode:m.args?.mode||'off',status:write?'verified':'observed',write_verified:write};
                event.source.postMessage({type:'wujian:bridge-result',version:1,request_id:m.request_id,
                  ok:valid&&!window.failBridge,result:{status:write?'verified':'observed',state,observed_at:'2026-11-07T00:00:00Z',physical_effect_verified:false},
                  error:window.failBridge?'check-device-offline':valid?undefined:allowed.includes(m.op)?'invalid bridge arguments':'unknown bridge operation'},'*');
            })""")
            page.locator("iframe").evaluate("(frame,html)=>frame.srcdoc=html", path.read_text(encoding="utf-8"))
            page.wait_for_timeout(700)
            frame = page.frames[-1]
            text = frame.locator("body").inner_text()
            controls = frame.locator("button,input,select").count()
            # Exercise generated controls with a simulated bridge only. These
            # are browser interaction checks, never device or user acceptance.
            page.evaluate("window.checkPhase='simulated_click'")
            read_button_index = None
            for index, button in enumerate(frame.locator("button").all()[:8]):
                if button.is_visible() and button.is_enabled():
                    count_before = len(requests)
                    button.click(timeout=1500)
                    page.wait_for_timeout(100)
                    if read_button_index is None and any(r.get("op") == "read_state" for r in requests[count_before:]):
                        read_button_index = index
            page.wait_for_timeout(300)
            final_text = frame.locator("body").inner_text()
            state_reads = any(r.get("op") == "read_state" for r in requests)
            volume_reads = any(r.get("op") == "read_volume" for r in requests)
            expected_volume = next((r["args"]["level"] for r in reversed(requests)
                if r.get("op") == "set_volume" and isinstance(r.get("args"), dict)
                and type(r["args"].get("level")) in {int, float}), fixture["volume"])
            rendering = {"battery_values_rendered": not state_reads or all(str(fixture[key]) in final_text for key in ("left", "right", "case")),
                "volume_rendered": not volume_reads or format(expected_volume, "g") in final_text}
            page.evaluate("window.fixtureUnknown=true;window.checkPhase='simulated_unknown'")
            buttons = frame.locator("button").all()
            refresh_button = buttons[read_button_index] if read_button_index is not None and read_button_index < len(buttons) else None
            if refresh_button and refresh_button.is_visible() and refresh_button.is_enabled():
                refresh_button.click(timeout=1500); page.wait_for_timeout(350)
            unknown_text = frame.locator("body").inner_text()
            unknown_read = any(r.get("phase") == "simulated_unknown" and r.get("op") == "read_state" for r in requests)
            rendering["unknown_clears_old_battery"] = not unknown_read or all(str(fixture[key]) not in unknown_text for key in ("left", "right", "case"))
            rendering["unknown_has_no_percentage_suffix"] = not re.search(r"(?:unknown|未知|—|--)\s*%", unknown_text, re.IGNORECASE)
            page.evaluate("window.failBridge=true;window.checkPhase='simulated_failure'")
            buttons = frame.locator("button").all()
            failure_button = refresh_button or (buttons[0] if buttons else None)
            if failure_button and failure_button.is_visible() and failure_button.is_enabled():
                failure_button.click(timeout=1500); page.wait_for_timeout(350)
            failure_text = frame.locator("body").inner_text()
            failed_request = any(r.get("phase") == "simulated_failure" for r in requests)
            rendering["failure_visible"] = not failed_request or "check-device-offline" in failure_text
            unexpected = [r for r in requests if r.get("op") not in ("read_state", "read_volume", "set_noise_mode", "set_volume")]
            invalid_arguments = [r for r in requests if r not in unexpected and not valid_bridge_request(r)]
            automatic_write = [r for r in requests if r.get("phase") == "load" and r.get("op") in {"set_noise_mode", "set_volume"}]
            passed = bool(text.strip()) and not errors and not blocked and not unexpected and not invalid_arguments and not automatic_write and all(rendering.values())
            return {"passed": passed, "page_errors": errors[:6], "blocked_requests": blocked[:6],
                "visible_text_excerpt": text[:800], "control_count": controls, "bridge_requests": requests[:20],
                "automatic_writes": automatic_write, "unknown_operations": unexpected,
                "invalid_arguments": invalid_arguments,
                "rendering_assertions": rendering, "random_device_fixture": fixture,
                "rendered_text_after_clicks": final_text[:1200], "unknown_text": unknown_text[:1000],
                "repair_hint": "Bridge arguments must match the contract: reads {}, noise mode off/light/balanced, volume {level:number 0..100}; no extra keys." if invalid_arguments else "SDK resolves DIRECT actual result (no .ok/.result wrapper): result.state.battery and result.state.volume. Display actual values and caught error.message; writes must await verified result." if not all(rendering.values()) else "",
                "scope": "isolated DOM and simulated bridge clicks; no real hardware or application account"}
        finally:
            browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    try:
        print(json.dumps(inspect_document(Path(sys.argv[1])), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"passed": False, "error": f"{type(error).__name__}: {str(error)[:1000]}"}, ensure_ascii=False))
