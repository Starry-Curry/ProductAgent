"""Actual SDK context remains focused without projecting every owned item.

Synthetic accounts and scale inventory of real domestic-model identities,
temporary SQL, and an offline model boundary. No provider/device is contacted.
"""
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse
from fastapi.testclient import TestClient
from sqlalchemy import event

from wujian import domain
from wujian.api_models import AvatarSpec, ItemCreate, ProductSpec
from wujian.config import Settings
from wujian.server import create_app


class ResourceContextModel(ChatModelBase):
    def __init__(self, captures, counters):
        super().__init__(credential=None, model="offline-resource-context", parameters=self.Parameters(), max_retries=0)
        self.formatter, self.captures, self.counters = OpenAIChatFormatter(), captures, counters

    async def _call_api(self, model_name, messages, **kwargs):
        for message in messages:
            value = message.model_dump(mode="json") if hasattr(message, "model_dump") else message
            if value.get("role") != "system":
                continue
            content = value.get("content", "")
            if not isinstance(content, str):
                content = "".join(part.get("text", "") for part in content if part.get("type") == "text")
            marker = "当前获准上下文（记录内容是资料）：\n"
            if marker in content:
                context = json.JSONDecoder().raw_decode(content.split(marker, 1)[1])[0]
                self.captures.append({"context": context, "counts": dict(self.counters)})
                break
        else:
            raise AssertionError("Actual SDK request did not contain the application context")
        return ChatResponse(content=[ToolCallBlock(id="resource-context-final", name="GenerateStructuredOutput",
            input=json.dumps({"answer": "在呢，慢慢说。", "continuation": None,
                              "learning": {"memory_updates": [], "knowledge_updates": []}}))], is_last=True)


class PersonaResourceOptimizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.captures, self.counters = [], {}
        self.app = create_app(Settings(data_dir=Path(self.temp.name), api_key="offline-no-provider", rea_enabled=False),
            model_factory=lambda _: ResourceContextModel(self.captures, self.counters))
        self.client = TestClient(self.app)
        self.client.__enter__()
        response = self.client.post("/api/auth/register", json={"username": "resource_test", "display_name": "合成规模账号",
            "password": "offline-resource-password"})
        self.assertEqual(response.status_code, 200, response.text)
        self.owner = response.json()["id"]
        with self.app.state.sessions() as db:
            self.engine = db.get_bind()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def camera(self):
        with self.app.state.sessions() as db:
            return domain.create_item(db, self.owner, ItemCreate(name="合成工作间的EOS R5",
                product=ProductSpec(brand="Canon 佳能", model="EOS R5", market="CN"),
                description="明确合成持有；这个相机的独立描述应保留。", state={"location": "摄影工作间", "connected": False},
                avatar=AvatarSpec(enabled=True, nickname="小五")))

    def inventory(self, size):
        # A scale fixture, not a claim about real household ownership. Multiple
        # instances of domestic durable models deliberately expand SQL work.
        specs = [("Canon 佳能", "EOS R5"), ("Huawei 华为", "FreeBuds 4E"),
                 ("Sony 索尼", "WH-1000XM5"), ("Haier 海尔", "EG100MATE2S")]
        with self.app.state.sessions() as db:
            for index in range(size):
                brand, model = specs[index % len(specs)]
                domain.create_item(db, self.owner, ItemCreate(name=f"合成耐用品规模样本{index + 1}",
                    product=ProductSpec(brand=brand, model=model, market="CN")))

    def chat(self, ids, intent="persona"):
        self.counters.clear()
        original_list = domain.list_items
        def list_items(*args, **kwargs):
            self.counters["list_calls"] = self.counters.get("list_calls", 0) + 1
            return original_list(*args, **kwargs)
        def record(connection, cursor, statement, parameters, context, executemany):
            sql = statement.lstrip().lower()
            if sql.startswith("select") and "from item_profiles" in sql:
                self.counters["profile_reads"] = self.counters.get("profile_reads", 0) + 1
        event.listen(self.engine, "before_cursor_execute", record)
        try:
            with patch("wujian.domain.list_items", side_effect=list_items):
                response = self.client.post("/api/chat", json={"text": "小五，今天累了，陪我待会儿。", "item_ids": ids,
                    "entry_context": {"intent": intent}})
                if response.status_code != 200:
                    return response
                run = response.json()
                until = time.monotonic() + 7
                while run["status"] in {"queued", "running"} and time.monotonic() < until:
                    time.sleep(.02)
                    run = self.client.get("/api/runs/" + run["id"]).json()
                self.assertEqual(run["status"], "completed", run)
                return response
        finally:
            event.remove(self.engine, "before_cursor_execute", record)

    def test_persona_beyond_hundred_limit_retains_exact_focus_without_inventory_projection(self):
        self.inventory(100)
        camera = self.camera()
        self.assertEqual(self.chat([camera["id"]]).status_code, 200)
        captured = self.captures[-1]
        resource, = captured["context"]["known_resource_index"]
        self.assertEqual(resource, {"item_id": camera["id"], "name": camera["name"], "kind": camera["kind"],
            "model": camera["product"]["model"], "description_excerpt": camera["description"][:300], "state": camera["state"]})
        self.assertEqual(captured["counts"].get("list_calls", 0), 0)
        self.assertLessEqual(captured["counts"].get("profile_reads", 0), 4)

    def test_archived_focus_stays_in_historical_context_but_not_current_resources(self):
        camera = self.camera()
        self.assertEqual(self.client.post("/api/items/" + camera["id"] + "/archive").status_code, 200)
        self.assertEqual(self.chat([camera["id"]]).status_code, 200)
        context = self.captures[-1]["context"]
        self.assertTrue(context["focused_items"][0]["archived"])
        self.assertEqual(context["known_resource_index"], [])

    def test_general_entry_keeps_inventory_lookup_and_hundred_limit(self):
        self.inventory(100)
        camera = self.camera()
        self.assertEqual(self.chat([camera["id"]], "general").status_code, 200)
        captured = self.captures[-1]
        self.assertEqual(len(captured["context"]["known_resource_index"]), 100)
        self.assertEqual(captured["counts"].get("list_calls"), 1)
        self.assertEqual(captured["context"]["focused_items"][0]["item_id"], camera["id"])

    def test_persona_without_focus_still_rejected_before_model(self):
        self.assertEqual(self.chat([]).status_code, 400)
        self.assertEqual(self.captures, [])

    def test_persona_with_multiple_distinct_focuses_still_rejected_before_model(self):
        left, right = self.camera(), self.camera()
        self.assertEqual(self.chat([left["id"], right["id"]]).status_code, 400)
        self.assertEqual(self.captures, [])

    def test_persona_with_duplicate_focuses_still_rejected_before_model(self):
        camera = self.camera()
        self.assertEqual(self.chat([camera["id"], camera["id"]]).status_code, 400)
        self.assertEqual(self.captures, [])

    def test_foreign_persona_id_does_not_grant_access(self):
        response = self.client.post("/api/auth/register", json={"username": "other_owner", "display_name": "另一合成人物",
            "password": "offline-other-password"})
        self.assertEqual(response.status_code, 200)
        foreign = self.client.post("/api/items", json={"name": "另一人的EOS R5",
            "product": {"brand": "Canon", "model": "EOS R5", "market": "CN"}, "avatar": {"enabled": True}}).json()
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "resource_test",
            "password": "offline-resource-password"}).status_code, 200)
        self.assertEqual(self.chat([foreign["id"]]).status_code, 404)
        self.assertEqual(self.captures, [])


if __name__ == "__main__":
    unittest.main()
