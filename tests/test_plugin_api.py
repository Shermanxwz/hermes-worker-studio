from __future__ import annotations

import importlib.util
import pathlib
import sys
import time
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_plugin_api", ROOT / "dashboard" / "plugin_api.py")
assert SPEC and SPEC.loader
plugin_api = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin_api
SPEC.loader.exec_module(plugin_api)


class RunBridgeTests(unittest.TestCase):
    def setUp(self):
        with plugin_api._RUNS_LOCK:
            plugin_api._RUNS.clear()

    def _seed(self, run_id="studio_test"):
        now = time.time()
        with plugin_api._RUNS_LOCK:
            plugin_api._RUNS[run_id] = {
                "session_id": "session-test",
                "status": "running",
                "started_at": now,
                "ended_at": None,
                "last_seq": 0,
                "events": [],
                "truncated": False,
            }
        return run_id

    def test_bridge_preserves_event_names_and_json(self):
        run_id = self._seed()
        wire = [
            b"event: assistant.delta\n",
            b'data: {"delta":"hello"}\n',
            b"\n",
            b"event: tool.started\n",
            b'data: {"tool_name":"terminal","arguments":"pwd"}\n',
            b"\n",
            b"event: tool.completed\n",
            b'data: {"tool_name":"terminal","result":"/tmp"}\n',
            b"\n",
            b"event: run.completed\n",
            b'data: {"final_response":"done"}\n',
            b"\n",
        ]
        with patch.object(plugin_api, "_stream_request", return_value=iter(wire)):
            plugin_api._consume_run_stream(run_id, "session-test", {"message": "go"})
        snap = plugin_api._run_snapshot(run_id)
        self.assertEqual(snap["status"], "completed")
        self.assertEqual([x["event"] for x in snap["events"]], [
            "assistant.delta", "tool.started", "tool.completed", "run.completed"
        ])
        self.assertEqual(snap["events"][0]["data"]["delta"], "hello")
        self.assertGreaterEqual(snap["elapsed_ms"], 0)

    def test_clean_eof_without_completed_is_not_faked_as_success(self):
        run_id = self._seed()
        with patch.object(plugin_api, "_stream_request", return_value=iter([
            b"event: assistant.delta\n", b'data: {"delta":"partial"}\n', b"\n"
        ])):
            plugin_api._consume_run_stream(run_id, "session-test", {"message": "go"})
        self.assertEqual(plugin_api._run_snapshot(run_id)["status"], "incomplete")

    def test_poll_cursor_returns_only_new_events(self):
        run_id = self._seed()
        plugin_api._append_run_event(run_id, "tool.started", {"name": "one"})
        plugin_api._append_run_event(run_id, "tool.completed", {"name": "one"})
        snap = plugin_api._run_snapshot(run_id, after=1)
        self.assertEqual(len(snap["events"]), 1)
        self.assertEqual(snap["events"][0]["seq"], 2)

    def test_loopback_is_default_security_boundary(self):
        with patch.dict(plugin_api.os.environ, {"HERMES_WORKER_STUDIO_ALLOW_REMOTE": ""}, clear=False):
            plugin_api._validate_upstream(plugin_api.Upstream("http://127.0.0.1:8642", "", "ok"))
            with self.assertRaises(Exception):
                plugin_api._validate_upstream(plugin_api.Upstream("https://example.com", "", "remote"))


if __name__ == "__main__":
    unittest.main()
