"""Real Chrome regressions for generic smoke; synthetic code, no app/device/model."""
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

from playwright.sync_api import BrowserContext

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wujian.coding_workbench import document_html, run_checks
from wujian.workbench_check import inspect_document


def source(javascript):
    return {"html": '<button id="go">Refresh</button><p id="status">Ready</p>', "css": "", "javascript": javascript}


def main():
    muted = "async function read(){try{const r=await window.wujian.request('read_volume',{});document.querySelector('#status').textContent=typeof r.state.muted==='boolean'?(r.state.muted?'系统静音':'系统未静音'):'系统静音未知';}catch(e){document.querySelector('#status').textContent='系统静音未知';}}document.querySelector('#go').onclick=read;read();"
    mode = "async function read(){try{const r=await window.wujian.request('read_state',{});document.querySelector('#status').textContent=r.state.noise_mode==='off'?'降噪关闭':'其他模式';}catch(e){document.querySelector('#status').textContent='模式未知';}}document.querySelector('#go').onclick=read;read();"
    cases = [
        ("muted_only_no_numeric_volume", muted, True, None),
        ("noise_mode_only_no_battery", mode, True, None),
        ("invalid_bridge_arguments", "document.querySelector('#go').onclick=()=>window.wujian.request('set_noise_mode',{mode:'transparent'}).catch(e=>document.querySelector('#status').textContent=e.message);", False, "invalid_arguments"),
        ("automatic_write", "window.wujian.request('set_volume',{level:30}).catch(()=>{});", False, "automatic_writes"),
        ("delayed_900ms_automatic_write", "setTimeout(()=>window.wujian.request('set_volume',{level:30}).catch(()=>{}),900);", False, "automatic_writes"),
        ("javascript_runtime_error", "document.querySelector('#go').onclick=()=>{throw new Error('synthetic runtime failure');};", False, "page_errors"),
        ("unhandled_bridge_failure", "document.querySelector('#go').onclick=async()=>{const r=await window.wujian.request('read_volume',{});document.querySelector('#status').textContent=r.state.muted?'静音':'未静音';};", False, "page_errors"),
    ]
    receipts = []
    for name, javascript, expected, failure_field in cases:
        result = run_checks(source(javascript))
        assert result["passed"] is expected, {"case": name, "receipt": result}
        if failure_field:
            assert result["browser"][failure_field], {"case": name, "receipt": result}
        receipts.append({"case": name, "passed": result["passed"], "expected_pass": expected,
                         "failure_field": failure_field, "scope": result["scope"]})
    # A CSP rejection happens before a routed request. Verify the actual
    # generated-document policy; absence of routed requests alone is no proof.
    console_messages = []
    original_new_page = BrowserContext.new_page
    def capture_console(context, *args, **kwargs):
        page = original_new_page(context, *args, **kwargs)
        page.on("console", lambda message: console_messages.append(message.text))
        return page
    with tempfile.TemporaryDirectory() as folder, patch.object(BrowserContext, "new_page", capture_console):
        path = Path(folder) / "network-probe.html"
        network_source = source("window['fe'+'tch']('https://offline-probe.invalid/blocked').then(()=>document.querySelector('#status').textContent='unexpected network success').catch(()=>document.querySelector('#status').textContent='network blocked');")
        path.write_text(document_html(network_source), encoding="utf-8")
        network = inspect_document(path)
    assert network["passed"] is True and not network["blocked_requests"], network
    assert "network blocked" in network["rendered_text_after_clicks"], network
    assert any("connect-src" in text for text in console_messages), console_messages
    receipts.append({"case": "csp_rejects_network_before_transport", "passed": network["passed"],
                     "expected_pass": True, "csp_rejection_observed": True, "routed_requests": 0})
    print(json.dumps({"passed": True, "scope": "generic production smoke in real Chrome; simulated bridge only", "cases": receipts}, ensure_ascii=True))


if __name__ == "__main__":
    main()
