"""Publication boundaries are independent of the main private database."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from wujian.database import Asset, Base, ChatMessage, Conversation, ItemRecord, User

spec = importlib.util.spec_from_file_location('export_showcase', Path(__file__).resolve().parents[1]/'scripts/export_showcase.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ShowcaseExportTests(unittest.TestCase):
    def test_scrubbing_preserves_public_urls_and_removes_local_identity(self):
        value = exporter.scrub({'url':'https://www.example.org/manual.pdf','text':'C:\\Users\\person\\secret\n设备 AA:BB:CC:DD:EE:FF','api_key':'not-published'})
        self.assertEqual(value['url'], 'https://www.example.org/manual.pdf')
        self.assertNotIn('api_key', value)
        self.assertNotIn('person', value['text'])
        self.assertNotIn('AA:BB:CC:DD:EE:FF', value['text'])

    def test_only_demo_facts_are_exported_and_workbench_bytes_remain_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root/'source.sqlite3'
            engine = create_engine('sqlite:///'+str(database))
            Base.metadata.create_all(engine)
            raw = b'{"html":"<p>demo</p>","css":"","javascript":""}'
            source = root/'source.json'
            source.write_bytes(raw)
            with Session(engine) as db:
                for identity in ['person_demo_owner','person_demo_friend','private_user']:
                    db.add(User(id=identity,username=identity,display_name=identity,password_hash='PRIVATE_HASH',preferences={}))
                db.commit()
                db.add(Asset(id='source_asset',owner_id='person_demo_owner',path=str(source),media_type='application/vnd.wujian.workbench+json',original_name='source.json'))
                db.add(ItemRecord(id='demo_item',owner_id='person_demo_owner',name='演示相机',state={'source_asset':'source_asset'}))
                db.add(ItemRecord(id='private_item',owner_id='private_user',name='不可发布'))
                db.add(Conversation(id='demo_chat',user_id='person_demo_owner',agent_state={'api_key':'PRIVATE'},title='演示对话'))
                db.commit()
                db.add(ChatMessage(id='message',conversation_id='demo_chat',role='user',text='为耳机做个面板',run_id='private-run'))
                db.commit()
            engine.dispose()
            output = root/'bundle'
            exporter.export(database, output)
            bundle = json.loads((output/'catalog.json').read_text(encoding='utf-8'))
            self.assertEqual({row['id'] for row in bundle['tables']['users']}, exporter.DEMO_IDS)
            self.assertEqual([row['id'] for row in bundle['tables']['items']], ['demo_item'])
            self.assertIsNone(bundle['tables']['conversations'][0]['agent_state'])
            self.assertIsNone(bundle['tables']['messages'][0]['run_id'])
            self.assertNotIn('PRIVATE_HASH', (output/'catalog.json').read_text(encoding='utf-8'))
            asset = bundle['assets_manifest'][0]
            self.assertEqual((output/asset['path']).read_bytes(), raw)
            self.assertEqual(asset['sha256'], hashlib.sha256(raw).hexdigest())


if __name__ == '__main__':
    unittest.main()
