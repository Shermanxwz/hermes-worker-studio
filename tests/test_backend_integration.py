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


class _HermesHandler(BaseHTTPRequestHandler):
    recorder: _Recorder

    def log_message(self, fmt: str, *args) -> None:  # pragma: no cover - silence test server
        return

    def _record(self, body: object | None = None) -> None:
        self.recorder.add(
            {
                "method": self.command,
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "body": body,
            }
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
        if self.path == "/v1/capabilities":
            return self._json(200, {"sessions": True, "streaming": True})
        if self.path.startswith("/api/model/options"):
            return self._json(200, {"provider": "official", "model": "official-model", "providers": []})
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
        if self.path == "/api/sessions/session-real-http/chat/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            events = [
                ("run.started", {"run_id": "upstream-run"}),
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
                time.sleep(0.01)
            return
        return self._json(404, {"error": "not found"})


class _WorkerHandler(BaseHTTPRequestHandler):
    recorder: _Recorder

    def log_message(self, fmt: str, *args) -> None:  # pragma: no cover
        return

    def _record(self, body: object | None = None) -> None:
        self.recorder.add(
            {
                "method": self.command,
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "body": body,
            }
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
            return self._json(200, {"mode": "AUTO", "routing": {}})
        if self.path == "/api/catalog":
            return self._json(
                200,
                {
                    "registry": {
                        "providers": {
                            "official": {"models": [{"id": "official-model"}]},
                            "third_party": {
                                "models": [
                                    {
                                        "id": "new-model",
                                        "reasoning": {"options": ["balanced", "deep"]},
                                    }
                                ]
                            },
                        }
                    }
                },
            )
        if self.path == "/api/worker/status/worker-123":
            return self._json(200, {"status": "completed", "taskId": "worker-123"})
        return self._json(404, {"error": "not found"})

    def do_PUT(self) -> None:
        body = self._body()
        self._record(body)
        if self.path in {"/api/provider", "/api/mode", "/api/routing"}:
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
            return self._json(200, {"task_id": "worker-123", "status": "running"})
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

    def test_health_and_read_surfaces_hit_real_loopback_http(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        health = self.client.get(base + "/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["ok"])
        self.assertTrue(health.json()["hermes"]["ok"])
        self.assertTrue(health.json()["worker"]["ok"])
        self.assertEqual(self.client.get(base + "/hermes/capabilities").json()["streaming"], True)
        self.assertEqual(self.client.get(base + "/hermes/model-options?refresh=1").json()["model"], "official-model")
        self.assertEqual(self.client.get(base + "/worker/state").json()["mode"], "AUTO")
        self.assertIn("registry", self.client.get(base + "/worker/catalog").json())

        hermes_rows = self.hermes_recorder.snapshot()
        worker_rows = self.worker_recorder.snapshot()
        self.assertTrue(any(x["authorization"] == "Bearer hermes-secret" for x in hermes_rows))
        self.assertTrue(any(x["authorization"] == "Bearer worker-secret" for x in worker_rows))

    def test_session_create_lock_and_run_bridge_are_end_to_end(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        created = self.client.post(base + "/hermes/sessions", json={"title": "integration"})
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["id"], "session-real-http")

        locked = self.client.post(
            base + "/hermes/sessions/session-real-http/model",
            json={"provider": "official", "model": "official-model", "require_model_lock": True},
        )
        self.assertEqual(locked.status_code, 200)
        self.assertEqual(locked.json()["locked"]["model"], "official-model")

        started = self.client.post(
            base + "/hermes/runs",
            json={"session_id": "session-real-http", "message": "do real work"},
        )
        self.assertEqual(started.status_code, 200)
        run_id = started.json()["id"]
        deadline = time.time() + 3
        snapshot = None
        while time.time() < deadline:
            response = self.client.get(base + f"/hermes/runs/{run_id}?after=0")
            self.assertEqual(response.status_code, 200)
            snapshot = response.json()
            if snapshot["status"] != "running":
                break
            time.sleep(0.02)
        assert snapshot is not None
        self.assertEqual(snapshot["status"], "completed")
        self.assertEqual(
            [row["event"] for row in snapshot["events"]],
            ["run.started", "assistant.delta", "tool.started", "tool.completed", "assistant.delta", "run.completed"],
        )
        self.assertEqual(snapshot["events"][3]["data"]["result"]["task_id"], "worker-123")
        self.assertGreaterEqual(snapshot["elapsed_ms"], 1)

        cursor = snapshot["events"][2]["seq"]
        tail = self.client.get(base + f"/hermes/runs/{run_id}?after={cursor}").json()
        self.assertEqual([x["event"] for x in tail["events"]], ["tool.completed", "assistant.delta", "run.completed"])

    def test_worker_mutations_and_status_use_exact_control_plane_contract(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        cases = [
            ("PUT", "/worker/provider", {"baseUrl": "https://upstream.example/v1", "apiKey": "key", "protocol": "auto"}),
            ("POST", "/worker/provider/probe", {}),
            ("POST", "/worker/provider/connectivity", {"models": ["new-model"]}),
            ("PUT", "/worker/mode", {"mode": "AUTO"}),
            ("PUT", "/worker/routing", {"mode": "AUTO", "roles": {"main": {"provider": "third_party", "model": "new-model", "effort": "deep"}}}),
            ("POST", "/worker/start", {"task": "test", "sandbox": "danger-full-access"}),
        ]
        for method, path, payload in cases:
            response = self.client.request(method, base + path, json=payload)
            self.assertEqual(response.status_code, 200, (method, path, response.text))
        status = self.client.get(base + "/worker/status/worker-123")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["status"], "completed")
        connectivity = self.client.post(base + "/worker/provider/connectivity", json={"models": ["new-model"]}).json()
        self.assertTrue(connectivity["results"][0]["ok"])

    def test_degraded_health_keeps_response_available(self) -> None:
        base = "/api/plugins/hermes-worker-studio"
        with patch.dict(os.environ, {"HERMES_WORKER_STUDIO_WORKER_URL": "http://127.0.0.1:1"}, clear=False):
            response = self.client.get(base + "/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["ok"] if payload["hermes"].get("ok") is False else payload["worker"].get("ok", False))
        self.assertTrue(payload["hermes"]["ok"])
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
        self.assertIn("exceeded", str(oversized.exception.detail))

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
