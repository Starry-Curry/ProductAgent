"""Evidence-reader regressions. Fixtures simulate response shapes, not real viewing."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from wujian import domain
from wujian.config import Settings
from wujian.database import make_database
from wujian.knowledge import fetch_source, parse_document


class PublicSourceTests(unittest.TestCase):
    def test_utf8_without_charset_and_legacy_declared_encoding_preserve_chinese(self):
        text="<title>杯子投影与生活创意</title><main>原作者：用透明片画图案。</main>"
        content,_,_,_,title=parse_document(text.encode("utf-8"),"text/html","https://example.invalid/page")
        self.assertEqual(title,"杯子投影与生活创意")
        self.assertIn("用透明片画图案",content)
        legacy='<meta charset="gb2312">'+text
        content,_,_,_,title=parse_document(legacy.encode("gb2312"),"text/html","https://example.invalid/legacy")
        self.assertEqual(title,"杯子投影与生活创意")
        self.assertIn("原作者",content)

    def test_bom_encoded_json_still_uses_the_original_unicode_text(self):
        body=json.dumps({"body":[{"from":0,"to":1,"content":"原始字幕文字"}]},ensure_ascii=False)
        content,*_=parse_document(body.encode("utf-16"),"application/json","https://example.invalid/subtitle.json")
        self.assertIn("原始字幕文字",content)

    def test_video_description_and_parts_survive_without_claiming_video_observation(self):
        state = {"videoData": {"title": "夹子的新玩法", "desc": "四种手机支架", "bvid": "BVexample",
                               "pages": [{"page": 2, "part": "折叠方法"}]}}
        html = ('<title>演示视频</title><script>window.__INITIAL_STATE__=' + json.dumps(state) +
                ';(function(){throw "never execute"})();</script><main>公开页面</main>').encode()
        content, pages, links, _, _ = parse_document(html, "text/html", "https://www.bilibili.com/video/BVexample/")
        self.assertIn("四种手机支架", content)
        self.assertIn("P2: 折叠方法", content)
        self.assertIn("没有观看视频", content)
        self.assertNotIn("never execute", content)
        self.assertEqual(pages, [])
        self.assertEqual(links[0]["url"], "https://www.bilibili.com/video/BVexample/?p=2")

    def test_video_seo_recommendations_are_not_current_video_or_model_evidence(self):
        state = {"videoData": {"title": "米家台灯2", "desc": "原作者的简介", "bvid": "BVexample"}}
        html = ('<meta name="description" content="原作者的简介，相关视频：米家台灯1S能调到6500K">'
                '<meta property="og:description" content="另一个商品的参数与方法">'
                '<script>window.__INITIAL_STATE__=' + json.dumps(state) + ';</script>'
                '<aside>推荐别的视频与商品</aside>')
        content, *_ = parse_document(html.encode(), "text/html", "https://www.bilibili.com/video/BVexample/")
        self.assertIn("原作者的简介", content)
        self.assertIn("米家台灯2", content)
        self.assertNotIn("6500K", content)
        self.assertNotIn("另一个商品", content)
        self.assertNotIn("推荐别的视频", content)

    def test_video_recommendation_chrome_is_not_mixed_with_canonical_description(self):
        html = ('<meta name="description" content="用夹子架手机的原创简介">'
                '<main>推荐另一个视频：拆电源</main><div>账号登录与会员广告</div>').encode()
        content, *_ = parse_document(html,"text/html","https://www.bilibili.com/video/BVexample/")
        self.assertIn("原创简介",content)
        self.assertNotIn("拆电源",content)
        self.assertNotIn("会员广告",content)

    def test_jsonld_description_read_but_javascript_not_evaluated(self):
        html = b'''<script type="application/ld+json">{"@type":"VideoObject","description":"public description"}</script>
                   <script>window.__INITIAL_STATE__={"note":undefined};</script>'''
        content, *_ = parse_document(html, "text/html", "https://www.xiaohongshu.com/explore/demo")
        self.assertIn("public description", content)
        self.assertNotIn("undefined", content)
        self.assertIn("没有登录", content)

    def test_standard_jsonld_faq_preserves_answer_without_arbitrary_state_fields(self):
        faq = {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "怎样查看版本？",
                "acceptedAnswer": {"@type": "Answer", "text": "<p>打开设置，查看系统信息。</p>"},
                "session_token": "not-public-content"}]}
        html = '<script type="application/ld+json">' + json.dumps(faq).replace("<", "\\u003c") + '</script>'
        content, *_ = parse_document(html.encode(), "text/html", "https://example.com/help")
        self.assertIn("打开设置，查看系统信息。", content)
        self.assertNotIn("not-public-content", content)

    def test_login_redirect_is_not_a_successful_note_read(self):
        with self.assertRaisesRegex(domain.DomainError, "没有取得原文"):
            parse_document(b"<title>Log in - rednote</title><p>scan QR code</p>", "text/html", "https://www.rednote.com/login")

    def test_normal_title_does_not_hide_note_login_gate(self):
        html = '<title>小红书 - 你的生活兴趣社区</title><body>登录后查看完整笔记</body>'.encode()
        with self.assertRaisesRegex(domain.DomainError, "没有取得笔记原文"):
            parse_document(html, "text/html", "https://www.xiaohongshu.com/explore/note123")

    def test_empty_video_shell_does_not_become_synthetic_evidence(self):
        content, *_ = parse_document(b"<title>bilibili</title><body></body>", "text/html", "https://www.bilibili.com/video/BVempty/")
        self.assertEqual(content, "")

    def test_public_support_faq_json_is_read_without_navigation_or_session_fields(self):
        page = {"main_body": {"section": [{"body": {"section": [
            {"name": "怎样查看系统？", "content": '<p>先打开设置，再查看版本。</p><img src="//example.com/guide.png"><script>evil()</script>'}
        ]}}]}, "session_token": "must-not-extract", "left_tree": {"name": "unrelated navigation", "content": "must-not-extract"}}
        encoded = json.dumps(page).replace("<", "\\u003c")
        html = '<title>小米帮助中心</title><nav>商城促销</nav><script>var $GLOBAL_PAGE = {PageData:' + encoded + ', init: function(){evil()}};</script>'
        content, _, links, _, _ = parse_document(html.encode(), "text/html", "https://www.mi.com/service/mitv/vip")
        self.assertIn("先打开设置，再查看版本。", content)
        self.assertIn("未执行脚本", content)
        self.assertNotIn("must-not-extract", content)
        self.assertNotIn("商城促销", content)
        self.assertNotIn("evil()", content)
        self.assertEqual(links[0]["url"], "https://example.com/guide.png")

    def test_support_javascript_objects_are_not_evaluated_as_json(self):
        html = '<script>var $GLOBAL_PAGE = {PageData:{main_body:{content:evil()}}};</script>'
        content, *_ = parse_document(html.encode(), "text/html", "https://www.mi.com/service/mitv/vip")
        self.assertEqual(content, "")

    def test_actual_article_about_login_is_not_a_login_gate(self):
        html = '<title>验证码怎么输入与登录问题的解决方法</title><article>扫码登录后如何处理失败</article>'.encode()
        content, *_ = parse_document(html, "text/html", "https://example.com/help/login")
        self.assertIn("如何处理失败", content)

    def test_plain_markdown_protocol_keeps_angle_brackets_and_newlines(self):
        protocol = "# protocol\nrequest: <target>\nresponse: <status>\n".encode()
        content, _, _, media, _ = parse_document(protocol, "text/plain; charset=utf-8", "https://example.com/protocol.md")
        self.assertEqual(content, protocol.decode())
        self.assertEqual(media, "text/plain")

    def test_html_protocol_and_highlighted_commands_keep_original_lines(self):
        html = b'<article>Read only example:<pre><code>adb shell pm <span>list</span> packages\ngetprop <span>ro.product.model</span></code></pre></article>'
        content, *_ = parse_document(html, "text/html", "https://example.com/protocol")
        self.assertIn("adb shell pm list packages\ngetprop ro.product.model", content)
        self.assertNotIn("pm \nlist", content)

    def test_public_subtitle_json_keeps_timestamps(self):
        data = json.dumps({"body": [{"from": 2.4, "to": 4.6, "content": "打开夹子的两根手柄"}]}).encode()
        content, _, _, media, _ = parse_document(data, "application/json", "https://example.com/subtitle.json")
        self.assertIn("[2.4–4.6秒]", content)
        self.assertIn("未观看视频画面", content)
        self.assertEqual(media, "application/json")

    def test_markdown_navigation_retains_relative_protocol_links(self):
        content, _, links, _, _ = parse_document(b"[Compatibility](docs/COMPATIBILITY.md)\ncmd <target>", "text/plain", "https://example.com/repo/README.md")
        self.assertIn("cmd <target>", content)
        self.assertEqual(links, [{"title": "Compatibility", "url": "https://example.com/repo/docs/COMPATIBILITY.md"}])

    def test_binary_package_is_not_misread_as_a_protocol_document(self):
        with self.assertRaisesRegex(domain.DomainError, "格式尚不能读取"):
            parse_document(b"PK\x03\x04some binary bytes", "application/octet-stream", "https://example.com/app.apk")

    def test_cached_source_keeps_links_and_read_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Settings(data_dir=Path(directory))
            settings.prepare()
            engine, sessions = make_database(settings)
            try:
                with sessions() as db:
                    domain.seed_demo(db)
                response = ("https://example.com/index", "text/html", b'<title>Index</title><a href="guide.md">Guide</a>')
                with patch("wujian.knowledge.download_public", new=AsyncMock(return_value=response)) as download:
                    first = asyncio.run(fetch_source(settings, sessions, "person_demo_owner", response[0]))
                    cached = asyncio.run(fetch_source(settings, sessions, "person_demo_owner", response[0]))
                self.assertEqual(download.await_count, 1)
                self.assertEqual(first["links"], cached["links"])
                self.assertEqual(cached["content_level"], "document_text")
                self.assertEqual(first["source_id"], cached["source_id"])
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
