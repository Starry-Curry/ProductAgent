"""Fake-IP proxy support must never become an SSRF bypass."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from wujian import domain
from wujian.knowledge import validate_public_url, download_public


def address(value): return [(2,1,6,'',(value,443))]


class ResearchNetworkTests(unittest.TestCase):
    def test_proxy_tls_uses_verified_original_name_without_changing_destination(self):
        from wujian.source_transport import NamePreservingStream, _tls_target
        stream=AsyncMock()
        stream.start_tls.return_value=stream
        tls_context=object()
        async def run():
            token=_tls_target.set(('8.8.8.8','manual.example.org'))
            try:
                await NamePreservingStream(stream).start_tls(tls_context,'8.8.8.8',4)
            finally:_tls_target.reset(token)
        asyncio.run(run())
        stream.start_tls.assert_awaited_once_with(tls_context,'manual.example.org',4)

    def test_configured_transport_keeps_destination_ip_pinned_and_tls_hostname(self):
        requests=[]
        def respond(request):
            requests.append(request)
            return httpx.Response(200,content=b'public manual')
        with patch('wujian.knowledge.validate_public_url',new_callable=AsyncMock,return_value='8.8.8.8'), \
             patch('wujian.knowledge.public_transport',return_value=httpx.MockTransport(respond)):
            result=asyncio.run(download_public('https://manual.example.org/guide'))
        self.assertEqual(result[2],b'public manual')
        self.assertEqual(requests[0].url.host,'8.8.8.8')
        self.assertEqual(requests[0].headers['host'],'manual.example.org')
        self.assertEqual(requests[0].extensions['sni_hostname'],'manual.example.org')

    def test_unreachable_cdn_address_can_use_another_verified_public_address(self):
        requests=[]
        def respond(request):
            requests.append(request)
            if request.url.host=='8.8.8.8':raise httpx.ConnectTimeout('offline fixture')
            return httpx.Response(200,content=b'original document')
        with patch('wujian.knowledge.validate_public_url',new_callable=AsyncMock,return_value=['8.8.8.8','1.1.1.1']), \
             patch('wujian.knowledge.public_transport',return_value=httpx.MockTransport(respond)):
            result=asyncio.run(download_public('https://manual.example.org/guide'))
        self.assertEqual(result[2],b'original document')
        self.assertEqual([r.url.host for r in requests],['8.8.8.8','1.1.1.1'])
        self.assertTrue(all(r.extensions['sni_hostname']=='manual.example.org' for r in requests))

    def test_private_and_literal_benchmark_addresses_never_use_remote_dns(self):
        for host,ip in [('localhost','127.0.0.1'),('internal.example','10.0.0.1'),('198.18.0.1','198.18.0.1')]:
            with patch('wujian.knowledge.socket.getaddrinfo',return_value=address(ip)),patch('wujian.knowledge.httpx.AsyncClient') as client:
                with self.assertRaises(domain.DomainError): asyncio.run(validate_public_url('https://'+host))
                client.assert_not_called()

    def resolve_fake(self,answers):
        response=httpx.Response(200,json={'Answer':[{'type':1,'data':ip} for ip in answers]})
        response.request=httpx.Request('GET','https://cloudflare-dns.com/dns-query')
        resolver=AsyncMock();resolver.get.return_value=response
        manager=AsyncMock();manager.__aenter__.return_value=resolver
        with patch('wujian.knowledge.socket.getaddrinfo',return_value=address('198.18.0.5')),patch('wujian.knowledge.httpx.AsyncClient',return_value=manager):
            return asyncio.run(validate_public_url('https://official.example/manual'))

    def test_fake_ip_requires_independent_globally_routable_answer(self):
        self.assertEqual(self.resolve_fake(['8.8.8.8']),'8.8.8.8')
        for answers in [[],['127.0.0.1'],['8.8.8.8','10.0.0.1']]:
            with self.assertRaises(domain.DomainError): self.resolve_fake(answers)
