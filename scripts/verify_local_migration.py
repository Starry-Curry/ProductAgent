"""Back up the current local SQLite database and verify every legacy row survives."""

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from wujian.config import Settings
from wujian.database import make_database


def snapshot(path, normalized):
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        tables = [
            r[0]
            for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
            if r[0]
            not in {
                "alembic_version",
                "products",
                "knowledge_claims",
                "tasks",
                "device_targets",
                "device_observations",
            }
        ]
        result = {}
        for table in tables:
            rows = []
            for original in db.execute('SELECT * FROM "' + table + '"'):
                row = dict(original)
                if table == "items" and normalized:
                    product = db.execute(
                        "SELECT spec FROM products WHERE id=?", (row.pop("product_id"),)
                    ).fetchone()
                    notes = json.loads(row.get("identity_notes", "{}"))
                    row["product"] = json.dumps(notes if notes else json.loads(product[0]) if product else {})
                    row.pop("identity_notes", None)
                if table == "items":
                    row["product"] = json.loads(row["product"])
                if table == "memories" and normalized:
                    row.pop("supersedes_id")
                    row.pop("expires_at")
                    row.pop("attributes", None)
                if table == "sources":
                    row.pop("origin", None)
                if table == "experiences":
                    row.pop("provenance", None)  # added metadata; original columns must match
                rows.append(json.dumps(row, sort_keys=True, ensure_ascii=False))
            result[table] = sorted(rows)
        return result


settings = Settings.load()
settings.prepare()
if not settings.database_url.startswith("sqlite:///"):
    raise RuntimeError("This verification applies to local SQLite only")
path = Path(settings.database_url.removeprefix("sqlite:///"))
backup = (
    settings.data_dir
    / "backups"
    / ("pre-v03-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".sqlite3")
)
backup.parent.mkdir(exist_ok=True)
with sqlite3.connect(path) as source, sqlite3.connect(backup) as target:
    source.backup(target)
with sqlite3.connect(path) as db:
    normalized = "product_id" in [r[1] for r in db.execute("PRAGMA table_info(items)")]
before = snapshot(backup, normalized)
engine, sessions = make_database(settings)
engine.dispose()
after = snapshot(path, True)
if before != after:
    raise RuntimeError(
        "Legacy row mismatch; preserve backup and inspect before continuing"
    )
print(
    json.dumps(
        {
            "verified": True,
            "backup": str(backup),
            "preserved_counts": {key: len(rows) for key, rows in after.items()},
        },
        ensure_ascii=True,
    )
)
