"""Real historical SQLite data and verified backups survive additive migrations."""
import json
import shutil
import sqlite3
import tempfile
import unittest
from contextlib import ExitStack, closing
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
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
                    title='找回围巾',text='今天找到了围巾。',item_ids=[item['id']],allow_ai=False),
                    source_message_id=question.id)
                receipts=dict(db.get(ChatMessage,question.id).recorded_experiences)
                self.assertEqual(list(receipts.values()),[record['id']])
            with engine.connect() as connection:
                self.assertEqual(connection.exec_driver_sql('PRAGMA foreign_key_check').fetchall(),[])
            engine.dispose()
            head=ScriptDirectory.from_config(config).get_current_head()
            backups=list((Path(directory)/'backups').glob(f'before-0007-to-{head}-*.sqlite3'))
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
                self.assertEqual(len(list((Path(directory)/'backups').glob(f'before-0007-to-{head}-*.sqlite3'))),1)
                with reopened.connect() as connection:
                    config.attributes['connection']=connection
                    with self.assertRaisesRegex(RuntimeError,'pre-(?:000[89]|0010)'):
                        command.downgrade(config,'0007')
                self.assertIn('recorded_experiences',[column['name'] for column in inspect(reopened).get_columns('messages')])
            finally:
                reopened.dispose()

    def test_0009_retains_shared_child_rows_receipts_and_photo_references(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as resources:
            settings=Settings(data_dir=Path(directory));settings.prepare()
            legacy=create_engine(settings.database_url)
            resources.callback(legacy.dispose)
            config=Config(str(ROOT/'alembic.ini'))
            config.set_main_option('script_location',str(ROOT/'migrations'))
            original='第一次一起点亮台灯，爸爸拍了这张照片。'
            receipt={'existing-recording-key':'existing-experience'}
            with legacy.connect() as connection:
                connection.exec_driver_sql('PRAGMA foreign_keys=ON')
                connection.commit()
                config.attributes['connection']=connection
                command.upgrade(config,'0008')
                for identity in ['author','recipient']:
                    connection.execute(text("INSERT INTO users(id,username,display_name,password_hash,preferences) VALUES (:id,:id,:id,'offline-only-hash','{}')"),{'id':identity})
                connection.execute(text("INSERT INTO assets(id,owner_id,path,media_type,original_name) VALUES ('existing-photo','author','unchanged-photo.jpg','image/jpeg','台灯.jpg')"))
                connection.execute(text("INSERT INTO conversations(id,user_id,title,item_ids,agent_state,context_revision,reset_after,updated_at,entry_context) VALUES ('old-chat','author','台灯','[]',NULL,0,'','2026-11-06','{}')"))
                connection.execute(text("INSERT INTO messages(id,conversation_id,role,text,run_id,photo_ids,created_at,recorded_experiences) VALUES ('old-message','old-chat','user',:body,NULL,:photos,'2026-11-06',:receipts)"),
                    {'body':original,'photos':json.dumps(['existing-photo']),'receipts':json.dumps(receipt)})
                connection.execute(text("INSERT INTO experiences(id,creator_id,title,text,item_ids,item_labels,photo_ids,occurred_on,origin_id,provenance,created_at,version,allow_ai) VALUES ('existing-experience','author','一起读书',:body,:items,:labels,:photos,'2026-11-06',NULL,:provenance,'2026-11-06',3,1)"),
                    {'body':original,'items':json.dumps(['mijia-lamp']),
                     'labels':json.dumps({'mijia-lamp':'米家台灯1S MJTD01SYL'},ensure_ascii=False),
                     'photos':json.dumps(['existing-photo']),
                     'provenance':json.dumps({'kind':'authored_record','author_id':'author'})})
                connection.execute(text("INSERT INTO experience_shares(experience_id,user_id) VALUES ('existing-experience','recipient')"))
                connection.commit()
                before=connection.execute(text("SELECT * FROM experiences WHERE id='existing-experience'")).mappings().one()
                original_columns=dict(before)
            legacy.dispose()
            engine,sessions=make_database(settings)
            resources.callback(engine.dispose)
            with engine.connect() as connection:
                after=dict(connection.execute(text("SELECT * FROM experiences WHERE id='existing-experience'")).mappings().one())
                self.assertIsNone(after.pop('household_id'))
                self.assertEqual(after,original_columns)
                self.assertEqual(connection.exec_driver_sql('SELECT experience_id,user_id FROM experience_shares').fetchall(),[('existing-experience','recipient')])
                self.assertEqual(json.loads(connection.exec_driver_sql("SELECT recorded_experiences FROM messages WHERE id='old-message'").scalar()),receipt)
                self.assertEqual(connection.exec_driver_sql('PRAGMA foreign_key_check').fetchall(),[])
                self.assertEqual(connection.exec_driver_sql("SELECT path FROM assets WHERE id='existing-photo'").scalar(),'unchanged-photo.jpg')
            head=ScriptDirectory.from_config(config).get_current_head()
            backups=list((Path(directory)/'backups').glob(f'before-0008-to-{head}-*.sqlite3'))
            self.assertEqual(len(backups),1)
            with closing(sqlite3.connect(backups[0])) as backup:
                self.assertEqual(backup.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertEqual(backup.execute('PRAGMA foreign_key_check').fetchall(),[])
                self.assertNotIn('household_id',[row[1] for row in backup.execute('PRAGMA table_info(experiences)')])
                self.assertEqual(backup.execute('SELECT text FROM experiences').fetchone()[0],original)
                self.assertEqual(backup.execute('SELECT experience_id,user_id FROM experience_shares').fetchall(),[('existing-experience','recipient')])
                self.assertEqual(json.loads(backup.execute('SELECT recorded_experiences FROM messages').fetchone()[0]),receipt)
            restored_settings=Settings(data_dir=Path(directory)/'restore-verification')
            restored_settings.prepare()
            shutil.copy2(backups[0],restored_settings.data_dir/'wujian.sqlite3')
            restored,_=make_database(restored_settings)
            resources.callback(restored.dispose)
            with restored.connect() as connection:
                self.assertEqual(connection.exec_driver_sql('SELECT experience_id,user_id FROM experience_shares').fetchall(),[('existing-experience','recipient')])
                self.assertEqual(connection.exec_driver_sql('SELECT text FROM experiences').scalar(),original)
                self.assertEqual(connection.exec_driver_sql('PRAGMA foreign_key_check').fetchall(),[])
            restored.dispose()
            engine.dispose()
            reopened,_=make_database(settings)
            resources.callback(reopened.dispose)
            self.assertEqual(len(list((Path(directory)/'backups').glob(f'before-0008-to-{head}-*.sqlite3'))),1)
