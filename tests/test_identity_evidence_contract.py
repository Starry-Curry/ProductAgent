"""Source-bound identity assertions through the actual AgentScope tool adapter.

MJTD01SYL is a real domestic Mi Desk Lamp 1S identity. People/ownership and
retained source text are explicit offline fixtures, not claimed web evidence.
"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, SourceRecord
from wujian.server import create_app


MODEL = "MJTD01SYL"
PRODUCT = {"brand": "米家", "commercial_name": "米家台灯1S", "model": MODEL, "market": "CN"}


class IdentityEvidenceContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name), api_key="offline-no-network", rea_enabled=False))
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()
        self.user = self.ok(self.client.post("/api/auth/register", json={
            "username": "identity_evidence", "display_name": "模拟物主",
            "password": "offline-fixture-only-123"}))

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.temp.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def item(self, product=None):
        return self.ok(self.client.post("/api/items", json={"name": "桌上的台灯",
            "product": product or {"commercial_name": "台灯，型号待确认"}}))

    def tools(self, item, user_text):
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=self.user["id"], title=user_text,
                item_ids=[item["id"]], entry_context={"intent": "general"})
            db.add(conversation)
            db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text=user_text)
            db.add(message)
            db.commit()
            message_id = message.id
        toolkit = make_tools(self.app.state.settings, self.app.state.sessions, self.user["id"], message_id)
        return {tool.name: tool for tool in toolkit.tool_groups[0].tools}

    def source(self, item, text):
        with self.app.state.sessions() as db:
            source = SourceRecord(owner_id=self.user["id"], item_id=item["id"],
                title="模拟留存的说明页（离线边界测试）", url="https://example.invalid/fixture-only",
                origin="public_web", content=text, pages=[])
            db.add(source)
            db.commit()
            return source.id

    def update(self, tools, item, basis, *, name="米家台灯1S", source_id=None, product=None):
        return asyncio.run(tools["update_item_identity"](item_id=item["id"], name=name,
            product=product or PRODUCT, basis=basis, source_id=source_id))

    def test_user_report_cannot_introduce_a_model_the_user_never_reported(self):
        item = self.item()
        tools = self.tools(item, "这盏台灯有点晃，帮我看看吧。")
        reply = self.update(tools, item, "user_report")
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(str(reply.state), "error", {
            "tool_text": reply.content[0].text, "stored_product": after["product"], "stored_state": after["state"]})
        self.assertEqual(after["product"], item["product"])
        self.assertEqual(after["version"], item["version"])

    def test_known_model_cannot_be_replaced_with_an_unreported_other_domestic_model(self):
        item = self.item(PRODUCT)
        tools = self.tools(item, "这盏灯改名小白就好，型号不用动。")
        # Real China Mi Desk Lamp Pro model, verified against the official page:
        # https://www.mi.com/lamp-pro/specs (not a fictional suffix/SKU).
        changed = {"brand": "米家", "commercial_name": "米家台灯Pro", "model": "MJTD02YL", "market": "CN"}
        reply = self.update(tools, item, "user_report", name="小白", product=changed)
        self.assertEqual(str(reply.state), "error", reply)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(after["product"], item["product"])
        self.assertEqual(after["product_id"], item["product_id"])
        self.assertEqual(after["name"], item["name"])
        self.assertEqual(after["version"], item["version"])

    def test_another_accounts_message_containing_the_model_is_not_user_report_evidence(self):
        item = self.item()
        other = TestClient(self.app)
        other.portal = self.client.portal
        try:
            stranger = self.ok(other.post("/api/auth/register", json={
                "username": "other_identity_owner", "display_name": "另一模拟物主",
                "password": "offline-fixture-only-123"}))
            with self.app.state.sessions() as db:
                conversation = Conversation(user_id=stranger["id"], title="另一人的灯",
                    item_ids=[], entry_context={"intent": "general"})
                db.add(conversation)
                db.flush()
                message = ChatMessage(conversation_id=conversation.id, role="user",
                    text="我这盏米家台灯1S铭牌上写着MJTD01SYL。")
                db.add(message)
                db.commit()
                source_message_id = message.id
            # Caller owns the target item, so this specifically tests the
            # source message's author rather than the target-item permission.
            toolkit = make_tools(self.app.state.settings, self.app.state.sessions,
                self.user["id"], source_message_id)
            tools = {tool.name: tool for tool in toolkit.tool_groups[0].tools}
            reply = self.update(tools, item, "user_report")
            self.assertEqual(str(reply.state), "error", reply)
            self.assertIn("当前用户的实际消息", reply.content[0].text)
            after = self.ok(self.client.get("/api/items/" + item["id"]))
            self.assertEqual(after["product"], item["product"])
            self.assertEqual(after["version"], item["version"])
        finally:
            other.close()

    def test_owned_document_without_target_model_cannot_establish_that_model(self):
        item = self.item()
        tools = self.tools(item, "这就是我存的说明页，你帮我认一下是哪一款。")
        source_id = self.source(item, "米家台灯通用使用提示：把电源接好，再旋转调光。本文没有具体型号。")
        reply = self.update(tools, item, "document_match", source_id=source_id)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(str(reply.state), "error", {
            "tool_text": reply.content[0].text, "stored_product": after["product"], "stored_state": after["state"]})
        self.assertEqual(after["product"], item["product"])
        self.assertEqual(after["version"], item["version"])

    def test_actual_user_report_of_exact_model_remains_usable(self):
        item = self.item()
        tools = self.tools(item, "铭牌上写的型号是MJTD01SYL，米家台灯1S。帮我补好。")
        reply = self.update(tools, item, "user_report")
        self.assertEqual(str(reply.state), "success", reply)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(after["product"]["model"], MODEL)
        self.assertEqual(after["state"]["identity_evidence"]["basis"], "user_report")

    def test_bound_document_containing_target_model_passes_presence_boundary(self):
        item = self.item()
        tools = self.tools(item, "帮我把这盏灯的型号补完整，这张说明页就是它的。")
        source_id = self.source(item, "米家台灯1S 使用说明书；产品型号：MJTD01SYL。旋转旋钮可以调节亮度。")
        reply = self.update(tools, item, "document_match", source_id=source_id)
        self.assertEqual(str(reply.state), "success", reply)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(after["product"]["model"], MODEL)
        self.assertEqual(after["state"]["identity_evidence"]["source_id"], source_id)

    def test_unchanged_known_model_can_be_renamed_and_moved_without_repeating_model(self):
        item = self.item(PRODUCT)
        tools = self.tools(item, "这盏灯搬到书房了，名字就叫书房小白灯。")
        renamed = self.update(tools, item, "user_report", name="书房小白灯", product=item["product"])
        self.assertEqual(str(renamed.state), "success", renamed)
        current = self.ok(self.client.get("/api/items/" + item["id"]))
        moved = asyncio.run(tools["update_item_condition"](item_id=item["id"],
            changes={"location": "书房"}, source_quote="这盏灯搬到书房了", expected_version=current["version"]))
        self.assertEqual(str(moved.state), "success", moved)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(after["name"], "书房小白灯")
        self.assertEqual(after["product"]["model"], MODEL)
        self.assertEqual(after["product_id"], item["product_id"])
        self.assertEqual(after["state"]["location"], "书房")

    def test_visual_candidate_remains_explicitly_provisional(self):
        item = self.item()
        tools = self.tools(item, "看着像米家那款台灯，不过铭牌我看不清。")
        reply = self.update(tools, item, "visual_inference")
        self.assertEqual(str(reply.state), "success", reply)
        value = json.loads(reply.content[0].text)
        self.assertEqual(value["state"]["identity_evidence"]["basis"], "visual_inference")
        self.assertTrue(value["state"]["identity_evidence"]["provisional"])
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertTrue(after["state"]["identity_evidence"]["provisional"])

    def test_renaming_a_visual_candidate_does_not_confirm_its_unchanged_model(self):
        item = self.item()
        candidate_tools = self.tools(item, "看着像米家那款台灯，不过铭牌我看不清。")
        candidate = self.update(candidate_tools, item, "visual_inference")
        self.assertEqual(str(candidate.state), "success", candidate)
        before = self.ok(self.client.get("/api/items/" + item["id"]))
        evidence = before["state"]["identity_evidence"]
        rename_tools = self.tools(before, "这盏灯就叫小白吧。")
        renamed = self.update(rename_tools, before, "user_report", name="小白", product=before["product"])
        self.assertEqual(str(renamed.state), "success", "Renaming must not require repeating or confirming a SKU")
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(after["name"], "小白")
        self.assertEqual(after["product"]["model"], MODEL)
        self.assertEqual(after["product_id"], before["product_id"])
        self.assertTrue(after["state"]["identity_evidence"]["provisional"],
            "A nickname report silently confirmed the previous visual model guess")
        self.assertEqual(after["state"]["identity_evidence"], evidence,
            "A nickname-only report must preserve the original model evidence and attribution")


if __name__ == "__main__":
    unittest.main()
