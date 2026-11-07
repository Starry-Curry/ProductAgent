"""Load the explicitly published showcase into a new demo database only."""
import hashlib
import json
import secrets
import shutil
from pathlib import Path

from pwdlib import PasswordHash
from sqlalchemy import select

from .config import ROOT
from .database import Base


EXCLUDED_TABLES = {"runs", "device_targets", "device_observations"}
DEMO_USERNAMES = {"xiaolin", "xiaoxia", "xiaolin_mom_demo", "xiaolin_grandpa_demo"}


def import_showcase(db, settings, bundle=None):
    """Return False for absent bundles or existing data; never merge into a user's DB."""
    bundle = Path(bundle or ROOT / "demo/showcase").resolve()
    catalog = bundle / "catalog.json"
    if not catalog.is_file():
        return False
    tables = Base.metadata.tables
    if any(db.execute(select(table).limit(1)).first() is not None for table in tables.values()):
        return False
    data = json.loads(catalog.read_text(encoding="utf-8"))
    if data.get("schema") != "wujian-showcase/1" or data.get("schema_revision") != "0009":
        raise ValueError("Unsupported showcase format or database revision")
    rows = data["tables"]
    if not set(rows) <= set(tables) - EXCLUDED_TABLES:
        raise ValueError("Showcase contains an unsupported or runtime-only table")
    for name, records in rows.items():
        for row in records:
            if not set(row) <= set(tables[name].columns.keys()):
                raise ValueError("Showcase contains unknown columns")
            if name == "users" and ("password_hash" in row or row.get("username") not in DEMO_USERNAMES):
                raise ValueError("Showcase must contain only public demo identities without credentials")
            if name == "conversations" and row.get("agent_state") is not None:
                raise ValueError("Showcase cannot restore private runtime state")
            if name == "messages" and row.get("run_id") is not None:
                raise ValueError("Showcase cannot restore runtime records")
    manifest = {row["id"]: row for row in data["assets_manifest"]}
    if set(manifest) != {row["id"] for row in rows.get("assets", [])}:
        raise ValueError("Showcase asset manifest does not match business assets")
    prepared = {}
    for row in rows.get("assets", []):
        entry = manifest[row["id"]]
        relative = Path(row["path"])
        source = (bundle / relative).resolve()
        if relative.is_absolute() or not source.is_relative_to(bundle) or row["path"] != entry["path"]:
            raise ValueError("Showcase asset path escapes its bundle")
        raw = source.read_bytes()
        if len(raw) != entry["size"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Showcase asset integrity check failed")
        # Content-derived names never interpret an exported id as a filesystem path.
        target = settings.data_dir.resolve() / "assets" / ("showcase-" + entry["sha256"] + source.suffix)
        if target.exists() and target.read_bytes() != raw:
            raise ValueError("Existing showcase asset differs; it was not overwritten")
        prepared[row["id"]] = (source, target)
    created = []
    try:
        with db.begin_nested():
            for source, target in prepared.values():
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    # Exclusive creation makes concurrent startup fail instead of clobbering files.
                    with target.open("xb") as output, source.open("rb") as original:
                        created.append(target)
                        shutil.copyfileobj(original, output)
            for table in Base.metadata.sorted_tables:
                pending = [dict(row) for row in rows.get(table.name, [])]
                if table.name == "users":
                    for row in pending:
                        row["password_hash"] = PasswordHash.recommended().hash(secrets.token_urlsafe(48))
                if table.name == "assets":
                    for row in pending:
                        row["path"] = str(prepared[row["id"]][1])
                # Respect self-references such as Memory.supersedes_id, regardless of export order.
                self_refs = [fk for fk in table.foreign_keys if fk.column.table is table]
                while pending:
                    ready = [row for row in pending if all(
                        row.get(fk.parent.name) is None or db.execute(select(table).where(
                            fk.column == row[fk.parent.name])).first() is not None for fk in self_refs)]
                    if not ready:
                        raise ValueError("Showcase contains cyclic or missing self references")
                    for row in ready:
                        db.execute(table.insert().values(**row))
                        pending.remove(row)
    except BaseException:
        for target in created:
            target.unlink(missing_ok=True)
        raise
    return True
