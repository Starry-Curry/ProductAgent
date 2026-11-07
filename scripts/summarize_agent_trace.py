"""Summarize retained real-model probes without model calls or private text.

Uses existing event/usage evidence. Model timing includes provider transport and
generation; it cannot distinguish hidden thinking from decoding. Tool durations
can overlap, so their sum is NOT an exclusive wall-clock decomposition.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path


def summarize_turn(turn):
    run = turn.get("run", {})
    names, pending, tools = {}, set(), defaultdict(list)
    models, finals, errors = [], [], []
    repeated = Counter()
    for event in run.get("events", []):
        kind, identity = event.get("type"), event.get("id")
        if kind == "tool_start":
            names[identity] = event.get("name", "unknown")
            pending.add(identity)
        elif kind == "model_timing":
            models.append(event)
            if any(names.get(key) == "GenerateStructuredOutput" for key in pending):
                finals.append(event)
        elif kind == "tool_end":
            name = names.get(identity, "unknown")
            tools[name].append(event.get("elapsed_seconds", 0) or 0)
            # Arguments are compared in memory; never emitted in this summary.
            if name in {"search_public_web", "fetch_document", "read_source", "search_world"}:
                repeated[(name, event.get("arguments", ""))] += 1
            if event.get("state") == "error":
                errors.append(name)
            pending.discard(identity)
    usage = run.get("usage", {})
    durations = [event.get("elapsed_seconds", 0) or 0 for event in models]
    final_durations = [event.get("elapsed_seconds", 0) or 0 for event in finals]
    return {
        "index": turn.get("index"), "status": run.get("status"),
        "wall_seconds": turn.get("elapsed", usage.get("elapsed_seconds")),
        "http_attempts": turn.get("http_attempts"),
        "main_model_calls_recorded": len(models),
        "main_model_elapsed_sum_seconds": round(sum(durations), 3),
        "final_generation_calls_recorded": len(finals),
        "final_generation_elapsed_sum_seconds": round(sum(final_durations), 3),
        "input_tokens_sum": sum(row.get("input_tokens", 0) or 0 for row in models),
        "peak_input_tokens": max((row.get("input_tokens", 0) or 0 for row in models), default=0),
        "output_tokens_sum": sum(row.get("output_tokens", 0) or 0 for row in models),
        "tools": {name: {"calls": len(values), "elapsed_sum_seconds": round(sum(values), 3)}
                  for name, values in sorted(tools.items())},
        "errors_by_tool": dict(Counter(errors)),
        # Existing runtime does not retain arguments for search_world, so do not
        # call its empty argument field a repeated identical query.
        "repeated_identical_recorded_reads": [
            {"tool": name, "calls": count}
            for (name, arguments), count in sorted(repeated.items())
            if arguments and count > 1],
    }


def summarize_report(path):
    report = json.loads(Path(path).read_text(encoding="utf-8"))
    return {"report": str(path), "case": report.get("case"), "label": report.get("label"),
            "model": report.get("model"), "provider_stream": report.get("provider_stream"),
            "turns": [summarize_turn(turn) for turn in report.get("turns", [])]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    paths = sorted({path for value in args.paths for path in
                    (value.rglob("results.json") if value.is_dir() else [value])})
    result = {"kind": "retained_trace_summary_no_model_call",
              "limits": ["Model time includes transport, thinking and output generation; those components are not separately observed.",
                         "Tool duration sums may overlap; do not subtract them from wall time as exclusive stages.",
                         "Search-model and embedding attempts are counted by the request ledger, not main-model timing events.",
                         "Missing timing events in a timed-out model invocation do not imply zero model time."],
              "reports": [summarize_report(path) for path in paths]}
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
