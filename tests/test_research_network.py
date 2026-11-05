"""Fake-IP proxy support must never become an SSRF bypass."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from wujian import domain
from wujian.knowledge import validate_public_url


def address(value): return [(2,1,6,'',(value,443))]


class ResearchNetworkTests(unittest.TestCase):
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
