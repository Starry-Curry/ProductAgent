"""Actual SQL projection counts; synthetic domestic-device chats, no provider."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import event

from wujian import domain
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory, Run, make_database
from wujian.retrieval import authorized_documents


class RetrievalProjectionBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        settings=Settings(data_dir=Path(self.temp.name),api_key='')
        settings.prepare();self.engine,self.sessions=make_database(settings)
        self.owner='person_demo_owner';self.other='person_demo_friend'
        with self.sessions() as db:domain.seed_demo(db)

    def tearDown(self):
        self.engine.dispose();self.temp.cleanup()

    def chat(self,db,owner=None,empty=False,stamp='2026-11-07T09:00:00+08:00'):
        conv=Conversation(user_id=owner or self.owner);db.add(conv);db.flush()
        if empty:return conv,None,None
        question=ChatMessage(conversation_id=conv.id,role='user',text='佳能EOS R5的电池放在哪儿？',created_at=stamp)
        answer=ChatMessage(conversation_id=conv.id,role='assistant',text='先看相机底部的电池仓标记。',created_at=stamp)
        db.add_all([question,answer]);db.flush()
        return conv,question,answer

    def counted(self):
        statements=[]
        def capture(conn,cursor,statement,parameters,context,executemany):
            if 'from messages' in statement.lower():statements.append(statement)
        event.listen(self.engine,'before_cursor_execute',capture)
        try:return authorized_documents(self.sessions,self.owner),len(statements)
        finally:event.remove(self.engine,'before_cursor_execute',capture)

    def test_thirty_conversations_need_one_message_select_and_keep_all_exchanges(self):
        with self.sessions() as db:
            ids=[self.chat(db)[1].id for _ in range(29)]
            self.chat(db,empty=True);self.chat(db,owner=self.other);db.commit()
        docs,reads=self.counted()
        self.assertEqual(reads,1)
        self.assertEqual({k for k in docs if k.startswith('conversation/')},{'conversation/'+i for i in ids})

    def test_same_timestamp_and_empty_chats_preserve_exact_projection_text_and_hash(self):
        with self.sessions() as db:
            conv,q,a=self.chat(db);self.chat(db,empty=True);db.commit()
            identity=q.id
            expected={'conversation_id':conv.id,'user_message_id':q.id,'user_text':q.text,
                'assistant_text':a.text,'created_at':q.created_at,'evidence_kind':'historical_exchange',
                'assistant_advice_is_not_observed_success':True,
                'assistant_text_is_generated_not_user_life_evidence':True}
        doc=authorized_documents(self.sessions,self.owner)['conversation/'+identity]
        self.assertEqual(doc['data'],expected)
        text=json.dumps(expected,ensure_ascii=False,sort_keys=True,separators=(',',':'))
        self.assertEqual(doc['text'],text)
        self.assertEqual(doc['hash'],hashlib.sha256(text.encode()).hexdigest())

    def test_cross_account_and_changed_conversation_owner_are_rechecked_each_projection(self):
        with self.sessions() as db:
            own,q,_=self.chat(db);foreign,other_q,_=self.chat(db,owner=self.other);db.commit()
            own_id,foreign_id,own_message=own.id,foreign.id,q.id
            foreign_message=other_q.id
        before=authorized_documents(self.sessions,self.owner)
        self.assertIn('conversation/'+own_message,before)
        self.assertNotIn('conversation/'+foreign_message,before)
        with self.sessions() as db:db.get(Conversation,own_id).user_id=self.other;db.commit()
        after=authorized_documents(self.sessions,self.owner)
        self.assertNotIn('conversation/'+own_message,after)
        self.assertNotIn('conversation/'+foreign_message,after)

    def test_failed_and_interrupted_unanswered_reports_stay_unanswered_and_retire_immediately(self):
        ids=[]
        with self.sessions() as db:
            for status in ['failed','interrupted']:
                conv=Conversation(user_id=self.owner);db.add(conv);db.flush()
                run=Run(conversation_id=conv.id,user_id=self.owner,status=status);db.add(run);db.flush()
                message=ChatMessage(conversation_id=conv.id,role='user',run_id=run.id,
                    text='邻居已经睡了，米家台灯1S的小玩法别加声音。')
                db.add(message);db.flush();ids.append(message.id)
            db.commit()
        docs=authorized_documents(self.sessions,self.owner)
        for identity,status in zip(ids,['failed','interrupted']):
            value=docs['conversation/'+identity]['data']
            self.assertEqual(value['run_status'],status)
            self.assertEqual(value['assistant_text'],'')
            self.assertEqual(value['evidence_kind'],'historical_unanswered_user_message')
        with self.sessions() as db:
            db.add(Memory(id='retired-exact-source',user_id=self.owner,source_message_id=ids[0],
                content='本次不要加声音',active=False,attributes={}))
            db.commit()
        docs=authorized_documents(self.sessions,self.owner)
        self.assertNotIn('conversation/'+ids[0],docs)
        self.assertIn('conversation/'+ids[1],docs)
