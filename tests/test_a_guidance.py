"""Real state boundaries; no paid calls or synthetic model quality assertions."""
import asyncio
import copy
import tempfile
import unittest
from pathlib import Path

from wujian import domain, foundation, guidance, interactions
from wujian.api_models import ItemCreate, ProductSpec, GuidanceFeedback
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory, Run, SourceRecord, TaskRecord, make_database
from wujian.memory_context import prepare_memories
from wujian.retrieval import authorized_documents


class TeachingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name))
        self.settings.prepare()
        self.engine,self.sessions = make_database(self.settings)
        self.owner = 'person_demo_owner'
        with self.sessions() as db:
            domain.seed_demo(db)
            self.item = domain.create_item(db,self.owner,ItemCreate(name='索尼耳机',kind='standard_product',
                product=ProductSpec(brand='Sony',model='WH-CH720N')))
            self.source = SourceRecord(id='manual',owner_id=self.owner,item_id=self.item['id'],
                title='WH-CH720N 帮助指南',url='https://helpguide.sony.net/',
                content='WH-CH720N 长按电源按钮约2秒钟，直至指示灯闪烁。',origin='public_web',
                pages=[{'page':1,'text':'WH-CH720N 长按电源按钮约2秒钟，直至指示灯闪烁。'}])
            db.add(self.source)
            db.commit()
        self.plan = {'schema':'interaction/1','kind':'guidance','entries':[{'id':'power','title':'开机',
            'item_id':self.item['id'],'group':'step','state':'pending','guidance':{
                'instruction':'长按电源按钮约2秒，观察指示灯。','success_signal':'指示灯闪烁',
                'evidence':[{'source_id':'manual','quote':'长按电源按钮约2秒钟，直至指示灯闪烁。','source_model':'WH-CH720N','page':1}]}}]}

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def save(self,db,plan=None):
        return foundation.save_task(db,self.owner,'explicit', '让耳机开机',[self.item['id']],{},plan or self.plan)

    def test_wrong_model_quote_and_page_rejected(self):
        with self.sessions() as db:
            for key,value in [('source_model','WH-1000XM5'),('quote','不存在的开机步骤和提示'),('page',2)]:
                plan = copy.deepcopy(self.plan)
                plan['entries'][0]['guidance']['evidence'][0][key] = value
                with self.assertRaises(domain.DomainError): self.save(db,plan)
            self.save(db)

    def test_false_completion_requires_current_report(self):
        with self.sessions() as db:
            plan = copy.deepcopy(self.plan)
            plan['entries'][0]['state']='ready'
            with self.assertRaises(domain.DomainError): self.save(db,plan)

    def test_valid_citation_cannot_launder_wrong_timing(self):
        with self.sessions() as db:
            plan = copy.deepcopy(self.plan)
            plan['entries'][0]['guidance']['instruction']='按住电源按钮约7秒。'
            with self.assertRaises(domain.DomainError): self.save(db,plan)

    def test_render_uses_current_validated_step_not_another_recipe(self):
        with self.sessions() as db:
            task=self.save(db)
            text=guidance.render_current_step(task['plan'],task['status'])
            self.assertIn('长按电源按钮约2秒',text)
            self.assertNotIn('7秒',text)

    def test_parameters_compare_whole_quantities_and_written_numbers(self):
        def evidence(quote):
            return [{'guidance':{'evidence':[{'quote':quote}]}}]
        for instruction,quote in [('按住5秒','按住15秒'),('按住七秒','按住2秒'),
            ('按住十二秒','按住2秒'),('等待0.5分钟','等待5秒'),('使用5伏','使用5瓦')]:
            with self.subTest(instruction=instruction,quote=quote):
                with self.assertRaises(domain.DomainError):
                    guidance.validate_parameters(instruction,evidence(quote))
        for instruction,quote in [('按住两秒','按住2.0秒钟'),('等待1分钟','等待60秒'),
            ('等三十秒','等0.5分钟'),('水温３７℃','水温37摄氏度'),('等待两点五秒','等待2.5秒')]:
            guidance.validate_parameters(instruction,evidence(quote))

    def test_feedback_atomic_idempotent_and_resume(self):
        with self.sessions() as db:
            task = self.save(db)
            payload = GuidanceFeedback(expected_version=1,step_id='power',outcome='unchanged',note='灯没亮',receipt_id='receipt-0001')
            first = guidance.start_feedback(db,self.owner,task['id'],payload)
            second = guidance.start_feedback(db,self.owner,task['id'],payload)
            self.assertEqual(first.id,second.id)
            row = db.get(TaskRecord,task['id'])
            self.assertEqual(row.version,2)
            self.assertEqual(row.plan['entries'][0]['state'],'unchanged')
            self.assertNotIn('灯没亮',row.plan['entries'][0].get('note',''))
            self.assertEqual(interactions.resume_task(db,self.owner,task['id'])['conversation_id'],first.conversation_id)
            self.assertNotEqual(row.status,'completed')
            with self.assertRaises(domain.DomainError):
                guidance.start_feedback(db,self.owner,task['id'],payload.model_copy(update={'note':'换一份实际结果'}))
            with self.assertRaises(domain.DomainError):
                guidance.start_feedback(db,self.owner,task['id'],payload.model_copy(update={'receipt_id':'receipt-0002'}))
            self.assertEqual(db.get(TaskRecord,task['id']).version,2)

    def test_changed_operation_cannot_inherit_old_success(self):
        with self.sessions() as db:
            task = self.save(db)
            guidance.start_feedback(db,self.owner,task['id'],GuidanceFeedback(expected_version=1,
                step_id='power',outcome='done',receipt_id='receipt-0010'))
            row = db.get(TaskRecord,task['id'])
            old = copy.deepcopy(row.plan)
            normalized = guidance.validate_plan(db,self.owner,[self.item['id']],old,previous=row.plan)
            self.assertEqual(normalized['entries'][0]['state'],'ready')
            changed = copy.deepcopy(old)
            changed['entries'][0]['guidance']['instruction']='改做另一项操作'
            with self.assertRaises(domain.DomainError):
                guidance.validate_plan(db,self.owner,[self.item['id']],changed,previous=old)

    def test_context_memory_lineage_and_forgetting(self):
        with self.sessions() as db:
            a = foundation.revise_memory(db,self.owner,'first','我喜欢白光',attributes={'context':'做手工'})
            b = foundation.revise_memory(db,self.owner,'second','我喜欢白光',attributes={'context':'阅读'})
            self.assertNotEqual(a['id'],b['id'])
            foundation.revise_memory(db,self.owner,'third','我喜欢白光',attributes={'context':'做手工'})
            self.assertEqual(db.get(Memory,a['id']).attributes['source_message_ids'],['first','third'])
            domain.remove_memory(db,self.owner,a['id'])
            self.assertNotIn(a['id'],[row['id'] for row in domain.recall(db,self.owner)])

    def test_forget_during_embedding_rehydrates_current_records(self):
        with self.sessions() as db:
            records = [foundation.revise_memory(db,self.owner,f'm{i}',f'爱好{i}') for i in range(10)]
        sessions,owner = self.sessions,self.owner
        class DelayedRetrieval:
            async def search(self,*args,**kwargs):
                with sessions() as db:
                    domain.remove_memory(db,owner,records[0]['id'])
                return {'mode':'hybrid','results':[{'id':records[0]['id']},{'id':records[1]['id']}]}
        result = asyncio.run(prepare_memories(sessions,DelayedRetrieval(),owner,'过去的爱好',[]))
        self.assertNotIn(records[0]['id'],[row['id'] for row in result['records']])
        self.assertIn(records[1]['id'],[row['id'] for row in result['records']])

    def test_forget_interrupts_inflight_context(self):
        with self.sessions() as db:
            memory = foundation.revise_memory(db,self.owner,'report','我有一个旧偏好')
            conversation = Conversation(user_id=self.owner)
            db.add(conversation); db.flush()
            run = Run(user_id=self.owner,conversation_id=conversation.id,status='running')
            db.add(run); db.commit()
            domain.remove_memory(db,self.owner,memory['id'])
            db.refresh(run)
            self.assertEqual(run.status,'interrupted')

    def test_retried_forget_does_not_interrupt_new_unrelated_run(self):
        with self.sessions() as db:
            memory = foundation.revise_memory(db,self.owner,'report','已经遗忘的偏好')
            domain.remove_memory(db,self.owner,memory['id'])
            retired_at = db.get(Memory,memory['id']).attributes['retired_at']
            conversation = Conversation(user_id=self.owner)
            db.add(conversation); db.flush()
            run = Run(user_id=self.owner,conversation_id=conversation.id,status='running')
            db.add(run); db.commit()
            domain.remove_memory(db,self.owner,memory['id'])
            db.refresh(run)
            self.assertEqual(run.status,'running')
            self.assertEqual(db.get(Memory,memory['id']).attributes['retired_at'],retired_at)

    def test_forget_excludes_echoed_answers_but_keeps_unrelated_history(self):
        with self.sessions() as db:
            memory = foundation.revise_memory(db,self.owner,'original','阅读偏好')
            for identity,dependencies in [('echo',[memory['id']]),('unrelated',[])]:
                conversation = Conversation(id=identity,user_id=self.owner)
                db.add(conversation);db.flush()
                run = Run(id=identity,user_id=self.owner,conversation_id=identity,status='completed',
                    events=[{'type':'memory_context','memory_ids':dependencies}])
                db.add(run)
                db.add(ChatMessage(id=identity+'-q',conversation_id=identity,role='user',text='以前的事',run_id=identity))
                db.add(ChatMessage(conversation_id=identity,role='assistant',text='历史回复',run_id=identity))
            db.commit()
            domain.remove_memory(db,self.owner,memory['id'])
        documents = authorized_documents(self.sessions,self.owner)
        self.assertNotIn('conversation/echo-q',documents)
        self.assertIn('conversation/unrelated-q',documents)


if __name__ == '__main__': unittest.main()
