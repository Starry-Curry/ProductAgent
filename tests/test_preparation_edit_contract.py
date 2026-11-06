"""Actual SDK/native validation plus HTTP/SQLite checklist-edit contracts.

Only the external model is deterministic. People, ownership and physical
preparation reports are simulated; no provider requests or live DB are used.
"""
import copy
import unittest

from fastapi.testclient import TestClient
from tests import test_agent_plan_contract as contracts
from wujian.database import TaskRecord


class PreparationEditContractTests(unittest.TestCase):
    def setUp(self):
        self.case = contracts.AgentPlanContractTests()
        self.case.setUp()
        self.addCleanup(self.case.tearDown)

    def board(self, *, group="confirm", note="再看看家里有没有"):
        c = self.case
        return c.ok(c.client.post("/api/task-boards", json={
            "goal": "周六四个人去公园野餐，准备饮用水", "kind": "checklist",
            "entries": [{"id": "water", "title": "饮用水", "group": group,
                         "state": "pending", "note": note}]}))

    def proposal(self, entries, board=None, *, quote="", preparation=None, progress=None):
        value = self.case.proposal(entries, board, quote)
        value["continuation"]["goal"] = "周六四人公园野餐准备清单"
        value["continuation"]["plan"]["kind"] = "checklist"
        value["continuation"]["plan"]["preparation_reports"] = preparation or []
        if progress:
            value["continuation"]["progress_reports"] = progress
        return value

    def current(self, task_id):
        with self.case.app.state.sessions() as db:
            return copy.deepcopy(db.get(TaskRecord, task_id).plan)

    def test_ready_water_reclassified_same_id_pending_keeps_actual_assignment_and_reporter(self):
        c = self.case
        board = self.board(group="buy", note="饮用水还没准备")
        friend = TestClient(c.app)
        friend.portal = c.client.portal
        self.addCleanup(friend.close)
        person = c.ok(friend.post("/api/auth/register", json={"username": "prep_friend",
            "display_name": "小雨（模拟）", "password": "synthetic-preparation-2026"}))
        c.ok(c.client.post("/api/friends", json={"username": "prep_friend"}))
        c.ok(friend.post(f"/api/friends/{c.user['id']}/accept"))
        identity = board["task"]["id"]
        c.ok(c.client.post(f"/api/tasks/{identity}/shares", json={"user_id": person["id"]}))
        c.ok(friend.post(f"/api/tasks/{identity}/accept"))
        assigned = c.ok(c.client.patch(f"/api/tasks/{identity}/entries/water/assignee", json={
            "expected_version": board["task"]["version"], "assignee_id": person["id"]}))
        ready = c.ok(friend.patch(f"/api/tasks/{identity}/entries/water", json={
            "expected_version": assigned["task"]["version"], "state": "ready", "note": "水已经准备好了"}))
        before = ready["entries"][0]
        changed = {**before, "group": "owned", "state": "pending", "note": "家里有一箱水，不用再买，重新确认带哪箱"}
        quote = "水家里还有一箱，别买水。"
        proposed = self.proposal([changed], ready, quote=quote,
            preparation=[{"entry_id": "water", "source_quote": "水家里还有一箱，别买水"}])
        plan, _ = c.run_turn([proposed], quote)
        self.assertEqual(c.model.calls, 1)
        self.assertEqual(len(plan["entries"]), 1)
        actual = plan["entries"][0]
        self.assertEqual((actual["id"], actual["group"], actual["state"]), ("water", "owned", "pending"))
        self.assertEqual(actual["assignee_id"], person["id"])
        self.assertEqual(actual["updated_by"], person["id"])
        self.assertEqual(actual["note"], changed["note"])
        self.assertEqual(self.current(identity)["entries"], plan["entries"])

    def test_current_preparation_quote_can_replace_old_note(self):
        c = self.case
        board = self.board(note="不清楚数量，先按四个人买四瓶")
        quote = "水家里还有一箱，别买水。"
        entry = {**board["entries"][0], "note": "家里有一箱水，先核对带多少，不要新买"}
        proposed = self.proposal([entry], board, quote=quote,
            preparation=[{"entry_id": "water", "source_quote": "水家里还有一箱，别买水"}])
        plan, _ = c.run_turn([proposed], quote)
        self.assertEqual(plan["entries"][0]["note"], entry["note"])
        self.assertNotIn("买四瓶", plan["entries"][0]["note"])

    def test_without_preparation_quote_old_note_assignment_and_attribution_survive(self):
        c = self.case
        board = self.board()
        board = c.ok(c.client.patch(f"/api/tasks/{board['task']['id']}/entries/water/assignee", json={
            "expected_version": board["task"]["version"], "assignee_id": c.user["id"]}))
        before = board["entries"][0]
        forged = {**before, "note": "模型自己改成已经有一箱了", "assignee_id": "invented-friend", "updated_by": "invented-reporter"}
        repaired = {**forged, "note": before["note"]}
        plan, _ = c.run_turn([self.proposal([forged], board), self.proposal([repaired], board)],
                            "先看看清单，别替我改分工。")
        self.assertEqual(c.model.calls, 2)
        self.assertIn("note不能静默丢弃", c.model.inputs[1])
        for key in ("note", "assignee_id", "updated_by"):
            self.assertEqual(plan["entries"][0][key], before[key])

    def test_ready_two_bottles_cannot_stay_ready_when_note_now_requires_ten(self):
        c = self.case
        board = self.board(group="buy", note="先准备两瓶饮用水")
        board = c.ok(c.client.patch(f"/api/tasks/{board['task']['id']}/entries/water", json={
            "expected_version": board["task"]["version"], "state": "ready", "note": "已经装好2瓶水"}))
        before = board["entries"][0]
        quote = "这次饮用水要10瓶，之前装的两瓶不够。"
        updated = {**before, "note": "这次需要10瓶，原来的2瓶不够，重新核对补足"}
        prep = [{"entry_id": "water", "source_quote": "这次饮用水要10瓶，之前装的两瓶不够"}]
        invalid = self.proposal([updated], board, quote=quote, preparation=prep)
        repaired = self.proposal([{**updated, "state": "pending"}], board, quote=quote, preparation=prep)
        plan, _ = c.run_turn([invalid, repaired], quote)
        self.assertEqual(c.model.calls, 2)
        self.assertIn("state需pending重新核对", c.model.inputs[1])
        self.assertEqual(plan["entries"][0]["state"], "pending")
        self.assertEqual(plan["entries"][0]["note"], updated["note"])
        self.assertEqual(plan["entries"][0]["updated_by"], before["updated_by"])
        self.assertEqual(self.current(board["task"]["id"])["entries"], plan["entries"])

    def test_missing_old_id_requires_native_repair_and_never_appends_duplicate_water(self):
        c = self.case
        board = self.board(group="buy")
        quote = "水家里还有一箱，别买水。"
        invalid = self.proposal([{**board["entries"][0], "id": "new-water", "group": "owned"}], board, quote=quote,
            preparation=[{"entry_id": "new-water", "source_quote": "水家里还有一箱，别买水"}])
        repaired = self.proposal([{**board["entries"][0], "group": "owned"}], board, quote=quote,
            preparation=[{"entry_id": "water", "source_quote": "水家里还有一箱，别买水"}])
        plan, _ = c.run_turn([invalid, repaired], quote)
        self.assertEqual(c.model.calls, 2)
        self.assertIn("已有清单项目不能漏掉或换新ID", c.model.inputs[1])
        self.assertEqual([(entry["id"], entry["title"], entry["group"]) for entry in plan["entries"]],
                         [("water", "饮用水", "owned")])

    def test_unknown_purchase_without_current_quote_repairs_to_confirm(self):
        c = self.case
        invalid = self.proposal([{"id": "tissues", "title": "纸巾", "group": "buy", "state": "pending"}])
        repaired = copy.deepcopy(invalid)
        repaired["continuation"]["plan"]["entries"][0]["group"] = "confirm"
        plan, _ = c.run_turn([invalid, repaired], "周六去野餐，先看看家里有什么，别买太多。")
        self.assertEqual(c.model.calls, 2)
        self.assertIn("未登记不代表没有", c.model.inputs[1])
        self.assertEqual(plan["entries"][0]["group"], "confirm")

    def test_resource_revision_cannot_also_transfer_completion_report(self):
        c = self.case
        board = self.board(group="buy")
        quote = "水家里还有一箱，别买水，刚才那箱已经准备好了。"
        entries = [{**board["entries"][0], "group": "owned", "state": "pending", "note": "改用家里那箱水，重新核对"}]
        prep = [{"entry_id": "water", "source_quote": "水家里还有一箱，别买水"}]
        invalid = self.proposal(entries, board, quote=quote, preparation=prep,
            progress=[{"entry_id": "water", "action_result": "completed", "source_quote": "刚才那箱已经准备好了"}])
        repaired = self.proposal(entries, board, quote=quote, preparation=prep)
        plan, _ = c.run_turn([invalid, repaired], quote)
        self.assertEqual(c.model.calls, 2)
        self.assertIn("不能同时把旧动作的完成报告迁移过来", c.model.inputs[1])
        self.assertEqual((plan["entries"][0]["group"], plan["entries"][0]["state"]), ("owned", "pending"))


if __name__ == "__main__":
    unittest.main()
