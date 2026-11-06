"""Authenticated household/gift delivery journeys, with synthetic ownership.

Real domestic models and actual uploaded JPEG bytes exercise transport and SQL
permissions. Visual observations are injected; no provider/network is invoked.
"""
import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from wujian import domain, interactions
from wujian.config import Settings
from wujian.database import ExperienceRecord, HouseholdMember, Profile
from wujian.photo_matching import PhotoMatchRequest, VisualMatches, match_experience_photos
from wujian.server import create_app


class FamilyDeliveryHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings=Settings(data_dir=Path(self.temp.name),api_key='offline-no-provider',demo_mode=False,rea_enabled=False)
        self.app=create_app(self.settings)
        self.owner=TestClient(self.app).__enter__()
        self.addCleanup(self.owner.__exit__,None,None,None)
        self.mother=TestClient(self.app)
        self.third=TestClient(self.app)
        self.addCleanup(self.mother.close)
        self.addCleanup(self.third.close)
        self.users={}
        for key,client in [('daughter',self.owner),('mother',self.mother),('third',self.third)]:
            self.users[key]=self.ok(client.post('/api/auth/register',json={
                'username':key,'display_name':key,'password':'offline-test-password'}))['id']
        self.house=self.ok(self.owner.post('/api/households',json={'name':'共同的家'}))
        with self.app.state.sessions() as db:
            db.add(HouseholdMember(household_id=self.house['id'],user_id=self.users['mother'],status='active'))
            db.commit()

    def ok(self,response):
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def photo(self,color='blue'):
        image=io.BytesIO()
        Image.new('RGB',(24,24),color).save(image,'JPEG')
        return self.ok(self.owner.post('/api/assets',files={'file':('真实照片.jpg',image.getvalue(),'image/jpeg')}))['id']

    def item(self,photo=None,name='米家台灯1S',shared=True):
        item=self.ok(self.owner.post('/api/items',json={'name':name,'photo_id':photo,
            'product':{'brand':'米家','model':'MJTD01SYL','market':'CN'}}))
        if shared:
            self.ok(self.owner.post(f"/api/households/{self.house['id']}/items",json={'item_id':item['id']}))
        return item

    def story(self,item,photo,**changes):
        return self.ok(self.owner.post('/api/experiences',json={
            'title':'周日读书','text':'这一天妈妈陪我读完了一本书。',
            'item_ids':[item['id']],'photo_ids':[photo],**changes}))

    def gift(self):
        self.ok(self.owner.post('/api/friends',json={'username':'mother'}))
        self.ok(self.mother.post(f"/api/friends/{self.users['daughter']}/accept"))
        item_photo,story_photo=self.photo('red'),self.photo('green')
        item=self.item(item_photo,shared=False)
        story=self.story(item,story_photo)
        gift=self.ok(self.owner.post('/api/gifts',json={'item_id':item['id'],
            'recipient_id':self.users['mother'],'experience_ids':[story['id']],
            'avatar':{'enabled':True,'nickname':'小灯','personality':'温柔，喜欢一起读书'},
            'surprises':[{'experience_id':story['id'],'hint':'想知道那天为什么买这盏灯吗？','trigger_words':['读书']}] }))
        return item,story,gift,item_photo,story_photo

    def test_family_photo_requires_explicit_scope_and_immediate_revocation(self):
        item=self.item()
        private_photo,shared_photo=self.photo('red'),self.photo('green')
        self.story(item,private_photo)
        shared=self.story(item,shared_photo,household_id=self.house['id'])
        self.assertEqual(self.mother.get('/api/assets/'+private_photo).status_code,404)
        self.assertEqual(self.mother.get('/api/assets/'+shared_photo).status_code,200)
        self.assertEqual(self.third.get('/api/assets/'+shared_photo).status_code,404)
        payload={key:shared[key] for key in ['title','text','item_ids','photo_ids','occurred_on','allow_ai']}
        self.ok(self.owner.put('/api/experiences/'+shared['id'],json={**payload,
            'expected_version':shared['version'],'household_id':None}))
        self.assertEqual(self.mother.get('/api/assets/'+shared_photo).status_code,404)
        self.assertEqual(self.owner.get('/api/assets/'+shared_photo).status_code,200)

    def test_family_reminders_need_no_friendship_and_do_not_survive_other_household_access(self):
        item=self.item()
        body={'title':'妈妈，今天先把台灯调到低亮度','due_at':'2026-11-07T09:00:00+08:00',
              'assignee_id':self.users['mother'],'item_id':item['id'],'household_id':self.house['id']}
        reminder=self.ok(self.owner.post('/api/reminders',json=body))
        self.assertEqual(self.ok(self.owner.get('/api/friends')),[])
        self.assertIn(reminder['id'],{row['id'] for row in self.ok(self.mother.get('/api/reminders'))})
        self.assertEqual(self.third.post('/api/reminders',json=body).status_code,404)
        invalid={**body,'assignee_id':self.users['third']}
        self.assertEqual(self.owner.post('/api/reminders',json=invalid).status_code,404)
        other=self.ok(self.owner.post('/api/households',json={'name':'同一物品的另一个共享范围'}))
        with self.app.state.sessions() as db:
            db.add(HouseholdMember(household_id=other['id'],user_id=self.users['mother'],status='active'))
            db.commit()
        self.ok(self.owner.post(f"/api/households/{other['id']}/items",json={'item_id':item['id']}))
        self.ok(self.owner.post(f"/api/households/{self.house['id']}/items",json={'item_id':item['id'],'shared':False}))
        self.assertEqual(self.mother.get('/api/items/'+item['id']).status_code,200)
        self.assertNotIn(reminder['id'],{row['id'] for row in self.ok(self.mother.get('/api/reminders'))})
        self.assertEqual(self.mother.post(f"/api/reminders/{reminder['id']}/feedback",json={'expected_version':1,'action':'read'}).status_code,403)
        self.assertEqual(self.owner.post('/api/reminders',json=body).status_code,400)
        self.ok(self.owner.post(f"/api/households/{self.house['id']}/items",json={'item_id':item['id']}))
        self.ok(self.owner.delete(f"/api/households/{self.house['id']}/members/{self.users['mother']}"))
        self.assertEqual(self.mother.get('/api/items/'+item['id']).status_code,200)
        self.assertNotIn(reminder['id'],{row['id'] for row in self.ok(self.mother.get('/api/reminders'))})

    def test_gift_preview_photos_are_participant_only_and_accept_true_is_idempotent(self):
        item,story,gift,item_photo,story_photo=self.gift()
        for photo in [item_photo,story_photo]:
            self.assertEqual(self.mother.get('/api/assets/'+photo).status_code,200)
            self.assertEqual(self.third.get('/api/assets/'+photo).status_code,404)
        self.assertNotIn(gift['id'],{row['id'] for row in self.ok(self.third.get('/api/gifts'))})
        self.assertNotIn(gift['id'],{row['id'] for row in self.ok(self.third.get('/api/workspace'))['gifts']})
        self.assertEqual(self.third.post(f"/api/gifts/{gift['id']}/accept",json={'wake_avatar':True,'allow_story_ai':True}).status_code,404)
        self.ok(self.mother.post(f"/api/gifts/{gift['id']}/accept",json={'wake_avatar':True,'allow_story_ai':True}))
        received_item=self.ok(self.mother.get('/api/items/'+item['id']))
        self.assertTrue(received_item['avatar']['enabled'])
        self.assertNotEqual(received_item['photo_id'],item_photo)
        self.assertEqual(self.mother.get('/api/assets/'+received_item['photo_id']).status_code,200)
        with self.app.state.sessions() as db:
            received=db.scalar(select(ExperienceRecord).where(ExperienceRecord.creator_id==self.users['mother'],ExperienceRecord.origin_id==story['id']))
            self.assertTrue(received.allow_ai)
            received_id=received.id
            received_photo=received.photo_ids[0]
            self.assertNotEqual(received_photo,story_photo)
            count=db.scalar(select(func.count()).select_from(ExperienceRecord))
        self.assertEqual(self.mother.get('/api/assets/'+received_photo).status_code,200)
        self.assertEqual(self.third.get('/api/assets/'+received_photo).status_code,404)
        self.ok(self.mother.request('DELETE','/api/experiences/'+received_id,json={'expected_version':1}))
        with self.app.state.sessions() as db:
            profile=db.get(Profile,(self.users['mother'],item['id']))
            profile.avatar={**profile.avatar,'enabled':False}
            db.commit()
        self.ok(self.mother.post(f"/api/gifts/{gift['id']}/accept",json={'wake_avatar':True,'allow_story_ai':True}))
        with self.app.state.sessions() as db:
            self.assertIsNone(db.get(ExperienceRecord,received_id))
            self.assertEqual(db.scalar(select(func.count()).select_from(ExperienceRecord)),count-1)
        self.assertFalse(self.ok(self.mother.get('/api/items/'+item['id']))['avatar']['enabled'])

    def test_gift_accept_false_cannot_be_upgraded_by_a_repeated_request(self):
        item,story,gift,_,_=self.gift()
        self.ok(self.mother.post(f"/api/gifts/{gift['id']}/accept",json={'wake_avatar':False,'allow_story_ai':False}))
        self.ok(self.mother.post(f"/api/gifts/{gift['id']}/accept",json={'wake_avatar':True,'allow_story_ai':True}))
        self.assertFalse(self.ok(self.mother.get('/api/items/'+item['id']))['avatar']['enabled'])
        with self.app.state.sessions() as db:
            records=db.scalars(select(ExperienceRecord).where(ExperienceRecord.creator_id==self.users['mother'],ExperienceRecord.origin_id==story['id'])).all()
            self.assertEqual(len(records),1)
            self.assertFalse(records[0].allow_ai)

    def test_cancelled_gift_withdraws_preview_photo_access(self):
        _,_,gift,item_photo,story_photo=self.gift()
        self.assertEqual(self.mother.get('/api/assets/'+story_photo).status_code,200)
        self.ok(self.owner.post(f"/api/gifts/{gift['id']}/decision",json={'action':'cancel'}))
        for photo in [item_photo,story_photo]:
            self.assertEqual(self.mother.get('/api/assets/'+photo).status_code,404)
        self.assertEqual(self.mother.post(f"/api/gifts/{gift['id']}/accept",json={'wake_avatar':True,'allow_story_ai':True}).status_code,409)

    def test_family_photo_recognition_only_compares_current_household_inventory(self):
        family=self.item(self.photo('blue'))
        other_family=self.item(self.photo('yellow'),name='家庭备用台灯')
        private=self.item(self.photo('purple'),shared=False,name='私人台灯')
        story=self.story(family,self.photo('white'),household_id=self.house['id'])
        observer=AsyncMock(return_value=VisualMatches())
        result=asyncio.run(match_experience_photos(self.settings,self.app.state.sessions,self.users['daughter'],
            story['id'],PhotoMatchRequest(expected_version=story['version']),observer=observer))
        self.assertEqual(set(result.examined_item_ids),{family['id'],other_family['id']})
        references=observer.call_args.args[2]
        self.assertNotIn(private['id'],{row['reference_item'] for row in references})
        async def remove_during_observation(*args):
            with self.app.state.sessions() as db:
                interactions.household_item(db,self.users['daughter'],self.house['id'],other_family['id'],False)
            return VisualMatches()
        with self.assertRaises(domain.DomainError) as caught:
            asyncio.run(match_experience_photos(self.settings,self.app.state.sessions,self.users['daughter'],
                story['id'],PhotoMatchRequest(expected_version=story['version']),observer=remove_during_observation))
        self.assertEqual(caught.exception.status,409)
