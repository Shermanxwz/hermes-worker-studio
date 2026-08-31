from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_plugin_api_integration", ROOT / "dashboard" / "plugin_api.py")
assert SPEC and SPEC.loader
plugin_api = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin_api
SPEC.loader.exec_module(plugin_api)


class Recorder:
    def __init__(self):
        self.lock = threading.Lock()
        self.rows = []

    def add(self, row):
        with self.lock:
            self.rows.append(row)

    def snapshot(self):
        with self.lock:
            return list(self.rows)

    def clear(self):
        with self.lock:
            self.rows.clear()


class HermesHandler(BaseHTTPRequestHandler):
    recorder: Recorder
    runs_enabled = True
    statuses = {}
    counter = 0

    def log_message(self, fmt, *args):  # pragma: no cover
        return

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode()) if length else {}

    def _record(self, body=None):
        self.recorder.add({
            "method": self.command,
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "body": body,
        })

    def _json(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._record()
        if self.path == "/health":
            return self._json(200, {"ok": True, "service": "hermes"})
        if self.path == "/health/detailed":
            return self._json(200, {"status": "ok"})
        if self.path == "/v1/capabilities":
            return self._json(200, {"features": {
                "run_submission": self.runs_enabled,
                "run_events_sse": self.runs_enabled,
                "run_stop": self.runs_enabled,
                "run_approval_response": self.runs_enabled,
                "run_steer": self.runs_enabled,
            }})
        if self.path.startswith("/api/model/options"):
            return self._json(200, {
                "provider": "official",
                "model": "model-main",
                "providers": [{
                    "slug": "official",
                    "name": "Official",
                    "authenticated": True,
                    "models": ["model-main", "model-worker"],
                    "capabilities": {"model-main": {"reasoning": True}},
                }],
            })
        if self.path.endswith("/events") and self.path.startswith("/v1/runs/"):
            run_id = self.path.split("/")[3]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            events = [
                ("run.started", {"run_id": run_id}),
                ("assistant.delta", {"delta": "hello"}),
                ("todo.updated", {"revision": 1, "todos": [{"title": "verify"}]}),
                ("tool.started", {"tool_name": "terminal", "arguments": "pwd"}),
                ("tool.completed", {"tool_name": "terminal", "result": "/tmp"}),
                ("run.completed", {"final_response": "hello"}),
            ]
            for name, data in events:
                self.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
                self.wfile.flush()
            type(self).statuses[run_id] = "completed"
            return
        if self.path.startswith("/v1/runs/"):
            run_id = self.path.split("/")[3]
            status = self.statuses.get(run_id, "running")
            return self._json(200, {
                "run_id": run_id,
                "status": status,
                "output": "hello" if status == "completed" else None,
                "usage": {"total_tokens": 3},
                "provider": "official",
                "model": "model-main",
            })
        if self.path == "/bad-json":
            raw = b"not-json"
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        body = self._body()
        self._record(body)
        if self.path == "/api/sessions":
            return self._json(200, {"id": "session-http"})
        if self.path == "/api/sessions/session-http/model":
            return self._json(200, {"ok": True, "locked": body})
        if self.path == "/v1/runs":
            if not self.runs_enabled:
                return self._json(404, {"error": "runs disabled"})
            type(self).counter += 1
            run_id = "run-http" if body.get("session_id") else f"run-probe-{self.counter}"
            type(self).statuses[run_id] = "running"
            if not body.get("session_id"):
                # Model probe waits by polling and does not need the SSE reader.
                type(self).statuses[run_id] = "completed"
            return self._json(202, {"run_id": run_id, "status": "running"})
        if self.path.endswith("/stop"):
            run_id = self.path.split("/")[3]
            type(self).statuses[run_id] = "cancelled"
            return self._json(200, {"run_id": run_id, "status": "stopping"})
        if self.path.endswith("/approval"):
            return self._json(200, {"resolved": 1, **body})
        if self.path.endswith("/steer"):
            return self._json(200, {"accepted": True, **body})
        return self._json(404, {"error": "not found"})


class BackendIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recorder = Recorder()
        HermesHandler.recorder = cls.recorder
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), HermesHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.env = patch.dict(os.environ, {
            "HERMES_WORKER_STUDIO_API_URL": f"http://127.0.0.1:{cls.server.server_port}",
            "HERMES_WORKER_STUDIO_API_KEY": "hermes-secret",
            "HERMES_WORKER_STUDIO_ALLOW_REMOTE": "0",
        }, clear=False)
        cls.env.start()
        app = FastAPI()
        app.include_router(plugin_api.router, prefix="/api/plugins/hermes-worker-studio")
        cls.client = TestClient(app)
        cls.base = "/api/plugins/hermes-worker-studio"

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.env.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.recorder.clear()
        HermesHandler.runs_enabled = True
        HermesHandler.statuses = {}
        with plugin_api._RUNS_LOCK:
            plugin_api._RUNS.clear()

    def test_health_integration_and_model_options_are_hermes_only(self):
        health = self.client.get(self.base + "/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["ok"])
        integration = self.client.get(self.base + "/integration").json()
        self.assertEqual(integration["hermes"]["execution_plane"], "official_runs")
        self.assertEqual(integration["hermes"]["worker_plane"], "PluginContext.subagent_lifecycle")
        self.assertTrue(integration["hermes"]["runs"]["approval"])
        options = self.client.get(self.base + "/hermes/model-options?refresh=1").json()
        self.assertEqual(options["model"], "model-main")
        self.assertTrue(any(row["authorization"] == "Bearer hermes-secret" for row in self.recorder.snapshot()))
        self.assertFalse(any("8788" in str(row) or "worker/" in row["path"] for row in self.recorder.snapshot()))

    def test_native_runs_and_event_projection_end_to_end(self):
        started = self.client.post(self.base + "/hermes/runs", json={"session_id": "session-http", "message": "go"})
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(started.json()["id"], "run-http")
        deadline = time.time() + 3
        snapshot = None
        while time.time() < deadline:
            snapshot = self.client.get(self.base + "/hermes/runs/run-http").json()
            if snapshot["status"] == "completed" and len(snapshot["events"]) >= 6:
                break
            time.sleep(0.02)
        self.assertEqual(snapshot["status"], "completed")
        self.assertIn("todo.updated", [x["event"] for x in snapshot["events"]])
        posts = [x for x in self.recorder.snapshot() if x["method"] == "POST" and x["path"] == "/v1/runs"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["body"]["input"], "go")
        self.assertEqual(posts[0]["body"]["session_id"], "session-http")

    def test_run_controls_forward_exact_public_endpoints(self):
        self.client.post(self.base + "/hermes/runs", json={"session_id": "session-http", "message": "go"})
        approval = self.client.post(self.base + "/hermes/runs/run-http/approval", json={"choice": "once", "resolve_all": True})
        steer = self.client.post(self.base + "/hermes/runs/run-http/steer", json={"input": "focus tests"})
        stop = self.client.post(self.base + "/hermes/runs/run-http/stop", json={})
        self.assertEqual(approval.status_code, 200)
        self.assertEqual(steer.status_code, 200)
        self.assertEqual(stop.status_code, 200)
        paths = [x["path"] for x in self.recorder.snapshot()]
        self.assertIn("/v1/runs/run-http/approval", paths)
        self.assertIn("/v1/runs/run-http/steer", paths)
        self.assertIn("/v1/runs/run-http/stop", paths)

    def test_model_probe_is_a_real_native_run(self):
        response = self.client.post(self.base + "/hermes/model-probe", json={"provider": "official", "model": "model-worker"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["ok"])
        posts = [x for x in self.recorder.snapshot() if x["method"] == "POST" and x["path"] == "/v1/runs"]
        self.assertEqual(posts[-1]["body"]["provider"], "official")
        self.assertEqual(posts[-1]["body"]["model"], "model-worker")

    def test_session_create_and_model_lock_use_official_routes(self):
        created = self.client.post(self.base + "/hermes/sessions", json={"title": "x"})
        locked = self.client.post(self.base + "/hermes/sessions/session-http/model", json={"provider": "official", "model": "model-main"})
        self.assertEqual(created.json()["id"], "session-http")
        self.assertTrue(locked.json()["ok"])

    def test_missing_runs_capability_fails_closed_without_chat_fallback(self):
        HermesHandler.runs_enabled = False
        response = self.client.post(self.base + "/hermes/runs", json={"session_id": "session-http", "message": "must fail"})
        self.assertEqual(response.status_code, 409)
        paths = [x["path"] for x in self.recorder.snapshot()]
        self.assertFalse(any("chat/stream" in path for path in paths))

    def test_invalid_json_and_remote_boundary_errors_are_structured(self):
        with self.assertRaises(plugin_api.HTTPException):
            plugin_api._hermes_proxy("/bad-json")
        with patch.dict(os.environ, {"HERMES_WORKER_STUDIO_API_URL": "https://example.com", "HERMES_WORKER_STUDIO_ALLOW_REMOTE": "0"}, clear=False):
            response = self.client.get(self.base + "/hermes/readiness")
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
