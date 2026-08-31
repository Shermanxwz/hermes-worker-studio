from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_native_tools", ROOT / "tools.py")
assert SPEC and SPEC.loader
tools = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tools)


class _Handler(BaseHTTPRequestHandler):
    rows: list[dict] = []
    lock = threading.Lock()

    def log_message(self, fmt: str, *args) -> None:  # pragma: no cover
        return

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode()) if n else {}

    def _record(self, body=None):
        with self.lock:
            self.rows.append(
                {
                    "method": self.command,
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "body": body,
                }
            )

    def _json(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._record()
        if self.path == "/api/catalog":
            return self._json(200, {"registry": {"providers": {"official": {"models": [{"id": "m1"}]}}}})
        if self.path == "/api/worker/status/task-1":
            return self._json(200, {"task_id": "task-1", "status": "completed"})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        body = self._body()
        self._record(body)
        if self.path == "/api/worker/start":
            return self._json(200, {"task_id": "task-1", "status": "running", "request": body})
        if self.path == "/api/worker/run":
            return self._json(200, {"task_id": "task-1", "status": "completed", "request": body})
        return self._json(404, {"error": "not found"})


class NativeToolsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _Handler.rows = []
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.env = patch.dict(
            os.environ,
            {
                "HERMES_WORKER_STUDIO_WORKER_URL": f"http://127.0.0.1:{cls.server.server_port}",
                "HERMES_WORKER_STUDIO_WORKER_TOKEN": "native-secret",
                "HERMES_WORKER_STUDIO_ALLOW_REMOTE": "0",
                "HERMES_WORKER_STUDIO_DEFAULT_SANDBOX": "danger-full-access",
            },
            clear=False,
        )
        cls.env.start()

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def test_delegate_async_defaults_to_requested_unattended_sandbox(self):
        out = json.loads(tools.worker_delegate({"task": "implement feature"}))
        self.assertTrue(out["ok"])
        request = out["result"]["request"]
        self.assertEqual(request["task"], "implement feature")
        self.assertEqual(request["role"], "worker")
        self.assertEqual(request["profile"], "standard")
        self.assertEqual(request["sandbox"], "danger-full-access")
        self.assertNotIn("waitForCompletion", request)

    def test_delegate_wait_role_cwd_and_explicit_sandbox_are_forwarded(self):
        out = json.loads(
            tools.worker_delegate(
                {
                    "task": "verify",
                    "role": "verifier",
                    "profile": "quick",
                    "cwd": "/tmp/project",
                    "sandbox": "read-only",
                    "wait_for_completion": True,
                }
            )
        )
        self.assertTrue(out["ok"])
        request = out["result"]["request"]
        self.assertEqual(request["role"], "verifier")
        self.assertEqual(request["profile"], "quick")
        self.assertEqual(request["cwd"], "/tmp/project")
        self.assertEqual(request["sandbox"], "read-only")
        self.assertTrue(request["waitForCompletion"])

    def test_status_and_catalog_are_live_worker_reads(self):
        status = json.loads(tools.worker_status({"task_id": "task-1"}))
        catalog = json.loads(tools.worker_catalog({}))
        self.assertTrue(status["ok"])
        self.assertEqual(status["result"]["status"], "completed")
        self.assertTrue(catalog["ok"])
        self.assertEqual(catalog["result"]["registry"]["providers"]["official"]["models"][0]["id"], "m1")

    def test_bearer_token_stays_server_side_and_is_forwarded(self):
        json.loads(tools.worker_catalog({}))
        with _Handler.lock:
            rows = list(_Handler.rows)
        self.assertTrue(any(row["authorization"] == "Bearer native-secret" for row in rows))

    def test_validation_and_network_errors_return_structured_failures(self):
        self.assertFalse(json.loads(tools.worker_delegate({}))["ok"])
        self.assertFalse(json.loads(tools.worker_status({}))["ok"])
        with patch.dict(os.environ, {"HERMES_WORKER_STUDIO_WORKER_URL": "https://example.com"}, clear=False):
            out = json.loads(tools.worker_catalog({}))
        self.assertFalse(out["ok"])
        self.assertIn("remote Worker URL", out["error"])

    def test_invalid_default_sandbox_fails_back_to_danger_full_access(self):
        with patch.dict(os.environ, {"HERMES_WORKER_STUDIO_DEFAULT_SANDBOX": "made-up"}, clear=False):
            out = json.loads(tools.worker_delegate({"task": "safe fallback"}))
        self.assertTrue(out["ok"])
        self.assertEqual(out["result"]["request"]["sandbox"], "danger-full-access")


if __name__ == "__main__":
    unittest.main()
