"""Actual HTTP/SQL reports of diagnostic actions on a paused domestic lamp.

The MJTD01SYL identity is real; people, ownership and reported results are
explicit fixtures. These tests run no model or hardware operations.
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from wujian.config import Settings
from wujian.server import create_app


class TaskActionProgressTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.directory.name), api_key="", rea_enabled=False))
        self.client = TestClient(self.app).__enter__()
        self.client.post("/api/auth/demo/xiaolin").raise_for_status()
        response = self.client.post("/api/items", json={"name": "书桌上的米家台灯1S",
            "product": {"brand": "米家", "model": "MJTD01SYL", "market": "CN"},
            "description": "模拟拥有与故障报告，不是实物测试。",
            "state": {"availability": "unavailable", "presentation": {
                "attention": "paused", "note": "灯不亮了，先暂停使用。"}}})
        response.raise_for_status()
        self.item = response.json()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def board(self, group="step", kind="guidance"):
        response = self.client.post("/api/task-boards", json={"goal": "台灯不亮，先核对情况再决定怎么办",
            "kind": kind, "entries": [
                {"id": "power", "title": "核对外部电源连接", "group": group, "item_id": self.item["id"],
                    "note": "这里只记录完成检查；不代表已经修好台灯。"},
                {"id": "continue", "title": "根据实际现象继续处理", "group": "step", "item_id": self.item["id"]}]})
        response.raise_for_status()
        return response.json()

    def test_reported_inspection_can_advance_while_the_object_remains_paused(self):
        board = self.board()
        response = self.client.patch(f"/api/tasks/{board['task']['id']}/entries/power", json={
            "expected_version": board["task"]["version"], "state": "ready",
            "note": "看过了，插头插紧了，灯还是不亮。"})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["entries"][0]["state"], "ready")
        self.assertEqual(result["entries"][0]["note"], "看过了，插头插紧了，灯还是不亮。")
        self.assertEqual(result["task"]["status"], "in_progress")
        current = self.client.get("/api/items/" + self.item["id"]).json()
        self.assertEqual(current["version"], self.item["version"])
        self.assertEqual(current["state"]["availability"], "unavailable")
        self.assertEqual(current["state"]["presentation"]["attention"], "paused")

    def test_preparation_of_the_same_paused_resource_still_cannot_be_reported_ready(self):
        for group in ("owned", "buy", "borrow", "confirm"):
            with self.subTest(group=group):
                board = self.board(group=group, kind="checklist")
                response = self.client.patch(f"/api/tasks/{board['task']['id']}/entries/power", json={
                    "expected_version": board["task"]["version"], "state": "ready"})
                self.assertEqual(response.status_code, 409, response.text)
                stored = self.client.get(f"/api/tasks/{board['task']['id']}/board").json()
                self.assertEqual(stored["entries"][0]["state"], "pending")
                self.assertEqual(stored["task"]["version"], board["task"]["version"])

    def test_action_report_still_requires_current_object_access_after_a_gift(self):
        board = self.board()
        recipient = TestClient(self.app)
        try:
            recipient.post("/api/auth/demo/xiaoxia").raise_for_status()
            response = self.client.post("/api/gifts", json={"item_id": self.item["id"],
                "recipient_id": "person_demo_friend"})
            response.raise_for_status()
            recipient.post("/api/gifts/" + response.json()["id"] + "/accept").raise_for_status()
            response = self.client.patch(f"/api/tasks/{board['task']['id']}/entries/power", json={
                "expected_version": board["task"]["version"], "state": "ready"})
            self.assertEqual(response.status_code, 404, response.text)
        finally:
            recipient.close()

    def test_mixed_guidance_keeps_available_resource_and_broken_device_distinct(self):
        towel = self.client.post("/api/items", json={"name": "书桌旁擦拭用的干毛巾",
            "kind": "nonstandard_object", "description": "模拟拥有，检查前用来擦干桌面。",
            "state": {"availability": "available", "presentation": {"attention": "normal"}}})
        towel.raise_for_status()
        response = self.client.post("/api/task-boards", json={"goal": "桌面先保持干燥，再核对台灯外部连接",
            "kind": "guidance", "entries": [
                {"id": "towel", "title": "准备干毛巾", "group": "owned", "item_id": towel.json()["id"]},
                {"id": "inspect", "title": "核对外部连接", "group": "step", "item_id": self.item["id"]}]})
        response.raise_for_status()
        board = response.json()
        for identity in ("towel", "inspect"):
            response = self.client.patch(f"/api/tasks/{board['task']['id']}/entries/{identity}", json={
                "expected_version": board["task"]["version"], "state": "ready"})
            self.assertEqual(response.status_code, 200, response.text)
            board = response.json()
        self.assertEqual(board["task"]["status"], "ready")
        self.assertEqual({entry["item_id"] for entry in board["entries"]}, {self.item["id"], towel.json()["id"]})
        current = self.client.get("/api/items/" + self.item["id"]).json()
        self.assertEqual(current["state"], self.item["state"])
        self.assertEqual(current["version"], self.item["version"])
