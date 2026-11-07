"""Versioned migrations; never replace a populated database with create_all."""

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from .config import ROOT


def upgrade_database(engine):
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    with engine.connect() as connection:
        tables = set(inspect(connection).get_table_names())
        if tables and engine.dialect.name == "sqlite" and engine.url.database not in {None, "", ":memory:"}:
            from pathlib import Path
            from datetime import datetime, timezone
            import sqlite3
            from alembic.script import ScriptDirectory
            from sqlalchemy import text
            current = connection.execute(text("SELECT version_num FROM alembic_version")).scalar() if "alembic_version" in tables else "unversioned"
            target = ScriptDirectory.from_config(config).get_current_head()
            connection.commit()
            if current != target:
                source = Path(engine.url.database).resolve()
                folder = source.parent / "backups"
                folder.mkdir(exist_ok=True)
                stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
                backup = folder / f"before-{current}-to-{target}-{stamp}.sqlite3"
                from contextlib import closing
                with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as reader:
                    with closing(sqlite3.connect(backup)) as writer:
                        reader.backup(writer)
        config.attributes["connection"] = connection
        if tables and "alembic_version" not in tables:
            # Only the exact known v0.2 layout may be adopted automatically.
            expected = {
                "users",
                "items",
                "item_profiles",
                "item_grants",
                "assets",
                "experiences",
                "memories",
                "sources",
                "conversations",
                "messages",
                "runs",
                "friendships",
                "gifts",
                "reminders",
            }
            if tables != expected or "product" not in {
                c["name"] for c in inspect(connection).get_columns("items")
            }:
                raise RuntimeError(
                    "Unversioned database is not the known v0.2 schema; manual migration required"
                )
            command.stamp(config, "0001")
            connection.commit()
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        command.upgrade(config, "head")
        connection.commit()
        if engine.dialect.name == "sqlite":
            failures = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()
            if failures:
                raise RuntimeError("Foreign-key check failed after migration")
