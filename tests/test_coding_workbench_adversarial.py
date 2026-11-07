"""Independent trust-boundary regressions; isolated SQL and mocked hardware only."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from wujian import coding_workbench as workbench, domain, foundation
from wujian.api_models import GiftCreate
from wujian.config import Settings
from wujian.database import Asset, ChatMessage, Conversation, ItemRecord, TaskRecord
from wujian.server import create_app


OWNER, FRIEND, ITEM = "person_demo_owner", "person_demo_friend", "item_demo_lamp"
SOURCE = {"html": "<main><p>独立离线样本</p></main>", "css": "", "javascript": ""}
CHECK = {"passed": True, "scope": "explicit synthetic receipt, not browser or hardware acceptance"}


class WorkbenchAdversarialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(data_dir=Path(self.temp.name), api_key="", rea_enabled=True)
        self.app = create_app(self.settings)
        self.owner = TestClient(self.app).__enter__()
        self.owner.post("/api/auth/demo/xiaolin")
        self.friend = TestClient(self.app)
        self.friend.post("/api/auth/demo/xiaoxia")
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=OWNER, item_ids=[ITEM])
            db.add(conversation); db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text="帮我做一个自己的小工具")
            db.add(message); db.commit()
            self.message_id = message.id
            self.task = workbench.create(db, OWNER, message.id, ITEM, "独立样本", message.text)

    def tearDown(self):
        self.friend.close()
        self.owner.__exit__(None, None, None)
        self.temp.cleanup()

    def write(self, task=None, source=None):
        task = task or self.task
        with self.app.state.sessions() as db:
            return workbench.write(db, self.settings, OWNER, task["task_id"], task["version"], source or SOURCE)

    def publish(self):
        task = self.write()
        with self.app.state.sessions() as db, patch("wujian.coding_workbench.run_checks", return_value=CHECK):
            checked = workbench.check(db, OWNER, task["task_id"], task["version"])
            return workbench.publish(db, OWNER, task["task_id"], checked["version"])

    def test_generic_creation_cannot_forge_workbench_check_receipt(self):
        source = self.write()
        with self.app.state.sessions() as db:
            forged = dict(db.get(TaskRecord, source["task_id"]).plan)
            forged.update(published=True, checks={"passed": True, "source_sha256": source["source_sha256"]})
            with self.assertRaises(domain.DomainError) as denied:
                foundation.save_task(db, OWNER, self.message_id, "伪造已验收工作台", [ITEM], {}, forged)
            self.assertEqual(denied.exception.status, 409)

    def test_generic_existing_task_cannot_be_converted_to_forged_workbench(self):
        with self.app.state.sessions() as db:
            plain = foundation.save_task(db, OWNER, self.message_id, "普通任务", [ITEM], {}, {})
            with self.assertRaises(domain.DomainError):
                foundation.save_task(db, OWNER, self.message_id, "伪造工作台", [ITEM], {},
                    {"schema": workbench.SCHEMA, "published": True, "checks": CHECK},
                    task_id=plain["id"], expected_version=plain["version"])
            self.assertEqual(db.get(TaskRecord, plain["id"]).plan, {})

    def test_source_asset_owner_is_authoritative_even_for_owned_task(self):
        task = self.write()
        with self.app.state.sessions() as db:
            row = db.get(TaskRecord, task["task_id"])
            db.get(Asset, row.plan["source_asset_id"]).owner_id = FRIEND
            db.commit()
        self.assertEqual(self.owner.get(f"/api/workbenches/{task['task_id']}").status_code, 404)
        with self.app.state.sessions() as db, patch("wujian.coding_workbench.run_checks") as checks:
            with self.assertRaises(domain.DomainError):
                workbench.check(db, OWNER, task["task_id"], task["version"])
            checks.assert_not_called()

    def test_changed_asset_bytes_cannot_reuse_hash_bound_check(self):
        task = self.write()
        with self.app.state.sessions() as db, patch("wujian.coding_workbench.run_checks", return_value=CHECK):
            checked = workbench.check(db, OWNER, task["task_id"], task["version"])
            asset = db.get(Asset, db.get(TaskRecord, task["task_id"]).plan["source_asset_id"])
            Path(asset.path).write_bytes(workbench.source_bytes({**SOURCE, "html": "<p>被替换的内容</p>"}))
            with self.assertRaises(domain.DomainError) as denied:
                workbench.publish(db, OWNER, task["task_id"], checked["version"])
            self.assertEqual(denied.exception.status, 409)

    def test_edit_during_browser_check_cannot_attach_stale_receipt(self):
        task = self.write()
        def concurrent_edit(_source):
            self.write(task, {**SOURCE, "html": "<p>新版本</p>"})
            return CHECK
        with self.app.state.sessions() as db, patch("wujian.coding_workbench.run_checks", side_effect=concurrent_edit):
            with self.assertRaises(domain.DomainError) as denied:
                workbench.check(db, OWNER, task["task_id"], task["version"])
            self.assertEqual(denied.exception.status, 409)
        current = self.owner.get(f"/api/workbenches/{task['task_id']}").json()
        self.assertEqual(current["source"]["html"], "<p>新版本</p>")
        self.assertIsNone(current["checks"])
        self.assertFalse(current["published"])

    def test_transfer_during_check_revokes_old_owner_before_receipt_save(self):
        task = self.write()
        def concurrent_transfer(_source):
            with self.app.state.sessions() as other:
                other.get(ItemRecord, ITEM).owner_id = FRIEND
                other.commit()
            return CHECK
        with self.app.state.sessions() as db, patch("wujian.coding_workbench.run_checks", side_effect=concurrent_transfer):
            with self.assertRaises(domain.DomainError) as denied:
                workbench.check(db, OWNER, task["task_id"], task["version"])
            self.assertEqual(denied.exception.status, 404)

    def test_transfer_neither_grants_private_code_nor_preserves_old_device_write(self):
        task = self.publish()
        with self.app.state.sessions() as db:
            gift = domain.create_gift(db, OWNER, GiftCreate(item_id=ITEM, recipient_id=FRIEND))
            domain.accept_gift(db, FRIEND, gift["id"])
        with patch("wujian.earbuds.earbud_tool") as hardware:
            for actor in (self.owner, self.friend):
                with self.subTest(actor=actor):
                    self.assertEqual(actor.get(f"/api/workbenches/{task['task_id']}").status_code, 404)
                    response = actor.post(f"/api/workbenches/{task['task_id']}/device", json={
                        "expected_version": task["version"], "op": "set_volume", "args": {"level": 30}})
                    self.assertEqual(response.status_code, 404)
            hardware.assert_not_called()

    def test_anonymous_and_opaque_origin_cannot_call_device_endpoint(self):
        task = self.publish()
        path = f"/api/workbenches/{task['task_id']}/device"
        payload = {"expected_version": task["version"], "op": "set_volume", "args": {"level": 30}}
        with TestClient(self.app) as anonymous, patch("wujian.earbuds.earbud_tool") as hardware:
            self.assertEqual(anonymous.get(f"/api/workbenches/{task['task_id']}").status_code, 401)
            self.assertEqual(anonymous.post(path, json=payload).status_code, 401)
            self.assertEqual(self.owner.post(path, json=payload, headers={"Origin": "null"}).status_code, 403)
            self.assertEqual(self.owner.post(path, json=payload, headers={"Origin": "https://unrelated.invalid"}).status_code, 403)
            hardware.assert_not_called()

    def test_device_requests_reject_stale_version_draft_and_foreign_item_args(self):
        task = self.publish()
        path = f"/api/workbenches/{task['task_id']}/device"
        with patch("wujian.earbuds.earbud_tool") as hardware:
            stale = self.owner.post(path, json={"expected_version": task["version"] - 1, "op": "read_state", "args": {}})
            self.assertEqual(stale.status_code, 409)
            for op, args in (("read_state", {"item_id": "item_other"}), ("set_volume", {"level": True}),
                    ("set_volume", {"level": 101}), ("set_noise_mode", {"mode": "transparent"}),
                    ("set_noise_mode", {"mode": "light", "item_id": "item_other"})):
                with self.subTest(op=op, args=args):
                    self.assertEqual(self.owner.post(path, json={"expected_version": task["version"], "op": op, "args": args}).status_code, 400)
            draft = self.write(task)
            self.assertEqual(self.owner.post(path, json={"expected_version": draft["version"], "op": "read_state", "args": {}}).status_code, 409)
            hardware.assert_not_called()

    def test_bridge_receipt_excludes_device_identity_and_private_fields(self):
        task = self.publish()
        raw = {"status": "observed", "message": "离线样本", "private": "secret", "state": {
            "battery": {"left": 42}, "noise_mode": "off", "bluetooth_address": "private-address",
            "endpoint_id": "private-endpoint", "source_text": "private source"}}
        with patch("wujian.earbuds.earbud_tool", return_value=raw) as hardware:
            result = self.owner.post(f"/api/workbenches/{task['task_id']}/device", json={
                "expected_version": task["version"], "op": "read_state", "args": {}})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json(), {"status": "observed", "message": "离线样本", "state": {"battery": {"left": 42}, "noise_mode": "off"}})
            self.assertEqual(hardware.call_args.args[1:], (OWNER, "read", ITEM))

    def test_history_uses_immutable_owned_asset_bytes(self):
        first = self.write()
        second = self.write(first, {**SOURCE, "html": "<p>第二版</p>"})
        with self.app.state.sessions() as db:
            task = workbench.owned_task(db, OWNER, second["task_id"])
            self.assertEqual(workbench.load_source(db, OWNER, task, first["version"]).model_dump(), SOURCE)
            old_id = task.plan["source_history"][0]["asset_id"]
            db.get(Asset, old_id).owner_id = FRIEND
            db.commit()
            with self.assertRaises(domain.DomainError):
                workbench.load_source(db, OWNER, task, first["version"])
