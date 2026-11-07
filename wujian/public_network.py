"""Public-only DNS resolution with pinned destinations, including TUN fake-DNS.

HTTPX/httpcore's documented sni_hostname extension preserves certificate checks
when a request connects to a verified IP instead of resolving the name again.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

import httpx

from .domain import DomainError


FAKE_DNS_RANGE = ipaddress.ip_network("198.18.0.0/15")


def public_unicast(address):
    return address.is_global and not address.is_multicast


async def public_doh_addresses(host):
    # Fixed Alibaba public DNS bootstrap: neither endpoint nor SNI is supplied
    # by a webpage. No account, cookies, API key or global DNS changes.
    async with httpx.AsyncClient(trust_env=False, timeout=10, follow_redirects=False) as client:
        response = await client.get("https://223.5.5.5/resolve", params={"name": host, "type": "A"},
                                    headers={"Host": "dns.alidns.com"},
                                    extensions={"sni_hostname": "dns.alidns.com"})
        response.raise_for_status()
        if len(response.content) > 65536:
            raise DomainError("公共DNS响应过大", 502)
        payload = response.json()
    question = payload.get("Question", {})
    if payload.get("Status") != 0 or not isinstance(question, dict) or question.get("name", "").rstrip(".").casefold() != host.rstrip(".").casefold():
        raise DomainError("公共DNS未能确认资料域名", 502)
    addresses = []
    for answer in payload.get("Answer", [])[:100]:
        if isinstance(answer, dict) and answer.get("type") == 1:
            try:
                address = ipaddress.ip_address(answer.get("data", ""))
            except ValueError as error:
                raise DomainError("公共DNS地址无效", 502) from error
            if not public_unicast(address):
                raise DomainError("资料读取不能访问本机或内网地址")
            addresses.append(str(address))
    if not addresses:
        raise DomainError("公共DNS未返回可连接的公网地址", 502)
    return list(dict.fromkeys(addresses))


async def resolve_public_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise DomainError("只支持公开的 HTTP 或 HTTPS 资料地址")
    try:
        if parsed.port not in (None, 80, 443):
            raise DomainError("不支持此资料端口")
        normalized = httpx.URL(url).copy_with(fragment=None)
    except (ValueError, httpx.InvalidURL) as error:
        raise DomainError("资料地址无效") from error
    host = normalized.raw_host.decode("ascii")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not public_unicast(literal):
            raise DomainError("资料读取不能访问本机或内网地址")
        return normalized, [str(literal)]
    try:
        resolved = await asyncio.to_thread(socket.getaddrinfo, host, parsed.port or (443 if parsed.scheme == "https" else 80), 0, socket.SOCK_STREAM)
    except OSError as error:
        raise DomainError("资料域名无法解析", 502) from error
    addresses = list(dict.fromkeys(row[4][0] for row in resolved))
    if not addresses:
        raise DomainError("资料域名没有地址", 502)
    values = [ipaddress.ip_address(address) for address in addresses]
    # Only benchmark-range fake DNS triggers an independent lookup. It is
    # NEVER a permitted destination. Private/link-local/etc. remain blocked.
    if all(value.version == 4 and value in FAKE_DNS_RANGE for value in values):
        addresses = await public_doh_addresses(host)
    elif any(not public_unicast(value) for value in values):
        raise DomainError("资料读取不能访问本机或内网地址")
    return normalized, addresses
