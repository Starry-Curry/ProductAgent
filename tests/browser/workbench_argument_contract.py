"""Production checker regression with simulated outcomes; no app/device/model."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wujian.coding_workbench import run_checks


def main():
    cases = [("set_noise_mode", {"mode": "transparent"}, False),
             ("set_noise_mode", {"mode": "light"}, True),
             ("set_volume", None, False),
             ("set_volume", {"level": 35.5}, True)]
    receipts = []
    for operation, args, expected in cases:
        source = {"html": '<button id="go">Adjust</button><p id="status">Ready</p>', "css": "",
                  "javascript": "document.querySelector('#go').onclick=async()=>{try{const r=await window.wujian.request("
                  + json.dumps(operation) + "," + json.dumps(args) + ");document.querySelector('#status').textContent=JSON.stringify(r.state);}catch(e){document.querySelector('#status').textContent=e.message;}}"}
        result = run_checks(source)
        assert result["passed"] is expected, result
        if not expected:
            assert result["browser"]["invalid_arguments"], result
        receipts.append({"operation": operation, "args": args, "expected_pass": expected,
                         "actual_pass": result["passed"], "invalid_arguments": result["browser"]["invalid_arguments"]})
    unknown_source = {"html": '<button id="read">Read</button><p id="status">Ready</p>', "css": "",
                      "javascript": "document.querySelector('#read').onclick=async()=>{try{const r=await window.wujian.request('read_state',{});document.querySelector('#status').textContent=Object.values(r.state.battery).map(v=>(v==null?'未知':v)+'%').join(' ');}catch(e){document.querySelector('#status').textContent=e.message;}}"}
    unknown = run_checks(unknown_source)
    assert unknown["passed"] is False, unknown
    assert unknown["browser"]["rendering_assertions"]["unknown_has_no_percentage_suffix"] is False, unknown
    receipts.append({"case": "unknown_battery_with_percent_unit", "actual_pass": unknown["passed"],
                     "unknown_text": unknown["browser"]["unknown_text"]})
    print(json.dumps({"passed": True, "scope": "production isolated browser checker; simulated bridge only", "cases": receipts}, ensure_ascii=True))


if __name__ == "__main__":
    main()
