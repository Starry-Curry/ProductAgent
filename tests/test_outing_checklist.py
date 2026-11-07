"""Real HTTP/SQLite outing collaboration with fictional people/ownership.

No paid models: these exercise canonical mutations, not creative quality.
"""
import concurrent.futures
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from wujian.config import Settings
from wujian.database import Conversation, TaskRecord
from wujian.server import create_app


class OutingChecklistTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), rea_enabled=False))
        self.owner = TestClient(self.app).__enter__()
        self.friend = TestClient(self.app)
        self.outsider = TestClient(self.app)
        self.owner.post("/api/auth/demo/xiaolin")
        self.friend.post("/api/auth/demo/xiaoxia")
        self.ok(self.outsider.post("/api/auth/register", json={
            "username": "outing_outsider", "display_name": "未受邀同学", "password": "fictional-test-123"}))
        self.owner_id, self.friend_id = "person_demo_owner", "person_demo_friend"

    def tearDown(self):
        self.friend.close()
        self.outsider.close()
        self.owner.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def item(self, client=None, name="我的野餐垫"):
        return self.ok((client or self.owner).post("/api/items", json={
            "name": name, "kind": "nonstandard_object", "description": "不随出游清单公开的私人物品说明"}))

    def board(self, item_id=None, kind="checklist"):
        return self.ok(self.owner.post("/api/task-boards", json={
            "goal": "周六四个人去公园野餐，先看看我们有什么。", "kind": kind,
            "constraints": {"private_note": "私人安排"},
            "entries": [{"id": "mat", "title": "野餐垫", "group": "owned", "item_id": item_id},
                        {"id": "water", "title": "饮用水", "group": "buy"}]}))

    def invite(self, identity, accept=True):
        self.ok(self.owner.post(f"/api/tasks/{identity}/shares", json={"user_id": self.friend_id}))
        if accept:
            return self.ok(self.friend.post(f"/api/tasks/{identity}/accept"))

    def test_checklist_invites_without_exposing_private_inventory_or_context(self):
        item = self.item()
        board = self.board(item["id"])
        identity = board["task"]["id"]
        self.invite(identity, accept=False)
        shared = self.ok(self.friend.get(f"/api/tasks/{identity}/board"))
        self.assertEqual(shared["entries"][0]["title"], "野餐垫")
        self.assertIsNone(shared["entries"][0]["item_id"])
        self.assertIsNone(shared["task"]["plan"]["entries"][0]["item_id"])
        self.assertEqual(shared["task"]["item_ids"], [])
        self.assertEqual(shared["task"]["constraints"], {})
        self.assertEqual(shared["task"]["feedback"], [])
        self.assertEqual(shared["sources"], [])
        self.assertEqual(self.friend.get(f"/api/items/{item['id']}").status_code, 404)
        self.assertEqual(self.outsider.get(f"/api/tasks/{identity}/board").status_code, 404)
        self.assertEqual(self.ok(self.owner.get(f"/api/tasks/{identity}/board"))["entries"][0]["item_id"], item["id"])
        resumed = self.ok(self.friend.post(f"/api/tasks/{identity}/conversation"))
        with self.app.state.sessions() as db:
            self.assertEqual(db.get(Conversation, resumed["conversation_id"]).item_ids, [])

    def test_idea_tasks_keep_inventory_boundary(self):
        item = self.item()
        board = self.board(item["id"], "idea")
        self.assertEqual(self.owner.post(f"/api/tasks/{board['task']['id']}/shares",
            json={"user_id": self.friend_id}).status_code, 404)

    def test_add_owned_is_not_ready_and_material_edits_reset_prepared_state(self):
        board = self.board()
        identity = board["task"]["id"]
        payload = {"expected_version": board["task"]["version"], "title": "  冰袋  ",
                   "group": "owned", "note": "家里有两个"}
        added = self.ok(self.owner.post(f"/api/tasks/{identity}/entries", json=payload))
        entry = added["entries"][-1]
        self.assertEqual((entry["title"], entry["group"], entry["state"], entry["item_id"]),
                         ("冰袋", "owned", "pending", None))
        self.assertEqual(self.owner.post(f"/api/tasks/{identity}/entries", json=payload).status_code, 409)
        ready = self.ok(self.owner.patch(f"/api/tasks/{identity}/entries/{entry['id']}",
            json={"expected_version": added["task"]["version"], "state": "ready"}))
        details = {"expected_version": ready["task"]["version"], "title": "冰袋", "group": "owned", "note": "已放进保温包"}
        annotated = self.ok(self.owner.patch(f"/api/tasks/{identity}/entries/{entry['id']}/details", json=details))
        self.assertEqual(annotated["entries"][-1]["state"], "ready")
        details.update(expected_version=annotated["task"]["version"], group="buy", note="找不到了，重新买")
        changed = self.ok(self.owner.patch(f"/api/tasks/{identity}/entries/{entry['id']}/details", json=details))
        self.assertEqual(changed["entries"][-1]["state"], "pending")
        self.assertEqual(changed["task"]["status"], "in_progress")

    def test_participant_accepts_adds_self_reports_without_opening_item(self):
        item = self.item()
        board = self.board(item["id"])
        identity = board["task"]["id"]
        self.invite(identity, accept=False)
        payload = {"expected_version": 1, "title": "水果", "group": "buy"}
        self.assertEqual(self.friend.post(f"/api/tasks/{identity}/entries", json=payload).status_code, 404)
        self.ok(self.friend.post(f"/api/tasks/{identity}/accept"))
        added = self.ok(self.friend.post(f"/api/tasks/{identity}/entries", json=payload))
        self.assertEqual(added["entries"][-1]["assignee_id"], self.friend_id)
        forged = {**payload, "expected_version": added["task"]["version"], "assignee_id": self.owner_id}
        self.assertEqual(self.friend.post(f"/api/tasks/{identity}/entries", json=forged).status_code, 403)
        assigned = self.ok(self.owner.patch(f"/api/tasks/{identity}/entries/mat/assignee", json={
            "expected_version": added["task"]["version"], "assignee_id": self.friend_id}))
        prepared = self.ok(self.friend.patch(f"/api/tasks/{identity}/entries/mat", json={
            "expected_version": assigned["task"]["version"], "state": "ready", "note": "垫子已装包"}))
        self.assertEqual(prepared["entries"][0]["updated_by"], self.friend_id)
        self.assertIsNone(prepared["entries"][0]["item_id"])
        annotated = self.ok(self.friend.patch(f"/api/tasks/{identity}/entries/mat/details", json={
            "expected_version": prepared["task"]["version"], "title": "野餐垫", "group": "owned", "note": "我来背"}))
        self.assertEqual(annotated["entries"][0]["state"], "ready")
        owner_view = self.ok(self.owner.get(f"/api/tasks/{identity}/board"))
        self.assertEqual(owner_view["entries"][0]["item_id"], item["id"], "omitted hidden reference must remain canonical")
        self.assertEqual(self.friend.get(f"/api/items/{item['id']}").status_code, 404)
        self.ok(self.owner.delete(f"/api/tasks/{identity}/shares/{self.friend_id}"))
        self.assertEqual(self.friend.post(f"/api/tasks/{identity}/entries", json=payload).status_code, 404)

    def test_participant_cannot_edit_others_or_publish_their_private_item(self):
        board = self.board()
        identity = board["task"]["id"]
        self.invite(identity)
        detail = {"expected_version": 1, "title": "替别人乱改", "group": "confirm"}
        self.assertEqual(self.friend.patch(f"/api/tasks/{identity}/entries/mat/details", json=detail).status_code, 403)
        private = self.item(self.friend, "小夏的私人物品")
        detail.update(title="我有便当盒", group="owned", item_id=private["id"])
        self.assertEqual(self.friend.post(f"/api/tasks/{identity}/entries", json=detail).status_code, 404)
        detail["item_id"] = None
        added = self.ok(self.friend.post(f"/api/tasks/{identity}/entries", json=detail))
        own = added["entries"][-1]
        self.assertIsNone(own["item_id"])
        detail.update(expected_version=added["task"]["version"], note="我带两个")
        edited = self.ok(self.friend.patch(f"/api/tasks/{identity}/entries/{own['id']}/details", json=detail))
        self.assertEqual(edited["entries"][-1]["note"], "我带两个")

    def test_concurrent_add_is_one_commit_not_lost_update(self):
        board = self.board()
        identity = board["task"]["id"]
        self.invite(identity)
        def add(client, title):
            return client.post(f"/api/tasks/{identity}/entries", json={
                "expected_version": 1, "title": title, "group": "buy"})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda pair: add(*pair), [(self.owner, "纸巾"), (self.friend, "水果")]))
        self.assertEqual(sorted(row.status_code for row in responses), [200, 409])
        current = self.ok(self.owner.get(f"/api/tasks/{identity}/board"))
        self.assertEqual(len(current["entries"]), 3)
        self.assertEqual(current["task"]["version"], 2)

    def test_new_entries_cannot_forge_completion_or_assignee_acceptance(self):
        board = self.board()
        identity = board["task"]["id"]
        self.invite(identity, accept=False)
        payload = {"expected_version": 1, "title": "饮料", "group": "buy", "assignee_id": self.friend_id}
        self.assertEqual(self.owner.post(f"/api/tasks/{identity}/entries", json=payload).status_code, 400)
        payload.pop("assignee_id")
        payload["state"] = "ready"
        self.assertEqual(self.owner.post(f"/api/tasks/{identity}/entries", json=payload).status_code, 422)
        payload.pop("state")
        payload["title"] = "  "
        self.assertEqual(self.owner.post(f"/api/tasks/{identity}/entries", json=payload).status_code, 400)

    def test_confirmation_draft_cannot_be_shared_and_capacity_is_bounded(self):
        board = self.board()
        identity = board["task"]["id"]
        with self.app.state.sessions() as db:
            row = db.get(TaskRecord, identity)
            row.plan = {**row.plan, "pending_action": {"kind": "reminder"}}
            db.commit()
        self.assertEqual(self.owner.post(f"/api/tasks/{identity}/shares", json={"user_id": self.friend_id}).status_code, 409)
        with self.app.state.sessions() as db:
            row = db.get(TaskRecord, identity)
            row.plan = {"schema": "interaction/1", "kind": "checklist", "entries": [
                {"id": str(index), "title": f"准备事项{index}", "group": "buy", "state": "pending"} for index in range(60)]}
            db.commit()
        self.assertEqual(self.owner.post(f"/api/tasks/{identity}/entries", json={
            "expected_version": 1, "title": "再加一项", "group": "buy"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
