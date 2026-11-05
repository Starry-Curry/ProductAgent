"""Offline permission/resource/network regression for optional video observations."""
import asyncio
import base64
import io
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image
from sqlalchemy import select

from wujian import domain
from wujian.config import Settings
from wujian.database import Asset, SourceRecord, make_database
from wujian.source_video import (MEDIA_LIMIT, METADATA_LIMIT, _decode_frames,
    _extract_metadata, _select_format, canonical_video_url, retained_video_frames, sample_source_video, sampling_times)

BVID = "BV1pa4y1B7f8"
URL = f"https://www.bilibili.com/video/{BVID}/"
MEDIA_URL = "https://media.bilivideo.com/public.m4s?ephemeral=not-public-log"
MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 24


def metadata():
    return {"id": BVID, "title": "公开夹子教程（合成测试数据）", "duration": 70.3,
        "formats": [{"format_id": "30016", "ext": "mp4", "url": MEDIA_URL,
                     "width": 640, "height": 360, "vcodec": "avc1.64001E", "tbr": 320}]}


def frame(second=6):
    output = io.BytesIO()
    Image.new("RGB", (64, 36), "#abcabc").save(output, format="PNG")
    return {"at_seconds": second, "width": 64, "height": 36, "body": output.getvalue()}


class SourceVideoTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name))
        self.settings.prepare()
        self.engine, self.sessions = make_database(self.settings)
        self.owner, self.friend = "person_demo_owner", "person_demo_friend"
        with self.sessions() as db:
            domain.seed_demo(db)
            source = SourceRecord(owner_id=self.owner, origin="public_web", url=URL,
                                  title="仅视频简介", content="公开视频描述", pages=[])
            db.add(source)
            db.commit()
            self.source_id = source.id

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    async def call(self, **kwargs):
        return await sample_source_video(self.settings, self.sessions, kwargs.pop("user_id", self.owner),
            self.source_id, kwargs.pop("start_seconds", 5), kwargs.pop("end_seconds", 10), kwargs.pop("frame_count", 1))

    async def test_permissions_and_non_bv_sources_fail_before_dependency_or_network(self):
        with patch("wujian.source_video._yt_types") as dependency, patch("wujian.source_video.download_public", new=AsyncMock()) as download:
            with self.assertRaises(domain.DomainError):
                await self.call(user_id=self.friend)
            with self.sessions() as db:
                db.get(SourceRecord, self.source_id).url = "https://example.com/not-video"
                db.commit()
            with self.assertRaises(domain.DomainError):
                await self.call()
            dependency.assert_not_called()
            download.assert_not_awaited()

    async def test_times_are_finite_bounded_and_count_is_small(self):
        for start, end, count in [(0, 31, 1), (-1, 2, 1), (2, 2, 1), (0, float("nan"), 1),
                                  (0, float("inf"), 1), (0, 2, 5), (0, 2, True)]:
            with self.subTest(start=start, end=end, count=count), self.assertRaises(domain.DomainError):
                sampling_times(start, end, count)
        self.assertEqual(sampling_times(5, 10, 2), [6.25, 8.75])

    async def test_derived_source_keeps_parent_scope_and_retains_actual_assets(self):
        observed = frame(7.5)
        with patch("wujian.source_video._ffmpeg_executable", return_value="trusted-ffmpeg"), \
             patch("wujian.source_video._yt_types"), patch("wujian.source_video._extract_metadata", return_value=metadata()), \
             patch("wujian.source_video.download_public", new=AsyncMock(return_value=(MEDIA_URL, "video/mp4", MP4))) as download, \
             patch("wujian.source_video._decode_frames", return_value=[observed]):
            result = await self.call()
        self.assertNotEqual(result["source_id"], self.source_id)
        self.assertEqual(base64.b64decode(result["frames"][0]["base64"]), observed["body"])
        self.assertEqual(download.await_args.kwargs["max_bytes"], MEDIA_LIMIT)
        self.assertEqual(download.await_args.kwargs["headers"]["Range"], "bytes=0-")
        self.assertNotIn("ephemeral", json.dumps(result))
        with self.sessions() as db:
            original = db.get(SourceRecord, self.source_id)
            self.assertEqual((original.origin, original.content), ("public_web", "公开视频描述"))
            derived = db.get(SourceRecord, result["source_id"])
            self.assertEqual((derived.origin, derived.owner_id), ("video_frame_sample", self.owner))
            manifest = json.loads(derived.content)
            self.assertEqual(manifest["parent_source_id"], self.source_id)
            self.assertEqual(manifest["requested_window_seconds"], [5, 10])
            self.assertEqual(Path(db.get(Asset, manifest["video_asset_id"]).path).read_bytes(), MP4)
            self.assertTrue(all(a.owner_id == self.owner for a in db.scalars(select(Asset))))
            # Another conversation sees the same saved frames, not a new sample
            # or a text manifest pretending to be an image observation.
            replay = retained_video_frames(db, self.owner, derived.id)
            self.assertEqual(base64.b64decode(replay["frames"][0]["base64"]), observed["body"])
            self.assertEqual(replay["source_id"], result["source_id"])
            with self.assertRaises(domain.DomainError):
                retained_video_frames(db, self.friend, derived.id)
            db.get(Asset,manifest["frames"][0]["asset_id"]).owner_id=self.friend
            db.commit()
            with self.assertRaises(domain.DomainError):
                retained_video_frames(db, self.owner, derived.id)

    async def test_revoke_parent_while_sampling_does_not_retain_assets(self):
        def revoked(*args):
            with self.sessions() as db:
                db.get(SourceRecord, self.source_id).owner_id = self.friend
                db.commit()
            return [frame()]
        with patch("wujian.source_video._ffmpeg_executable", return_value="ffmpeg"), \
             patch("wujian.source_video._yt_types"), patch("wujian.source_video._extract_metadata", return_value=metadata()), \
             patch("wujian.source_video.download_public", new=AsyncMock(return_value=(MEDIA_URL, "video/mp4", MP4))), \
             patch("wujian.source_video._decode_frames", side_effect=revoked):
            with self.assertRaises(domain.DomainError):
                await self.call()
        with self.sessions() as db:
            self.assertEqual(list(db.scalars(select(Asset))), [])
        self.assertEqual(list((self.settings.data_dir / "assets").iterdir()), [])

    async def test_cancelled_request_does_not_remove_a_running_workers_directory_or_save_assets(self):
        started, release = threading.Event(), threading.Event()
        observed = {}
        def still_running(executable, local_media, times, directory, cancelled):
            observed["directory"] = Path(directory)
            started.set()
            if not release.wait(3):
                raise AssertionError("test did not release worker")
            observed["media_exists_after_cancel"] = Path(local_media).is_file()
            observed["saw_cancel_signal"] = cancelled.is_set()
            # Reproduce a process finishing its local write after cancellation.
            (Path(directory) / "late-frame.png").write_bytes(frame()["body"])
            return []
        with patch("wujian.source_video._ffmpeg_executable", return_value="ffmpeg"), \
             patch("wujian.source_video._yt_types"), patch("wujian.source_video._extract_metadata", return_value=metadata()), \
             patch("wujian.source_video.download_public", new=AsyncMock(return_value=(MEDIA_URL, "video/mp4", MP4))), \
             patch("wujian.source_video._decode_frames", side_effect=still_running):
            task = asyncio.create_task(self.call())
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                self.assertTrue(observed["directory"].is_dir())
            finally:
                release.set()
            deadline = time.monotonic() + 2
            while observed["directory"].exists() and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
        self.assertTrue(observed["media_exists_after_cancel"])
        self.assertTrue(observed["saw_cancel_signal"])
        self.assertFalse(observed["directory"].exists())
        with self.sessions() as db:
            self.assertEqual(list(db.scalars(select(Asset))), [])
            self.assertEqual(len(list(db.scalars(select(SourceRecord)))), 1)

    async def test_invalid_or_oversized_media_never_enters_ffmpeg(self):
        for body in [b"<html>login</html>", MP4 + b"x" * MEDIA_LIMIT]:
            with self.subTest(size=len(body)), patch("wujian.source_video._ffmpeg_executable", return_value="ffmpeg"), \
                 patch("wujian.source_video._yt_types"), patch("wujian.source_video._extract_metadata", return_value=metadata()), \
                 patch("wujian.source_video.download_public", new=AsyncMock(return_value=(MEDIA_URL, "video/mp4", body))), \
                 patch("wujian.source_video._decode_frames") as decode:
                with self.assertRaises(domain.DomainError):
                    await self.call()
                decode.assert_not_called()

    async def test_private_redirect_is_rejected_by_shared_downloader(self):
        requests = []
        def serve(request):
            requests.append(request)
            return httpx.Response(302, headers={"location": "http://169.254.169.254/private"})
        client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch("wujian.source_video._ffmpeg_executable", return_value="ffmpeg"), \
             patch("wujian.source_video._yt_types"), patch("wujian.source_video._extract_metadata", return_value=metadata()), \
             patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=public), \
             patch("wujian.source_video._decode_frames") as decode:
            with self.assertRaises(domain.DomainError):
                await self.call()
            decode.assert_not_called()
        self.assertEqual(len(requests), 1)

    async def test_network_body_limit_is_passed_and_errors_do_not_leak_playback_url(self):
        async def too_large(url, **kwargs):
            self.assertEqual(kwargs["max_bytes"], MEDIA_LIMIT)
            raise ValueError(f"over budget {url}")
        with patch("wujian.source_video._ffmpeg_executable", return_value="ffmpeg"), \
             patch("wujian.source_video._yt_types"), patch("wujian.source_video._extract_metadata", return_value=metadata()), \
             patch("wujian.source_video.download_public", new=AsyncMock(side_effect=too_large)):
            with self.assertRaises(domain.DomainError) as caught:
                await self.call()
        self.assertNotIn("ephemeral", str(caught.exception))

    async def test_actual_stream_reader_stops_an_oversized_media_before_decoding(self):
        yielded = []
        class Oversized(httpx.AsyncByteStream):
            async def __aiter__(self):
                for index in range(20):
                    yielded.append(index)
                    yield b"x" * (1024 * 1024)
        client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, stream=Oversized(), headers={"content-type": "video/mp4"})))
        public = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch("wujian.source_video._ffmpeg_executable", return_value="ffmpeg"), \
             patch("wujian.source_video._yt_types"), patch("wujian.source_video._extract_metadata", return_value=metadata()), \
             patch("wujian.knowledge.httpx.AsyncClient", return_value=client), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=public), \
             patch("wujian.source_video._decode_frames") as decode:
            with self.assertRaises(domain.DomainError):
                await self.call()
            decode.assert_not_called()
        self.assertLess(len(yielded), 20)
        self.assertEqual(len(yielded), 13)  # The shared reader rejects on its first over-limit chunk.


class FormatAndDecoderTests(unittest.TestCase):
    def test_rejects_playlist_parameters_wrong_identity_drm_and_manifest_formats(self):
        for url in [URL + "?p=2", URL + "#x", "http://www.bilibili.com/video/" + BVID,
                    "https://user:password@www.bilibili.com/video/" + BVID,
                    "https://www.bilibili.com:bad/video/" + BVID]:
            with self.subTest(url=url), self.assertRaises(domain.DomainError):
                canonical_video_url(url)
        for change in [{"id": "BVOTHER"}, {"availability": "needs_auth"}, {"is_live": True}]:
            with self.subTest(change=change), self.assertRaises(domain.DomainError):
                _select_format(metadata() | change, BVID, 10)
        for change in [{"has_drm": True}, {"manifest_url": "https://x/playlist.mpd"},
                       {"fragments": [{"url": "https://x/segment"}]}, {"width": 1920},
                       {"url": "http://127.0.0.1/movie"}, {"filesize": MEDIA_LIMIT + 1}]:
            info = metadata()
            info["formats"][0].update(change)
            with self.subTest(change=change), self.assertRaises(domain.DomainError):
                _select_format(info, BVID, 10)

    def test_ffmpeg_command_is_local_only_and_timeout_is_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / "source.mp4"
            local.write_bytes(MP4)
            def run(command, **kwargs):
                self.assertFalse(kwargs["shell"])
                self.assertEqual(kwargs["timeout"], 12)
                self.assertEqual(command[command.index("-protocol_whitelist") + 1], "file,pipe")
                self.assertEqual(command[command.index("-enable_drefs") + 1], "0")
                self.assertEqual(command[command.index("-use_absolute_path") + 1], "0")
                self.assertEqual(command[command.index("-f") + 1], "mov")
                self.assertEqual(command[command.index("-i") + 1], str(local))
                self.assertNotIn("https://", " ".join(command))
                Path(command[-1]).write_bytes(frame()["body"])
                return type("Completed", (), {"returncode": 0})()
            with patch("wujian.source_video.subprocess.run", side_effect=run):
                self.assertEqual(len(_decode_frames("ffmpeg", local, [3], directory)), 1)
            import subprocess
            with patch("wujian.source_video.subprocess.run", side_effect=subprocess.TimeoutExpired("ffmpeg", 12)):
                with self.assertRaises(domain.DomainError):
                    _decode_frames("ffmpeg", local, [3], directory)

    def test_cancellation_between_frames_does_not_start_another_process(self):
        cancelled = threading.Event()
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / "source.mp4"
            local.write_bytes(MP4)
            def completed_during_cancel(command, **kwargs):
                cancelled.set()
                Path(command[-1]).write_bytes(frame()["body"])
                return type("Completed", (), {"returncode": 0})()
            with patch("wujian.source_video.subprocess.run", side_effect=completed_during_cancel) as run:
                self.assertEqual(_decode_frames("ffmpeg", local, [3, 6, 9], directory, cancelled), [])
            self.assertEqual(run.call_count, 1)


class ExtractorAdapterTests(unittest.TestCase):
    """Fake SDK transport, no optional dependency needed for ordinary CI."""
    def types(self, requests, director=False):
        class Request:
            def __init__(self, url, method="GET", data=None):
                self.url, self.method, self.data = url, method, data
                self.headers = {"Cookie": "secret", "Authorization": "secret", "Host": "localhost"}
        class Response:
            def __init__(self, fp, url, headers):
                self.fp, self.url, self.headers = fp, url, headers
        class Downloader:
            def __init__(self, *args, **kwargs): pass
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def add_info_extractor(self, extractor): pass
            def extract_info(self, *args, **kwargs):
                if director: self.build_request_director()
                for request in requests:
                    response = self.urlopen(Request(**request))
                    if response.headers.get("Content-Encoding"): raise AssertionError("double decoding")
                    response.fp.read()
                return metadata()
        return Downloader, type("Extractor", (), {}), Request, Response

    def test_every_get_uses_shared_downloader_and_drops_authentication_headers(self):
        calls = []
        async def read(url, **kwargs):
            calls.append((url, kwargs))
            self.assertEqual(set(kwargs["headers"]), {"User-Agent", "Referer"})
            return url, "text/html; charset=utf-8", b"already-decoded"
        requests = [{"url": URL}, {"url": "https://api.bilibili.com/x/player/v2"}]
        with patch("wujian.source_video._yt_types", return_value=self.types(requests)), \
             patch("wujian.source_video.download_public", new=AsyncMock(side_effect=read)):
            _extract_metadata(URL)
        self.assertEqual(len(calls), 2)

    def test_non_get_foreign_hosts_direct_network_and_request_exhaustion_fail_closed(self):
        cases = [[{"url": URL, "method": "POST", "data": b"x"}], [{"url": "https://evil.example/x"}],
                 [{"url": URL}] * 11]
        for requests in cases:
            with self.subTest(requests=len(requests)), patch("wujian.source_video._yt_types", return_value=self.types(requests)), \
                 patch("wujian.source_video.download_public", new=AsyncMock(return_value=(URL, "text/html", b"ok"))):
                with self.assertRaises(domain.DomainError):
                    _extract_metadata(URL)
        with patch("wujian.source_video._yt_types", return_value=self.types([], director=True)):
            with self.assertRaises(domain.DomainError):
                _extract_metadata(URL)

    def test_metadata_total_bytes_and_private_dns_fail_closed(self):
        requests = [{"url": URL}] * 4
        with patch("wujian.source_video._yt_types", return_value=self.types(requests)), \
             patch("wujian.source_video.download_public", new=AsyncMock(return_value=(URL, "text/html", b"x" * (1024 * 1024)))):
            with self.assertRaises(domain.DomainError):
                _extract_metadata(URL)
        private = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch("wujian.source_video._yt_types", return_value=self.types([{"url": URL}])), \
             patch("wujian.public_network.socket.getaddrinfo", return_value=private):
            with self.assertRaises(domain.DomainError):
                _extract_metadata(URL)


if __name__ == "__main__":
    unittest.main()
