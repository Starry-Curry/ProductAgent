"""Independent HTTP checks for temporary community-session ownership.

Real FastAPI authentication/session middleware and SQLite are exercised; only
the external collector manager is a bounded fake. No login browser, private
database, model request or network access is used.
"""
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from wujian.config import Settings
from wujian.domain import DomainError
from wujian.server import create_app


class FakeCollectorManager:
    def __init__(self):
        self.sessions = {}
        self.calls = []
        self.fail_close = set()

    async def status(self, user_id):
        self.calls.append(("status", user_id))
        return {"stage": "connected" if user_id in self.sessions else "disconnected",
                "connected": user_id in self.sessions, "remaining_seconds": 120,
                "qr_data_url": None, "failure_phase": None, "failure_reason": None}

    async def start(self, user_id):
        self.calls.append(("start", user_id))
        self.sessions[user_id] = object()
        return await self.status(user_id)

    async def close(self, user_id):
        self.calls.append(("close", user_id))
        if user_id in self.fail_close:
            raise DomainError("模拟：采集进程仍待回收", 503)
        self.sessions.pop(user_id, None)
        return await self.status(user_id)

    async def close_all(self):
        self.sessions.clear()


class CommunitySessionAPIReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temporary.name),
                                      api_key="", rea_enabled=False))
        self.manager = FakeCollectorManager()
        self.app.state.runner.communities = self.manager
        self.owner = TestClient(self.app).__enter__()
        self.friend = TestClient(self.app)
        self.anonymous = TestClient(self.app)
        self.owner_id = self.register(self.owner, "collector_owner")
        self.friend_id = self.register(self.friend, "collector_friend")

    def tearDown(self):
        self.friend.close()
        self.anonymous.close()
        self.owner.__exit__(None, None, None)
        self.temporary.cleanup()

    def register(self, client, username):
        response = client.post("/api/auth/register", json={"username": username,
            "password": "isolated-review-password", "display_name": "模拟会话审查用户"})
        response.raise_for_status()
        return response.json()["id"]

    def test_anonymous_cannot_read_start_or_close_collector(self):
        for method in ("GET", "POST", "DELETE"):
            with self.subTest(method=method):
                response = self.anonymous.request(method, "/api/community/bilibili/session")
                self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(self.manager.calls, [])

    def test_cross_origin_mutations_rejected_before_touching_manager(self):
        for method in ("POST", "DELETE"):
            with self.subTest(method=method):
                response = self.owner.request(method, "/api/community/bilibili/session",
                                              headers={"Origin": "https://unrelated.example"})
                self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.manager.calls, [])

    def test_current_account_owns_session_even_with_another_user_query(self):
        started = self.owner.post("/api/community/bilibili/session",
                                  headers={"Origin": "http://testserver"})
        self.assertEqual(started.status_code, 200, started.text)
        self.assertTrue(started.json()["connected"])
        self.assertEqual(started.headers["cache-control"], "no-store")
        friend_status = self.friend.get("/api/community/bilibili/session",
                                        params={"user_id": self.owner_id})
        self.assertFalse(friend_status.json()["connected"])
        self.friend.delete("/api/community/bilibili/session",
                           params={"user_id": self.owner_id}).raise_for_status()
        self.assertIn(self.owner_id, self.manager.sessions)
        self.assertEqual(set(self.manager.sessions), {self.owner_id})

    def test_logout_closes_only_current_account_and_clears_authentication(self):
        for client in (self.owner, self.friend):
            client.post("/api/community/bilibili/session").raise_for_status()
        self.owner.post("/api/auth/logout").raise_for_status()
        self.assertEqual(self.owner.get("/api/me").status_code, 401)
        self.assertNotIn(self.owner_id, self.manager.sessions)
        self.assertIn(self.friend_id, self.manager.sessions)
        self.assertTrue(self.friend.get("/api/community/bilibili/session").json()["connected"])

    def test_failed_collector_cleanup_reports_failure_but_still_logs_out(self):
        self.owner.post("/api/community/bilibili/session").raise_for_status()
        retained_handle = self.manager.sessions[self.owner_id]
        self.manager.fail_close.add(self.owner_id)
        response = self.owner.post("/api/auth/logout")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertIn("仍待回收", response.json()["detail"])
        self.assertEqual(self.owner.get("/api/me").status_code, 401)
        self.assertIs(self.manager.sessions[self.owner_id], retained_handle)
        self.assertEqual(self.owner.get("/api/community/bilibili/session").status_code, 401)


if __name__ == "__main__":
    unittest.main()
