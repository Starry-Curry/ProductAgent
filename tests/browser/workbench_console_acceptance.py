"""Explicit full earbud-console rendering acceptance, separate from generic smoke.

This checks the former battery/volume/unknown/error display requirements. It
does not establish real device observations or physical effects. --document
may inspect an exported console document; no generated artifact is edited.
Assertions use the generic receipt's bounded snapshots (20 requests, 1,200
post-click characters, 1,000 unknown/failure characters); large consoles may
need a focused UI acceptance rather than treating truncation as product failure.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wujian.coding_workbench import document_html
from wujian.workbench_check import inspect_document


def console_rendering_assertions(receipt):
    requests, fixture = receipt["bridge_requests"], receipt["random_device_fixture"]
    final_text, unknown_text = receipt["rendered_text_after_clicks"], receipt["unknown_text"]
    state_reads = any(row.get("op") == "read_state" for row in requests)
    volume_reads = any(row.get("op") == "read_volume" for row in requests)
    expected_volume = next((row["args"]["level"] for row in reversed(requests)
        if row.get("op") == "set_volume" and isinstance(row.get("args"), dict)
        and type(row["args"].get("level")) in {int, float}), fixture["volume"])
    unknown_read = any(row.get("phase") == "simulated_unknown" and row.get("op") == "read_state" for row in requests)
    failed_request = any(row.get("phase") == "simulated_failure" for row in requests)
    return {"battery_read_observed": state_reads, "volume_read_observed": volume_reads,
        "battery_values_rendered": state_reads and all(str(fixture[key]) in final_text for key in ("left", "right", "case")),
        "volume_rendered": volume_reads and format(expected_volume, "g") in final_text,
        "unknown_clears_old_battery": unknown_read and all(str(fixture[key]) not in unknown_text for key in ("left", "right", "case")),
        "unknown_has_no_percentage_suffix": not re.search(r"(?:unknown|未知|—|--)\s*%", unknown_text, re.IGNORECASE),
        "failure_visible": failed_request and "check-device-offline" in receipt["failure_text"]}


def accept_console(path):
    receipt = inspect_document(path)
    assertions = console_rendering_assertions(receipt)
    return {"passed": receipt["passed"] and all(assertions.values()), "generic_smoke_passed": receipt["passed"],
            "rendering_assertions": assertions,
            "scope": "explicit full earbud-console UI acceptance with simulated results; no real hardware"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document", type=Path)
    args = parser.parse_args()
    if args.document:
        result = accept_console(args.document)
        print(json.dumps(result, ensure_ascii=True))
        assert result["passed"], result
        return
    source = {"html": '<button id="read">Refresh</button><p id="battery">Ready</p><p id="volume">Ready</p><p id="error"></p>', "css": "",
        "javascript": "const fmt=v=>v==null?'未知':v+'%';document.querySelector('#read').onclick=async()=>{try{const [a,b]=await Promise.all([window.wujian.request('read_state',{}),window.wujian.request('read_volume',{})]);document.querySelector('#battery').textContent=Object.values(a.state.battery).map(fmt).join(' ');document.querySelector('#volume').textContent=fmt(b.state.volume);document.querySelector('#error').textContent='';}catch(e){document.querySelector('#error').textContent=e.message;}};"}
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "console.html"
        path.write_text(document_html(source), encoding="utf-8")
        good = accept_console(path)
        assert good["passed"], good
        path.write_text(document_html({**source, "javascript": source["javascript"].replace("?'未知':", "?'未知%':")}), encoding="utf-8")
        bad = accept_console(path)
        assert bad["generic_smoke_passed"] and not bad["passed"], bad
        assert bad["rendering_assertions"]["unknown_has_no_percentage_suffix"] is False, bad
    print(json.dumps({"passed": True, "synthetic_console": good, "bad_unknown_units": bad}, ensure_ascii=True))


if __name__ == "__main__":
    main()
