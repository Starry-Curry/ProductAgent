"""User-scoped temporary stdio collector sessions, never a cookie store/server."""
import asyncio
import base64
import json
import os
import subprocess
import time
import uuid

import psutil

from .domain import DomainError
from .mediacrawler_adapter import worker_launch


def _public_operation(request):
    if not isinstance(request, dict):
        raise DomainError("社区请求格式不正确", 422)
    if request.get("operation") == "search" and set(request) == {"operation", "query", "limit"}:
        query, limit = request["query"], request["limit"]
        if (isinstance(query, str) and 1 <= len(query.strip()) <= 200 and not any(ord(c) < 32 for c in query)
                and isinstance(limit, int) and not isinstance(limit, bool) and 1 <= limit <= 5):
            return request
    if request.get("operation") == "detail" and set(request) == {"operation", "bvid"}:
        from .source_video import canonical_video_url
        if isinstance(request["bvid"], str):
            canonical_video_url(f"https://www.bilibili.com/video/{request['bvid']}/")
            return request
    raise DomainError("临时社区会话只支持有界搜索和公开视频详情", 422)


class MediaCrawlerSession:
    def __init__(self, *, ttl_seconds=1800):
        self.ttl_seconds = min(1800, max(1, ttl_seconds))
        self.process = None
        self.stage = "disconnected"
        self.qr_data_url = None
        self.failure_phase = self.failure_reason = None
        self.started_at = None
        self._reader = self._expiry = None
        self._pending = {}
        self._lock = asyncio.Lock()
        self._closing = False
        self._cleanup_task = None
        # Ownership snapshots outlive failed cleanup attempts. Once the worker
        # exits, an unreaped orphan cannot be rediscovered from its old parent.
        self._descendants = {}

    async def start(self):
        command, environment = worker_launch("--session")
        spawning = asyncio.create_task(asyncio.create_subprocess_exec(*command, env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, limit=262144,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
        try:
            self.process = await asyncio.shield(spawning)
        except asyncio.CancelledError:
            try:
                self.process = await spawning
            except OSError:
                pass
            await self.close()
            raise
        except OSError:
            raise DomainError("无法启动临时MediaCrawler会话", 503) from None
        self.started_at, self.stage = time.monotonic(), "starting"
        self._reader = asyncio.create_task(self._read_messages())
        self._expiry = asyncio.create_task(self._expire())
        return self.status()

    def status(self):
        remaining = max(0, self.ttl_seconds - (time.monotonic() - self.started_at)) if self.started_at else 0
        return {"stage": self.stage, "connected": self.stage == "connected", "remaining_seconds": int(remaining),
                "qr_data_url": self.qr_data_url if self.stage == "waiting_scan" else None,
                "failure_phase": self.failure_phase, "failure_reason": self.failure_reason}

    async def _expire(self):
        await asyncio.sleep(self.ttl_seconds)
        await self.close(stage="expired")

    async def _read_messages(self):
        try:
            while line := await self.process.stdout.readline():
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("response")
                if value.get("event") == "stage":
                    stage = value.get("stage")
                    if stage not in {"opening", "waiting_scan", "connected", "login_failed", "needs_login"}:
                        raise ValueError("stage")
                    self.stage, self.qr_data_url = stage, None
                    if stage == "login_failed":
                        phase, reason = value.get("failure_phase"), value.get("failure_reason")
                        phases = {"browser_launch", "navigation", "login_ui", "qr_capture", "waiting_scan", "session_check"}
                        reasons = {"timeout", "authentication_unconfirmed", "upstream_login_stopped", "browser_or_login_error",
                                   "err_cert_authority_invalid", "err_connection_closed", "err_http2_protocol_error",
                                   "err_connection_reset", "err_name_not_resolved", "err_proxy_connection_failed"}
                        self.failure_phase = phase if phase in phases else None
                        self.failure_reason = reason if reason in reasons else None
                    elif stage == "connected":
                        self.failure_phase = self.failure_reason = None
                    if stage == "waiting_scan":
                        qr = value.get("qr_data_url")
                        if not isinstance(qr, str) or not qr.startswith("data:image/png;base64,") or len(qr) > 200000:
                            raise ValueError("qr")
                        body = base64.b64decode(qr.split(",", 1)[1], validate=True)
                        if not body.startswith(b"\x89PNG\r\n\x1a\n"):
                            raise ValueError("qr format")
                        self.qr_data_url = qr
                    continue
                request_id = value.get("request_id")
                future = self._pending.get(request_id) if isinstance(request_id, str) else None
                if future is None:
                    raise ValueError("unknown request")
                if not future.done():
                    future.set_result(value)
        except (OSError, ValueError, UnicodeError):
            self.stage = "unavailable"
        finally:
            if not self._closing:
                await self.close(stage="unavailable" if self.stage in {"starting", "opening", "waiting_scan", "connected"} else self.stage)

    async def request(self, request):
        request = _public_operation(request)
        async with self._lock:
            if self.stage != "connected" or self.process is None or self.process.returncode is not None:
                raise DomainError("B站临时会话尚未登录或已经结束，请重新扫码", 503)
            if time.monotonic() - self.started_at >= self.ttl_seconds:
                await self.close(stage="expired")
                raise DomainError("B站临时会话已到期，请重新扫码", 503)
            request_id = uuid.uuid4().hex
            future = asyncio.get_running_loop().create_future()
            self._pending[request_id] = future
            try:
                self.process.stdin.write(json.dumps({**request, "request_id": request_id}, ensure_ascii=False).encode("utf-8") + b"\n")
                await self.process.stdin.drain()
                result = await asyncio.wait_for(future, timeout=35)
                if result.get("status") == "needs_login":
                    await self.close(stage="needs_login")
                    raise DomainError("B站临时登录已失效，请重新扫码", 503)
                if result.get("status") != "ok" or not isinstance(result.get("data"), dict):
                    raise DomainError("B站公开资料请求未完成", 502)
                return result["data"]
            except asyncio.CancelledError:
                await self.close(force=True)
                raise
            except (OSError, asyncio.TimeoutError):
                await self.close(stage="unavailable", force=True)
                raise DomainError("B站临时请求已停止或超时，会话已关闭", 502) from None
            finally:
                self._pending.pop(request_id, None)

    async def close(self, *, stage="disconnected", force=False):
        # Every closer awaits the same owned cleanup. Cancelling an HTTP close
        # request must not cancel cleanup or make the session untrackable.
        if self._cleanup_task is None or (self._cleanup_task.done() and
                (self._cleanup_task.cancelled() or self._cleanup_task.exception() is not None)):
            self._closing = True
            self.stage, self.qr_data_url = stage, None
            self._cleanup_task = asyncio.create_task(self._cleanup(force))
        try:
            await asyncio.shield(self._cleanup_task)
        except psutil.Error:
            raise DomainError("临时采集进程暂未完成回收；会话保留以便再次关闭", 503) from None

    async def _cleanup(self, urgent):
        current = asyncio.current_task()
        cancelled = []
        for task in (self._reader, self._expiry):
            if task is not None and task is not current:
                task.cancel()
                cancelled.append(task)
        if cancelled:
            await asyncio.gather(*cancelled, return_exceptions=True)
        process = self.process
        descendants = self._descendants
        def capture_descendants():
            if process is None:
                return
            roots = list(descendants.values())
            if process.returncode is None:
                try:
                    roots.append(psutil.Process(process.pid))
                except psutil.NoSuchProcess:
                    pass
            for root in roots:
                try:
                    for child in root.children(recursive=True):
                        descendants[(child.pid, child.create_time())] = child
                except psutil.NoSuchProcess:
                    pass

        capture_descendants()
        if process is not None and process.returncode is None:
            try:
                # Even cancellation first lets the actual worker cancel its
                # pending operation and run browser/context finally blocks.
                process.stdin.write(b'{"operation":"close"}\n')
                await process.stdin.drain()
                process.stdin.close()
                await asyncio.wait_for(process.wait(), timeout=.25 if urgent else 4)
            except (OSError, asyncio.TimeoutError):
                capture_descendants()
        # Keep Process objects (including creation identity) instead of killing
        # by name or trusting a reused PID. Browser-like descendants that don't
        # honor EOF must be reaped even if their immediate worker has exited.
        capture_descendants()
        def kill_owned_descendants():
            children = list(descendants.values())
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            return children
        children = []
        if descendants:
            children = await asyncio.to_thread(kill_owned_descendants)
        if process is not None and process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
        if children:
            _, alive = await asyncio.to_thread(psutil.wait_procs, children, timeout=3)
            # On POSIX an already-killed grandchild may remain a non-running
            # zombie until its new parent reaps it; it cannot continue work.
            running = []
            for child in alive:
                try:
                    if child.is_running() and child.status() != psutil.STATUS_ZOMBIE:
                        running.append(child)
                except psutil.NoSuchProcess:
                    pass
            alive = running
            if alive:
                raise DomainError("临时采集后代进程尚未完成回收，会话仍保留以便重试", 503)
        descendants.clear()
        for future in self._pending.values():
            if not future.done():
                future.set_result({"status": "closed"})


class MediaCrawlerSessions:
    def __init__(self, *, ttl_seconds=1800):
        self.ttl_seconds = ttl_seconds
        self._sessions = {}
        self._lock = asyncio.Lock()

    async def start(self, user_id):
        async with self._lock:
            previous = self._sessions.get(user_id)
            if previous and previous.stage in {"starting", "opening", "waiting_scan", "connected"}:
                return previous.status()
            if previous:
                await previous.close()
            session = MediaCrawlerSession(ttl_seconds=self.ttl_seconds)
            self._sessions[user_id] = session
            try:
                return await session.start()
            except BaseException:
                await session.close()
                self._sessions.pop(user_id, None)
                raise

    async def status(self, user_id):
        session = self._sessions.get(user_id)
        return session.status() if session else {"stage": "disconnected", "connected": False,
                                                "remaining_seconds": 0, "qr_data_url": None,
                                                "failure_phase": None, "failure_reason": None}

    async def request(self, user_id, request):
        session = self._sessions.get(user_id)
        if not session:
            raise DomainError("请先为当前用户开启B站临时扫码会话", 503)
        return await session.request(request)

    async def close(self, user_id):
        async with self._lock:
            session = self._sessions.get(user_id)
        if session:
            await session.close()
            async with self._lock:
                if self._sessions.get(user_id) is session:
                    self._sessions.pop(user_id)
        return await self.status(user_id)

    async def close_all(self):
        async with self._lock:
            sessions = list(self._sessions.items())
        await asyncio.gather(*(session.close() for _, session in sessions))
        async with self._lock:
            for user_id, session in sessions:
                if self._sessions.get(user_id) is session:
                    self._sessions.pop(user_id)
