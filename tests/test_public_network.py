"""Adversarial destination checks without contacting paid or public services."""
import socket
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from wujian.domain import DomainError
from wujian.knowledge import download_public
from wujian.public_network import public_doh_addresses, resolve_public_url


def dns_rows(*addresses):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443)) for address in addresses]


class PublicNetworkTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_origin_reader_does_not_forward_session_header_to_another_origin(self):
        for target in ("https://other.example.com/result", "http://example.com/result"):
            with self.subTest(target=target):
                observed = []
                def serve(request):
                    observed.append(request)
                    return httpx.Response(302, headers={"location": target})
                client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
                with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
                     patch("wujian.public_network.socket.getaddrinfo", return_value=dns_rows("8.8.8.8")):
                    with self.assertRaisesRegex(DomainError, "另一站点"):
                        await download_public("https://example.com/search", same_origin=True,
                            headers={"Cookie": "anonymous-fixture=not-a-user-credential"})
                self.assertEqual(len(observed), 1)
                self.assertEqual(observed[0].headers["host"], "example.com")

    async def test_same_origin_reader_keeps_normal_path_redirects_and_default_reader_can_change_public_origin(self):
        for restricted, target in ((True, "https://example.com:443/result"), (False, "https://other.example.com/result")):
            with self.subTest(restricted=restricted):
                observed = []
                def serve(request):
                    observed.append(request)
                    return httpx.Response(302, headers={"location": target}) if len(observed) == 1 else httpx.Response(200, text="public results")
                client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
                with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
                     patch("wujian.public_network.socket.getaddrinfo", return_value=dns_rows("8.8.8.8")):
                    final, _, body = await download_public("https://example.com/search", same_origin=restricted)
                self.assertEqual(len(observed), 2)
                self.assertEqual(body, b"public results")
                self.assertEqual(final, "https://example.com/result" if restricted else target)

    async def test_private_literal_destinations_and_invalid_authorities_rejected(self):
        for url in ["http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/",
                    "http://[::1]/", "http://224.0.0.1/", "http://198.18.0.1/",
                    "http://example.com:8000/", "https://name:secret@example.com/"]:
            with self.subTest(url=url), patch("wujian.public_network.public_doh_addresses", new=AsyncMock()) as doh:
                with self.assertRaises(DomainError):
                    await resolve_public_url(url)
                doh.assert_not_awaited()

    async def test_mixed_private_public_resolution_rejected_without_doh(self):
        for addresses in [("8.8.8.8", "127.0.0.1"), ("198.18.0.2", "10.0.0.2")]:
            with patch("wujian.public_network.socket.getaddrinfo", return_value=dns_rows(*addresses)), \
                 patch("wujian.public_network.public_doh_addresses", new=AsyncMock()) as doh:
                with self.assertRaises(DomainError):
                    await resolve_public_url("https://example.com/source")
                doh.assert_not_awaited()

    async def test_fake_dns_is_resolved_independently_not_used_as_destination(self):
        with patch("wujian.public_network.socket.getaddrinfo", return_value=dns_rows("198.18.0.12")), \
             patch("wujian.public_network.public_doh_addresses", new=AsyncMock(return_value=["8.8.8.8"])) as doh:
            original, addresses = await resolve_public_url("https://example.com/source#section")
        self.assertEqual(str(original), "https://example.com/source")
        self.assertEqual(addresses, ["8.8.8.8"])
        doh.assert_awaited_once_with("example.com")

    async def test_download_pins_dns_result_but_preserves_host_sni_and_public_identity(self):
        requests = []

        def serve(request):
            requests.append(request)
            return httpx.Response(200, text="public protocol", headers={"content-type": "text/plain"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
        with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=dns_rows("8.8.8.8")) as dns:
            final, _, content = await download_public("https://example.com/source?q=1")
        self.assertEqual(str(requests[0].url), "https://8.8.8.8/source?q=1")
        self.assertEqual(requests[0].headers["host"], "example.com")
        self.assertEqual(requests[0].extensions["sni_hostname"], "example.com")
        self.assertEqual(final, "https://example.com/source?q=1")
        self.assertEqual(content, b"public protocol")
        self.assertEqual(dns.call_count, 1)

    async def test_redirect_to_private_destination_stops_before_second_request(self):
        requests = []

        def serve(request):
            requests.append(request)
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
        with patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=dns_rows("8.8.8.8")):
            with self.assertRaises(DomainError):
                await download_public("https://example.com/source")
        self.assertEqual(len(requests), 1)

    async def test_doh_private_no_answer_and_wrong_question_are_failures(self):
        for answer, question in [([{"type": 1, "data": "127.0.0.1"}], "example.com."),
                                 ([], "example.com."),
                                 ([{"type": 1, "data": "8.8.8.8"}], "other.com.")]:
            with self.subTest(answer=answer, question=question):
                def serve(request):
                    self.assertEqual(str(request.url).split("?")[0], "https://223.5.5.5/resolve")
                    self.assertEqual(request.headers["host"], "dns.alidns.com")
                    self.assertEqual(request.extensions["sni_hostname"], "dns.alidns.com")
                    return httpx.Response(200, json={"Status": 0, "Question": {"name": question}, "Answer": answer})

                client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
                with patch("wujian.public_network.httpx.AsyncClient", return_value=client):
                    with self.assertRaises(DomainError):
                        await public_doh_addresses("example.com")

    async def test_tls_failure_is_not_retried_with_disabled_verification(self):
        requests = []

        def serve(request):
            requests.append(request)
            raise httpx.ConnectError("certificate verification failed", request=request)

        client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
        with patch("wujian.knowledge.httpx.AsyncClient", return_value=client) as constructor, \
             patch("wujian.public_network.socket.getaddrinfo", return_value=dns_rows("8.8.8.8")):
            with self.assertRaises(httpx.ConnectError):
                await download_public("https://example.com/source")
        self.assertEqual(len(requests), 1)
        self.assertNotEqual(constructor.call_args.kwargs.get("verify"), False)


if __name__ == "__main__":
    unittest.main()
