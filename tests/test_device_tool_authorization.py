"""Offline checks: never operate a real Bluetooth adapter in these tests."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from wujian import domain
from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, make_database


class DeviceAuthorizationTests(unittest.TestCase):
    def test_tool_cannot_take_permission_from_document_or_another_message(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = Settings(data_dir=Path(temporary), rea_enabled=True)
            config.prepare()
            engine, sessions = make_database(config)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                    conversation = Conversation(user_id="person_demo_owner", item_ids=[])
                    db.add(conversation); db.flush()
                    message = ChatMessage(conversation_id=conversation.id, role="user", text="读一下电量就好，先别改。")
                    db.add(message); db.commit(); identity = message.id
                tools = {tool.name: tool for tool in make_tools(config, sessions, "person_demo_owner", identity).tool_groups[0].tools}
                self.assertNotIn("set_earbud_noise_mode", tools)
                self.assertNotIn("set_earbud_volume", tools)
                with patch("wujian.earbuds.earbud_tool") as hardware:
                    denied = asyncio.run(tools["connect_earbuds"](item_id="item_demo_lamp",
                        source_quote="请建立耳机控制面板"))
                    self.assertEqual(str(denied.state), "error")
                    hardware.assert_not_called()
                    config.rea_enabled = False
                    disabled = asyncio.run(tools["inspect_earbuds"]())
                    self.assertEqual(str(disabled.state), "error")
                    hardware.assert_not_called()
            finally:
                engine.dispose()
