"""Optional isolated MediaCrawler client, with one bounded public operation.

Only local operator configuration chooses executable/source paths. The Agent
supplies a query or BV identity, never cookies, a command, or a filesystem path.
The upstream dependency stays in its own environment; its default full crawler,
login, storage, comments and media flows are never started here.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sysconfig
import tempfile

from .domain import DomainError


def worker_launch(*extra_arguments):
    """Trusted local launch config shared by one-shot and temporary sessions."""
    python = Path(os.getenv("WUJIAN_MEDIACRAWLER_PYTHON", ""))
    source = Path(os.getenv("WUJIAN_MEDIACRAWLER_SOURCE", ""))
    if (not python.is_absolute() or not python.is_file() or python.suffix.lower() in {".cmd", ".bat", ".ps1"}
            or not source.is_absolute() or not (source / "media_platform/bilibili/client.py").is_file()):
        raise DomainError("MediaCrawler尚未配置独立Python和源码目录；没有读取浏览器登录态", 503)
    project = Path(__file__).resolve().parent.parent
    # No inherited API keys, account cookies, browser profile or proxy settings.
    environment = {key: os.environ[key] for key in (
        "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "SystemDrive",
        "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA",
    ) if key in os.environ}
    # Node requires a home even with a nonpersistent Playwright context. Give
    # the isolated worker an empty runtime directory, not the user's profile.
    runtime_home = Path(tempfile.gettempdir()) / "wujian-community-runtime"
    runtime_home.mkdir(exist_ok=True)
    environment.update(USERPROFILE=str(runtime_home), HOME=str(runtime_home))
    environment.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1",
                       PYTHONPATH=os.pathsep.join([str(project), sysconfig.get_path("purelib")]))
    return [str(python), "-m", "wujian.mediacrawler_worker", str(source), *extra_arguments], environment


async def request_public(request):
    command, environment = worker_launch()
    # Shield creation so cancellation cannot lose a child between OS creation
    # and receiving its handle. Cancellation/timeout must stop actual work,
    # rather than merely abandoning a thread awaiting subprocess.run.
    spawning = asyncio.create_task(asyncio.create_subprocess_exec(
        *command,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=environment, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
    process = None
    try:
        process = await asyncio.shield(spawning)
        stdout, _ = await asyncio.wait_for(process.communicate(
            json.dumps(request, ensure_ascii=False).encode("utf-8")), timeout=35)
    except asyncio.CancelledError:
        # A pending spawn still belongs to us; reap it before propagating.
        if process is None:
            try:
                process = await spawning
            except OSError:
                pass
        raise
    except (OSError, asyncio.TimeoutError):
        raise DomainError("MediaCrawler只读请求未完成；没有尝试登录或反复重试", 502) from None
    finally:
        if process is not None and process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
    if process.returncode or len(stdout) > 65536:
        raise DomainError("MediaCrawler适配器未返回有效的有界结果", 502)
    try:
        result = json.loads(stdout)
    except (ValueError, UnicodeError):
        raise DomainError("MediaCrawler适配器未返回JSON结果", 502) from None
    if not isinstance(result, dict) or result.get("status") != "ok":
        reason = result.get("status") if isinstance(result, dict) else "failed"
        if reason == "needs_login":
            raise DomainError("MediaCrawler需要新的临时扫码会话；当前工具未登录，也未复用旧会话", 503)
        if reason == "dependency_unavailable":
            raise DomainError("MediaCrawler隔离环境依赖不完整", 503)
        raise DomainError("MediaCrawler公开请求受限或未完成；没有使用账号或绕过限制", 502)
    if not isinstance(result.get("data"), dict):
        raise DomainError("MediaCrawler适配器结果缺少公开数据", 502)
    return result["data"]
