"""Real authenticated HTTP journeys for wishlist scope, editing and conflicts.

People/ownership are synthetic; domestic product names are concrete. No model,
network purchase, payment or device is used by these application operations.
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from wujian.config import Settings
from wujian.server import create_app


class WishVisibilityHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = create_app(Settings(data_dir=Path(self.temp.name), demo_mode=False,
            rea_enabled=False, api_key=""))
        self.owner = TestClient(self.app).__enter__()
        self.addCleanup(self.owner.__exit__, None, None, None)
        self.friend, self.third, self.anonymous = (TestClient(self.app) for _ in range(3))
        for client in (self.friend, self.third, self.anonymous):
            client.portal = self.owner.portal
            self.addCleanup(client.close)
        self.users = {}
        for key, client, name in (("owner", self.owner, "小晴"),
                ("friend", self.friend, "小雨"), ("third", self.third, "阿宁")):
            self.users[key] = self.ok(client.post("/api/auth/register", json={
                "username": "wish_" + key, "display_name": name, "password": "offline-test-password"}))
        self.ok(self.owner.post("/api/friends", json={"username": self.users["friend"]["username"]}))
        self.ok(self.friend.post(f"/api/friends/{self.users['owner']['id']}/accept"))

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def wish(self, **changes):
        return self.ok(self.owner.post("/api/wishes", json={
            "title": "想收到米家台灯1S（MJTD01SYL）", "note": "最近睡前想多看会儿书，想让书桌舒服一点。",
            "url": "https://www.mi.com/", "visible_to_friends": False, **changes}))

    def change(self, wish, **changes):
        return {key: wish[key] for key in ("title", "note", "url", "visible_to_friends")} | {
            "expected_version": wish["version"], **changes}

    def friend_space(self):
        return self.ok(self.friend.get(f"/api/friends/{self.users['owner']['id']}/space"))

    def test_friend_sees_only_explicitly_visible_wishes_and_not_owned_items(self):
        private = self.wish()
        public = self.wish(title="想要一个宜家特提亚文件盒", visible_to_friends=True)
        self.assertEqual([row["id"] for row in self.friend_space()["wishes"]], [public["id"]])
        self.assertEqual({row["id"] for row in self.ok(self.owner.get("/api/wishes"))}, {private["id"], public["id"]})
        self.assertEqual(self.ok(self.friend.get("/api/wishes")), [])
        self.assertEqual(self.ok(self.owner.get("/api/items")), [])
        self.assertEqual(self.friend_space()["items"], [])

    def test_owner_updates_same_record_and_withdraws_visibility_without_deleting(self):
        wish = self.wish(visible_to_friends=True)
        changed = self.ok(self.owner.put(f"/api/wishes/{wish['id']}", json=self.change(wish,
            title="还是想要米家台灯1S", note="希望是白色，主要用来读书。", url="https://www.mi.com/service/", visible_to_friends=False)))
        self.assertEqual(changed["id"], wish["id"])
        self.assertEqual(changed["version"], wish["version"] + 1)
        self.assertEqual(changed["note"], "希望是白色，主要用来读书。")
        self.assertEqual(changed["url"], "https://www.mi.com/service/")
        self.assertFalse(changed["visible_to_friends"])
        self.assertEqual(self.friend_space()["wishes"], [])
        self.assertEqual(self.ok(self.owner.get("/api/wishes")), [changed])
        reopened = self.ok(self.owner.put(f"/api/wishes/{wish['id']}", json=self.change(changed, visible_to_friends=True)))
        self.assertEqual(self.friend_space()["wishes"], [reopened])

    def test_stale_writer_cannot_undo_visibility_withdrawal(self):
        wish = self.wish(visible_to_friends=True)
        newest = self.ok(self.owner.put(f"/api/wishes/{wish['id']}", json=self.change(wish, visible_to_friends=False)))
        stale = self.owner.put(f"/api/wishes/{wish['id']}", json=self.change(wish, title="旧窗口里的修改", visible_to_friends=True))
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(self.friend_space()["wishes"], [])
        self.assertEqual(self.ok(self.owner.get("/api/wishes")), [newest])

    def test_nonowners_and_pending_friend_cannot_read_or_modify_other_wishes(self):
        wish = self.wish(visible_to_friends=True)
        for client in (self.friend, self.third):
            response = client.put(f"/api/wishes/{wish['id']}", json=self.change(wish, title="替别人改名"))
            self.assertEqual(response.status_code, 404, response.text)
        third_url = f"/api/friends/{self.users['owner']['id']}/space"
        self.assertEqual(self.third.get(third_url).status_code, 404)
        self.ok(self.owner.post("/api/friends", json={"username": self.users["third"]["username"]}))
        self.assertEqual(self.third.get(third_url).status_code, 404)
        self.assertEqual(self.anonymous.put(f"/api/wishes/{wish['id']}", json=self.change(wish)).status_code, 401)
        self.assertEqual(self.ok(self.owner.get("/api/wishes")), [wish])

    def test_change_contract_and_https_validation_do_not_partially_write(self):
        wish = self.wish()
        for url in ("http://example.com/product", "https://name:password@example.com/product", "javascript:alert(1)", "https://[", "https://example.com:90000/product"):
            response = self.owner.put(f"/api/wishes/{wish['id']}", json=self.change(wish, url=url))
            self.assertEqual(response.status_code, 400, response.text)
        invalid = self.change(wish)
        del invalid["expected_version"]
        self.assertEqual(self.owner.put(f"/api/wishes/{wish['id']}", json=invalid).status_code, 422)
        self.assertEqual(self.owner.put(f"/api/wishes/{wish['id']}", json=self.change(wish, user_id=self.users['third']['id'])).status_code, 422)
        self.assertEqual(self.owner.put(f"/api/wishes/{wish['id']}", json=self.change(wish, title="   ")).status_code, 400)
        self.assertEqual(self.ok(self.owner.get("/api/wishes")), [wish])


if __name__ == "__main__":
    unittest.main()
