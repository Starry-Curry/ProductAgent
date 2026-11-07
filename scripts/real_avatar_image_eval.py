"""Explicit paid-provider check of the app's photo-to-avatar implementation.

Never imported by CI. Requires an intentional CLI invocation and configured
Bailian credentials. User-provided photos and results stay in a private folder.
"""
import argparse
import asyncio
import json
import time
from pathlib import Path

from wujian.avatar_images import generate_avatar_image
from wujian.config import Settings


async def run(args):
    settings = Settings.load()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    record = {"source": str(args.source.resolve()), "item_name": args.name,
              "evidence": "real provider generation; appearance reviewed separately"}
    try:
        generated, metadata = await generate_avatar_image(settings, args.source.read_bytes(),
            item_name=args.name)
        path = output / "portrait.png"
        path.write_bytes(generated)
        record.update(status="generated", output=str(path), **metadata)
    except Exception as error:
        record.update(status="failed", error=str(error),
            cause_type=type(error.__cause__).__name__ if error.__cause__ else "")
    record["elapsed_seconds"] = round(time.monotonic() - started, 2)
    (output / "result.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False))
    return 0 if record["status"] == "generated" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--output", required=True, type=Path)
    raise SystemExit(asyncio.run(run(parser.parse_args())))
