"""Optional, source-bound anonymous BiliBili frame sampling.

yt-dlp supplies platform parsing, never its own network/downloader. All HTTP
passes through the shared public-address/pinned-IP reader. FFmpeg sees only a
bounded local MP4, not remote URLs. This is sampling, not a complete tutorial.
"""
import asyncio
import base64
import io
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image

from .database import Asset, SourceRecord, now, uid
from .domain import DomainError
from .knowledge import download_public
from .source_access import readable_source

MEDIA_LIMIT = 12 * 1024 * 1024
METADATA_LIMIT = 3 * 1024 * 1024
FRAME_LIMIT = 1024 * 1024
PUBLIC_HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"}
SCOPE = "仅观察指定时间窗的少量抽帧；未观看完整视频、未听取音频，不能据此补全未见动作。"


def retained_video_frames(db, user_id, source_id):
    """Reopen the actual saved observations, not just their manifest text."""
    source = readable_source(db, user_id, source_id)
    if source.origin != "video_frame_sample":
        raise DomainError("此来源不是已留存的视频抽帧", 422)
    manifest = json.loads(source.content)
    records = manifest.get("frames", [])
    if not 1 <= len(records) <= 4:
        raise DomainError("已留存抽帧清单无效", 422)
    frames = []
    for record in records:
        asset = db.get(Asset, record["asset_id"])
        if not asset or asset.owner_id != source.owner_id or asset.media_type != "image/png":
            raise DomainError("这份来源的抽帧资产已不可用", 404)
        path = Path(asset.path)
        if not path.is_file() or path.stat().st_size > FRAME_LIMIT:
            raise DomainError("这份来源的抽帧文件已不可用", 404)
        frames.append({**record, "media_type": asset.media_type,
                       "base64": base64.b64encode(path.read_bytes()).decode("ascii")})
    return {"source_id": source.id, "parent_source_id": manifest["parent_source_id"],
        "source_url": source.url, "content_level": "sampled_video_frames_not_full_video",
        "manifest": manifest, "frames": frames}


def canonical_video_url(url):
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError:
        raise DomainError("视频来源端口无效", 422) from None
    if (parsed.scheme != "https" or parsed.hostname not in {"www.bilibili.com", "bilibili.com"}
            or parsed.username or parsed.password or port not in {None, 443}):
        raise DomainError("仅支持已获准的B站BV视频来源", 422)
    match = re.fullmatch(r"/video/(BV[0-9A-Za-z]{10})/?", parsed.path)
    if not match or parsed.query or parsed.fragment:
        raise DomainError("仅支持单条规范BV视频来源，不支持列表或播放参数", 422)
    return f"https://www.bilibili.com/video/{match[1]}/", match[1]


def sampling_times(start_seconds, end_seconds, frame_count):
    if (isinstance(frame_count, bool) or not isinstance(frame_count, int) or not 1 <= frame_count <= 4
            or isinstance(start_seconds, bool) or isinstance(end_seconds, bool)):
        raise DomainError("抽帧数量须为1至4，时间窗须为有限秒数", 422)
    try:
        start, end = float(start_seconds), float(end_seconds)
    except (ValueError, TypeError):
        raise DomainError("采样时间必须为有限秒数", 422) from None
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or not 0 < end - start <= 30:
        raise DomainError("采样时间窗须为0至30秒的正区间", 422)
    return [round(start + (end - start) * (index + 0.5) / frame_count, 3) for index in range(frame_count)]


def _ffmpeg_executable():
    # Local operator configuration only; never an Agent tool argument or shell.
    configured = os.getenv("FFMPEG_BINARY", "")
    if configured and not Path(configured).is_absolute():
        raise DomainError("FFMPEG_BINARY须为本地可执行文件绝对路径", 503)
    executable = configured or shutil.which("ffmpeg.exe") or shutil.which("ffmpeg")
    if not executable or Path(executable).suffix.lower() in {".cmd", ".bat", ".ps1"}:
        raise DomainError("抽帧需要真实FFmpeg可执行文件；可在本地配置FFMPEG_BINARY绝对路径", 503)
    path = Path(executable).resolve()
    if not path.is_file():
        raise DomainError("FFmpeg可执行文件不存在", 503)
    return str(path)


def _yt_types():
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.extractor.bilibili import BiliBiliIE
        from yt_dlp.networking.common import Request, Response
    except ImportError:
        raise DomainError("公开视频采样尚未安装可选yt-dlp组件", 503) from None
    return YoutubeDL, BiliBiliIE, Request, Response


class _Quiet:
    def debug(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


def _extract_metadata(url):
    YoutubeDL, BiliBiliIE, Request, Response = _yt_types()
    deadline, calls, received = time.monotonic() + 45, 0, 0

    class PinnedYoutubeDL(YoutubeDL):
        def build_request_director(self, *args, **kwargs):
            raise DomainError("提取器备用网络已禁用", 502)

        def urlopen(self, request):
            nonlocal calls, received
            if isinstance(request, str):
                request = Request(request)
            if not isinstance(request, Request) or request.method != "GET" or request.data is not None:
                raise DomainError("提取器仅允许匿名GET", 422)
            parsed = urlsplit(request.url)
            host = parsed.hostname or ""
            if parsed.scheme != "https" or not (host == "bilibili.com" or host.endswith(".bilibili.com")):
                raise DomainError("提取器仅允许B站公开元数据地址", 422)
            calls += 1
            remaining = deadline - time.monotonic()
            if calls > 10 or remaining <= 0 or received >= METADATA_LIMIT:
                raise DomainError("视频元数据超过请求、时间或字节上限", 422)
            # Ignore ALL extractor headers (including Cookie/Authorization), use
            # only these internal anonymous constants. Body is already decoded.
            final_url, content_type, body = asyncio.run(asyncio.wait_for(
                download_public(request.url, max_bytes=min(1024 * 1024, METADATA_LIMIT - received),
                                headers=PUBLIC_HEADERS), timeout=min(15, remaining)))
            received += len(body)
            if received > METADATA_LIMIT:
                raise DomainError("视频元数据超过字节上限", 422)
            return Response(io.BytesIO(body), final_url, {
                "Content-Type": content_type, "Content-Length": str(len(body))})

    try:
        with PinnedYoutubeDL({"quiet": True, "logger": _Quiet(), "cachedir": False,
                "skip_download": True, "noplaylist": True, "extractor_retries": 0,
                "retries": 0, "proxy": ""}, auto_init=False) as downloader:
            downloader.add_info_extractor(BiliBiliIE())
            info = downloader.extract_info(url, download=False, process=False, ie_key="BiliBili")
    except DomainError:
        raise
    except Exception:
        # Third-party exceptions can contain expiring playback URLs or headers.
        raise DomainError("公开视频元数据读取失败；未登录或绕过访问限制", 502) from None
    if not isinstance(info, dict) or info.get("_type", "video") != "video":
        raise DomainError("仅支持单条可公开读取视频", 422)
    return info


def _select_format(info, bvid, end_seconds):
    if info.get("id") != bvid or info.get("is_live") or info.get("availability") in {"premium_only", "subscriber_only", "needs_auth"}:
        raise DomainError("视频身份不匹配或需要额外授权", 422)
    duration = info.get("duration")
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or end_seconds > duration:
        raise DomainError("采样时间超过可确认的视频时长", 422)
    candidates = []
    for fmt in info.get("formats", []):
        if (fmt.get("ext") != "mp4" or fmt.get("protocol") not in {None, "https", "http"}
                or fmt.get("fragments") or fmt.get("manifest_url") or fmt.get("has_drm") or fmt.get("vcodec") in {None, "none"}
                or not isinstance(fmt.get("height"), (int, float)) or not 0 < fmt["height"] <= 480
                or not isinstance(fmt.get("width"), (int, float)) or not 0 < fmt["width"] <= 854):
            continue
        parsed = urlsplit(fmt.get("url", ""))
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not host.endswith((".bilivideo.com", ".akamaized.net")):
            continue
        size = fmt.get("filesize") or fmt.get("filesize_approx")
        if not size and isinstance(fmt.get("tbr"), (int, float)):
            size = fmt["tbr"] * duration * 1000 / 8
        if size and (not isinstance(size, (int, float)) or size > MEDIA_LIMIT):
            continue
        candidates.append({**fmt, "estimated_bytes": size})
    if not candidates:
        raise DomainError("未取得12MB以内可匿名读取的低分辨率单文件MP4格式", 422)
    return min(candidates, key=lambda fmt: (fmt["height"], not str(fmt.get("vcodec")).startswith("avc"),
                                           fmt.get("filesize") or fmt.get("filesize_approx") or MEDIA_LIMIT))


def _decode_frames(executable, media_path, times, temporary_dir, cancelled=None):
    frames = []
    for index, second in enumerate(times):
        if cancelled is not None and cancelled.is_set():
            return []
        output = Path(temporary_dir) / f"frame-{index}.png"
        command = [executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2",
            "-enable_drefs", "0", "-use_absolute_path", "0", "-max_pixels", "921600", "-threads", "1",
            "-ss", str(second), "-f", "mov", "-i", str(media_path), "-map", "0:v:0", "-an", "-sn", "-dn",
            "-frames:v", "1", "-vf", "scale=640:480:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-threads", "1", "-c:v", "png", "-fs", str(FRAME_LIMIT), str(output)]
        try:
            completed = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, timeout=12, shell=False,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except (OSError, subprocess.TimeoutExpired):
            raise DomainError("本地抽帧失败或超过时间限制", 422) from None
        if cancelled is not None and cancelled.is_set():
            return []
        if completed.returncode or not output.is_file() or output.stat().st_size > FRAME_LIMIT:
            raise DomainError("本地抽帧未生成有效的有界PNG", 422)
        body = output.read_bytes()
        try:
            with Image.open(io.BytesIO(body)) as picture:
                if picture.format != "PNG" or not 0 < picture.width <= 640 or not 0 < picture.height <= 480:
                    raise ValueError("dimensions")
                picture.verify()
            with Image.open(io.BytesIO(body)) as picture:
                picture.load()
                width, height = picture.size
        except (OSError, ValueError, Image.DecompressionBombError):
            raise DomainError("抽帧图片无效或超过像素限制", 422) from None
        frames.append({"at_seconds": second, "width": width, "height": height, "body": body})
    return frames


def _sample_local_media(executable, media, times, cancelled):
    # The worker owns this directory for its entire lifetime. Cancelling an
    # asyncio.to_thread await does not stop its thread or the current FFmpeg;
    # cleanup in the caller would otherwise race with those local file writes.
    with tempfile.TemporaryDirectory(prefix="wujian-video-") as temporary_dir:
        if cancelled.is_set():
            return []
        local_media = Path(temporary_dir) / "source.mp4"
        local_media.write_bytes(media)
        return _decode_frames(executable, local_media, times, temporary_dir, cancelled)


async def sample_source_video(settings, sessions, user_id, source_id,
                              start_seconds, end_seconds, frame_count=3):
    """Return bounded actual frames; no visual model, animation or remote ffmpeg."""
    times = sampling_times(start_seconds, end_seconds, frame_count)
    with sessions() as db:
        parent = readable_source(db, user_id, source_id)
        if parent.origin != "public_web":
            raise DomainError("仅支持已读取的公开B站网页来源", 422)
        url, bvid = canonical_video_url(parent.url)
    executable = _ffmpeg_executable()
    _yt_types()  # Fail before network when the optional dependency is absent.
    info = await asyncio.to_thread(_extract_metadata, url)
    fmt = _select_format(info, bvid, float(end_seconds))
    try:
        _, _, media = await asyncio.wait_for(download_public(fmt["url"], max_bytes=MEDIA_LIMIT,
            headers={**PUBLIC_HEADERS, "Range": "bytes=0-"}), timeout=30)
    except Exception:
        raise DomainError("公开视频媒体读取受限或超过12MB／时间上限", 502) from None
    if len(media) > MEDIA_LIMIT or len(media) < 12 or media[4:8] != b"ftyp":
        raise DomainError("取得内容不是有界单文件MP4", 422)
    cancelled = threading.Event()
    try:
        frames = await asyncio.to_thread(_sample_local_media, executable, media, times, cancelled)
    except asyncio.CancelledError:
        # The in-flight local process retains its existing 12-second timeout;
        # the worker stops before another frame and removes its own directory.
        cancelled.set()
        raise
    # Recheck the parent grant after all I/O, before retaining observations.
    with sessions() as db:
        parent = readable_source(db, user_id, source_id)
        current_url, _ = canonical_video_url(parent.url)
        if current_url != url or parent.origin != "public_web":
            raise DomainError("资料来源在采样过程中已改变", 409)
        created_paths = []
        try:
            def retain(body, media_type, name):
                asset_id = uid()
                path = settings.data_dir / "assets" / asset_id
                created_paths.append(path)
                path.write_bytes(body)
                db.add(Asset(id=asset_id, owner_id=user_id, path=str(path), media_type=media_type, original_name=name))
                return asset_id
            media_id = retain(media, "video/mp4", f"{bvid}-anonymous-original.mp4")
            manifest_frames = []
            for frame in frames:
                asset_id = retain(frame["body"], "image/png", f"{bvid}-at-{frame['at_seconds']}s.png")
                manifest_frames.append({key: frame[key] for key in ("at_seconds", "width", "height")} | {"asset_id": asset_id})
            manifest = {"parent_source_id": source_id, "source_url": url, "bvid": bvid,
                "title": str(info.get("title", bvid))[:240], "retrieved_at": now(),
                "video_asset_id": media_id, "video_bytes": len(media), "original_duration_seconds": info["duration"],
                "format_id": str(fmt.get("format_id", ""))[:80], "source_width": fmt["width"], "source_height": fmt["height"],
                "requested_window_seconds": [float(start_seconds), float(end_seconds)], "frames": manifest_frames,
                "timestamp_precision": "记录请求的seek秒数；解码帧按源帧率量化，不声称精确逐帧PTS。",
                "reading_scope": SCOPE, "download_scope": "取得一条有界低分辨率原视频文件，然后只在本地抽取指定帧；不是只下载该时间窗。"}
            derived = SourceRecord(owner_id=user_id, item_id=parent.item_id, origin="video_frame_sample",
                title=f"视频抽帧：{manifest['title']}", url=url, content=json.dumps(manifest, ensure_ascii=False),
                pages=[], asset_id=media_id)
            db.add(derived)
            db.commit()
            derived_id = derived.id
        except Exception:
            db.rollback()
            for path in created_paths:
                path.unlink(missing_ok=True)
            raise
    return {"source_id": derived_id, "parent_source_id": source_id, "source_url": url,
        "content_level": "sampled_video_frames_not_full_video", "manifest": manifest,
        "frames": [{**metadata, "media_type": "image/png", "base64": base64.b64encode(frame["body"]).decode("ascii")}
                   for metadata, frame in zip(manifest_frames, frames)]}
