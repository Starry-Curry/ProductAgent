"""Isolated upstream BilibiliClient entrypoint; stdout is public JSON only."""
import asyncio
import base64
import contextlib
import importlib
import json
import logging
import os
from pathlib import Path
import re
import sys
import threading
import time
import types
from urllib.parse import urlsplit

from .domain import DomainError
from .knowledge import download_public


def load_client(source):
    sys.path.insert(0, str(source))
    # Avoid __init__ starting the full multi-platform crawler/store imports.
    for name, relative in (("media_platform", "media_platform"), ("media_platform.bilibili", "media_platform/bilibili")):
        package = types.ModuleType(name)
        package.__path__ = [str(source / relative)]
        sys.modules[name] = package
    config = importlib.import_module("config")
    for name in ("ENABLE_IP_PROXY", "ENABLE_GET_COMMENTS", "ENABLE_GET_SUB_COMMENTS", "ENABLE_GET_MEDIA", "SAVE_LOGIN_STATE", "DISABLE_SSL_VERIFY"):
        setattr(config, name, False)
    return importlib.import_module("media_platform.bilibili.client").BilibiliClient


async def execute(client_type, request, *, session_headers=None, signing_page=None):
    """One read-only operation; optional headers belong to the caller's RAM.

    The CLI never accepts headers or cookies. A short-lived operator-controlled
    login process may call this function with its own browser session, without
    exporting credentials to the application or another user's request.
    """
    calls, received, deadline = 0, 0, time.monotonic() + 25

    class PinnedClient(client_type):
        async def request(self, method, url, **kwargs):
            nonlocal calls, received
            parsed = urlsplit(url)
            if (method != "GET" or parsed.scheme != "https" or parsed.hostname != "api.bilibili.com"
                    or parsed.username or parsed.password or parsed.port not in (None, 443)
                    or parsed.path not in {"/x/web-interface/nav", "/x/web-interface/wbi/search/type", "/x/web-interface/view/detail"}):
                raise DomainError("MediaCrawler只允许指定公开GET", 422)
            calls += 1
            remaining = deadline - time.monotonic()
            if calls > 2 or received >= 1024 * 1024 or remaining <= 0:
                raise DomainError("MediaCrawler超过单次公开操作上限", 422)
            headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"}
            if session_headers is not None:
                # Only the authorized in-memory Bili session's Cookie is used;
                # never forward arbitrary upstream Host/Authorization headers.
                cookie = session_headers.get("Cookie")
                if isinstance(cookie, str) and cookie and "\r" not in cookie and "\n" not in cookie:
                    headers["Cookie"] = cookie
            _, _, body = await asyncio.wait_for(download_public(url,
                max_bytes=1024 * 1024 - received, same_origin=True,
                headers=headers), min(15, remaining))
            received += len(body)
            payload = json.loads(body)
            if not isinstance(payload, dict) or payload.get("code") != 0:
                # Return only an enum, never a complete authenticated response.
                message = str(payload.get("message", "")) if isinstance(payload, dict) else ""
                if "登录" in message or (isinstance(payload, dict) and payload.get("code") == -101):
                    raise PermissionError("needs_login")
                raise DomainError("MediaCrawler公开操作受限", 502)
            return payload.get("data", {})

    client = PinnedClient(timeout=15, headers={}, playwright_page=signing_page, cookie_dict={})
    operation = request.get("operation")
    if operation == "search":
        query, limit = request.get("query"), request.get("limit")
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200 or any(ord(c) < 32 for c in query):
            raise ValueError("query")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 5:
            raise ValueError("limit")
        value = await client.search_video_by_keyword(query.strip(), page=1, page_size=limit)
        rows = [{key: row.get(key) for key in ("bvid", "title", "author", "description")}
                for row in value.get("result", [])[:limit] if isinstance(row, dict)]
        return {"items": rows, "search_pages_read": 1, "network_requests": calls}
    if operation == "detail":
        bvid = request.get("bvid")
        if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
            raise ValueError("bvid")
        value = await client.get_video_info(bvid=bvid)
        view = value.get("View", value)
        if view.get("bvid") != bvid:
            raise ValueError("identity")
        result = {key: view.get(key) for key in ("bvid", "title", "desc", "duration")}
        result["author"] = view.get("owner", {}).get("name")
        result["parts"] = [{key: part.get(key) for key in ("page", "part", "duration")}
                           for part in view.get("pages", [])[:30] if isinstance(part, dict)]
        result["network_requests"] = calls
        return result
    if operation == "session_check":
        value = await client.request("GET", "https://api.bilibili.com/x/web-interface/nav")
        return {"authenticated": value.get("isLogin") is True}
    raise ValueError("operation")


async def session_main(client_type, protocol_output):
    """Fresh upstream QR login and read-only operations; all cookies stay here."""
    from playwright.async_api import async_playwright
    from media_platform.bilibili.login import BilibiliLogin
    from tools import utils
    login_phase = "browser_launch"

    def failure_reason(error):
        # Stable diagnostics only. Raw Playwright errors can contain login
        # image URLs/tokens and must never reach the application or logs.
        text = str(error)
        for code in ("ERR_CERT_AUTHORITY_INVALID", "ERR_CONNECTION_CLOSED", "ERR_HTTP2_PROTOCOL_ERROR",
                     "ERR_CONNECTION_RESET", "ERR_NAME_NOT_RESOLVED", "ERR_PROXY_CONNECTION_FAILED"):
            if code in text:
                return code.lower()
        if type(error).__name__ == "TimeoutError":
            return "timeout"
        if isinstance(error, PermissionError):
            return "authentication_unconfirmed"
        if isinstance(error, SystemExit):
            return "upstream_login_stopped"
        return "browser_or_login_error"

    def emit(value):
        print(json.dumps(value, ensure_ascii=False), file=protocol_output, flush=True)

    def show_qr(value):
        # The upstream login/check flow is unchanged; display stays in RAM.
        body = base64.b64decode(value.split(",")[-1], validate=True)
        if not body.startswith(b"\x89PNG\r\n\x1a\n") or len(body) > 130000:
            return
        emit({"event": "stage", "stage": "waiting_scan",
              "qr_data_url": "data:image/png;base64," + base64.b64encode(body).decode("ascii")})

    async def capture_qr(page, selector):
        # The upstream helper can swallow a transient src/HTTP error and exit
        # login. Observe the actual browser image with Playwright's retrying
        # assertions rather than fetching a signed QR URL in another client.
        from playwright.async_api import expect
        nonlocal login_phase
        login_phase = "qr_capture"
        image = page.locator(selector).first
        await expect(image).to_have_js_property("complete", True, timeout=15000)
        await expect(image).not_to_have_js_property("naturalWidth", 0, timeout=15000)
        body = await image.screenshot(type="png", timeout=15000)
        if not body.startswith(b"\x89PNG\r\n\x1a\n") or len(body) > 130000:
            raise ValueError("invalid_qr_image")
        login_phase = "waiting_scan"
        return base64.b64encode(body).decode("ascii")

    utils.show_qrcode = show_qr
    utils.find_login_qrcode = capture_qr
    # Windows inherited stdin handles do not consistently deliver partial
    # input through Proactor connect_read_pipe. One daemon only reads stdio;
    # it never performs requests and cannot keep an expired worker alive.
    loop = asyncio.get_running_loop()
    input_lines = asyncio.Queue(maxsize=4)
    def enqueue(line):
        if not input_lines.full():
            input_lines.put_nowait(line)
    def read_input():
        buffered = b""
        while True:
            try:
                chunk = os.read(sys.stdin.fileno(), 4096)
            except OSError:
                chunk = b""
            if not chunk:
                try:
                    loop.call_soon_threadsafe(enqueue, b"")
                except RuntimeError:
                    pass
                break
            buffered += chunk
            while b"\n" in buffered:
                line, buffered = buffered.split(b"\n", 1)
                if len(line) > 8192:
                    line = b""
                try:
                    loop.call_soon_threadsafe(enqueue, line)
                except RuntimeError:
                    return
                if not line:
                    return
            if len(buffered) > 8192:
                try:
                    loop.call_soon_threadsafe(enqueue, b"")
                except RuntimeError:
                    pass
                return
    threading.Thread(target=read_input, name="mediacrawler-stdio", daemon=True).start()
    pending_input = login_task = operation_task = None
    browser = None
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(channel="msedge", headless=True)
            context = await browser.new_context(viewport={"width": 1100, "height": 820})
            page = await context.new_page()
            emit({"event": "stage", "stage": "opening"})

            async def login():
                nonlocal login_phase
                login_phase = "navigation"
                await page.goto("https://www.bilibili.com/", wait_until="domcontentloaded", timeout=40000)
                login_phase = "login_ui"
                try:
                    await asyncio.wait_for(BilibiliLogin("qrcode", context, page).begin(), timeout=540)
                except SystemExit:
                    raise RuntimeError("upstream login did not complete") from None
                cookie, _ = await utils.convert_browser_context_cookies(context, urls=["https://www.bilibili.com"])
                login_phase = "session_check"
                checked = await execute(client_type, {"operation": "session_check"},
                                        session_headers={"Cookie": cookie}, signing_page=page)
                if not checked["authenticated"]:
                    raise PermissionError("needs_login")
                emit({"event": "stage", "stage": "connected"})

            login_task = asyncio.create_task(login())
            pending_input = asyncio.create_task(input_lines.get())
            authenticated = False
            deadline = time.monotonic() + 1800
            while time.monotonic() < deadline:
                waiting = {pending_input}
                if not authenticated:
                    waiting.add(login_task)
                done, _ = await asyncio.wait(waiting, timeout=max(0, deadline - time.monotonic()),
                                             return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    break
                if login_task in done and not authenticated:
                    try:
                        await login_task
                        authenticated = True
                    except (Exception, SystemExit) as error:
                        emit({"event": "stage", "stage": "login_failed",
                              "failure_phase": login_phase, "failure_reason": failure_reason(error)})
                        break
                if pending_input not in done:
                    continue
                line = await pending_input
                if not line:
                    break
                request = json.loads(line)
                if request.get("operation") == "close":
                    break
                request_id = request.get("request_id")
                if not isinstance(request_id, str) or len(request_id) > 80:
                    break
                response = {"request_id": request_id, "status": "unavailable"}
                pending_input = asyncio.create_task(input_lines.get())
                if not authenticated:
                    response["status"] = "needs_login"
                else:
                    try:
                        from .mediacrawler_session import _public_operation
                        operation = _public_operation({key: value for key, value in request.items() if key != "request_id"})
                        cookie, _ = await utils.convert_browser_context_cookies(context, urls=["https://www.bilibili.com"])
                        operation_task = asyncio.create_task(execute(client_type, operation,
                            session_headers={"Cookie": cookie}, signing_page=page))
                        completed, _ = await asyncio.wait({operation_task, pending_input},
                                                         return_when=asyncio.FIRST_COMPLETED)
                        if pending_input in completed:
                            # close/EOF during an operation cancels its actual
                            # network work before closing browser and context.
                            operation_task.cancel()
                            await asyncio.gather(operation_task, return_exceptions=True)
                            break
                        response["data"] = await operation_task
                        response["status"] = "ok"
                    except PermissionError:
                        response["status"] = "needs_login"
                        authenticated = False
                    except Exception:
                        pass
                emit(response)
                if response["status"] == "needs_login" and login_task.done():
                    emit({"event": "stage", "stage": "needs_login"})
                    break
            await context.close()
            await browser.close()
            browser = None
    except Exception as error:
        emit({"event": "stage", "stage": "login_failed",
              "failure_phase": login_phase, "failure_reason": failure_reason(error)})
    finally:
        for task in (pending_input, login_task, operation_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(*(task for task in (pending_input, login_task, operation_task) if task is not None), return_exceptions=True)
        if browser is not None:
            await browser.close()


def main():
    logging.disable(logging.CRITICAL)
    protocol_output = sys.stdout
    try:
        source = Path(sys.argv[1])
        if sys.argv[2:] == ["--session"]:
            with contextlib.redirect_stdout(sys.stderr):
                client_type = load_client(source)
                asyncio.run(session_main(client_type, protocol_output))
            return
        request = json.loads(sys.stdin.read(4097))
        if not isinstance(request, dict):
            raise ValueError("request")
        # Upstream imports/helpers may print; none of that belongs in tool data.
        with contextlib.redirect_stdout(sys.stderr):
            client_type = load_client(source)
            result = asyncio.run(execute(client_type, request))
        response = {"status": "ok", "data": result}
    except ImportError:
        response = {"status": "dependency_unavailable"}
    except PermissionError:
        response = {"status": "needs_login"}
    except Exception:
        response = {"status": "unavailable"}
    print(json.dumps(response, ensure_ascii=False), file=protocol_output, flush=True)


if __name__ == "__main__":
    main()
