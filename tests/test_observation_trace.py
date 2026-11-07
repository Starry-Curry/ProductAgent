"""Native SDK/FastAPI/isolated SQL observation traces; no visual quality claim.

Only media acquisition is a named synthetic fixture. No public network, paid
model, real device, production database or fabricated visual acceptance.
"""
import base64
import copy
import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import TextBlock, ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from agentscope.model._model_usage import ChatUsage
from agentscope.permission import PermissionBehavior, PermissionDecision
from agentscope.tool import FunctionTool, Toolkit, ToolChunk
from fastapi.testclient import TestClient
from PIL import Image

from wujian.config import Settings
from wujian.database import Run, SourceRecord
from wujian.server import create_app


PARENT, CHILD = "offline-parent-video", "offline-observed-frames"
URL = "https://www.bilibili.com/video/BV1pa4y1B7f8/"


def video_fixture():
    image = io.BytesIO()
    Image.new("RGB", (16, 12), "#abcabc").save(image, "PNG")
    return {"source_id": CHILD, "parent_source_id": PARENT, "source_url": URL,
        "content_level": "sampled_video_frames_not_full_video",
        "manifest": {"original_duration_seconds": 71,
            "timestamp_precision": "requested timestamp; bounded decoder sample"},
        "frames": [{"asset_id": f"offline-frame-{at}", "at_seconds": at,
            "media_type": "image/png", "base64": base64.b64encode(image.getvalue()).decode()}
            for at in [3.5, 7.5]]}


class ObservationModel(ChatModelBase):
    def __init__(self, control, compact=False):
        super().__init__(credential=None, model="offline-observation-trace",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.control, self.compact, self.calls = control, compact, 0

    async def _call_api(self, model_name, messages, **kwargs):
        self.calls += 1
        self.control.append(await self.formatter.format(copy.deepcopy(messages)))
        if self.calls == 1:
            name = "read_source" if self.compact else "sample_video_frames"
            args = {"source_id": PARENT, "start_seconds": 0, "end_seconds": 10, "frame_count": 2}
            if self.compact:
                args = {"source_id": CHILD}
        elif self.calls == 2 and not self.compact:
            name, args = "read_source", {"source_id": CHILD}
        else:
            name, args = "GenerateStructuredOutput", {"answer": "这是两个指定时刻的抽帧，未看整片。",
                "continuation": None, "learning": {"knowledge_updates": [], "memory_updates": []},
                "story_refs": [], "source_refs": [], "source_limitations": "仅为合成传输样本，不据此验证现实动作。"}
        return ChatResponse(content=[ToolCallBlock(id=f"trace-{self.calls}", name=name,
            input=json.dumps(args))], is_last=True,
            usage=ChatUsage(input_tokens=10, output_tokens=5, time=0))


class ObservationTraceTests(unittest.TestCase):
    def run_case(self, compact=False):
        control = []
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False),
                model_factory=lambda _: ObservationModel(control, compact))
            with TestClient(app) as client:
                owner = client.post("/api/auth/demo/xiaolin").json()
                with app.state.sessions() as db:
                    for identity, origin in [(PARENT, "public_web"), (CHILD, "video_frame_sample")]:
                        db.add(SourceRecord(id=identity, owner_id=owner["id"], origin=origin,
                            url=URL, title="合成媒体传输测试", content="{}", pages=[]))
                    db.commit()

                # A single valid JSON text plus metadata is a legal SDK tool
                # result. This reproduces the overwrite independently of the
                # multi-text captions in the native image observation.
                def compact_tools(*args):
                    async def read_source(source_id: str):
                        return ToolChunk(state="success", content=[TextBlock(text=json.dumps({
                            "source_id": CHILD, "url": URL, "title": "已读取的抽帧资料",
                            "content_level": "sampled_video_frames_not_full_video"}))],
                            metadata={"evidence": {"source_id": CHILD, "parent_source_id": PARENT,
                                "observed_frame_times_seconds": [3.5, 7.5],
                                "frame_asset_ids": ["offline-frame-3.5", "offline-frame-7.5"],
                                "reading_scope": "只有两张指定时刻静态画面，未看整片或音频。"}})
                    return Toolkit(tools=[FunctionTool(read_source, is_read_only=True,
                        permission=PermissionDecision(behavior=PermissionBehavior.ALLOW, message="Offline transport fixture"))])

                with patch("wujian.agent_runtime.sample_source_video", new=AsyncMock(side_effect=lambda *a, **kw: video_fixture())), \
                     patch("wujian.agent_runtime.retained_video_frames", side_effect=lambda *a: video_fixture()):
                    if compact:
                        tool_patch = patch("wujian.agent_runtime.make_tools", side_effect=compact_tools)
                    else:
                        from contextlib import nullcontext
                        tool_patch = nullcontext()
                    with tool_patch:
                        response = client.post("/api/chat", json={"text": "看看这两个时刻，再重新打开同一份抽帧。"})
                        self.assertEqual(response.status_code, 200, response.text)
                        run = response.json()
                        deadline = time.monotonic() + 8
                        while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
                            time.sleep(.02)
                            run = client.get("/api/runs/" + run["id"]).json()
                self.assertEqual(run["status"], "completed", run)
                with app.state.sessions() as db:
                    retained = db.get(Run, run["id"])
                    self.assertEqual(retained.events, run["events"])
                    events = copy.deepcopy(retained.events)
                return events, control

    def test_sample_and_reopen_keep_the_same_actual_observation_scope_in_sql_and_http(self):
        events, calls = self.run_case()
        observed = [entry["evidence"] for entry in events
            if entry.get("type") == "tool_end" and entry.get("id") in {"trace-1", "trace-2"}]
        self.assertEqual(len(observed), 2)
        for evidence in observed:
            self.assertEqual(evidence["source_id"], CHILD)
            self.assertEqual(evidence["parent_source_id"], PARENT)
            self.assertEqual(evidence["source_url"], URL)
            self.assertEqual(evidence["content_level"], "sampled_video_frames_not_full_video")
            self.assertEqual(evidence["observed_frame_times_seconds"], [3.5, 7.5])
            self.assertEqual(evidence["evidence_kind"], "timestamped_still_images")
            self.assertEqual(evidence["original_duration_seconds"], 71)
            self.assertEqual(evidence["timestamp_precision"], "requested timestamp; bounded decoder sample")
            self.assertIn("没有观察其余时刻或音频", evidence["reading_scope"])
            self.assertEqual(evidence["frame_asset_ids"], ["offline-frame-3.5", "offline-frame-7.5"])
            self.assertNotIn("base64", json.dumps(evidence))
        formatted = json.dumps(calls[1:], ensure_ascii=False, default=str)
        self.assertIn("observed_frame_times_seconds", formatted)
        self.assertIn("data:image/png;base64,", formatted)

    def test_parseable_result_text_enriches_instead_of_replacing_native_metadata(self):
        events, _ = self.run_case(compact=True)
        evidence = next(entry["evidence"] for entry in events
            if entry.get("type") == "tool_end" and entry.get("id") == "trace-1")
        self.assertEqual(evidence["parent_source_id"], PARENT)
        self.assertEqual(evidence["observed_frame_times_seconds"], [3.5, 7.5])
        self.assertEqual(evidence["frame_asset_ids"], ["offline-frame-3.5", "offline-frame-7.5"])
        self.assertIn("未看整片", evidence["reading_scope"])
        self.assertEqual(evidence["url"], URL)
        self.assertEqual(evidence["title"], "已读取的抽帧资料")
