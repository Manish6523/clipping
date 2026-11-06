import unittest
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from aiohttp import web
from src.web.routes_clips import make_json_error, serve_file_range
from pathlib import Path


class TestWebRoutes(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application()
        app.router.add_get("/test-err", lambda r: make_json_error("TEST_CODE", "Test message", 400))
        return app

    @unittest_run_loop
    async def test_error_format(self):
        resp = await self.client.request("GET", "/test-err")
        self.assertEqual(resp.status, 400)
        data = await resp.json()
        self.assertIn("error", data)
        self.assertEqual(data["error"]["code"], "TEST_CODE")
        self.assertEqual(data["error"]["message"], "Test message")


if __name__ == "__main__":
    unittest.main()

