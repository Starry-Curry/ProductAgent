"""Actual SDK/HTTP/SQL resume after an explicitly simulated upstream outage.

Domestic Sony SRS-XB100 identity is real; people, ownership, dialogue and the
small image transport fixture are synthetic. No provider or hardware is used.
"""
import asyncio
import base64
import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from fastapi.testclient import TestClient
from PIL import Image

from wujian import domain
from wujian.config import Settings
from wujian.server import create_app


FAILED_WORDS = "邻居已经睡了，先别外放，也别往墙上粘东西。"
RETRY_WORDS = (
    "刚才好像卡住了。", "还能接着说吗？", "我这边没看到回复。", "刚才那句话收到了吗？",
    "我换了网络，能接着聊吗？", "还是没刷出来。", "先接着前面那个说吧。", "现在能看到我的话吗？",
    "刚才的回答还没出来。", "我重新打开了，能继续吗？", "还是刚才音箱的事。", "先不用换话题。",
    "我还在，接着说就行。", "是不是又断了？", "我再试一下。", "现在能接着前面说了吗？",
)


class RecoveryControl:
    def __init__(self):
        self.round = 0
        self.requests = {}
        self.photo_url = ""
        self.failure_rounds = {2}

    def factory(self, _settings):
        self.round += 1
        return RecoveryModel(self, self.round)


class RecoveryModel(ChatModelBase):
    def __init__(self, control, round_number):
        super().__init__(credential=None, model="offline-recovery-only",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.control, self.round_number = control, round_number

    async def _call_api(self, model_name, messages, **kwargs):
        self.control.requests.setdefault(self.round_number, []).append(
            json.dumps(await self.formatter.format(messages), ensure_ascii=False))
        if self.round_number in self.control.failure_rounds:
            raise TimeoutError("Intentional offline upstream failure fixture")
        arguments = {"answer": "我们可以接着聊。", "continuation": None,
            "learning": {"knowledge_updates": [], "memory_updates": []}}
        return ChatResponse(content=[ToolCallBlock(id=f"recovery-{self.round_number}",
            name="GenerateStructuredOutput", input=json.dumps(arguments, ensure_ascii=False))], is_last=True)


class FailedTurnRecoveryTests(unittest.TestCase):
    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def chat(self, client, text, conversation_id=None, **extra):
        run = self.ok(client.post("/api/chat", json={"text": text,
            **({"conversation_id": conversation_id} if conversation_id else {}), **extra}))
        deadline = time.monotonic() + 6
        while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(.02)
            run = self.ok(client.get("/api/runs/" + run["id"]))
        self.assertNotIn(run["status"], {"queued", "running"}, run)
        return run

    def journey(self, *, restart=False, reset=False, with_photo=False):
        with tempfile.TemporaryDirectory() as directory:
            control = RecoveryControl()
            settings = Settings(data_dir=Path(directory), api_key="offline-no-network", rea_enabled=False)

            def app():
                return create_app(settings, model_factory=control.factory)

            application = app()
            with TestClient(application) as client:
                self.ok(client.post("/api/auth/demo/xiaolin"))
                item = self.ok(client.post("/api/items", json={"name": "书桌上的索尼音箱",
                    "product": {"brand": "索尼", "model": "SRS-XB100", "market": "CN"}}))
                first = self.chat(client, "想用家里的音箱找点有意思的玩法。", item_ids=[item["id"]])
                self.assertEqual(first["status"], "completed", first)
                photo_ids = []
                if with_photo:
                    image = io.BytesIO()
                    Image.new("RGB", (24, 16), "#8274ac").save(image, format="PNG")
                    photo = self.ok(client.post("/api/assets", files={"file": ("desk-fixture.png", image.getvalue(), "image/png")}))
                    photo_ids.append(photo["id"])
                    retained = client.get("/api/assets/" + photo["id"])
                    retained.raise_for_status()
                    control.photo_url = "data:" + retained.headers["content-type"] + ";base64," + base64.b64encode(retained.content).decode()
                failed = self.chat(client, FAILED_WORDS, first["conversation_id"], photo_ids=photo_ids)
                self.assertEqual(failed["status"], "failed", failed)
                if reset:
                    with application.state.sessions() as db:
                        domain.invalidate_context(db, ["person_demo_owner"])
                        db.commit()
                if not restart:
                    self.resume(client, control, first["conversation_id"], reset, with_photo)
            if restart:
                with TestClient(app()) as client:
                    self.ok(client.post("/api/auth/demo/xiaolin"))
                    self.resume(client, control, first["conversation_id"], reset, with_photo)

    def resume(self, client, control, conversation_id, reset, with_photo):
        resumed = self.chat(client, "接着说吧。", conversation_id)
        self.assertEqual(resumed["status"], "completed", resumed)
        request = control.requests[3][0]
        self.assertEqual(request.count(FAILED_WORDS), 0 if reset else 1, "Unanswered user words were lost or duplicated")
        if with_photo:
            self.assertTrue(control.photo_url)
            self.assertIn(control.photo_url, request, "Actual retained attachment bytes were not replayed")
        following = self.chat(client, "好，继续。", conversation_id)
        self.assertEqual(following["status"], "completed", following)
        self.assertEqual(control.requests[4][0].count(FAILED_WORDS), 0 if reset else 1)
        messages = self.ok(client.get(f"/api/conversations/{conversation_id}/messages"))
        self.assertEqual(sum(row["role"] == "user" and row["text"] == FAILED_WORDS for row in messages), 1)

    def test_failed_user_constraints_reach_resume_once_and_are_not_repeated_after_success(self):
        self.journey()

    def test_failed_user_constraints_survive_an_actual_application_restart(self):
        self.journey(restart=True)

    def test_explicit_context_invalidation_still_excludes_older_failed_user_text(self):
        self.journey(reset=True)

    def test_failed_attachment_is_actually_replayed_to_the_main_model(self):
        self.journey(with_photo=True)

    def initial_failure_journey(self, *, with_photo=False, failed_retries=0):
        from wujian.database import Conversation

        with tempfile.TemporaryDirectory() as directory:
            control = RecoveryControl()
            control.failure_rounds = set(range(1, failed_retries + 2))
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network",
                rea_enabled=False), model_factory=control.factory)
            with TestClient(app) as client:
                self.ok(client.post("/api/auth/demo/xiaolin"))
                item = self.ok(client.post("/api/items", json={"name": "书桌上的索尼音箱",
                    "product": {"brand": "索尼", "model": "SRS-XB100", "market": "CN"}}))
                photo_ids = []
                if with_photo:
                    image = io.BytesIO()
                    Image.new("RGB", (24, 16), "#8274ac").save(image, format="PNG")
                    photo = self.ok(client.post("/api/assets", files={"file": (
                        "first-failed-desk-fixture.png", image.getvalue(), "image/png")}))
                    photo_ids.append(photo["id"])
                    retained = client.get("/api/assets/" + photo["id"])
                    retained.raise_for_status()
                    control.photo_url = "data:" + retained.headers["content-type"] + ";base64," + base64.b64encode(retained.content).decode()
                first = self.chat(client, FAILED_WORDS, item_ids=[item["id"]], photo_ids=photo_ids)
                self.assertEqual(first["status"], "failed", first)
                for index in range(failed_retries):
                    failed = self.chat(client, RETRY_WORDS[index],
                        first["conversation_id"])
                    self.assertEqual(failed["status"], "failed", failed)
                with app.state.sessions() as db:
                    self.assertIsNone(db.get(Conversation, first["conversation_id"]).agent_state)
                resumed = self.chat(client, "现在能接着说了吗？", first["conversation_id"])
                self.assertEqual(resumed["status"], "completed", resumed)
                request = control.requests[failed_retries + 2][0]
                messages = self.ok(client.get(f"/api/conversations/{first['conversation_id']}/messages"))
                self.assertEqual(sum(row["role"] == "user" and row["text"] == FAILED_WORDS
                    for row in messages), 1)
                self.assertEqual(request.count(FAILED_WORDS), 1,
                    "Initial unanswered constraints are not already-answered history")
                if with_photo:
                    self.assertIn(photo_ids[0], request)
                    self.assertIn(control.photo_url, request,
                        "A failed first turn needs actual retained image bytes, not just its ID")

    def test_first_failed_turn_attachment_is_replayed_without_an_sdk_checkpoint(self):
        self.initial_failure_journey(with_photo=True)

    def test_initial_unanswered_constraint_is_not_cut_off_without_an_sdk_checkpoint(self):
        self.initial_failure_journey(failed_retries=16)

    def test_http_cancel_during_actual_model_wait_recovers_the_unanswered_user_once(self):
        class CancelGateModel(RecoveryModel):
            async def _call_api(self, model_name, messages, **kwargs):
                if self.round_number == 2:
                    self.control.requests.setdefault(2, []).append(
                        json.dumps(await self.formatter.format(messages), ensure_ascii=False))
                    self.control.entered.set()
                    try:
                        await asyncio.Event().wait()
                    except asyncio.CancelledError:
                        self.control.cancelled.set()
                        raise
                return await super()._call_api(model_name, messages, **kwargs)

        class CancelGateControl(RecoveryControl):
            def __init__(self):
                super().__init__()
                self.entered = threading.Event()
                self.cancelled = threading.Event()

            def factory(self, _settings):
                self.round += 1
                return CancelGateModel(self, self.round)

        with tempfile.TemporaryDirectory() as directory:
            control = CancelGateControl()
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network",
                rea_enabled=False), model_factory=control.factory)
            with TestClient(app) as client:
                self.ok(client.post("/api/auth/demo/xiaolin"))
                item = self.ok(client.post("/api/items", json={"name": "书桌上的索尼音箱",
                    "product": {"brand": "索尼", "model": "SRS-XB100", "market": "CN"}}))
                first = self.chat(client, "想给音箱找点有意思的用法。", item_ids=[item["id"]])
                self.assertEqual(first["status"], "completed", first)
                pending = self.ok(client.post("/api/chat", json={"text": FAILED_WORDS,
                    "conversation_id": first["conversation_id"]}))
                self.assertTrue(control.entered.wait(3), "Actual SDK model did not reach the wait gate")
                self.ok(client.post("/api/runs/" + pending["id"] + "/cancel"))
                self.assertTrue(control.cancelled.wait(3), "HTTP cancellation did not interrupt the actual model wait")
                cancelled = self.ok(client.get("/api/runs/" + pending["id"]))
                self.assertEqual(cancelled["status"], "interrupted", cancelled)
                self.resume(client, control, first["conversation_id"], reset=False, with_photo=False)

    def test_unanswered_constraint_is_not_silently_cut_off_by_the_old_history_window(self):
        class LongOutageModel(RecoveryModel):
            async def _call_api(self, model_name, messages, **kwargs):
                if 2 <= self.round_number <= 18:
                    raise TimeoutError("Intentional repeated offline upstream outage")
                return await super()._call_api(model_name, messages, **kwargs)

        class LongOutageControl(RecoveryControl):
            def factory(self, _settings):
                self.round += 1
                return LongOutageModel(self, self.round)

        with tempfile.TemporaryDirectory() as directory:
            control = LongOutageControl()
            app = create_app(Settings(data_dir=Path(directory), api_key="offline-no-network",
                rea_enabled=False), model_factory=control.factory)
            with TestClient(app) as client:
                self.ok(client.post("/api/auth/demo/xiaolin"))
                item = self.ok(client.post("/api/items", json={"name": "书桌上的索尼音箱",
                    "product": {"brand": "索尼", "model": "SRS-XB100", "market": "CN"}}))
                first = self.chat(client, "想给音箱找点有意思的用法。", item_ids=[item["id"]])
                self.assertEqual(first["status"], "completed", first)
                failed = self.chat(client, FAILED_WORDS, first["conversation_id"])
                self.assertEqual(failed["status"], "failed", failed)
                for index in range(16):
                    failed = self.chat(client, RETRY_WORDS[index],
                        first["conversation_id"])
                    self.assertEqual(failed["status"], "failed", failed)
                resumed = self.chat(client, "现在能接着说了吗？", first["conversation_id"])
                self.assertEqual(resumed["status"], "completed", resumed)
                request = control.requests[19][0]
                messages = self.ok(client.get(f"/api/conversations/{first['conversation_id']}/messages"))
                self.assertEqual(sum(row["role"] == "user" and row["text"] == FAILED_WORDS
                    for row in messages), 1)
                self.assertIn(RETRY_WORDS[-1], request)
                self.assertEqual(request.count(FAILED_WORDS), 1,
                    "Unanswered constraints must not be trimmed as already-answered history")
