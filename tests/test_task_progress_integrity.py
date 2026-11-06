"""Adversarial progress writes through the native SDK/HTTP boundary.

Only the model is deterministic; users, possessions and reports are simulated.
No provider calls and no live application database access.
"""
import copy
import unittest

import test_agent_plan_contract as contracts
from wujian import foundation
from wujian.database import ItemRecord, TaskRecord


class TaskProgressIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.case = contracts.AgentPlanContractTests()
        self.case.setUp()
        self.addCleanup(self.case.tearDown)

    def test_agent_resource_report_obeys_same_unavailability_rule_as_ui(self):
        c = self.case
        board = c.board()
        with c.app.state.sessions() as db:
            row = db.get(TaskRecord, board["task"]["id"])
            row.plan = {**row.plan, "entries": [{**e, "group": "owned"} for e in row.plan["entries"]]}
            item = db.get(ItemRecord, c.item["id"])
            item.state = {"availability": "unavailable"}
            db.commit()
        ui = c.client.patch(f"/api/tasks/{board['task']['id']}/entries/fold", json={
            "expected_version": board["task"]["version"], "state": "ready"})
        self.assertEqual(ui.status_code, 409)
        invalid = c.proposal([{**c.entry(state="ready"), "group": "owned"}], board)
        invalid["continuation"]["progress_reports"] = [{"entry_id": "fold",
            "action_result": "completed", "source_quote": "It is prepared."}]
        repaired = c.proposal([{**c.entry(), "group": "owned"}], board)
        plan, _ = c.run_turn([invalid, repaired], "It is prepared.")
        self.assertEqual(c.model.calls, 2)
        self.assertEqual(plan["entries"][0]["state"], "pending")

    def test_unavailable_device_diagnostic_step_can_still_be_completed(self):
        c = self.case
        board = c.board()
        with c.app.state.sessions() as db:
            db.get(ItemRecord, c.item["id"]).state = {"availability": "unavailable"}
            db.commit()
        proposal = c.proposal([c.entry(state="ready")], board)
        proposal["continuation"]["progress_reports"] = [{"entry_id": "fold",
            "action_result": "completed", "source_quote": "I completed that inspection."}]
        plan, _ = c.run_turn([proposal], "I completed that inspection.")
        self.assertEqual(c.model.calls, 1)
        self.assertEqual(plan["entries"][0]["state"], "ready")
        self.assertEqual(plan["entries"][0]["updated_by"], c.user["id"])

    def test_model_cannot_overwrite_existing_ui_notes_assignment_or_attribution(self):
        c = self.case
        board = c.board()
        board = c.ok(c.client.patch(f"/api/tasks/{board['task']['id']}/entries/fold", json={
            "expected_version": board["task"]["version"], "state": "ready",
            "note": "Keep this sheet intact."}))
        original = copy.deepcopy(board["entries"][0])
        changed = {**original, "note": "Cut it freely.",
            "assignee_id": "forged-person", "updated_by": "forged-person"}
        plan, _ = c.run_turn([c.proposal([changed], board)], "Continue.")
        self.assertEqual(plan["entries"][0], original)

    def test_new_proposals_cannot_assign_or_attribute_to_invented_people(self):
        c = self.case
        entry = {**c.entry(), "assignee_id": "forged-person", "updated_by": "forged-person"}
        plan, _ = c.run_turn([c.proposal([entry])])
        self.assertIsNone(plan["entries"][0]["assignee_id"])
        self.assertIsNone(plan["entries"][0]["updated_by"])

    def test_overall_success_cannot_complete_a_task_with_pending_entries(self):
        c = self.case
        board = c.board()
        invalid = c.proposal([c.entry()], board, "I only opened settings.")
        invalid["continuation"].update(status="completed", outcome="success")
        repaired = copy.deepcopy(invalid)
        repaired["continuation"].update(status="in_progress", outcome="unknown")
        plan, feedback = c.run_turn([invalid, repaired], "I only opened settings.")
        self.assertEqual(c.model.calls, 2)
        self.assertEqual(plan["entries"][0]["state"], "pending")
        self.assertFalse(any(row["outcome"] == "success" for row in feedback))
        with c.app.state.sessions() as db:
            self.assertEqual(db.get(TaskRecord, board["task"]["id"]).status, "in_progress")

    def test_current_report_can_complete_last_step_and_sign_exact_new_plan_once(self):
        c = self.case
        board = c.board()
        quote = "The card is folded and the game worked."
        proposal = c.proposal([c.entry(state="ready")], board, quote)
        proposal["continuation"].update(status="completed", outcome="success")
        proposal["continuation"]["progress_reports"] = [{"entry_id": "fold",
            "action_result": "completed", "source_quote": "The card is folded"}]
        plan, feedback = c.run_turn([proposal], quote)
        self.assertEqual(c.model.calls, 1)
        self.assertEqual(len(feedback), 1, "The rolled-back preview must not add another receipt")
        self.assertEqual(plan["entries"][0]["state"], "ready")
        with c.app.state.sessions() as db:
            row = db.get(TaskRecord, board["task"]["id"])
            self.assertEqual(row.status, "completed")
            self.assertEqual(feedback[0]["plan_signature"], foundation.plan_signature(
                row.goal, row.item_ids, row.constraints, row.plan))

    def test_resource_readiness_without_success_report_is_not_overall_completion(self):
        c = self.case
        board = c.board()
        board = c.ok(c.client.patch(f"/api/tasks/{board['task']['id']}/entries/fold", json={
            "expected_version": board["task"]["version"], "state": "ready"}))
        invalid = c.proposal(board["entries"], board)
        invalid["continuation"]["status"] = "completed"
        repaired = copy.deepcopy(invalid)
        repaired["continuation"]["status"] = "ready"
        c.run_turn([invalid, repaired], "Everything is prepared; how do I start?")
        self.assertEqual(c.model.calls, 2)
        with c.app.state.sessions() as db:
            self.assertEqual(db.get(TaskRecord, board["task"]["id"]).status, "ready")


if __name__ == "__main__":
    unittest.main()
