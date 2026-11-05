"""References stay grounded and authorized; metadata isn't video observation."""
import tempfile
import unittest
from pathlib import Path

from wujian import domain
from wujian.config import Settings
from wujian.database import ChatMessage, Conversation, Memory, SourceRecord, make_database
from wujian.turns import TurnResult, commit_result, grounded_turn_schema


class AnswerSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        s=Settings(data_dir=Path(self.temp.name));s.prepare()
        self.engine,self.sessions=make_database(s)
        self.owner,self.friend="person_demo_owner","person_demo_friend"
        with self.sessions() as db:
            domain.seed_demo(db)
            conversation=Conversation(user_id=self.owner);db.add(conversation);db.flush()
            message=ChatMessage(conversation_id=conversation.id,role="user",text="帮我看看这个公开案例。")
            db.add(message);db.commit();self.message=message.id

    def tearDown(self):
        self.engine.dispose();self.temp.cleanup()

    def result(self, refs):
        return TurnResult.model_validate({"answer":"这是一条可以借鉴的线索，具体夹法还需要核对。",
            "continuation":None,"learning":{"knowledge_updates":[],"memory_updates":[]},
            "story_refs":[],"source_refs":refs})

    def test_actual_video_page_link_is_rendered_with_its_reading_limit(self):
        with self.sessions() as db:
            # Synthetic excerpt to test rendering only; not a claim of live reading.
            row=SourceRecord(owner_id=self.owner,origin="public_web",url="https://www.bilibili.com/video/BV1pa4y1B7f8/",
                title="长尾夹 [手机] 支架",content="公开网页简介，尚未观看视频。")
            db.add(row);db.commit()
            result=commit_result(db,self.owner,self.message,self.result([row.id,row.id]),"帮我看看这个公开案例。")
            self.assertIn(row.url,result["answer"])
            self.assertEqual(result["answer"].count(row.url),1)
            self.assertIn("未观看视频",result["answer"])
            self.assertIn(r"\[手机\]",result["answer"])

    def test_other_persons_private_reference_is_rejected_without_fact_writes(self):
        with self.sessions() as db:
            row=SourceRecord(owner_id=self.friend,origin="private_annotation",url="https://example.invalid/private",title="私人说明",content="不应分享")
            db.add(row);db.commit()
            result=self.result([row.id])
            with self.assertRaises(domain.DomainError):
                grounded_turn_schema(self.sessions,self.owner,self.message).model_validate(result.model_dump())
            with self.assertRaises(domain.DomainError):
                commit_result(db,self.owner,self.message,result,"帮我看看这个公开案例。")
            self.assertEqual(db.query(Memory).filter(Memory.user_id==self.owner).count(),0)

    def test_reading_without_support_can_finish_with_an_honest_limitation(self):
        value = self.result([]).model_dump()
        schema = grounded_turn_schema(self.sessions, self.owner, self.message, {"actually_read"})
        with self.assertRaises(ValueError):
            schema.model_validate(value)
        value["source_limitations"] = "只读到了视频简介，还不能确认具体夹法。"
        self.assertEqual(schema.model_validate(value).source_refs, [])

    def test_malformed_plan_is_returned_to_the_native_repair_loop_before_commit(self):
        value = self.result([]).model_dump()
        value["continuation"] = {"goal":"试试桌面拍照", "item_ids":[],"constraints":{},
            "plan":{"schema":"interaction/1","kind":"idea","entries":[{"id":"try-1","title":"移一下灯","group":"unexpected"}]},
            "task_id":None,"expected_version":None}
        with self.assertRaisesRegex(domain.DomainError, r"entries\[0\].group"):
            grounded_turn_schema(self.sessions,self.owner,self.message).model_validate(value)

    def test_inline_internal_reference_becomes_a_readable_authorized_link(self):
        with self.sessions() as db:
            row=SourceRecord(owner_id=self.owner,origin="public_web",url="https://example.invalid/source",title="实际原文",content="模拟正文仅检验渲染")
            db.add(row);db.commit()
            value=self.result([]).model_dump();value["answer"]=f"这只是原文报告的情况 [{row.id}]。"
            result=grounded_turn_schema(self.sessions,self.owner,self.message).model_validate(value)
            self.assertEqual(result.source_refs,[row.id])
            answer=commit_result(db,self.owner,self.message,result,"帮我看看这个公开案例。")["answer"]
            self.assertIn(row.url,answer)
            self.assertNotIn(row.id,answer)

    def test_inline_private_source_still_requires_permission(self):
        with self.sessions() as db:
            row=SourceRecord(owner_id=self.friend,origin="private_annotation",url="https://example.invalid/private",title="私人",content="模拟私人资料")
            db.add(row);db.commit()
            value=self.result([]).model_dump();value["answer"]=f"资料 [{row.id}]。"
            with self.assertRaises(domain.DomainError):
                grounded_turn_schema(self.sessions,self.owner,self.message).model_validate(value)
