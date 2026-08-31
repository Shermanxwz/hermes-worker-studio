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


class _Recorder:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.rows: list[dict] = []

    def add(self, row: dict) -> None:
        with self.lock:
            self.rows.append(row)

    def snapshot(self) -> list[dict]:
        with self.lock:
            return list(self.rows)

    def clear(self) -> None:
        with self.lock:
            self.rows.clear()


class _HermesHandler(BaseHTTPRequestHandler):
    recorder: _Recorder
    runs_enabled = True
    run_status = "running"

    def log_message(self, fmt: str, *args) -> None:  # pragma: no cover
        return

    def _record(self, body: object | None = None) -> None:
        self.recorder.add(
            {"method": self.command, "path": self.path, "authorization": self.headers.get("Authorization"), "body": body}
        )

    def _json(self, status: int, payload: object) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> object:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode())

    def do_GET(self) -> None:
        self._record()
        if self.path == "/health":
            return self._json(200, {"ok": True, "service": "hermes"})
        if self.path == "/health/detailed":
            return self._json(200, {"status": "ok", "readiness": {"checks": {}}})
        if self.path == "/v1/capabilities":
            features = {
                "run_submission": self.runs_enabled,
                "run_events_sse": self.runs_enabled,
                "run_stop": self.runs_enabled,
                "run_approval": self.runs_enabled,
            }
            return self._json(200, {"object": "hermes.api_server.capabilities", "features": features})
        if self.path.startswith("/api/model/options"):
            return self._json(200, {"provider": "official", "model": "official-model", "providers": []})
        if self.path == "/v1/runs/run-real-http":
            return self._json(
                200,
                {
                    "object": "hermes.run",
                    "run_id": "run-real-http",
                    "session_id": "session-real-http",
                    "status": self.run_status,
                    "output": "hello world" if self.run_status == "completed" else None,
                    "usage": {"total_tokens": 3},
                },
            )
        if self.path == "/v1/runs/run-real-http/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            events = [
                ("run.started", {"run_id": "run-real-http"}),
                ("assistant.delta", {"delta": "hello "}),
                ("tool.started", {"tool_name": "worker_delegate", "arguments": "{}"}),
                ("tool.completed", {"tool_name": "worker_delegate", "result": {"task_id": "worker-123"}}),
                ("assistant.delta", {"delta": "world"}),
                ("run.completed", {"final_response": "hello world"}),
            ]
            for name, data in events:
                self.wfile.write(f"event: {name}\n".encode())
                self.wfile.write(f"data: {json.dumps(data)}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.005)
            type(self).run_status = "completed"
            return
        if self.path == "/oversized":
            raw = b"x" * (plugin_api._JSON_LIMIT + 2)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if self.path == "/bad-json":
            raw = b"not-json"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if self.path == "/teapot":
            return self._json(418, {"error": {"message": "expected failure"}})
        return self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        body = self._body()
        self._record(body)
        if self.path == "/api/sessions":
            return self._json(200, {"id": "session-real-http"})
        if self.path == "/api/sessions/session-real-http/model":
            return self._json(200, {"ok": True, "locked": body})
        if self.path == "/v1/runs":
            type(self).run_status = "running"
            return self._json(202, {"run_id": "run-real-http", "status": "started"})
        if self.path == "/v1/runs/run-real-http/stop":
            type(self).run_status = "cancelled"
            return self._json(200, {"run_id": "run-real-http", "status": "stopping"})
        if self.path == "/v1/runs/run-real-http/approval":
            return self._json(200, {"run_id": "run-real-http", "resolved": 1, **body})
        if self.path == "/v1/runs/run-real-http/steer":
            return self._json(200, {"object": "hermes.run.steer", "run_id": "run-real-http", "accepted": True})
        if self.path == "/api/sessions/session-real-http/chat/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for name, data in [
                ("assistant.delta", {"delta": "legacy"}),
                ("run.completed", {"final_response": "legacy"}),
            ]:
                self.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
                self.wfile.flush()
            return
        return self._json(404, {"error": "not found"})


class _WorkerHandler(BaseHTTPRequestHandler):
    recorder: _Recorder
    mode = "AUTO"

    def log_message(self, fmt: str, *args) -> None:  # pragma: no cover
        return

    def _record(self, body: object | None = None) -> None:
        self.recorder.add(
            {"method": self.command, "path": self.path, "authorization": self.headers.get("Authorization"), "body": body}
        )

    def _json(self, status: int, payload: object) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> object:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode()) if length else {}

    def do_GET(self) -> None:
        self._record()
        if self.path == "/api/health":
            return self._json(200, {"ok": True, "service": "worker"})
        if self.path == "/api/state":
            return self._json(200, {"mode": self.mode, "routing": {}})
        if self.path == "/api/catalog":
            return self._json(200, {"registry": {"providers": {"official": {"models": [{"id": "official-model"}]}}}})
        if self.path == "/api/worker/status/worker-123":
            return self._json(200, {"status": "completed", "taskId": "worker-123"})
        return self._json(404, {"error": "not found"})

    def do_PUT(self) -> None:
        body = self._body()
        self._record(body)
        if self.path == "/api/mode":
            type(self).mode = body.get("mode") or self.mode
            return self._json(200, {"ok": True, "mode": self.mode})
        if self.path in {"/api/provider", "/api/routing"}:
            return self._json(200, {"ok": True, "echo": body})
        return self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        body = self._body()
        self._record(body)
        if self.path == "/api/provider/probe":
            return self._json(200, {"ok": True, "protocol": "responses", "status": 200})
        if self.path == "/api/provider/connectivity":
            models = body.get("models") if isinstance(body, dict) else []
            return self._json(200, {"results": [{"model": x, "ok": True, "latencyMs": 7} for x in models or []]})
        if self.path == "/api/worker/start":
            return self._json(200, {"task_id": "worker-123", "status": "running", "request": body})
        if self.path in {"/api/codex/install", "/api/verify/coexistence"}:
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "not found"})


class BackendHttpIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.hermes_recorder = _Recorder()
        cls.worker_recorder = _Recorder()
        _HermesHandler.recorder = cls.hermes_recorder
        _WorkerHandler.recorder = cls.worker_recorder
        cls.hermes_server = ThreadingHTTPServer(("127.0.0.1", 0), _HermesHandler)
        cls.worker_server = ThreadingHTTPServer(("127.0.0.1", 0), _WorkerHandler)
        cls.hermes_thread = threading.Thread(target=cls.hermes_server.serve_forever, daemon=True)
        cls.worker_thread = threading.Thread(target=cls.worker_server.serve_forever, daemon=True)
        cls.hermes_thread.start()
        cls.worker_thread.start()
        cls.env = patch.dict(
            os.environ,
            {
                "HERMES_WORKER_STUDIO_API_URL": f"http://127.0.0.1:{cls.hermes_server.server_port}",
                "HERMES_WORKER_STUDIO_API_KEY": "hermes-secret",
                "HERMES_WORKER_STUDIO_WORKER_URL": f"http://127.0.0.1:{cls.worker_server.server_port}",
                "HERMES_WORKER_STUDIO_WORKER_TOKEN": "worker-secret",
                "HERMES_WORKER_STUDIO_ALLOW_REMOTE": "0",
            },
            clear=False,
        )
        cls.env.start()
        app = FastAPI()
        app.include_router(plugin_api.router, prefix="/api/plugins/hermes-worker-studio")
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        cls.env.stop()
        cls.hermes_server.shutdown()
        cls.worker_server.shutdown()
        cls.hermes_server.server_close()
        cls.worker_server.server_close()

    def setUp(self) -> None:
        with plugin_api._RUNS_LOCK:
            plugin_api._RUNS.clear()
        _HermesHandler.runs_enabled = True
        _HermesHandler.run_status = "running"
        _WorkerHandler.mode = "AUTO"
        self.hermes_recorder.clear()
        self.worker_recorder.clear()

    def test_health_and_read_surfaces_hit_real_loopback_http(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        health = self.client.get(base + "/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["ok"])
        self.assertFalse(health.json()["worker_degraded"])
        self.assertTrue(self.client.get(base + "/hermes/capabilities").json()["features"]["run_submission"])
        self.assertEqual(self.client.get(base + "/hermes/model-options?refresh=1").json()["model"], "official-model")
        self.assertEqual(self.client.get(base + "/worker/state").json()["mode"], "AUTO")
        self.assertEqual(self.client.get(base + "/integration").json()["hermes"]["execution_plane"], "official_runs")
        self.assertTrue(any(x["authorization"] == "Bearer hermes-secret" for x in self.hermes_recorder.snapshot()))
        self.assertTrue(any(x["authorization"] == "Bearer worker-secret" for x in self.worker_recorder.snapshot()))

    def test_native_runs_are_primary_and_event_projection_is_end_to_end(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        started = self.client.post(base + "/hermes/runs", json={"session_id": "session-real-http", "message": "do real work"})
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json()["id"], "run-real-http")
        self.assertEqual(started.json()["transport"], "official_runs")
        deadline = time.time() + 3
        snapshot = None
        while time.time() < deadline:
            snapshot = self.client.get(base + "/hermes/runs/run-real-http?after=0").json()
            if snapshot["status"] == "completed" and len(snapshot["events"]) >= 6:
                break
            time.sleep(0.02)
        assert snapshot is not None
        self.assertEqual(snapshot["status"], "completed")
        self.assertEqual(snapshot["output"], "hello world")
        self.assertEqual(
            [row["event"] for row in snapshot["events"]],
            ["run.started", "assistant.delta", "tool.started", "tool.completed", "assistant.delta", "run.completed"],
        )
        run_posts = [x for x in self.hermes_recorder.snapshot() if x["method"] == "POST" and x["path"] == "/v1/runs"]
        self.assertEqual(len(run_posts), 1)
        self.assertEqual(run_posts[0]["body"]["input"], "do real work")
        self.assertEqual(run_posts[0]["body"]["session_id"], "session-real-http")
        self.assertNotIn("message", run_posts[0]["body"])
        self.assertFalse(any(x["path"].endswith("/chat/stream") for x in self.hermes_recorder.snapshot()))

    def test_official_run_control_endpoints_are_forwarded_exactly(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        self.client.post(base + "/hermes/runs", json={"session_id": "session-real-http", "message": "go"})
        approval = self.client.post(base + "/hermes/runs/run-real-http/approval", json={"choice": "once", "resolve_all": True})
        steer = self.client.post(base + "/hermes/runs/run-real-http/steer", json={"input": "tighten ending"})
        stop = self.client.post(base + "/hermes/runs/run-real-http/stop")
        self.assertEqual(approval.status_code, 200)
        self.assertEqual(approval.json()["choice"], "once")
        self.assertTrue(approval.json()["resolve_all"])
        self.assertEqual(steer.status_code, 200)
        self.assertTrue(steer.json()["accepted"])
        self.assertEqual(stop.status_code, 200)
        rows = self.hermes_recorder.snapshot()
        self.assertTrue(any(x["path"] == "/v1/runs/run-real-http/approval" for x in rows))
        self.assertTrue(any(x["path"] == "/v1/runs/run-real-http/steer" for x in rows))
        self.assertTrue(any(x["path"] == "/v1/runs/run-real-http/stop" for x in rows))

    def test_legacy_chat_stream_is_used_only_when_capability_lacks_runs(self) -> None:
        _HermesHandler.runs_enabled = False
        base = "/api/plugins/hermes-worker-studio"
        started = self.client.post(base + "/hermes/runs", json={"session_id": "session-real-http", "message": "legacy"})
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json()["transport"], "legacy_chat_stream")
        run_id = started.json()["id"]
        deadline = time.time() + 2
        snapshot = None
        while time.time() < deadline:
            snapshot = self.client.get(base + f"/hermes/runs/{run_id}").json()
            if snapshot["status"] != "running":
                break
            time.sleep(0.02)
        assert snapshot is not None
        self.assertEqual(snapshot["status"], "completed")
        rows = self.hermes_recorder.snapshot()
        self.assertTrue(any(x["path"] == "/api/sessions/session-real-http/chat/stream" for x in rows))
        self.assertFalse(any(x["method"] == "POST" and x["path"] == "/v1/runs" for x in rows))

    def test_worker_start_is_server_side_mode_enforced(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        for mode, allowed in (("AUTO", True), ("DELEGATE", True), ("OFFICIAL", False), ("MAIN", False)):
            with self.subTest(mode=mode):
                _WorkerHandler.mode = mode
                before = len([x for x in self.worker_recorder.snapshot() if x["path"] == "/api/worker/start"])
                response = self.client.post(base + "/worker/start", json={"task": "test"})
                after = len([x for x in self.worker_recorder.snapshot() if x["path"] == "/api/worker/start"])
                self.assertEqual(response.status_code == 200, allowed)
                self.assertEqual(after - before, 1 if allowed else 0)

    def test_worker_alias_maps_to_delegate_and_official_routing_is_rejected(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        mode = self.client.put(base + "/worker/mode", json={"mode": "WORKER"})
        self.assertEqual(mode.status_code, 200)
        self.assertEqual(mode.json()["mode"], "DELEGATE")
        rejected = self.client.put(base + "/worker/routing", json={"mode": "OFFICIAL", "roles": {}})
        self.assertEqual(rejected.status_code, 409)

    def test_worker_outage_is_degraded_not_hermes_failure(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        with patch.dict(os.environ, {"HERMES_WORKER_STUDIO_WORKER_URL": "http://127.0.0.1:1"}, clear=False):
            response = self.client.get(base + "/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["hermes"]["ok"])
        self.assertTrue(payload["worker_degraded"])
        self.assertFalse(payload["worker"]["ok"])

    def test_error_translation_size_limit_and_invalid_json_fail_closed(self) -> None:
        upstream = plugin_api._hermes()
        with self.assertRaises(plugin_api.HTTPException) as teapot:
            plugin_api._request_json(upstream, "/teapot")
        self.assertEqual(teapot.exception.status_code, 418)
        self.assertIn("expected failure", str(teapot.exception.detail))
        with self.assertRaises(plugin_api.HTTPException) as bad_json:
            plugin_api._request_json(upstream, "/bad-json")
        self.assertEqual(bad_json.exception.status_code, 502)
        with self.assertRaises(plugin_api.HTTPException) as oversized:
            plugin_api._request_json(upstream, "/oversized")
        self.assertEqual(oversized.exception.status_code, 502)

    def test_remote_and_embedded_credentials_are_rejected(self) -> None:
        with patch.dict(os.environ, {"HERMES_WORKER_STUDIO_ALLOW_REMOTE": "0"}, clear=False):
            with self.assertRaises(plugin_api.HTTPException) as remote:
                plugin_api._validate_upstream(plugin_api.Upstream("https://example.com", "", "remote"))
            self.assertEqual(remote.exception.status_code, 403)
            with self.assertRaises(plugin_api.HTTPException) as creds:
                plugin_api._validate_upstream(plugin_api.Upstream("http://user:pass@127.0.0.1:8642", "", "embedded"))
            self.assertEqual(creds.exception.status_code, 500)


if __name__ == "__main__":
    unittest.main()
