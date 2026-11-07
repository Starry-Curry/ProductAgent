"""Repair visitor demo references without removing conversations or messages."""
import json
import copy
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import select
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Run, TaskRecord, User, make_database


def repair(settings):
    engine, sessions = make_database(settings)
    repaired_tasks = repaired_runs = moved_messages = reset_reports = 0
    try:
        with sessions.begin() as db:
            users = {user.id: user for user in db.scalars(select(User))
                     if re.match(r'^demo_[0-9a-f]{32}_', user.username)}
            conversations = {user_id: list(db.scalars(select(Conversation).where(Conversation.user_id == user_id)))
                             for user_id in users}
            for task in db.scalars(select(TaskRecord).where(TaskRecord.user_id.in_(users))):
                source = db.get(ChatMessage, task.source_message_id)
                origin = db.get(Conversation, source.conversation_id) if source else None
                if origin and origin.user_id == task.user_id:
                    continue
                target = next((chat for chat in conversations[task.user_id]
                               if (chat.entry_context or {}).get('task_id') == task.id), None)
                if target:
                    question = db.scalar(select(ChatMessage).where(ChatMessage.conversation_id == target.id,
                        ChatMessage.role == 'user').order_by(ChatMessage.created_at))
                    if question:
                        task.source_message_id = question.id
                        repaired_tasks += 1
            bad_runs = list(db.scalars(select(Run).join(Conversation, Run.conversation_id == Conversation.id)
                .where(Run.user_id.in_(users), Run.user_id != Conversation.user_id)))
            if any(run.status in {'queued', 'running'} for run in bad_runs):
                raise RuntimeError('Wait for affected runs to stop before repairing their conversation links')
            for run in bad_runs:
                namespace = users[run.user_id].username.split('_', 2)[1]
                target = db.get(Conversation, namespace + '_' + run.conversation_id)
                if target is None or target.user_id != run.user_id:
                    raise RuntimeError('Could not identify the private destination; no repairs committed')
                run.conversation_id = target.id
                for message in db.scalars(select(ChatMessage).where(ChatMessage.run_id == run.id)):
                    message.conversation_id = target.id
                    moved_messages += 1
                repaired_runs += 1
            for task in db.scalars(select(TaskRecord).where(TaskRecord.user_id.in_(users))):
                plan = copy.deepcopy(task.plan or {})
                progress = plan.get('guidance') or {}
                failed = []
                for report in progress.get('observations', []):
                    run = db.get(Run, report.get('run_id', ''))
                    if run and run.user_id == task.user_id and run.status == 'failed' and run.error == '步骤反馈必须来自当前教学对话':
                        failed.append(report)
                if not failed:
                    continue
                progress.setdefault('recovered_reports', []).extend(failed)
                progress['observations'] = [report for report in progress['observations'] if report not in failed]
                progress.update(active_step_id=failed[0]['step_id'], awaiting_reply=False)
                for entry in plan.get('entries', []):
                    if any(entry['id'] == report['step_id'] for report in failed):
                        entry.update(state='pending', updated_by=None)
                        if entry.get('guidance'):
                            entry['guidance'].update(observed_quote='', observed_message_id=None)
                task.plan, task.version = plan, task.version + 1
                reset_reports += len(failed)
        return {'repaired_tasks': repaired_tasks, 'repaired_runs': repaired_runs, 'moved_messages': moved_messages, 'reset_failed_reports':reset_reports}
    finally:
        engine.dispose()


if __name__ == '__main__':
    settings = Settings.load()
    settings.prepare()
    database = settings.data_dir / 'wujian.sqlite3'
    if settings.database_url != 'sqlite:///' + database.as_posix():
        raise SystemExit('This repair only supports the default SQLite file; back up and repair custom databases separately.')
    backup = settings.data_dir / 'backups' / ('before-demo-link-repair-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.sqlite3')
    backup.parent.mkdir(exist_ok=True)
    with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    print(json.dumps(repair(settings)))
