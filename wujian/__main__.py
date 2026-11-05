"""Offline validation and schema export for shared development fixtures."""

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from .contracts import DevelopmentCatalog


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate", help="Validate an explicit development catalog.")
    validate.add_argument("path", type=Path)
    schema = subparsers.add_parser("schema", help="Export the generated JSON Schema.")
    schema.add_argument("path", type=Path)
    serve = subparsers.add_parser("serve", help="Run the local Wujian application.")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    openapi = subparsers.add_parser("openapi", help="Export the actual application API contract.")
    openapi.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "serve":
            import uvicorn

            from .config import Settings
            from .server import create_app
            settings = Settings.load()
            uvicorn.run(create_app(settings), host=args.host or settings.host, port=args.port or settings.port)
        elif args.command == "openapi":
            from .config import ROOT, Settings
            from .server import create_app
            app = create_app(Settings(data_dir=ROOT / "tmp" / "schema-export",database_url='sqlite://', demo_mode=False))
            args.path.parent.mkdir(parents=True, exist_ok=True)
            args.path.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"OpenAPI exported to {args.path}")
        elif args.command == "validate":
            catalog = DevelopmentCatalog.model_validate_json(args.path.read_text(encoding="utf-8"))
            print(json.dumps({
                "status": "valid_development_fixture",
                "products": len(catalog.products),
                "items": len(catalog.items),
                "experiences": len(catalog.experiences),
                "real_model_or_device_acceptance": False,
            }, ensure_ascii=False))
        else:
            args.path.parent.mkdir(parents=True, exist_ok=True)
            args.path.write_text(
                json.dumps(DevelopmentCatalog.model_json_schema(), ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"Schema exported to {args.path}")
    except (OSError, ValidationError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
