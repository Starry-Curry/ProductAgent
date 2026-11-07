"""Literal checklist contracts with natural fictional user utterances; no DB/API."""
import copy
import unittest

from pydantic import ValidationError

from wujian import domain
from wujian.preparation_plan import PreparationReport, validate_preparation


def entry(identity, title, group="confirm", *, item_id=None, state="pending", note=""):
    return {"id": identity, "title": title, "group": group, "item_id": item_id, "state": state, "note": note}


def plan(*entries, reports=None, kind="checklist"):
    return {"schema": "interaction/1", "kind": kind, "entries": list(entries), "preparation_reports": reports or []}


def report(identity, quote):
    return {"entry_id": identity, "source_quote": quote}


class PreparationPlanTests(unittest.TestCase):
    def test_unknown_inventory_can_stay_confirm_without_inventing_missing(self):
        proposed = plan(entry("tissue", "纸巾"), entry("water", "饮用水"))
        self.assertEqual(validate_preparation(proposed, {}, "周六野餐，先看看家里有什么，别买太多。"), set())

    def test_real_inventory_reference_can_start_owned_without_user_ownership_quote(self):
        proposed = plan(entry("mat", "野餐垫", "owned", item_id="actual-authorized-inventory-id"))
        self.assertEqual(validate_preparation(proposed, {}, "帮我列份准备清单。"), set())

    def test_unrecorded_is_not_owned_or_missing_without_current_evidence(self):
        for group in ("owned", "buy"):
            with self.subTest(group=group), self.assertRaisesRegex(domain.DomainError, "未登记不代表没有"):
                validate_preparation(plan(entry("tissue", "纸巾", group)), {}, "周六野餐，别买太多。")

    def test_literal_reports_support_existing_water_and_known_missing_ice(self):
        question = "水家里还有一箱，别买水。冰袋真没有了，我买两块。"
        proposed = plan(entry("water", "饮用水", "owned"), entry("ice", "冰袋", "buy"), reports=[
            report("water", "水家里还有一箱，别买水"), report("ice", "冰袋真没有了，我买两块")])
        self.assertEqual(validate_preparation(proposed, {}, question), {"water", "ice"})

    def test_old_unchanged_classification_needs_no_repeated_quote(self):
        previous = plan(entry("water", "饮用水", "buy", state="ready"), entry("mat", "野餐垫", "owned"))
        self.assertEqual(validate_preparation(copy.deepcopy(previous), previous, "纸巾不确定还有没有。"), set())

    def test_reported_reclassification_must_restart_pending_and_keep_identity(self):
        previous = plan(entry("water", "饮用水", "buy", state="ready"))
        proposed = plan(entry("water", "饮用水", "owned"), reports=[report("water", "水家里还有一箱，别买水")])
        self.assertEqual(validate_preparation(proposed, previous, "水家里还有一箱，别买水。"), {"water"})
        proposed["entries"][0]["state"] = "ready"
        with self.assertRaisesRegex(domain.DomainError, "state必须pending"):
            validate_preparation(proposed, previous, "水家里还有一箱，别买水。")

    def test_title_or_reference_change_also_requires_current_report(self):
        previous = plan(entry("boxes", "餐盒", "owned", item_id="two-boxes"))
        for change in ({"title": "两个大号餐盒"}, {"item_id": "other-boxes"}):
            with self.subTest(change=change):
                updated = copy.deepcopy(previous)
                updated["entries"][0].update(change)
                with self.assertRaisesRegex(domain.DomainError, "需preparation_reports"):
                    validate_preparation(updated, previous, "两个大号餐盒，大家一起装就够了。")
                updated["preparation_reports"] = [report("boxes", "两个大号餐盒")]
                self.assertEqual(validate_preparation(updated, previous, "两个大号餐盒，大家一起装就够了。"), {"boxes"})

    def test_old_ids_must_not_disappear_or_be_implicitly_appended(self):
        previous = plan(entry("old-water", "饮用水", "buy", state="ready"))
        proposed = plan(entry("new-water", "饮用水", "owned"), reports=[report("new-water", "水家里还有一箱")])
        before = copy.deepcopy(proposed)
        with self.assertRaisesRegex(domain.DomainError, "old-water: 饮用水"):
            validate_preparation(proposed, previous, "水家里还有一箱。")
        self.assertEqual(proposed, before)

    def test_normalized_duplicate_titles_rejected_without_semantic_aliases(self):
        for left, right in (("饮用水", " 饮 用 水！"), ("Ice Pack", "ice pack！")):
            with self.subTest(left=left), self.assertRaisesRegex(domain.DomainError, "名称重复"):
                validate_preparation(plan(entry("a", left), entry("b", right)), {}, "帮我看看。")
        distinct = plan(entry("water", "饮用水"), entry("cup", "水杯"))
        self.assertEqual(validate_preparation(distinct, {}, "帮我看看。"), set())

    def test_internal_punctuation_keeps_quantities_and_specs_distinct(self):
        distinct = plan(entry("small", "1.5L饮用水"), entry("large", "15L饮用水"),
                        entry("jack", "3.5mm转接头"), entry("tube", "35mm转接头"))
        self.assertEqual(validate_preparation(distinct, {}, "先核对一下。"), set())

    def test_reports_reject_old_quote_unknown_id_duplicate_and_excess_count(self):
        cases = [([report("water", "我家里有水")], "本轮用户原话"),
                 ([report("unknown", "去野餐")], "不存在的条目"),
                 ([report("water", "去野餐"), report("water", "去野餐")], "只能报告一次"),
                 ([report("water", "去野餐")] * 61, "最多60条")]
        for reports, reason in cases:
            with self.subTest(reason=reason), self.assertRaisesRegex(domain.DomainError, reason):
                validate_preparation(plan(entry("water", "饮用水"), reports=reports), {}, "去野餐。")

    def test_note_support_returned_without_mutating_plan_and_layout_whitespace_allowed(self):
        previous = plan(entry("ice", "冰袋", note="再看看家里有没有"))
        proposed = copy.deepcopy(previous)
        proposed["entries"][0]["note"] = "我准备两块"
        proposed["preparation_reports"] = [report("ice", "冰袋我来准备两块")]
        before = copy.deepcopy(proposed)
        self.assertEqual(validate_preparation(proposed, previous, "冰袋 我来准备 两块。"), {"ice"})
        self.assertEqual(proposed, before)

    def test_non_checklist_remains_out_of_scope_and_report_model_is_strict(self):
        self.assertEqual(validate_preparation({"kind": "guidance", "preparation_reports": "invalid"}, {}, ""), set())
        with self.assertRaises(ValidationError):
            PreparationReport(entry_id="water", source_quote="我有水", fabricated=True)


if __name__ == "__main__":
    unittest.main()
