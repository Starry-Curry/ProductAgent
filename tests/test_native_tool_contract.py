"""Exercise the installed SDK adapter, not only our function's return value."""
import asyncio
import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from agentscope.tool import ToolChunk
from agentscope.message import AssistantMsg, DataBlock, ToolResultBlock
from agentscope.formatter import DashScopeChatFormatter

from wujian import domain
from wujian.api_models import ExperienceCreate
from wujian.agent_runtime import make_tools
from wujian.config import Settings
from wujian.database import Asset, Grant, ItemRecord, SourceRecord, make_database


class NativeToolContractTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.settings=Settings(data_dir=Path(self.temp.name));self.settings.prepare()
        self.engine,self.sessions=make_database(self.settings)
        with self.sessions() as db: domain.seed_demo(db)
        self.toolkit=make_tools(self.settings,self.sessions,"person_demo_owner","synthetic-message")
        self.tools={tool.name:tool for tool in self.toolkit.tool_groups[0].tools}

    def tearDown(self):
        self.engine.dispose();self.temp.cleanup()

    def test_business_json_is_not_serialized_as_a_nested_python_tool_response(self):
        result=asyncio.run(self.tools["read_item"](item_id="item_demo_lamp"))
        self.assertIsInstance(result,ToolChunk)
        self.assertEqual(str(result.state),"success")
        data=json.loads(result.content[0].text)
        self.assertEqual(data["item_id"],"item_demo_lamp")
        self.assertNotIn("product_id",data)

    def test_business_rejection_reaches_sdk_error_state(self):
        result=asyncio.run(self.tools["read_item"](item_id="not-an-authorized-item"))
        self.assertEqual(str(result.state),"error")
        self.assertIn("无权访问",result.content[0].text)

    def test_known_story_id_reads_exact_original_and_rechecks_ai_consent(self):
        with self.sessions() as db:
            story=domain.create_experience(db,"person_demo_owner",ExperienceCreate(
                title="一段模拟生活",text="只是测试记录，不是实际往事。",item_ids=["item_demo_lamp"],allow_ai=True))
        result=asyncio.run(self.tools["recall_memories"](experience_id=story["id"]))
        value=json.loads(result.content[0].text)
        self.assertEqual(value["experiences"][0]["text"],story["text"])
        self.assertEqual(value["memories"],[])
        with self.sessions() as db:
            from wujian.database import ExperienceRecord
            db.get(ExperienceRecord,story["id"]).allow_ai=False
            db.commit()
        denied=asyncio.run(self.tools["recall_memories"](experience_id=story["id"]))
        self.assertEqual(str(denied.state),"error")
        self.assertNotIn(story["text"],denied.content[0].text)

    def test_actual_source_reading_metadata_survives_sdk_adapter(self):
        value={"source_id":"synthetic_source","url":"https://example.invalid/public",
               "title":"运输契约样本","content_level":"document_text","text":"1: 原始正文"}
        # fetch_source retains this fact before the SDK adapter rechecks its
        # present permission and applicability; mock transport, not persistence.
        with self.sessions() as db:
            db.add(SourceRecord(id=value['source_id'],owner_id='person_demo_owner',
                url=value['url'],title=value['title'],content='原始正文',origin='public_web'))
            db.commit()
        with patch("wujian.agent_runtime.fetch_source",new=AsyncMock(return_value=value)):
            result=asyncio.run(self.tools["fetch_document"](url=value["url"]))
        self.assertEqual(str(result.state),'success')
        self.assertEqual(result.metadata["evidence"]["source_id"],"synthetic_source")
        self.assertEqual(json.loads(result.content[0].text)["text"],value["text"])

    def test_saved_object_photo_is_native_multimodal_and_rechecked_after_revoke(self):
        # A one-pixel fixture tests transport/authorization, never visual quality.
        content=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=")
        path=Path(self.temp.name)/"photo.png";path.write_bytes(content)
        with self.sessions() as db:
            db.add(Asset(id="pixel",owner_id="person_demo_owner",path=str(path),media_type="image/png",original_name="pixel.png"))
            db.get(ItemRecord,"item_demo_lamp").photo_id="pixel"
            if db.get(Grant,("item_demo_lamp","person_demo_friend")) is None:
                db.add(Grant(item_id="item_demo_lamp",user_id="person_demo_friend"))
            db.commit()
        friend_tools=make_tools(self.settings,self.sessions,"person_demo_friend","synthetic-message")
        tool=next(t for t in friend_tools.tool_groups[0].tools if t.name=="view_item_photo")
        result=asyncio.run(tool(item_id="item_demo_lamp"))
        self.assertEqual(str(result.state),"success")
        self.assertIsInstance(result.content[1],DataBlock)
        self.assertEqual(result.content[1].source.data,base64.b64encode(content).decode())
        with self.sessions() as db:
            db.delete(db.get(Grant,("item_demo_lamp","person_demo_friend")));db.commit()
        denied=asyncio.run(tool(item_id="item_demo_lamp"))
        self.assertEqual(str(denied.state),"error")
        self.assertFalse(any(isinstance(block,DataBlock) for block in denied.content))

    def test_source_photo_reaches_the_sdk_multimodal_formatter_as_an_image(self):
        value={"source_id":"synthetic_source","source_url":"https://example.invalid/source",
               "image_url":"https://example.invalid/photo.png","asset_id":"synthetic_asset",
               "media_type":"image/png","base64":"c3ludGhldGljLXRyYW5zcG9ydC1vbmx5",
               "evidence_kind":"source_image_for_model_observation"}
        with patch("wujian.agent_runtime.fetch_source_image",new=AsyncMock(return_value=value)):
            result=asyncio.run(self.tools["view_source_image"](source_id="synthetic_source",image_url=value["image_url"]))
        self.assertEqual(str(result.state),"success")
        self.assertIsInstance(result.content[1],DataBlock)
        self.assertNotIn("base64",result.content[0].text)
        formatted=asyncio.run(DashScopeChatFormatter().format([AssistantMsg(name="offline-test",content=[
            ToolResultBlock(id="test-photo",name="view_source_image",output=result.content,state=result.state)])]))
        images=[block for message in formatted for block in (message.get("content") or [])
                if isinstance(block,dict) and block.get("type")=="image_url"]
        self.assertEqual(len(images),1)

    def test_video_samples_keep_timestamps_and_images_in_native_sdk_transport(self):
        value={"source_id":"synthetic_frames","parent_source_id":"synthetic_page",
            "source_url":"https://www.bilibili.com/video/BV1pa4y1B7f8/",
            "content_level":"sampled_video_frames_not_full_video",
            "manifest":{"reading_scope":"仅两个抽帧，不是完整视频"},
            "frames":[{"asset_id":f"frame-{second}","at_seconds":second,"media_type":"image/png",
                       "base64":"c3ludGhldGljLXRyYW5zcG9ydC1vbmx5"} for second in [3.5,7.5]]}
        with patch("wujian.agent_runtime.sample_source_video",new=AsyncMock(return_value=value)):
            result=asyncio.run(self.tools["sample_video_frames"](
                source_id="synthetic_page",start_seconds=0,end_seconds=10,frame_count=2))
        self.assertEqual(str(result.state),"success")
        self.assertEqual(result.metadata["evidence"]["source_id"],"synthetic_frames")
        self.assertEqual(result.metadata["evidence"]["frame_asset_ids"],["frame-3.5","frame-7.5"])
        self.assertIn("3.5秒",result.content[1].text)
        self.assertNotIn("base64",result.content[0].text)
        observed=json.loads(result.content[0].text)
        self.assertEqual(observed["observed_frame_times_seconds"],[3.5,7.5])
        self.assertEqual(observed["evidence_kind"],"timestamped_still_images")
        formatted=asyncio.run(DashScopeChatFormatter().format([AssistantMsg(name="offline-test",content=[
            ToolResultBlock(id="test-video",name="sample_video_frames",output=result.content,state=result.state)])]))
        images=[block for message in formatted for block in (message.get("content") or [])
                if isinstance(block,dict) and block.get("type")=="image_url"]
        self.assertEqual(len(images),2)

    def test_read_source_reopens_actual_saved_video_frames_without_new_download(self):
        with self.sessions() as db:
            db.add(SourceRecord(id="saved_sample",owner_id="person_demo_owner",origin="video_frame_sample",
                url="https://www.bilibili.com/video/BV1pa4y1B7f8/",title="抽帧",content="{}",pages=[]))
            db.commit()
        value={"source_id":"saved_sample","parent_source_id":"original_page",
            "source_url":"https://www.bilibili.com/video/BV1pa4y1B7f8/",
            "content_level":"sampled_video_frames_not_full_video","manifest":{},
            "frames":[{"asset_id":"saved_frame","at_seconds":3.5,"media_type":"image/png","base64":"c3ludGhldGlj"}]}
        with patch("wujian.agent_runtime.retained_video_frames",return_value=value), \
             patch("wujian.agent_runtime.sample_source_video",new=AsyncMock()) as sample:
            result=asyncio.run(self.tools["read_source"](source_id="saved_sample"))
        self.assertEqual(str(result.state),"success")
        self.assertIsInstance(result.content[2],DataBlock)
        self.assertEqual(result.metadata["evidence"]["source_id"],"saved_sample")
        sample.assert_not_awaited()
