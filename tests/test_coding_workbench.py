"""Source, task ownership and publication checks; no model or device calls."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from wujian import coding_workbench as workbench, domain, foundation
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, ItemRecord, TaskRecord
from wujian.server import create_app


class CodingWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name), api_key="", rea_enabled=False)
        self.app = create_app(self.settings)
        self.owner = TestClient(self.app).__enter__()
        self.owner.post("/api/auth/demo/xiaolin")
        self.friend = TestClient(self.app)
        self.friend.post("/api/auth/demo/xiaoxia")
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id="person_demo_owner", item_ids=["item_demo_lamp"])
            db.add(conversation); db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text="帮我为这件物品做一个控制台")
            db.add(message); db.commit(); self.message_id = message.id

    def tearDown(self):
        self.friend.close(); self.owner.__exit__(None, None, None); self.temp.cleanup()

    def create(self):
        with self.app.state.sessions() as db:
            return workbench.create(db, "person_demo_owner", self.message_id, "item_demo_lamp",
                "小林自己的控制台", "帮我为这件物品做一个控制台")

    def source(self):
        return {"html": "<button id='read'>Read</button><p id='state'>Waiting</p>",
            "css": "body{padding:20px}",
            "javascript": "document.querySelector('#read').onclick=async()=>{const r=await window.wujian.request('read_state',{});document.querySelector('#state').textContent=r.status};"}

    def write(self, task, source=None):
        with self.app.state.sessions() as db:
            return workbench.write(db, self.settings, "person_demo_owner", task["task_id"], task["version"], source or self.source())

    def publish(self, task):
        with self.app.state.sessions() as db, patch("wujian.coding_workbench.run_checks", return_value={
                "passed": True, "scope": "explicit offline check fixture, not a browser or hardware acceptance"}):
            checked = workbench.check(db, "person_demo_owner", task["task_id"], task["version"])
            return workbench.publish(db, "person_demo_owner", task["task_id"], checked["version"])

    def test_create_reanchors_rhythm_request_quotes_and_retains_original_span(self):
        # Verbatim opening of the retained failed request, without private IDs.
        original = "我想给这副华为 FreeBuds 4E 另做一个叫‘节奏回声’的小作品，放在它的工作台里，原来的耳机操控台请完整保留，别改它。"
        candidate = original.replace("‘", "'").replace("’", "'")
        with self.app.state.sessions() as db:
            db.get(ChatMessage, self.message_id).text = "阿圆，" + original
            db.commit()
            created = workbench.create(db, "person_demo_owner", self.message_id, "item_demo_lamp", "私有可逆草稿", candidate)
            task = db.get(TaskRecord, created["task_id"])
            self.assertEqual(task.constraints["request_quote"], original)
            self.assertEqual(task.source_message_id, self.message_id)
            self.assertEqual(task.user_id, "person_demo_owner")
            self.assertFalse(task.plan["published"])
            self.assertNotIn("origin", task.plan)
            self.assertEqual(workbench.create(db, "person_demo_owner", self.message_id, "item_demo_lamp", "私有可逆草稿", candidate)["task_id"], task.id)

    def test_create_reanchors_only_consecutive_whitespace_and_same_kind_quotes(self):
        original = '请做一个叫“节奏回声”的小作品，保留 a  b 的显示。'
        with self.app.state.sessions() as db:
            db.get(ChatMessage, self.message_id).text = original
            db.commit()
            created = workbench.create(db, "person_demo_owner", self.message_id, "item_demo_lamp", "排版测试草稿",
                '请做一个叫"节奏回声"的小作品，保留 a b 的显示。')
            self.assertEqual(db.get(TaskRecord, created["task_id"]).constraints["request_quote"], original)
            with self.assertRaises(domain.DomainError):
                workbench.create(db, "person_demo_owner", self.message_id, "item_demo_lamp", "不能合并词边界",
                    '请做一个叫"节奏回声"的小作品，保留 ab 的显示。')

    def test_create_rejects_deleted_middle_negation_splicing_or_changed_model_number_content(self):
        original = "我想为 FreeBuds 4E 做‘节奏回声’，保留 40% 的显示，但我不要删除旧工作台。"
        candidates = [original.replace("我不要", "我要"),
                      "我想为 FreeBuds 4E 做‘节奏回声’，但我不要删除旧工作台。",
                      original.replace("4E", "5E"), original.replace("40%", "80%"),
                      original.replace("节奏回声", "音乐回声")]
        with self.app.state.sessions() as db:
            db.get(ChatMessage, self.message_id).text = original
            db.commit()
            for quote in candidates:
                with self.subTest(quote=quote), self.assertRaises(domain.DomainError) as denied:
                    workbench.create(db, "person_demo_owner", self.message_id, "item_demo_lamp", "仍须原词原句", quote)
                self.assertEqual(denied.exception.status, 403)

    def test_create_keeps_owned_user_message_and_current_quote_boundary(self):
        original = "请创建‘节奏回声’草稿。"
        with self.app.state.sessions() as db:
            current = db.get(ChatMessage, self.message_id)
            current.text = original
            other = ChatMessage(conversation_id=current.conversation_id, role="user", text="这条消息没有要求创建草稿。")
            assistant = ChatMessage(conversation_id=current.conversation_id, role="assistant", text=original)
            foreign_chat = Conversation(user_id="person_demo_friend")
            db.add_all([other, assistant, foreign_chat]); db.flush()
            foreign = ChatMessage(conversation_id=foreign_chat.id, role="user", text=original)
            db.add(foreign); db.commit()
            for message in (other, assistant, foreign):
                with self.subTest(role=message.role, message=message.id), self.assertRaises(domain.DomainError) as denied:
                    workbench.create(db, "person_demo_owner", message.id, "item_demo_lamp", "不可借别处的原话", "请创建'节奏回声'草稿。")
                self.assertEqual(denied.exception.status, 403)
            with self.assertRaises(domain.DomainError):
                workbench.create(db, "person_demo_friend", self.message_id, "item_demo_lamp", "非owner不能创建", "请创建'节奏回声'草稿。")

    def test_owner_source_versions_checks_and_publication_are_one_task(self):
        created = self.create()
        self.assertEqual(self.create()["task_id"], created["task_id"])
        written = self.write(created)
        self.assertFalse(written["published"])
        with self.app.state.sessions() as db, self.assertRaises(domain.DomainError):
            workbench.publish(db, "person_demo_owner", written["task_id"], written["version"])
        published = self.publish(written)
        self.assertEqual(published["task_id"], created["task_id"])
        self.assertTrue(published["published"])
        self.assertIn("connect-src &#x27;none&#x27;", published["document_html"])
        self.assertIn("window.wujian", published["document_html"])
        read = self.owner.get(f"/api/workbenches/{created['task_id']}")
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json()["source"], self.source())
        changed = self.write(published)
        self.assertFalse(changed["published"])
        self.assertIsNone(changed["checks"])

    def test_source_is_private_and_rechecked_against_current_item_ownership(self):
        task = self.write(self.create())
        self.assertEqual(self.friend.get(f"/api/workbenches/{task['task_id']}").status_code, 404)
        with self.app.state.sessions() as db:
            asset_id = db.get(TaskRecord, task["task_id"]).plan["source_asset_id"]
        self.assertEqual(self.friend.get(f"/api/assets/{asset_id}").status_code, 404)
        with self.app.state.sessions() as db:
            db.get(ItemRecord, "item_demo_lamp").owner_id = "person_demo_friend"; db.commit()
        self.assertEqual(self.owner.get(f"/api/workbenches/{task['task_id']}").status_code, 404)

    def test_stale_writes_and_generic_task_updates_cannot_overwrite_source(self):
        task = self.create(); self.write(task)
        with self.app.state.sessions() as db:
            with self.assertRaises(domain.DomainError):
                workbench.write(db, self.settings, "person_demo_owner", task["task_id"], task["version"], self.source())
            with self.assertRaises(domain.DomainError):
                foundation.save_task(db, "person_demo_owner", self.message_id, "overwrite", [], {}, {},
                    task_id=task["task_id"], expected_version=task["version"])

    def test_escaping_and_network_features_are_not_publishable_source(self):
        for change in ({"html": "<iframe src='https://example.invalid'></iframe>"},
                {"html": "<button onclick='fetch(1)'>Read</button>"},
                {"javascript": "window.location='https://example.invalid'"},
                {"javascript": "parent.document.cookie"}, {"css": "@import 'https://example.invalid/style.css'"}):
            with self.subTest(change=change), self.assertRaises(domain.DomainError):
                workbench.validate_source({**self.source(), **change})

    def test_device_api_is_disabled_for_offline_environment(self):
        task = self.publish(self.write(self.create()))
        with patch("wujian.earbuds.earbud_tool") as hardware:
            reply = self.owner.post(f"/api/workbenches/{task['task_id']}/device", json={
                "expected_version": task["version"], "op": "set_noise_mode", "args": {"mode": "light"}})
            self.assertEqual(reply.status_code, 403)
            hardware.assert_not_called()

    def test_broker_rejects_http200_device_failures_and_unverified_writes(self):
        task = self.publish(self.write(self.create()))
        self.settings.rea_enabled = True  # every device facade remains mocked
        endpoint = f"/api/workbenches/{task['task_id']}/device"
        with patch("wujian.earbuds.earbud_tool", return_value={"status": "disconnected", "message": "耳机当前未连接"}):
            reply = self.owner.post(endpoint, json={"expected_version": task["version"], "op": "read_state", "args": {}})
            self.assertEqual(reply.status_code, 409)
            self.assertIn("未连接", reply.json()["detail"])
        for status, verified in (("outcome_unknown", False), ("unverified", False), ("verified", False), ("observed", True), ("verified", 1)):
            with self.subTest(status=status, verified=verified), patch("wujian.earbuds.earbud_tool", return_value={
                    "status": status, "message": "回读未确认", "state": {"write_verified": verified}}):
                reply = self.owner.post(endpoint, json={"expected_version": task["version"], "op": "set_noise_mode", "args": {"mode": "light"}})
                self.assertEqual(reply.status_code, 502)
                self.assertIn("可能已经改变", reply.json()["detail"])
                self.assertIn("刷新状态", reply.json()["detail"])
        with patch("wujian.earbuds.earbud_tool", return_value={"status": "verified", "state": {"write_verified": True, "noise_mode": "light"}}):
            reply = self.owner.post(endpoint, json={"expected_version": task["version"], "op": "set_noise_mode", "args": {"mode": "light"}})
            self.assertEqual(reply.status_code, 200)
            self.assertIs(reply.json()["state"]["write_verified"], True)

    def test_broker_does_not_mislabel_preflight_read_as_a_volume_write_success(self):
        task = self.publish(self.write(self.create()))
        self.settings.rea_enabled = True
        endpoint = f"/api/workbenches/{task['task_id']}/device"
        for current in ({"status": "disconnected", "message": "还未连上耳机"},
                        {"status": "observed", "state": {"volume": 40}}):
            with self.subTest(current=current), patch("wujian.earbuds.earbud_tool", return_value=current) as hardware:
                reply = self.owner.post(endpoint, json={"expected_version": task["version"], "op": "set_volume", "args": {"level": 30}})
                self.assertEqual(reply.status_code, 409)
                self.assertEqual(hardware.call_count, 1)
        with patch("wujian.earbuds.earbud_tool", side_effect=[
                {"status": "observed", "state": {"volume": 40, "endpoint_id": "pinned-endpoint"}},
                {"status": "outcome_unknown", "state": {"write_verified": False}}]) as hardware:
            reply = self.owner.post(endpoint, json={"expected_version": task["version"], "op": "set_volume", "args": {"level": 30}})
            self.assertEqual(reply.status_code, 502)
            self.assertEqual(hardware.call_count, 2)
            self.assertEqual(hardware.call_args.kwargs["endpoint_id"], "pinned-endpoint")

    def test_native_unknown_write_observation_survives_broker_rejection(self):
        from sqlalchemy import select
        from wujian.database import DeviceObservation, DeviceTarget
        from wujian.earbuds.service import KIND
        task = self.publish(self.write(self.create()))
        self.settings.rea_enabled = True
        with self.app.state.sessions() as db:
            db.add(DeviceTarget(user_id="person_demo_owner", item_id="item_demo_lamp", kind=KIND, address="AA:BB:CC:DD:EE:FF"))
            db.commit()
        # A synthetic transport outcome exercises the real service transaction;
        # no native Bluetooth function is reached in offline regression.
        with patch("wujian.earbuds.windows.operate", return_value={"status": "outcome_unknown",
                "noise_mode": None, "requested_mode": "light", "write_verified": False}):
            reply = self.owner.post(f"/api/workbenches/{task['task_id']}/device", json={
                "expected_version": task["version"], "op": "set_noise_mode", "args": {"mode": "light"}})
        self.assertEqual(reply.status_code, 502)
        with self.app.state.sessions() as db:
            observations = list(db.scalars(select(DeviceObservation)))
            self.assertEqual(len(observations), 1)
            self.assertEqual(observations[0].evidence["status"], "outcome_unknown")
