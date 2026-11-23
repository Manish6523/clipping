"""Serve frontend/dist as a single-page app for the mocked browser tests (tests/e2e_*.py).
Run: python tests/spa_server.py [dist_dir] [port]   (defaults: frontend/dist, 8799)"""
import http.server
import os
import sys

root = sys.argv[1] if len(sys.argv) > 1 else "frontend/dist"
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8799


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=root, **k)

    def send_head(self):
        if not os.path.exists(self.translate_path(self.path.split("?")[0])):
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
