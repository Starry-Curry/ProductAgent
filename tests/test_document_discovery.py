"""Document navigation and lexical page lookup; synthetic, offline sources only."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from wujian import domain
from wujian.config import Settings
from wujian.database import SourceRecord, make_database
from wujian.knowledge import fetch_source, parse_document, search_web, source_excerpt, source_navigation


WRAPPER = b'''<html><title>Family user guide</title><script>
var F="topics/home.html"; var A=location.search.substr(1).split("&");
for(var j=0;j<A.length;j++){if(A[j][0]=="page") F=A[j][1];}
F=unescape(F); document.write('<frame name="content" src="' + F + '">');
</script><noscript><a href="contents.html">Help contents</a></noscript></html>'''


class DocumentDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.settings=Settings(data_dir=Path(self.temp.name));self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings)
        self.owner='person_demo_owner'
        with self.sessions() as db:
            domain.seed_demo(db)

    def tearDown(self):
        self.engine.dispose();self.temp.cleanup()

    def test_empty_wrapper_retains_declared_navigation_without_claiming_body_read(self):
        url='https://example.org/manual/index.html?page=topics%2Finspection.html'
        with patch('wujian.knowledge.download_public',new=AsyncMock(return_value=(url,'text/html',WRAPPER))) as download:
            value=asyncio.run(fetch_source(self.settings,self.sessions,self.owner,url))
        self.assertEqual(download.await_count,1)
        self.assertFalse(value['content_available'])
        self.assertEqual(value['content_level'],'navigation_only_not_document_content')
        self.assertEqual(value['text'],'')
        self.assertIn('https://example.org/manual/topics/inspection.html',[link['url'] for link in value['links']])
        with self.sessions() as db:
            retained=source_navigation(db,self.owner,value['source_id'])
            self.assertEqual(retained['links'],value['links'])
            self.assertEqual(db.get(SourceRecord,value['source_id']).content,'')

    def test_explicit_frame_and_script_resources_are_navigation_not_executed_content(self):
        html=b'''<title>Manual viewer</title><iframe src="chapter.html"></iframe>
            <object data="manual.pdf"></object><script src="assets/catalog.js"></script>'''
        content,_,links,_,_=parse_document(html,'text/html','https://example.org/docs/index')
        self.assertEqual(content,'')
        self.assertEqual([link['url'] for link in links],['https://example.org/docs/chapter.html',
            'https://example.org/docs/manual.pdf','https://example.org/docs/assets/catalog.js'])
        self.assertEqual(links[-1]['kind'],'declared_script_resource')

    def test_support_shell_exposes_script_resources_alongside_paged_navigation(self):
        html=('<title>Support</title><main>Manuals are loaded dynamically.</main>'+''.join(
            f'<a href="news/{index}">news</a>' for index in range(20))+
            '<script src="assets/catalog.js"></script>').encode()
        url='https://example.org/support'
        with patch('wujian.knowledge.download_public',new=AsyncMock(return_value=(url,'text/html',html))):
            value=asyncio.run(fetch_source(self.settings,self.sessions,self.owner,url,link_limit=5))
        self.assertEqual(len(value['links']),5)
        self.assertEqual(value['declared_resources'][0]['url'],'https://example.org/assets/catalog.js')
        self.assertIn('不执行脚本',value['resource_scope'])

    def test_regular_query_page_without_a_frame_declaration_is_not_followed(self):
        _,_,links,_,_=parse_document(b'<main>Public article</main>','text/html',
            'https://example.org/index?page=hidden.html')
        self.assertEqual(links,[])

    def test_wrapper_query_is_bounded_to_declared_page_and_public_same_origin_path(self):
        for suffix in ('?page=javascript:evil()', '?page=https://other.invalid/x.html',
                       '?token=topics/private.html', '?page=file:///secret.html'):
            with self.subTest(suffix=suffix):
                _,_,links,_,_=parse_document(WRAPPER,'text/html','https://example.org/index.html'+suffix)
                self.assertFalse(any(link.get('kind')=='wrapper_query_page_candidate' for link in links))

    def test_public_javascript_is_read_as_code_without_running_or_resolving_variables(self):
        raw=b"var id = getUserSecret(); $.ajax({url:'/api/manuals/' + id}); neverExecute();"
        content,_,links,media,_=parse_document(raw,'application/x-javascript','https://example.org/catalog.js')
        self.assertEqual(content,raw.decode())
        self.assertEqual(links,[])
        self.assertEqual(media,'application/x-javascript')

    def pdf_source(self):
        pages=[{'page':1,'text':"Family user guide\nContents\nChecking the Nozzles Using Product Buttons ........ 3"},
            {'page':2,'text':'Computer maintenance\nUse the driver to check nozzle condition.'},
            {'page':3,'text':'Checking the Nozzles Using Product Buttons\nCheck the printed pattern.\nRead the button symbols before proceeding.'}]
        return SourceRecord(id='synthetic',owner_id=self.owner,origin='public_web',title='Synthetic manual',
            url='https://example.org/manual.pdf',pages=pages,
            content='\n\n'.join(f"[第{page['page']}页]\n{page['text']}" for page in pages))

    def test_pdf_phrase_miss_finds_lexical_page_with_actual_line_numbers(self):
        source=self.pdf_source()
        result=source_excerpt(source,query='nozzle check pattern buttons')
        self.assertFalse(result['query_matched'])
        self.assertEqual(result['query_match_type'],'terms')
        self.assertEqual(result['page'],3)
        self.assertEqual(result['candidate_pages'][0]['page'],3)
        self.assertIn('Check the printed pattern.',result['text'])
        first=result['first_line']
        self.assertEqual(result['text'].splitlines()[0],f'{first}: '+source.pages[2]['text'].splitlines()[0])

    def test_no_lexical_match_is_explicit_and_does_not_fabricate_candidates(self):
        result=source_excerpt(self.pdf_source(),query='unrelated mysterious request')
        self.assertEqual(result['query_match_type'],'none')
        self.assertEqual(result['candidate_pages'],[])

    def test_chinese_multiterm_pdf_lookup_returns_only_actual_original_text(self):
        source=self.pdf_source()
        source.pages=[{'page':1,'text':'目录\n按钮使用......2'},
            {'page':2,'text':'喷嘴检查\n先看按钮符号，再看检查图案。'}]
        source.content='\n\n'.join(f"[第{page['page']}页]\n{page['text']}" for page in source.pages)
        value=source_excerpt(source,query='喷嘴 检查 图案 按钮')
        self.assertEqual(value['page'],2)
        self.assertIn('先看按钮符号，再看检查图案。',value['text'])
        self.assertFalse(value['query_matched'])


class SearchMetadataPreservationTests(unittest.IsolatedAsyncioTestCase):
    async def test_preserves_provider_metadata_without_inventing_missing_titles(self):
        output=[{'type':'web_search_call','status':'completed','action':{'sources':[
            {'url':'https://example.org/manual','title':'Provider title','snippet':'Provider excerpt'},
            {'url':'https://example.org/opaque'}]}},
            {'type':'message','content':[{'type':'output_text','text':'Fabricated title or invented steps','annotations':[]}]}]
        client=MagicMock();client.__aenter__=AsyncMock(return_value=client);client.__aexit__=AsyncMock(return_value=False)
        client.responses.create=AsyncMock(return_value=SimpleNamespace(model_dump=lambda **_: {'output':output}))
        with patch('wujian.knowledge.AsyncOpenAI',return_value=client):
            value=await search_web(Settings(api_key='offline-no-network'),'synthetic query')
        self.assertEqual(value['results'][0]['snippet'],'Provider excerpt')
        self.assertEqual(value['results'][1],{'url':'https://example.org/opaque'})
        self.assertNotIn('Fabricated',json.dumps(value))


if __name__=='__main__':
    unittest.main()
