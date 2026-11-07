"""A bounded manual landing reader; no network, paid models or real manuals."""
import io
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from wujian import domain
from wujian.config import Settings
from wujian.database import Asset, SourceRecord, make_database
from wujian.knowledge import fetch_manual_source


LANDING='https://example.org/fictional-guide'
TARGET='https://example.org/declared-download?id=fictional'


def pdf_bytes():
    writer=PdfWriter();page=writer.add_blank_page(width=240,height=180)
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({
        NameObject('/F1'):DictionaryObject({NameObject('/Type'):NameObject('/Font'),
            NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})})})
    stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 15 100 Td (FictionalModel user manual) Tj ET')
    page[NameObject('/Contents')]=writer._add_object(stream)
    output=io.BytesIO();writer.write(output);return output.getvalue()


def landing(anchors=None,title='FictionalModel User Manual'):
    return ('<title>'+title+'</title><main><h2>'+title+'</h2><p>Document language: English.</p>'+
        (anchors or f'<a href="{TARGET}">Download</a>')+'</main>').encode()


class ManualAttachmentReaderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.settings=Settings(data_dir=Path(self.directory.name));self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings);self.owner='person_demo_owner'
        with self.sessions() as db:
            domain.seed_demo(db)

    def tearDown(self):
        self.engine.dispose();self.directory.cleanup()

    async def read(self, raw=None, *, attachment=None, target_final=None, **kwargs):
        async def download(url, **_):
            if url==LANDING:
                return url,'text/html',raw if raw is not None else landing()
            self.assertEqual(url,TARGET,'Only the actual declared target may be read')
            return target_final or url,*(attachment or ('application/pdf',pdf_bytes()))
        with patch('wujian.knowledge.download_public',new=AsyncMock(side_effect=download)) as transport:
            result=await fetch_manual_source(self.settings,self.sessions,self.owner,LANDING,**kwargs)
        return result,transport

    async def test_unique_explicit_download_returns_real_pdf_and_retains_both_originals(self):
        value,transport=await self.read(raw=landing(f'<a href="{TARGET}">立即下载</a>','FictionalModel 用户指南'))
        self.assertEqual(transport.await_count,2)
        self.assertEqual(value['manual_resolution']['status'],'retrieved_pdf')
        self.assertEqual(value['page_count'],1)
        self.assertIn('FictionalModel user manual',value['text'])
        self.assertEqual(value['url'],TARGET)
        self.assertNotEqual(value['source_id'],value['landing_source']['source_id'])
        self.assertEqual(len(value['document_read_chain']),2)
        with self.sessions() as db:
            self.assertEqual(db.query(SourceRecord).count(),2)
            self.assertEqual(db.query(Asset).count(),2)
            self.assertEqual(db.get(Asset,db.get(SourceRecord,value['source_id']).asset_id).media_type,'application/pdf')
            self.assertIn(b'FictionalModel',Path(db.get(Asset,db.get(SourceRecord,value['landing_source']['source_id']).asset_id).path).read_bytes())

    async def test_two_download_targets_require_choice_without_following_either(self):
        raw=landing(f'<a href="{TARGET}">Download</a><a href="other.pdf">PDF</a>')
        value,transport=await self.read(raw)
        self.assertEqual(transport.await_count,1)
        self.assertEqual(value['manual_resolution']['status'],'ambiguous')
        self.assertEqual(value['manual_resolution']['candidate_count'],2)
        self.assertFalse(value['manual_resolution']['pdf_obtained'])

    async def test_nonmanual_and_metadata_only_pages_are_not_followed(self):
        for raw in (landing(title='FictionalModel firmware release'),
            f'<title>FictionalModel User Manual</title><meta name="description" content="User Manual"><a href="{TARGET}" type="application/pdf"></a>'.encode()):
            with self.subTest(raw=raw[:70]):
                value,transport=await self.read(raw,refresh=True)
                self.assertEqual(transport.await_count,1)
                self.assertEqual(value['manual_resolution']['status'],'not_applicable')

    async def test_non_pdf_target_is_retained_but_never_promoted_or_recursively_followed(self):
        value,transport=await self.read(attachment=('text/html',landing('<a href="second.pdf">Download</a>')))
        self.assertEqual(transport.await_count,2)
        self.assertEqual(value['url'],LANDING)
        self.assertEqual(value['page_count'],0)
        self.assertEqual(value['manual_resolution']['status'],'not_pdf')
        self.assertFalse(value['manual_resolution']['pdf_obtained'])
        self.assertIn('attachment_source',value)
        with self.sessions() as db:
            self.assertEqual(db.query(SourceRecord).count(),2)

    async def test_target_failure_keeps_the_landing_and_honest_failure(self):
        async def download(url, **_):
            if url==LANDING:return url,'text/html',landing()
            raise domain.DomainError('公开资料读取受限（HTTP 403）',502)
        with patch('wujian.knowledge.download_public',new=AsyncMock(side_effect=download)):
            value=await fetch_manual_source(self.settings,self.sessions,self.owner,LANDING)
        self.assertEqual(value['manual_resolution']['status'],'unavailable')
        self.assertEqual(value['url'],LANDING)
        self.assertIn('403',value['manual_resolution']['reason'])
        with self.sessions() as db:self.assertEqual(db.query(SourceRecord).count(),1)

    async def test_exact_url_cache_reuses_both_sources_and_checks_item_access_first(self):
        first,transport=await self.read(item_id='item_demo_lamp')
        self.assertEqual(transport.await_count,2)
        with patch('wujian.knowledge.download_public',new=AsyncMock()) as network:
            cached=await fetch_manual_source(self.settings,self.sessions,self.owner,LANDING,item_id='item_demo_lamp')
            self.assertEqual(cached['source_id'],first['source_id'])
            with self.assertRaises(domain.DomainError):
                await fetch_manual_source(self.settings,self.sessions,'person_demo_friend',LANDING,item_id='item_demo_lamp')
            network.assert_not_awaited()

    async def test_final_pdf_url_and_declared_download_url_remain_distinct_in_chain(self):
        final='https://cdn.example.org/files/fictional.pdf'
        value,_=await self.read(target_final=final)
        self.assertEqual(value['url'],final)
        self.assertEqual(value['manual_resolution']['declared_url'],TARGET)
        self.assertEqual(value['document_read_chain'][-1]['url'],final)

    async def test_script_strings_and_undeclared_guesses_do_not_create_targets(self):
        value,transport=await self.read(landing('<script>var download="missing.pdf"; neverExecute();</script>'))
        self.assertEqual(transport.await_count,1)
        self.assertEqual(value['manual_resolution']['status'],'no_candidate')

    async def test_declared_target_beyond_compact_first_page_is_still_unique(self):
        raw=landing(''.join(f'<a href="/news/{n}">News</a>' for n in range(18))+f'<a href="{TARGET}">Download PDF</a>')
        value,transport=await self.read(raw,link_limit=3)
        self.assertEqual(transport.await_count,2)
        self.assertEqual(value['page_count'],1)

    async def test_navigation_inventory_limit_cannot_hide_a_second_download(self):
        raw=landing(f'<a href="{TARGET}">Download</a>'+''.join(
            f'<a href="/news/{n}">News</a>' for n in range(105))+'<a href="second.pdf">PDF</a>')
        value,transport=await self.read(raw)
        self.assertEqual(transport.await_count,1)
        self.assertFalse(value['manual_resolution']['pdf_obtained'])

    async def test_actual_pdf_input_is_not_treated_as_another_download_landing(self):
        with patch('wujian.knowledge.download_public',new=AsyncMock(return_value=(TARGET,'application/pdf',pdf_bytes()))) as network:
            value=await fetch_manual_source(self.settings,self.sessions,self.owner,TARGET)
        self.assertEqual(network.await_count,1)
        self.assertEqual(value['page_count'],1)
        self.assertEqual(value['manual_resolution']['status'],'already_pdf')
        self.assertEqual(value['manual_resolution']['automatic_attachment_reads'],0)

    async def test_twelve_megabyte_body_limit_is_not_bypassed_by_attachment(self):
        observed=[]
        def serve(request):
            observed.append(request)
            if request.url.path=='/fictional-guide':
                return httpx.Response(200,content=landing(),headers={'content-type':'text/html'})
            return httpx.Response(200,content=b'%PDF'+b'x'*(12*1024*1024),headers={'content-type':'application/pdf'})
        real_client=httpx.AsyncClient
        def client(**kwargs):return real_client(transport=httpx.MockTransport(serve),**kwargs)
        dns=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',443))]
        with patch('wujian.knowledge.httpx.AsyncClient',side_effect=client),patch(
            'wujian.public_network.socket.getaddrinfo',return_value=dns):
            value=await fetch_manual_source(self.settings,self.sessions,self.owner,LANDING)
        self.assertEqual(value['manual_resolution']['status'],'unavailable')
        self.assertFalse(value['manual_resolution']['pdf_obtained'])
        self.assertIn('12MB',value['manual_resolution']['reason'])
        with self.sessions() as db:self.assertEqual(db.query(SourceRecord).count(),1)

    async def test_private_target_and_redirect_still_use_pinned_public_downloader(self):
        for direct in (True,False):
            with self.subTest(direct=direct):
                observed=[]
                target='http://127.0.0.1/private.pdf' if direct else TARGET
                def serve(request):
                    observed.append(request)
                    if request.url.path=='/fictional-guide':
                        return httpx.Response(200,content=landing(f'<a href="{target}">Download</a>'),headers={'content-type':'text/html'})
                    return httpx.Response(302,headers={'location':'http://169.254.169.254/latest/private.pdf'})
                real_client=httpx.AsyncClient
                def client(**kwargs):return real_client(transport=httpx.MockTransport(serve),**kwargs)
                dns=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',443))]
                with patch('wujian.knowledge.httpx.AsyncClient',side_effect=client),patch(
                    'wujian.public_network.socket.getaddrinfo',return_value=dns):
                    value=await fetch_manual_source(self.settings,self.sessions,self.owner,LANDING,refresh=True)
                self.assertEqual(value['manual_resolution']['status'],'unavailable')
                self.assertFalse(value['manual_resolution']['pdf_obtained'])
                self.assertEqual(len(observed),1 if direct else 2)
                self.assertTrue(all(request.url.host=='8.8.8.8' for request in observed))
                self.assertTrue(all(request.headers['host']=='example.org' for request in observed))


if __name__=='__main__':unittest.main()
