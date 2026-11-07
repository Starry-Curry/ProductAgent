"""Metadata-only pages cannot stand in for a read article or tutorial."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from wujian import domain, foundation
from wujian.api_models import ItemCreate
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, SourceRecord, KnowledgeClaim, make_database
from wujian.agent_runtime import make_tools
from wujian.knowledge import fetch_source, parse_document, source_content_level, source_excerpt
from wujian.turns import TurnResult, commit_result


class MetadataReadingDepthTests(unittest.TestCase):
    def source(self, html):
        content,pages,_,_,title=parse_document(html.encode(),'text/html','https://example.org/help')
        return SourceRecord(id='synthetic',owner_id='person_demo_owner',origin='public_web',
            title=title,url='https://example.org/help',content=content,pages=pages)

    def test_empty_dom_with_only_description_is_metadata_not_read_instructions(self):
        source=self.source('<title>Device guide</title><meta name="description" content="SYNTHETIC-100 guide">'
            '<body><div><a href="javascript:;"><img></a></div><script src="page-data.js"></script></body>')
        value=source_excerpt(source)
        self.assertEqual(source_content_level(source),'public_page_metadata_only_not_document_body')
        self.assertFalse(value['content_available'])
        self.assertEqual(value['evidence_kind'],'retrieved_page_metadata')
        self.assertIn('没有正文',value['reading_note'])
        self.assertIn('SYNTHETIC-100 guide',value['text'])

    def test_real_short_body_is_not_classified_by_length(self):
        source=self.source('<meta name="description" content="Device FAQ"><main>开机。</main>')
        self.assertEqual(source_content_level(source),'document_text')
        self.assertTrue(source_excerpt(source)['content_available'])

    def test_structured_authored_body_survives_even_without_visible_dom_text(self):
        records=[{'@type':'Article','articleBody':'按说明查看状态。'},
            {'@type':'FAQPage','mainEntity':[{'@type':'Question','name':'怎样查看？',
                'acceptedAnswer':{'@type':'Answer','text':'查看状态。'}}]},
            {'@type':'HowTo','name':'查看状态','step':[{'@type':'HowToStep','text':'打开状态面板。'}]}]
        for record in records:
            with self.subTest(kind=record['@type']):
                source=self.source('<meta name="description" content="Guide"><script type="application/ld+json">'+
                    json.dumps(record,ensure_ascii=False)+'</script>')
                self.assertEqual(source_content_level(source),'document_text')
                self.assertTrue(source_excerpt(source)['content_available'])

    def test_retained_legacy_metadata_header_with_empty_body_is_recognized(self):
        source=SourceRecord(id='legacy',owner_id='person_demo_owner',origin='public_web',url='https://example.org/help',
            title='Guide',content='[公开页面元数据；描述不等于已验证操作]\ndescription: Device guide\n\n',pages=[])
        self.assertEqual(source_content_level(source),'public_page_metadata_only_not_document_body')
        source.content+='短正文。'
        self.assertEqual(source_content_level(source),'document_text')

    def test_fetch_cached_read_tool_and_rendered_citation_keep_the_same_depth(self):
        html=b'<title>Guide</title><meta name="description" content="Device guide"><script src="assets.js"></script>'
        url='https://example.org/help'
        with tempfile.TemporaryDirectory() as folder:
            settings=Settings(data_dir=Path(folder));settings.prepare()
            engine,sessions=make_database(settings)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                    conversation=Conversation(user_id='person_demo_owner');db.add(conversation);db.flush()
                    message=ChatMessage(conversation_id=conversation.id,role='user',text='先看资料。')
                    db.add(message);db.commit();message_id=message.id
                with patch('wujian.knowledge.download_public',new=AsyncMock(return_value=(url,'text/html',html))):
                    first=asyncio.run(fetch_source(settings,sessions,'person_demo_owner',url))
                with patch('wujian.knowledge.download_public',new=AsyncMock()) as download:
                    cached=asyncio.run(fetch_source(settings,sessions,'person_demo_owner',url))
                    download.assert_not_awaited()
                toolkit=make_tools(settings,sessions,'person_demo_owner',message_id)
                tool=next(tool for tool in toolkit.tool_groups[0].tools if tool.name=='read_source')
                result=asyncio.run(tool(source_id=first['source_id'],query='操作步骤'))
                read=json.loads(result.content[0].text)
                for value in (first,cached,read):
                    self.assertEqual(value['content_level'],'public_page_metadata_only_not_document_body')
                    self.assertFalse(value['content_available'])
                    self.assertEqual(value['evidence_kind'],'retrieved_page_metadata')
                proposal=TurnResult.model_validate({'answer':'目前只取得简介。','learning':{},'continuation':None,
                    'source_refs':[first['source_id']]})
                with sessions() as db:
                    answer=commit_result(db,'person_demo_owner',message_id,proposal,'先看资料。')['answer']
                self.assertIn('仅取得页面标题/简介，未读取正文',answer)
            finally:
                engine.dispose()

    def test_metadata_learning_is_provisional_item_inference_and_guidance_needs_body(self):
        with tempfile.TemporaryDirectory() as folder:
            settings=Settings(data_dir=Path(folder));settings.prepare()
            engine,sessions=make_database(settings)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                    item=domain.create_item(db,'person_demo_owner',ItemCreate(name='合成测试设备',
                        product={'brand':'Synthetic fixture','model':'SYNTHETIC-100','market':'CN'}))
                    source=self.source('<meta name="description" content="SYNTHETIC-100 使用指南">')
                    db.add(source);db.commit()
                    row=foundation.save_claim(db,'person_demo_owner','synthetic-message',item['id'],
                        '菜单操作尚未读取，具体路径未知。',{},'document','product',source.id,'description: SYNTHETIC-100 使用指南')
                    claim=db.get(KnowledgeClaim,row['id'])
                    self.assertEqual((claim.basis,claim.status,claim.product_id),('inference','provisional',None))
                    self.assertEqual(claim.conditions['reading_scope'],'public_page_metadata_only_not_document_body')
                    self.assertEqual(claim.source_quote,'')
                    plan={'schema':'interaction/1','kind':'checklist','entries':[{'id':'step','title':'查看菜单','item_id':item['id'],
                        'group':'step','guidance':{'basis':'document','instruction':'进入设置菜单查看状态。',
                            'evidence':[{'source_id':source.id,'quote':'description: SYNTHETIC-100 使用指南'}]}}]}
                    with self.assertRaisesRegex(domain.DomainError,'元数据'):
                        foundation.save_task(db,'person_demo_owner','synthetic-message','查看状态',[item['id']],{},plan)
            finally:
                engine.dispose()


if __name__=='__main__':
    unittest.main()
