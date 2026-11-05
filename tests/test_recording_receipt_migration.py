"""A real pre-0008 message and its backup survive the additive receipt column."""
import sqlite3
import tempfile
import unittest
from contextlib import ExitStack, closing
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from wujian import domain
from wujian.api_models import ExperienceCreate, ItemCreate
from wujian.config import ROOT, Settings
from wujian.database import ChatMessage, make_database


class RecordingReceiptMigrationTests(unittest.TestCase):
    def test_old_messages_are_preserved_and_replay_receipts_survive_restart(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as resources:
            settings=Settings(data_dir=Path(directory));settings.prepare()
            legacy=create_engine(settings.database_url)
            resources.callback(legacy.dispose)
            config=Config(str(ROOT/'alembic.ini'))
            original='帮我记下：今天找到了围巾。🧣'
            with legacy.connect() as connection:
                config.attributes['connection']=connection
                command.upgrade(config,'0007')
                connection.execute(text("INSERT INTO users(id,username,display_name,password_hash) VALUES ('receipt-owner','receipt_owner','模拟记录者','offline-only-hash')"))
                connection.execute(text("INSERT INTO conversations(id,user_id,title,item_ids,agent_state,context_revision,reset_after,updated_at,entry_context) VALUES ('receipt-chat','receipt-owner','找回围巾','[]',NULL,0,'','2026-11-06','{}')"))
                connection.execute(text("INSERT INTO messages(id,conversation_id,role,text,run_id,photo_ids,created_at) VALUES ('receipt-question','receipt-chat','user',:text,NULL,'[]','2026-11-06')"),{'text':original})
                connection.commit()
            legacy.dispose()
            engine,sessions=make_database(settings)
            resources.callback(engine.dispose)
            with sessions() as db:
                question=db.get(ChatMessage,'receipt-question')
                self.assertEqual(question.text,original)
                self.assertEqual(question.recorded_experiences,{})
                item=domain.create_item(db,'receipt-owner',ItemCreate(name='外婆的围巾',kind='nonstandard_object'))
                record=domain.create_experience(db,'receipt-owner',ExperienceCreate(
                    title='找回围巾',text='今天找到了围巾。',item_ids=[item['id']],allow_ai=True),
                    source_message_id=question.id)
                receipts=dict(db.get(ChatMessage,question.id).recorded_experiences)
                self.assertEqual(list(receipts.values()),[record['id']])
            with engine.connect() as connection:
                self.assertEqual(connection.exec_driver_sql('PRAGMA foreign_key_check').fetchall(),[])
            engine.dispose()
            backups=list((Path(directory)/'backups').glob('before-0007-to-0008-*.sqlite3'))
            self.assertEqual(len(backups),1)
            with closing(sqlite3.connect(backups[0])) as backup:
                self.assertEqual(backup.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertEqual(backup.execute('SELECT text FROM messages WHERE id=?',('receipt-question',)).fetchone()[0],original)
                self.assertNotIn('recorded_experiences',[row[1] for row in backup.execute('PRAGMA table_info(messages)')])
            reopened,sessions=make_database(settings)
            resources.callback(reopened.dispose)
            try:
                with sessions() as db:
                    self.assertEqual(db.get(ChatMessage,'receipt-question').recorded_experiences,receipts)
                self.assertEqual(len(list((Path(directory)/'backups').glob('before-0007-to-0008-*.sqlite3'))),1)
                with reopened.connect() as connection:
                    config.attributes['connection']=connection
                    with self.assertRaisesRegex(RuntimeError,'verified pre-0008'):
                        command.downgrade(config,'0007')
                self.assertIn('recorded_experiences',[column['name'] for column in inspect(reopened).get_columns('messages')])
            finally:
                reopened.dispose()
