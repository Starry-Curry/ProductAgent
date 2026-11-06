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

    def test_editorial_game_title_is_not_presented_as_the_original_videos_title(self):
        with self.sessions() as db:
            original=SourceRecord(owner_id=self.owner,origin="public_web",
                url="https://www.bilibili.com/video/BV1pa4y1B7f8/",
                title="原页 [音箱] 评测",content="合成元数据，仅检验引用呈现")
            db.add(original);db.flush()
            row=SourceRecord(owner_id=self.owner,origin="curated_reference",
                url="https://www.bilibili.com/video/BV1pa4y1B7f8/",
                title="灵感参考｜生活声音猜谜",content=f"[Codex编者整理] 猜谜是编者待试设计。\n原始资料 [{original.id}] 原页音箱评测")
            db.add(row);db.commit()
            result=commit_result(db,self.owner,self.message,self.result([row.id]),"帮我看看这个公开案例。")
            self.assertIn("整理的灵感《生活声音猜谜》（待试",result["answer"])
            self.assertIn("原页不等于本玩法教程",result["answer"])
            self.assertIn(r"[原页 \[音箱\] 评测]",result["answer"])
            self.assertNotIn(f"[{row.title}]",result["answer"])

    def test_editorial_provenance_cannot_disclose_another_owners_source_title(self):
        with self.sessions() as db:
            other=SourceRecord(owner_id=self.friend,origin="public_web",url="https://example.invalid/other",
                title="不能披露的他人私人检索标题",content="合成记录")
            db.add(other);db.flush()
            row=SourceRecord(owner_id=self.owner,origin="curated_reference",url="https://example.invalid/public",
                title="测试提案",content=f"原始资料 [{other.id}] 伪造的跨用户引用")
            db.add(row);db.commit()
            answer=commit_result(db,self.owner,self.message,self.result([row.id]),"帮我看看这个公开案例。")["answer"]
            self.assertNotIn(other.title,answer)
            self.assertNotIn(other.url,answer)
            self.assertIn("[原始资料]",answer)

    def test_retired_editorial_reference_can_be_revisited_without_looking_active(self):
        with self.sessions() as db:
            row=SourceRecord(owner_id=self.owner,origin="curated_reference_retired",url="https://example.invalid/public",
                title="灵感参考｜已撤回的合成测试",content="旧正文保留供回查")
            db.add(row);db.commit()
            answer=commit_result(db,self.owner,self.message,self.result([row.id]),"帮我看看这个公开案例。")["answer"]
            self.assertIn("已撤回的整理灵感",answer)
            self.assertIn("仅供历史回查",answer)
            self.assertNotIn("（待试",answer)

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
