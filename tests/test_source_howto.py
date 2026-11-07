import json
from pathlib import Path
import unittest

from wujian.source_content import parse_public_text, public_image_candidates
from wujian.source_howto import extract_howto


class SourceHowToTests(unittest.TestCase):
    def test_real_agent_retained_source_keeps_critical_hardware_and_order(self):
        data = Path(__file__).with_name("fixtures").joinpath("instructables_howto_reduced.html").read_bytes()
        url = "https://www.instructables.com/Computer-Cable-Management-on-the-Cheap/"
        text, links, _, _ = parse_public_text(data, "text/html", url)
        self.assertIn("HowTo 步骤 1: Unplug", text)
        self.assertIn("3/4 inch length screws", text)
        self.assertLess(text.index("HowTo 步骤 1:"), text.index("HowTo 步骤 2:"))
        self.assertIn("不代表已观察配图或已验证适用性", text)
        self.assertTrue(any(row["url"].endswith("#step2") for row in links))
        images = public_image_candidates(data, url)
        self.assertTrue(any("FLU/JNX2" in row["url"] and "步骤 2" in row["alt"] for row in images))

    def test_nested_standard_sections_tools_and_untrusted_html_stay_text_only(self):
        value = {"@type": ["CreativeWork", "HowTo"], "tool": [{"name": "夹子"}], "supply": "纸",
                 "step": [{"@type": "HowToSection", "name": "准备", "itemListElement": [
                     {"@type": "HowToStep", "name": "第一步", "itemListElement": [
                         {"@type": "HowToDirection", "text": "<p>轻放纸</p><script>danger()</script>"}],
                      "image": [{"contentUrl": "https://user:secret@example.org/a.jpg"}, "javascript:alert(1)", "/step.jpg"],
                      "url": "/guide#one"}]}]}
        text, links, images = extract_howto(value, "https://example.org/guide")
        self.assertIn("HowTo 所需工具: 夹子", text)
        self.assertIn("HowTo 所需材料: 纸", text)
        self.assertIn("HowTo 步骤 1.1.1:  — 轻放纸", text)
        self.assertNotIn("danger()", "\n".join(text))
        self.assertEqual([row["url"] for row in images], ["https://example.org/step.jpg"])
        self.assertEqual(links[0]["url"], "https://example.org/guide#one")

    def test_malformed_data_and_large_step_lists_do_not_expand_without_bound(self):
        value = {"@type": "HowTo", "step": [{"name": f"s{i}", "text": "x" * 50000} for i in range(1000)]}
        lines, links, images = extract_howto(value, "https://example.org/")
        self.assertEqual(sum(line.startswith("HowTo 步骤 ") for line in lines), 40)
        self.assertLess(sum(map(len, lines)), 100000)
        self.assertEqual(links, [])
        self.assertEqual(images, [])
        self.assertEqual(extract_howto({"@type": "Product", "step": "invented"}, "https://example.org/"), ([], [], []))

    def test_plain_titles_are_not_invented_as_steps(self):
        data = ('<title>some idea</title><script type="application/ld+json">'
                + json.dumps({"@type": "HowTo", "name": "Only a title"}) + '</script>').encode()
        text, _, _, _ = parse_public_text(data, "text/html", "https://example.org/")
        self.assertNotIn("HowTo 步骤 1", text)
