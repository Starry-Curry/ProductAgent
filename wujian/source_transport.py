"""Verified-IP CONNECT with the original TLS name through a configured proxy.

httpcore's HTTP proxy tunnel ignores the request's sni_hostname extension and
uses the CONNECT IP as the TLS name. This narrow adapter keeps the public IP as
the destination while restoring the verified URL hostname for TLS validation.
It never resolves the target through the proxy or disables certificate checks.
"""
from contextvars import ContextVar

import httpcore
import httpx

_tls_target = ContextVar('source_tls_target', default=None)


class NamePreservingStream(httpcore.AsyncNetworkStream):
    def __init__(self, stream):
        self.stream = stream

    async def read(self, max_bytes, timeout=None):
        return await self.stream.read(max_bytes, timeout)

    async def write(self, buffer, timeout=None):
        return await self.stream.write(buffer, timeout)

    async def aclose(self):
        await self.stream.aclose()

    def get_extra_info(self, info):
        return self.stream.get_extra_info(info)

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        target = _tls_target.get()
        if target and server_hostname == target[0]:
            server_hostname = target[1]
        stream = await self.stream.start_tls(ssl_context, server_hostname, timeout)
        return NamePreservingStream(stream)


class NamePreservingBackend(httpcore.AsyncNetworkBackend):
    def __init__(self):
        self.backend = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        stream = await self.backend.connect_tcp(host, port, timeout, local_address, socket_options)
        return NamePreservingStream(stream)

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        return NamePreservingStream(await self.backend.connect_unix_socket(path, timeout, socket_options))

    async def sleep(self, seconds):
        await self.backend.sleep(seconds)


class ResponseStream(httpx.AsyncByteStream):
    def __init__(self, stream):
        self.stream = stream

    async def __aiter__(self):
        async for chunk in self.stream:
            yield chunk

    async def aclose(self):
        await self.stream.aclose()


class PinnedProxyTransport(httpx.AsyncBaseTransport):
    def __init__(self, proxy_url):
        proxy = httpx.Proxy(proxy_url)
        self.pool = httpcore.AsyncHTTPProxy(
            proxy_url=httpcore.URL(scheme=proxy.url.raw_scheme, host=proxy.url.raw_host,
                port=proxy.url.port, target=proxy.url.raw_path),
            proxy_auth=proxy.raw_auth, proxy_headers=proxy.headers.raw,
            proxy_ssl_context=proxy.ssl_context,
            network_backend=NamePreservingBackend(), retries=1,
            max_keepalive_connections=0)  # Avoid reusing one IP's TLS session for another hostname.

    async def handle_async_request(self, request):
        token = _tls_target.set((request.url.host, request.extensions.get('sni_hostname', request.url.host)))
        try:
            response = await self.pool.handle_async_request(httpcore.Request(
                method=request.method,
                url=httpcore.URL(scheme=request.url.raw_scheme,host=request.url.raw_host,
                    port=request.url.port,target=request.url.raw_path),
                headers=request.headers.raw,content=request.stream,extensions=request.extensions))
            return httpx.Response(response.status,headers=response.headers,
                stream=ResponseStream(response.stream),extensions=response.extensions)
        finally:
            _tls_target.reset(token)

    async def aclose(self):
        await self.pool.aclose()
