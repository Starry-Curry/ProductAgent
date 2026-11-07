"""Actual HTTP/AgentScope/SQL SKU-boundary tests, without provider or network.

Sony WH-CH720N and Deli 8553 are domestic product identifiers. Extended strings
WH-CH720N2 and 85530 below are synthetic negative identifiers, not real models.
Every retained document body is a synthetic lexical fixture, not web evidence.
"""
import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from fastapi.testclient import TestClient
from sqlalchemy import select

from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, KnowledgeClaim, SourceRecord
from wujian.server import create_app


SONY = {"brand": "索尼", "model": "WH-CH720N", "market": "CN"}
QUOTE = "按住功能按钮可以切换当前模式。"


class ExactLearningModel(ChatModelBase):
    def __init__(self):
        super().__init__(credential=None, model="offline-exact-model-only",
            parameters=self.Parameters(), max_retries=0)
        self.formatter = OpenAIChatFormatter()
        self.calls = 0
        self.source_id = ""
        self.changes = []
        self.received_rejection = False

    async def _call_api(self, model_name, messages, **kwargs):
        self.calls += 1
        if self.calls == 1:
            name, arguments = "read_source", {"source_id": self.source_id}
        else:
            if self.calls > 3:
                raise AssertionError("Only one actual source read, one proposal and one repair are expected")
            if self.calls == 3:
                actual_feedback = json.dumps(messages, ensure_ascii=False, default=str)
                self.received_rejection = any(text in actual_feedback for text in (
                    "该来源原文没有匹配型号", "型号知识需要原文中实际出现的匹配型号"))
            name = "GenerateStructuredOutput"
            arguments = {"answer": "这份资料先留作参考。", "continuation": None,
                "source_refs": [self.source_id], "learning": {
                    "knowledge_updates": self.changes if self.calls == 2 else [], "memory_updates": []}}
        return ChatResponse(content=[ToolCallBlock(id=f"exact-{self.calls}", name=name,
            input=json.dumps(arguments, ensure_ascii=False))], is_last=True)


class ExactModelEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.model = ExactLearningModel()
        self.app = create_app(Settings(data_dir=Path(self.directory.name),
            api_key="offline-no-provider", demo_mode=False, rea_enabled=False),
            model_factory=lambda _settings: self.model)
        self.client = TestClient(self.app).__enter__()
        self.user = self.ok(self.client.post("/api/auth/register", json={"username": "exact_owner",
            "display_name": "模拟物主", "password": "offline-fixture-only-123"}))

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def item(self, product=None):
        return self.ok(self.client.post("/api/items", json={"name": "桌上的耳机（模拟拥有）",
            "product": product or {}}))

    def tools(self, item, text):
        with self.app.state.sessions() as db:
            conversation = Conversation(user_id=self.user["id"], item_ids=[item["id"]])
            db.add(conversation)
            db.flush()
            message = ChatMessage(conversation_id=conversation.id, role="user", text=text)
            db.add(message)
            db.commit()
            message_id = message.id
        toolkit = make_tools(self.app.state.settings, self.app.state.sessions, self.user["id"], message_id)
        return {tool.name: tool for tool in toolkit.tool_groups[0].tools}

    def source(self, item, text, title="离线合成的型号边界文本，不是真实说明书"):
        with self.app.state.sessions() as db:
            source = SourceRecord(owner_id=self.user["id"], item_id=item["id"],
                title=title,
                url="https://example.invalid/synthetic-only", origin="public_web", content=text, pages=[])
            db.add(source)
            db.commit()
            return source.id

    def update(self, tools, item, basis, product=SONY, source_id=None):
        return asyncio.run(tools["update_item_identity"](item_id=item["id"], name="识别后的物品",
            product=product, basis=basis, source_id=source_id))

    def test_user_report_does_not_treat_a_longer_synthetic_sku_as_the_shorter_real_model(self):
        item = self.item()
        tools = self.tools(item, "我看到铭牌上写的是WH-CH720N2，帮我看看。")
        result = self.update(tools, item, "user_report")
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(str(result.state), "error", {"tool": result.content[0].text, "stored": after["product"]})
        self.assertEqual(after["product"], item["product"])
        self.assertEqual(after["version"], item["version"])

    def test_document_match_does_not_confirm_a_model_from_a_synthetic_neighbor_number(self):
        item = self.item()
        source = self.source(item, "合成负例规格标识：85530。这种夹子可以夹住纸张。")
        tools = self.tools(item, "这盒夹子的说明在这里，帮我认一下。")
        result = self.update(tools, item, "document_match",
            product={"brand": "得力", "model": "8553", "market": "CN"}, source_id=source)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(str(result.state), "error", {"tool": result.content[0].text, "stored": after["product"]})
        self.assertEqual(after["product"], item["product"])
        self.assertEqual(after["version"], item["version"])

    def test_exact_user_model_with_adjacent_chinese_or_normal_punctuation_remains_valid(self):
        for text in ("这是索尼WH-CH720N耳机，帮我把型号记好。", "型号：wh-ch720n（中国版）。"):
            with self.subTest(text=text):
                item = self.item()
                result = self.update(self.tools(item, text), item, "user_report")
                self.assertEqual(str(result.state), "success", result)
                after = self.ok(self.client.get("/api/items/" + item["id"]))
                self.assertEqual(after["product"]["model"], SONY["model"])
                self.assertFalse(after["state"]["identity_evidence"]["provisional"])

    def test_visual_candidate_still_keeps_its_explicit_uncertainty(self):
        item = self.item()
        result = self.update(self.tools(item, "看着像索尼那款，但铭牌我看不清。"), item, "visual_inference")
        self.assertEqual(str(result.state), "success", result)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(after["state"]["identity_evidence"]["basis"], "visual_inference")
        self.assertTrue(after["state"]["identity_evidence"]["provisional"])

    def test_joined_suffix_ascii_prefix_and_longer_number_remain_other_identifiers(self):
        for product, reported in ((SONY, "WH-CH720N-2"), (SONY, "XWH-CH720N"),
                ({"brand": "得力", "model": "8553", "market": "CN"}, "18553")):
            with self.subTest(reported=reported):
                item = self.item()
                result = self.update(self.tools(item, "我看到的标识是" + reported + "，帮我核对一下。"),
                    item, "user_report", product=product)
                self.assertEqual(str(result.state), "error", result)
                after = self.ok(self.client.get("/api/items/" + item["id"]))
                self.assertEqual(after["product"], item["product"])
                self.assertEqual(after["version"], item["version"])

    def test_document_cannot_assemble_a_model_across_title_and_body(self):
        item = self.item()
        source = self.source(item, "720N。这是合成的正文片段，不含完整型号。", title="合成标题 WH-CH")
        result = self.update(self.tools(item, "帮我认一下这份资料。"), item,
            "document_match", source_id=source)
        self.assertEqual(str(result.state), "error", result)
        after = self.ok(self.client.get("/api/items/" + item["id"]))
        self.assertEqual(after["product"], item["product"])
        self.assertEqual(after["version"], item["version"])

    def test_nfkc_typographic_hyphen_and_ikea_dotted_article_keep_working(self):
        ikea = {"brand": "IKEA 宜家", "model": "501.777.27", "market": "CN"}
        for product, words in ((SONY, "型号是ＷＨ－ＣＨ７２０Ｎ，帮我记好。"),
                (SONY, "索尼wh–ch720n耳机，铭牌写的是这个。"),
                (ikea, "宜家货号501.777.27，这就是我买的那个搁板。")):
            with self.subTest(words=words):
                item = self.item()
                result = self.update(self.tools(item, words), item, "user_report", product=product)
                self.assertEqual(str(result.state), "success", result)
                after = self.ok(self.client.get("/api/items/" + item["id"]))
                self.assertEqual(after["product"]["model"], product["model"])
        item = self.item()
        source = self.source(item, "合成正例：宜家货号501.777.27。这是离线格式测试。")
        result = self.update(self.tools(item, "帮我按这份资料确认货号。"), item,
            "document_match", product=ikea, source_id=source)
        self.assertEqual(str(result.state), "success", result)

    def change(self, item, *, scope="product", basis="document", kind="capability"):
        return {"item_id": item["id"], "kind": kind, "content": "可以切换当前模式。",
            "conditions": {"requirements": [], "limits": [], "unknowns": ["当前实物适配未核实"]},
            "basis": basis, "scope": scope, "source_id": self.model.source_id,
            "source_quote": QUOTE, "source_model": SONY["model"] if scope == "product" else ""}

    def learn(self, item, source_text, changes):
        self.model.source_id = self.source(item, source_text)
        self.model.changes = changes
        for change in self.model.changes:
            change["source_id"] = self.model.source_id
        run = self.ok(self.client.post("/api/chat", json={"text": "这份资料帮我看看，能用的认识留着以后参考。",
            "item_ids": [item["id"]]}))
        deadline = time.monotonic() + 5
        while run["status"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(.02)
            run = self.ok(self.client.get("/api/runs/" + run["id"]))
        self.assertEqual(run["status"], "completed", run)
        with self.app.state.sessions() as db:
            return [dict(id=row.id, product_id=row.product_id, item_id=row.item_id,
                basis=row.basis, status=row.status, conditions=row.conditions)
                for row in db.scalars(select(KnowledgeClaim).where(KnowledgeClaim.owner_id == self.user["id"]))]

    def test_product_learning_rejects_neighbor_sku_via_real_sdk_validation_and_sql(self):
        item = self.item(SONY)
        claims = self.learn(item, "合成负例标识：WH-CH720N2。" + QUOTE, [self.change(item)])
        self.assertEqual(claims, [], "Synthetic neighboring SKU was persisted as model-wide knowledge")
        self.assertEqual(self.model.calls, 3, "The real SDK final tool should return an error before repair")
        self.assertTrue(self.model.received_rejection)

    def test_generic_item_reference_and_inference_survive_without_claiming_model_match(self):
        item = self.item(SONY)
        claims = self.learn(item, "合成负例标识：WH-CH720N2。" + QUOTE,
            [self.change(item, scope="item", kind="case"), self.change(item, scope="item", basis="inference")])
        self.assertEqual(len(claims), 2)
        self.assertTrue(all(row["product_id"] is None and row["item_id"] == item["id"] for row in claims))
        document = next(row for row in claims if row["basis"] == "document")
        inference = next(row for row in claims if row["basis"] == "inference")
        self.assertEqual(document["conditions"]["identity_match"], "generic_reference")
        self.assertEqual(inference["conditions"]["identity_match"], "unverified")

    def test_exact_document_product_learning_remains_valid(self):
        item = self.item(SONY)
        claims = self.learn(item, "合成正例：索尼wh-ch720n耳机。" + QUOTE, [self.change(item)])
        self.assertEqual(len(claims), 1)
        self.assertEqual(claims[0]["product_id"], item["product_id"])
        self.assertEqual(claims[0]["conditions"]["identity_match"], "model_text_matched")
        self.assertEqual(self.model.calls, 2)
