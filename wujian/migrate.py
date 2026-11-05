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
