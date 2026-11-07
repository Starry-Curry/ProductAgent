"""Offline synthetic evidence tests; no device instructions or provider calls."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from wujian import domain, foundation
from wujian.api_models import ItemCreate
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, SourceRecord, TaskRecord, make_database
from wujian.turns import grounded_turn_schema
from wujian.guidance import source_applicability
from wujian.agent_runtime import make_tools


class GuidanceEvidenceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        settings = Settings(data_dir=Path(self.temp.name)); settings.prepare()
        self.settings = settings
        self.engine, self.sessions = make_database(settings)
        self.owner = 'person_demo_owner'
        with self.sessions() as db:
            domain.seed_demo(db)
            self.item = domain.create_item(db, self.owner, ItemCreate(name='合成拥有的耳机',
                product={'brand':'Sony','model':'WH-CH720N','market':'CN'}))['id']
            conversation = Conversation(user_id=self.owner); db.add(conversation); db.flush()
            message = ChatMessage(conversation_id=conversation.id, role='user', text='先做一项小检查。')
            db.add(message); db.commit(); self.message = message.id

    def tearDown(self):
        self.engine.dispose(); self.temp.cleanup()

    def plan(self, kind='checklist', evidence=None, basis='document'):
        return {'schema':'interaction/1','kind':kind,'entries':[{'id':'check','title':'一项小检查',
            'item_id':self.item,'group':'step','guidance':{'kind':'operate','basis':basis,
            'instruction':'查看纸面是否有缺口。','evidence':evidence or []}}]}

    def save(self, db, plan):
        return foundation.save_task(db,self.owner,self.message,'先检查',[self.item],{},plan)

    def test_document_evidence_cannot_be_bypassed_by_plan_presentation(self):
        for kind in ['checklist','idea','guidance']:
            with self.subTest(kind=kind), self.sessions() as db:
                before = db.query(TaskRecord).count()
                with self.assertRaisesRegex(domain.DomainError,'适用原文'):
                    self.save(db,self.plan(kind))
                db.rollback()
                self.assertEqual(db.query(TaskRecord).count(),before)

    def test_native_schema_rejects_same_missing_evidence_before_persistence(self):
        value={'answer':'先查看纸面。','learning':{},'continuation':{
            'goal':'先检查','item_ids':[self.item],'constraints':{},'plan':self.plan(),
            'task_id':None,'expected_version':None}}
        with self.assertRaisesRegex(domain.DomainError,'适用原文'):
            grounded_turn_schema(self.sessions,self.owner,self.message).model_validate(value)

    def test_neighbor_model_cannot_ground_an_operation_but_multi_model_manual_can(self):
        for label, accepted in [('WH-CH720N2',False),('WH-CH720N / WH-CH520',True)]:
            with self.subTest(label=label), self.sessions() as db:
                source=SourceRecord(owner_id=self.owner,origin='public_web',title='合成说明',
                    url='https://example.invalid/manual',content=label+'\n查看纸面是否有缺口。',pages=[])
                db.add(source);db.commit()
                plan=self.plan(evidence=[{'source_id':source.id,'quote':'查看纸面是否有缺口。'}])
                if accepted:
                    self.assertEqual(self.save(db,plan)['plan']['kind'],'checklist')
                else:
                    with self.assertRaisesRegex(domain.DomainError,'准确型号'):
                        self.save(db,plan)

    def test_general_first_help_does_not_require_a_manual_or_create_guidance_progress(self):
        with self.sessions() as db:
            result=self.save(db,self.plan(basis='general'))
            self.assertNotIn('guidance',result['plan'])

    def test_checklist_actual_progress_uses_its_existing_report_contract(self):
        text='这一步我已经做完。'
        with self.sessions() as db:
            task=self.save(db,self.plan(basis='general'))
            db.get(ChatMessage,self.message).text=text;db.commit()
        value={'answer':'保留你的实际完成反馈。','learning':{},'continuation':{
            'goal':'先检查','item_ids':[self.item],'constraints':{},'plan':self.plan(basis='general'),
            'task_id':task['id'],'expected_version':task['version'],
            'progress_reports':[{'entry_id':'check','action_result':'completed','source_quote':text}]}}
        result=grounded_turn_schema(self.sessions,self.owner,self.message).model_validate(value)
        self.assertEqual(result.continuation.task_id,task['id'])

    def test_general_basis_cannot_disguise_an_unverified_button_sequence(self):
        with self.sessions() as db:
            plan=self.plan(basis='general')
            plan['entries'][0]['guidance']['instruction']='按住功能键同时按电源键，先松电源键。'
            with self.assertRaisesRegex(domain.DomainError,'按键组合'):
                self.save(db,plan)

    def test_applicability_reports_body_presence_without_promising_compatibility(self):
        with self.sessions() as db:
            source=SourceRecord(owner_id=self.owner,item_id=self.item,origin='public_web',
                title='WH-CH720N 产品入口',url='https://example.invalid/WH-CH720N',
                content='合成泛系列说明：WH-CH720N2。',pages=[])
            absent=source_applicability(db,self.owner,source)
            self.assertFalse(absent['targets'][0]['model_in_source_text'])
            self.assertEqual(absent['targets'][0]['status'],'model_not_confirmed')
            source.content='合成多型号手册：WH-CH720N / WH-CH520。'
            present=source_applicability(db,self.owner,source)
            self.assertTrue(present['targets'][0]['model_in_source_text'])
            self.assertFalse(present['procedure_compatibility_verified'])

    def test_checklist_preserves_pdf_page_quote_validation(self):
        with self.sessions() as db:
            source=SourceRecord(owner_id=self.owner,origin='public_web',title='合成手册',
                url='https://example.invalid/manual.pdf',content='WH-CH720N\n查看纸面是否有缺口。',
                pages=[{'page':1,'text':'WH-CH720N'},{'page':2,'text':'查看纸面是否有缺口。'}])
            db.add(source);db.commit()
            evidence={'source_id':source.id,'quote':'查看纸面是否有缺口。','page':1}
            with self.assertRaisesRegex(domain.DomainError,'PDF页码'):
                self.save(db,self.plan(evidence=[evidence]))
            evidence['page']=2
            self.assertEqual(self.save(db,self.plan(evidence=[evidence]))['plan']['entries'][0]['guidance']['evidence'][0]['page'],2)

    def test_guidance_evidence_must_have_been_read_even_when_source_refs_are_omitted(self):
        with self.sessions() as db:
            source=SourceRecord(owner_id=self.owner,origin='public_web',title='合成手册',
                url='https://example.invalid/manual',content='WH-CH720N\n查看纸面是否有缺口。',pages=[])
            db.add(source);db.commit(); identity=source.id
        value={'answer':'查看纸面。','learning':{},'continuation':{
            'goal':'先检查','item_ids':[self.item],'constraints':{},
            'plan':self.plan(evidence=[{'source_id':identity,'quote':'查看纸面是否有缺口。'}]),
            'task_id':None,'expected_version':None}}
        with self.assertRaisesRegex(ValueError,'尚未实际读取'):
            grounded_turn_schema(self.sessions,self.owner,self.message,set()).model_validate(value)
        checked=grounded_turn_schema(self.sessions,self.owner,self.message,{identity}).model_validate(value)
        self.assertEqual(checked.source_refs,[identity])

    def test_tools_report_applicability_after_read_item_without_explicit_fetch_item_id(self):
        with self.sessions() as db:
            source=SourceRecord(owner_id=self.owner,origin='public_web',title='合成泛系列FAQ',
                url='https://example.invalid/faq',content='这是一份合成泛系列说明，没有准确型号。',pages=[])
            db.add(source);db.commit(); identity=source.id
        toolkit=make_tools(self.settings,self.sessions,self.owner,self.message)
        toolset={tool.name:tool for tool in toolkit.tool_groups[0].tools}
        async def exercise():
            await toolset['read_item'](item_id=self.item)
            with patch('wujian.agent_runtime.fetch_source',new=AsyncMock(return_value={'source_id':identity})):
                fetched=await toolset['fetch_document'](url='https://example.invalid/faq')
            read=await toolset['read_source'](source_id=identity)
            return fetched,read
        for result in asyncio.run(exercise()):
            value=json.loads(result.content[0].text)
            self.assertEqual(value['applicability']['targets'][0]['model'],'WH-CH720N')
            self.assertFalse(value['applicability']['targets'][0]['model_in_source_text'])


if __name__ == '__main__':
    unittest.main()
