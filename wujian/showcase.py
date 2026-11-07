"""Load the explicitly published showcase into a new demo database only."""
import hashlib
import json
import re
import secrets
from pathlib import Path

from pwdlib import PasswordHash
from sqlalchemy import select

from .config import ROOT
from .database import Base


EXCLUDED_TABLES = {"runs", "device_targets", "device_observations"}
DEMO_USERNAMES = {"xiaolin", "xiaoxia", "xiaolin_mom_demo", "xiaolin_grandpa_demo"}
DEMO_SEED_REVISION = '2026-11-07-clean-start-2'


def fresh_demo_rows(rows):
    """Keep completed showcase responses and reset interactive exercise progress."""
    kept_chats, kept_messages = [], []
    for chat in rows.get('conversations', []):
        messages = [m for m in rows.get('messages', []) if m['conversation_id'] == chat['id']]
        good = [i for i, m in enumerate(messages) if m['role'] == 'assistant' and m.get('text', '').strip()
                and not m['text'].startswith(('模型调用失败', '请求失败', '未配置', '服务未配置'))]
        if not good or chat.get('title') == '你好' or '开发联调' in chat.get('title', '') or chat.get('title') == '我身边现在哦独有写啥呀':
            continue
        end = good[0] if '烫印机' in chat.get('title', '') else good[-1]
        kept_chats.append(chat)
        kept_messages.extend(messages[:end + 1])
    rows['conversations'], rows['messages'] = kept_chats, kept_messages
    kept_ids = {message['id'] for message in kept_messages}
    for task in rows.get('tasks', []):
        if task.get('source_message_id') not in kept_ids:
            conversation = next((chat for chat in kept_chats if chat.get('entry_context', {}).get('task_id') == task['id']), None)
            first_question = next((message for message in kept_messages if conversation and message['conversation_id'] == conversation['id'] and message['role'] == 'user'), None)
            task['source_message_id'] = first_question['id'] if first_question else 'published-demo-seed:' + task['id']
        plan = task.get('plan', {})
        if plan.get('schema') == 'workbench/1':
            continue  # Published tools are finished artifacts, not exercise progress.
        entries = plan.get('entries', [])
        task['feedback'], task['version'] = [], 1
        for entry in entries:
            entry.update(state='pending', updated_by=None)
            guide = entry.get('guidance')
            if guide:
                guide.update(observed_quote='', observed_message_id=None)
        progress = plan.get('guidance')
        if progress is not None and entries:
            progress.update(active_step_id=entries[0]['id'], observations=[], awaiting_reply=False)
            lesson = progress.get('lesson')
            if lesson:
                lesson.update(phase='waiting', inputs={}, handled_messages=[])
            task['status'] = 'in_progress'
    return rows


def import_showcase(db, settings, bundle=None, namespace=None):
    """Import the published seed once; namespace creates a visitor's private identities."""
    bundle = Path(bundle or ROOT / "demo/showcase").resolve()
    catalog = bundle / "catalog.json"
    if not catalog.is_file():
        return False
    tables = Base.metadata.tables
    if namespace is not None and not re.fullmatch(r"[0-9a-f]{32}", namespace):
        raise ValueError("Invalid demo visitor identity")
    if namespace is None and any(db.execute(select(table).limit(1)).first() is not None for table in tables.values()):
        return False
    data = json.loads(catalog.read_text(encoding="utf-8"))
    if data.get("schema") != "wujian-showcase/1" or data.get("schema_revision") != "0009":
        raise ValueError("Unsupported showcase format or database revision")
    rows = data["tables"]
    if namespace:
        rows = fresh_demo_rows(rows)
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
    identities = {row['id']: ('person_demo_' if name == 'users' else '') + namespace + '_' + row['id']
                  for name, records in rows.items() for row in records if 'id' in row} if namespace else {}
    pattern = re.compile(r'(?<![A-Za-z0-9_-])(?:' + '|'.join(re.escape(k) for k in sorted(identities, key=len, reverse=True)) + r')(?![A-Za-z0-9_-])') if identities else None
    def remap(value):
        if isinstance(value, str):
            return pattern.sub(lambda match: identities[match.group()], value) if pattern else value
        if isinstance(value, list):
            return [remap(entry) for entry in value]
        if isinstance(value, dict):
            return {remap(key): remap(entry) for key, entry in value.items()}
        return value
    if namespace:
        owner = next((row for row in rows.get('users', []) if row['username'] == 'xiaolin'), None)
        if owner is None:
            raise ValueError('Showcase is missing the demo owner')
        users = tables['users']
        if db.execute(select(users).where(users.c.id == identities[owner['id']])).first():
            return False
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
        if namespace and row['media_type'].endswith('+json'):
            raw = json.dumps(remap(json.loads(raw)), ensure_ascii=False).encode('utf-8')
        target = settings.data_dir.resolve() / "assets" / ("showcase-" + hashlib.sha256(raw).hexdigest() + source.suffix)
        if target.exists() and target.read_bytes() != raw:
            raise ValueError("Existing showcase asset differs; it was not overwritten")
        prepared[remap(row["id"])] = (raw, target)
    created = []
    try:
        with db.begin_nested():
            for raw, target in prepared.values():
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    # Exclusive creation makes concurrent startup fail instead of clobbering files.
                    with target.open("xb") as output:
                        created.append(target)
                        output.write(raw)
            for table in Base.metadata.sorted_tables:
                pending = [remap(dict(row)) for row in rows.get(table.name, [])]
                if table.name == "users":
                    for row in pending:
                        if namespace:
                            row['username'] = 'demo_' + namespace + '_' + row['username']
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
