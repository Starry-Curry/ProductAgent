"""Published photos/history boot on a new install without overwriting local data."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from wujian.config import Settings
from wujian.database import Asset, ChatMessage, ItemRecord, ProductRecord, User, make_database
from wujian.server import create_app
from wujian.showcase import import_showcase


class ShowcaseImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / 'demo/showcase'
        self.bundle.mkdir(parents=True)
        (self.bundle / 'media').mkdir()
        self.raw = b'public demonstration image bytes'
        (self.bundle / 'media/photo.jpg').write_bytes(self.raw)
        self.data = {'schema':'wujian-showcase/1','schema_revision':'0009', 'tables':{
            'users':[{'id':'person_demo_owner','username':'xiaolin','display_name':'小林','preferences':{}}],
            'assets':[{'id':'photo','owner_id':'person_demo_owner','path':'media/photo.jpg','media_type':'image/jpeg','original_name':'camera.jpg'}],
            'items':[{'id':'camera','owner_id':'person_demo_owner','name':'佳能EOS R5','kind':'standard_product','photo_id':'photo'}],
            'conversations':[{'id':'chat','user_id':'person_demo_owner','title':'相机怎么用','agent_state':None}],
            'messages':[{'id':'message','conversation_id':'chat','role':'user','text':'这台相机怎么拍延时？','run_id':None}],
        },'assets_manifest':[{'id':'photo','path':'media/photo.jpg','size':len(self.raw),'sha256':hashlib.sha256(self.raw).hexdigest(),'media_type':'image/jpeg'}]}
        self.write()
        self.settings = Settings(data_dir=self.root/'var', api_key='', rea_enabled=False)
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        self.addCleanup(self.engine.dispose)

    def write(self):
        (self.bundle/'catalog.json').write_text(json.dumps(self.data,ensure_ascii=False),encoding='utf-8')

    def test_portable_photo_and_history_import_once_then_preserve_local_edits(self):
        with self.sessions() as db:
            self.assertTrue(import_showcase(db,self.settings,self.bundle))
            db.commit()
            user = db.get(User,'person_demo_owner')
            self.assertTrue(user.password_hash)
            self.assertNotIn('password_hash',self.data['tables']['users'][0])
            asset = db.get(Asset,'photo')
            self.assertTrue(Path(asset.path).is_relative_to(self.settings.data_dir))
            self.assertEqual(Path(asset.path).read_bytes(),self.raw)
            self.assertEqual(db.get(ChatMessage,'message').text,'这台相机怎么拍延时？')
            db.get(ItemRecord,'camera').name='我的相机新名字'
            db.commit()
            self.assertFalse(import_showcase(db,self.settings,self.bundle))
            self.assertEqual(db.get(ItemRecord,'camera').name,'我的相机新名字')

    def test_existing_partial_database_is_not_a_new_install(self):
        with self.sessions() as db:
            db.add(ProductRecord(id='existing',spec={'model':'EOS R5'})); db.commit()
            self.assertFalse(import_showcase(db,self.settings,self.bundle))
            self.assertIsNone(db.get(User,'person_demo_owner'))

    def test_hash_failure_and_path_escape_do_not_write_rows_or_files(self):
        for change in ('hash','path'):
            with self.subTest(change=change):
                self.data['assets_manifest'][0]['sha256']='0'*64 if change=='hash' else hashlib.sha256(self.raw).hexdigest()
                if change=='path':
                    self.data['tables']['assets'][0]['path']='../outside.jpg'
                    self.data['assets_manifest'][0]['path']='../outside.jpg'
                self.write()
                with self.sessions() as db, self.assertRaises(ValueError):
                    import_showcase(db,self.settings,self.bundle)
                with self.sessions() as db:
                    self.assertIsNone(db.get(User,'person_demo_owner'))
                self.assertEqual(list((self.settings.data_dir/'assets').iterdir()),[])

    def test_insert_failure_rolls_back_rows_and_removes_only_new_asset(self):
        self.data['tables']['items'][0]['owner_id']='missing-user'; self.write()
        retained=self.settings.data_dir/'assets/existing.txt'; retained.write_text('keep')
        with self.sessions() as db, self.assertRaises(Exception):
            import_showcase(db,self.settings,self.bundle)
        with self.sessions() as db:
            self.assertIsNone(db.get(User,'person_demo_owner'))
        self.assertEqual([p.name for p in retained.parent.iterdir()],['existing.txt'])

    def test_existing_asset_is_never_overwritten(self):
        digest=hashlib.sha256(self.raw).hexdigest()
        target=self.settings.data_dir/'assets'/('showcase-'+digest+'.jpg')
        target.write_bytes(b'local file must survive')
        with self.sessions() as db, self.assertRaises(ValueError):
            import_showcase(db,self.settings,self.bundle)
        self.assertEqual(target.read_bytes(),b'local file must survive')
        with self.sessions() as db:
            self.assertIsNone(db.get(User,'person_demo_owner'))

    def test_runtime_and_credentials_are_rejected(self):
        for field in ('password','runs','state'):
            with self.subTest(field=field):
                self.data['tables']['users'][0].pop('password_hash',None)
                self.data['tables'].pop('runs',None)
                self.data['tables']['conversations'][0]['agent_state']=None
                if field=='password': self.data['tables']['users'][0]['password_hash']='old-secret'
                if field=='runs': self.data['tables']['runs']=[]
                if field=='state': self.data['tables']['conversations'][0]['agent_state']={'private':'runtime'}
                self.write()
                with self.sessions() as db, self.assertRaises(ValueError):
                    import_showcase(db,self.settings,self.bundle)

    def test_demo_app_starts_with_published_history_and_restart_keeps_it(self):
        self.engine.dispose()
        settings=Settings(data_dir=self.root/'boot',api_key='',rea_enabled=False,showcase_enabled=True)
        with patch('wujian.showcase.ROOT',self.root):
            for _ in range(2):
                with TestClient(create_app(settings)) as client:
                    self.assertEqual(client.post('/api/auth/demo/xiaolin').status_code,200)
                    items=client.get('/api/items').json()
                    self.assertEqual(len(items),1)
                    history=client.get('/api/conversations/chat/messages').json()
                    self.assertEqual([row['text'] for row in history],['这台相机怎么拍延时？'])


if __name__=='__main__':
    unittest.main()
