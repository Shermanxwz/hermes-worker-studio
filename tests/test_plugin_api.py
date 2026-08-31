from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import threading
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

    def _seed(self, run_id="studio_test", *, transport="legacy_chat_stream", started_at: float | None = None):
        now = time.time() if started_at is None else started_at
        with plugin_api._RUNS_LOCK:
            plugin_api._RUNS[run_id] = {
                "session_id": "session-test",
                "transport": transport,
                "upstream_run_id": run_id if transport == "official_runs" else None,
                "status": "running",
                "started_at": now,
                "ended_at": None,
                "last_seq": 0,
                "events": [],
                "truncated": False,
            }
        return run_id

    def test_sse_preserves_event_names_and_json(self):
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
        plugin_api._consume_sse(run_id, iter(wire), legacy_eof_incomplete=True)
        snap = plugin_api._run_snapshot(run_id)
        self.assertEqual(snap["status"], "completed")
        self.assertEqual(
            [x["event"] for x in snap["events"]],
            ["assistant.delta", "tool.started", "tool.completed", "run.completed"],
        )
        self.assertEqual(snap["events"][0]["data"]["delta"], "hello")

    def test_multiline_sse_data_and_comments_follow_framing(self):
        run_id = self._seed()
        wire = [
            b": heartbeat\n",
            b"event: custom.event\n",
            b"data: first line\n",
            b"data: second line\n",
            b"\n",
            b"event: run.completed\n",
            b"data: {}\n",
            b"\n",
        ]
        plugin_api._consume_sse(run_id, iter(wire), legacy_eof_incomplete=True)
        snap = plugin_api._run_snapshot(run_id)
        self.assertEqual(snap["events"][0]["event"], "custom.event")
        self.assertEqual(snap["events"][0]["data"], {"raw": "first line\nsecond line"})
        self.assertEqual(snap["status"], "completed")

    def test_legacy_clean_eof_without_completed_is_incomplete(self):
        run_id = self._seed()
        plugin_api._consume_sse(
            run_id,
            iter([b"event: assistant.delta\n", b'data: {"delta":"partial"}\n', b"\n"]),
            legacy_eof_incomplete=True,
        )
        self.assertEqual(plugin_api._run_snapshot(run_id)["status"], "incomplete")

    def test_official_event_stream_eof_does_not_invent_terminal_state(self):
        run_id = self._seed(transport="official_runs")
        plugin_api._consume_sse(
            run_id,
            iter([b"event: assistant.delta\n", b'data: {"delta":"partial"}\n', b"\n"]),
            legacy_eof_incomplete=False,
        )
        with plugin_api._RUNS_LOCK:
            self.assertEqual(plugin_api._RUNS[run_id]["status"], "running")

    def test_official_run_body_uses_native_contract_and_whitelist(self):
        body = {
            "session_id": "s",
            "message": "go",
            "provider": "minimax",
            "model": "MiniMax-M3",
            "model_options": {"reasoning_effort": "high"},
            "instructions": "do it",
            "private_ui_only": "must-not-forward",
        }
        outgoing = plugin_api._official_run_body(body, "s", "go")
        self.assertEqual(outgoing["input"], "go")
        self.assertEqual(outgoing["session_id"], "s")
        self.assertEqual(outgoing["provider"], "minimax")
        self.assertEqual(outgoing["model"], "MiniMax-M3")
        self.assertNotIn("message", outgoing)
        self.assertNotIn("private_ui_only", outgoing)

    def test_capability_detection_prefers_features_map(self):
        caps = {"features": {"run_submission": True, "run_events_sse": True, "run_stop": True}}
        self.assertTrue(plugin_api._feature(caps, "run_submission"))
        self.assertTrue(plugin_api._feature(caps, "run_events_sse"))
        self.assertFalse(plugin_api._feature(caps, "run_approval"))
        self.assertTrue(plugin_api._feature({"run_submission": True}, "run_submission"))

    def test_poll_cursor_returns_only_new_events(self):
        run_id = self._seed()
        plugin_api._append_run_event(run_id, "tool.started", {"name": "one"})
        plugin_api._append_run_event(run_id, "tool.completed", {"name": "one"})
        snap = plugin_api._run_snapshot(run_id, after=1)
        self.assertEqual(len(snap["events"]), 1)
        self.assertEqual(snap["events"][0]["seq"], 2)

    def test_event_ring_is_bounded_and_reports_truncation(self):
        run_id = self._seed()
        original_limit = plugin_api._RUN_EVENT_LIMIT
        try:
            plugin_api._RUN_EVENT_LIMIT = 25
            for i in range(100):
                plugin_api._append_run_event(run_id, "tool.started", {"i": i})
            snap = plugin_api._run_snapshot(run_id)
        finally:
            plugin_api._RUN_EVENT_LIMIT = original_limit
        self.assertEqual(len(snap["events"]), 25)
        self.assertTrue(snap["truncated"])
        self.assertEqual(snap["events"][0]["data"]["i"], 75)
        self.assertEqual(snap["last_seq"], 100)

    def test_oversized_event_payload_is_truncated_before_json_parse(self):
        raw = json.dumps({"blob": "x" * (plugin_api._RUN_EVENT_DATA_LIMIT + 100)})
        data = plugin_api._safe_event_data(raw)
        self.assertIn("raw", data)
        self.assertIn("event payload truncated", data["raw"])

    def test_ttl_pruning_removes_only_stale_runs(self):
        stale = self._seed("stale", started_at=time.time() - plugin_api._RUN_TTL - 10)
        fresh = self._seed("fresh")
        plugin_api._prune_runs()
        with plugin_api._RUNS_LOCK:
            self.assertNotIn(stale, plugin_api._RUNS)
            self.assertIn(fresh, plugin_api._RUNS)

    def test_parallel_event_append_keeps_unique_monotonic_sequence(self):
        run_id = self._seed()
        workers = 8
        per_worker = 200

        def append(worker: int) -> None:
            for i in range(per_worker):
                plugin_api._append_run_event(run_id, "worker.event", {"worker": worker, "i": i})

        threads = [threading.Thread(target=append, args=(i,)) for i in range(workers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive(), "append thread did not finish")

        snap = plugin_api._run_snapshot(run_id)
        seqs = [event["seq"] for event in snap["events"]]
        self.assertEqual(seqs, list(range(1, workers * per_worker + 1)))

    def test_snapshot_isolation_does_not_leak_mutable_event_rows(self):
        run_id = self._seed()
        plugin_api._append_run_event(run_id, "tool.started", {"name": "x"})
        snap = plugin_api._run_snapshot(run_id)
        snap["events"][0]["event"] = "tampered"
        self.assertEqual(plugin_api._run_snapshot(run_id)["events"][0]["event"], "tool.started")


class FourModePolicyTests(unittest.TestCase):
    def test_wire_mode_alias_and_invalid_mode(self):
        self.assertEqual(plugin_api._normalize_worker_mode("WORKER"), "DELEGATE")
        for mode in ("OFFICIAL", "AUTO", "DELEGATE", "MAIN"):
            self.assertEqual(plugin_api._normalize_worker_mode(mode), mode)
        with self.assertRaises(plugin_api.HTTPException):
            plugin_api._normalize_worker_mode("mystery")

    def test_delegation_allowed_only_auto_and_delegate(self):
        for mode in ("AUTO", "DELEGATE", "WORKER"):
            with self.subTest(mode=mode), patch.object(plugin_api, "_worker_proxy", return_value={"mode": mode}):
                effective, _ = plugin_api._require_worker_delegation_mode()
                self.assertIn(effective, {"AUTO", "DELEGATE"})
        for mode in ("OFFICIAL", "MAIN"):
            with self.subTest(mode=mode), patch.object(plugin_api, "_worker_proxy", return_value={"mode": mode}):
                with self.assertRaises(plugin_api.HTTPException) as ctx:
                    plugin_api._require_worker_delegation_mode()
                self.assertEqual(ctx.exception.status_code, 409)


class SecurityBoundaryTests(unittest.TestCase):
    def test_loopback_is_default_security_boundary(self):
        with patch.dict(plugin_api.os.environ, {"HERMES_WORKER_STUDIO_ALLOW_REMOTE": ""}, clear=False):
            plugin_api._validate_upstream(plugin_api.Upstream("http://127.0.0.1:8642", "", "ok"))
            with self.assertRaises(Exception):
                plugin_api._validate_upstream(plugin_api.Upstream("https://example.com", "", "remote"))

    def test_remote_opt_in_is_explicit_and_embedded_credentials_forbidden(self):
        with patch.dict(plugin_api.os.environ, {"HERMES_WORKER_STUDIO_ALLOW_REMOTE": "1"}, clear=False):
            plugin_api._validate_upstream(plugin_api.Upstream("https://example.com", "token", "remote"))
            with self.assertRaises(plugin_api.HTTPException):
                plugin_api._validate_upstream(plugin_api.Upstream("https://u:p@example.com", "", "bad"))


if __name__ == "__main__":
    unittest.main()
