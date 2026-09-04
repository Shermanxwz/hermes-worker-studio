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


class RunProjectionTests(unittest.TestCase):
    def setUp(self):
        with plugin_api._RUNS_LOCK:
            plugin_api._RUNS.clear()
        with plugin_api._EPHEMERAL_REAPERS_LOCK:
            plugin_api._EPHEMERAL_REAPERS.clear()

    def _seed(self, run_id="run-test", started_at=None):
        now = time.time() if started_at is None else started_at
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

    def test_sse_preserves_official_event_names_and_payloads(self):
        run_id = self._seed()
        wire = [
            b"event: run.started\n", b'data: {"run_id":"run-test"}\n', b"\n",
            b"event: assistant.delta\n", b'data: {"delta":"hello"}\n', b"\n",
            b"event: todo.updated\n", b'data: {"revision":2,"todos":[{"title":"test"}]}\n', b"\n",
            b"event: tool.started\n", b'data: {"tool_name":"terminal","arguments":"pwd"}\n', b"\n",
            b"event: tool.completed\n", b'data: {"tool_name":"terminal","result":"/tmp"}\n', b"\n",
            b"event: run.completed\n", b'data: {"final_response":"done"}\n', b"\n",
        ]
        plugin_api._consume_sse(run_id, iter(wire))
        with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "completed", "output": "done"}):
            snap = plugin_api._run_snapshot(run_id)
        self.assertEqual(snap["status"], "completed")
        self.assertEqual(
            [x["event"] for x in snap["events"]],
            ["run.started", "assistant.delta", "todo.updated", "tool.started", "tool.completed", "run.completed"],
        )
        self.assertEqual(snap["events"][2]["data"]["revision"], 2)

    def test_multiline_sse_and_comments_follow_framing(self):
        run_id = self._seed()
        plugin_api._consume_sse(run_id, iter([
            b": heartbeat\n",
            b"event: custom.event\n",
            b"data: first\n",
            b"data: second\n",
            b"\n",
        ]))
        with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "running"}):
            snap = plugin_api._run_snapshot(run_id)
        self.assertEqual(snap["events"][0]["data"], {"raw": "first\nsecond"})
        self.assertEqual(snap["status"], "running")

    def test_generic_sse_envelope_projects_embedded_hermes_event_name(self):
        run_id = self._seed()
        plugin_api._consume_sse(run_id, iter([
            b"event: message\n",
            b'data: {"event":"message.delta","delta":"hello"}\n', b"\n",
            b"event: message\n",
            b'data: {"event":"run.completed","output":"done"}\n', b"\n",
        ]))
        with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "completed", "output": "done"}):
            snap = plugin_api._run_snapshot(run_id)
        self.assertEqual([x["event"] for x in snap["events"]], ["message.delta", "run.completed"])
        self.assertEqual(snap["status"], "completed")

    def test_explicit_sse_event_name_still_wins_over_payload_field(self):
        run_id = self._seed()
        plugin_api._consume_sse(run_id, iter([
            b"event: tool.started\n",
            b'data: {"event":"payload.name","tool_name":"terminal"}\n', b"\n",
        ]))
        with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "running"}):
            snap = plugin_api._run_snapshot(run_id)
        self.assertEqual(snap["events"][0]["event"], "tool.started")

    def test_native_run_body_is_allowlisted(self):
        outgoing = plugin_api._official_run_body({
            "message": "go",
            "provider": "provider-x",
            "model": "model-x",
            "model_options": {"reasoning_effort": "provider-advertised-value"},
            "instructions": "do it",
            "private_ui_only": "must-not-forward",
        }, "session-1", "go")
        self.assertEqual(outgoing["input"], "go")
        self.assertEqual(outgoing["session_id"], "session-1")
        self.assertEqual(outgoing["provider"], "provider-x")
        self.assertEqual(outgoing["model"], "model-x")
        self.assertNotIn("message", outgoing)
        self.assertNotIn("private_ui_only", outgoing)

    def test_require_runs_has_no_legacy_fallback(self):
        with patch.object(plugin_api, "_run_support", return_value={"submission": False}):
            with self.assertRaises(plugin_api.HTTPException) as ctx:
                plugin_api._require_runs()
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("no legacy execution fallback", str(ctx.exception.detail))

    def test_ephemeral_probe_cleanup_deletes_only_the_run_session(self):
        def fake_proxy(path, method="GET", body=None, timeout=None):
            if method == "DELETE":
                return {}
            raise plugin_api.HTTPException(404, "gone")

        with patch.object(plugin_api, "_hermes_proxy", side_effect=fake_proxy) as proxy, patch.object(
            plugin_api.time, "sleep"
        ):
            self.assertTrue(plugin_api._cleanup_ephemeral_run_session("run_probe_123"))
            self.assertIn(
                (("/api/sessions/run_probe_123",), {"method": "DELETE"}),
                [(call.args, call.kwargs) for call in proxy.call_args_list],
            )

        with patch.object(plugin_api, "_hermes_proxy") as proxy:
            self.assertFalse(plugin_api._cleanup_ephemeral_run_session("session-user-owned"))
            proxy.assert_not_called()

    def test_ephemeral_probe_cleanup_retries_when_a_late_session_write_reappears(self):
        calls = []
        verification = [
            plugin_api.HTTPException(404, "gone"),
            {"id": "run_probe_late"},
            plugin_api.HTTPException(404, "gone"),
            plugin_api.HTTPException(404, "gone"),
        ]

        def fake_proxy(path, method="GET", body=None, timeout=None):
            calls.append((path, method))
            if method == "DELETE":
                return {}
            result = verification.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

        with patch.object(plugin_api, "_hermes_proxy", side_effect=fake_proxy), patch.object(
            plugin_api.time, "sleep"
        ):
            self.assertTrue(plugin_api._cleanup_ephemeral_run_session("run_probe_late"))

        self.assertEqual(calls.count(("/api/sessions/run_probe_late", "DELETE")), 2)

    def test_ephemeral_wait_cleans_after_terminal_run(self):
        with patch.object(plugin_api, "_wait_run", return_value={"status": "completed"}), patch.object(
            plugin_api, "_cleanup_ephemeral_run_session"
        ) as cleanup, patch.object(plugin_api, "_schedule_ephemeral_run_reaper") as schedule:
            final = plugin_api._wait_ephemeral_run("run_probe_456", 3)
        self.assertEqual(final["status"], "completed")
        cleanup.assert_called_once_with("run_probe_456")
        schedule.assert_called_once_with("run_probe_456")

    def test_ephemeral_reaper_removes_a_session_that_appears_after_initial_cleanup(self):
        with patch.object(plugin_api, "_EPHEMERAL_REAPER_GRACE_SECONDS", 0.5), patch.object(
            plugin_api, "_EPHEMERAL_REAPER_POLL_SECONDS", 0.1
        ), patch.object(plugin_api, "_ephemeral_session_exists", side_effect=[False, True, False]), patch.object(
            plugin_api, "_delete_ephemeral_run_session"
        ) as delete, patch.object(plugin_api.time, "sleep"), patch.object(
            plugin_api.time, "monotonic", side_effect=[0.0, 0.0, 0.1, 1.0]
        ):
            plugin_api._reap_ephemeral_run_session("run_probe_late_title")
        delete.assert_called_once_with("run_probe_late_title")
        with plugin_api._EPHEMERAL_REAPERS_LOCK:
            self.assertNotIn("run_probe_late_title", plugin_api._EPHEMERAL_REAPERS)

    def test_ephemeral_timeout_does_not_delete_an_active_session(self):
        with patch.object(plugin_api, "_EPHEMERAL_STOP_GRACE_SECONDS", 0), patch.object(
            plugin_api, "_wait_run", side_effect=plugin_api.HTTPException(504, "timed out")), patch.object(
            plugin_api, "_hermes_proxy", return_value={"status": "running"}
        ), patch.object(plugin_api, "_cleanup_ephemeral_run_session") as cleanup:
            with self.assertRaises(plugin_api.HTTPException):
                plugin_api._wait_ephemeral_run("run_probe_789", 3)
        cleanup.assert_not_called()

    def test_ephemeral_timeout_waits_for_official_stop_before_cleanup(self):
        statuses = [{"status": "stopping"}, {"status": "completed"}]

        with patch.object(plugin_api, "_EPHEMERAL_STOP_GRACE_SECONDS", 1), patch.object(
            plugin_api, "_wait_run", side_effect=plugin_api.HTTPException(504, "timed out")
        ), patch.object(plugin_api, "_hermes_proxy", side_effect=lambda *args, **kwargs: statuses.pop(0)), patch.object(
            plugin_api, "_cleanup_ephemeral_run_session"
        ) as cleanup, patch.object(plugin_api, "_schedule_ephemeral_run_reaper") as schedule, patch.object(
            plugin_api.time, "sleep"
        ):
            with self.assertRaises(plugin_api.HTTPException):
                plugin_api._wait_ephemeral_run("run_probe_stopped", 3)

        cleanup.assert_called_once_with("run_probe_stopped")
        schedule.assert_called_once_with("run_probe_stopped")

    def test_poll_cursor_returns_only_new_events(self):
        run_id = self._seed()
        plugin_api._append_run_event(run_id, "tool.started", {"name": "one"})
        plugin_api._append_run_event(run_id, "tool.completed", {"name": "one"})
        with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "running"}):
            snap = plugin_api._run_snapshot(run_id, after=1)
        self.assertEqual([x["seq"] for x in snap["events"]], [2])

    def test_event_ring_is_bounded(self):
        run_id = self._seed()
        original = plugin_api._RUN_EVENT_LIMIT
        try:
            plugin_api._RUN_EVENT_LIMIT = 25
            for i in range(100):
                plugin_api._append_run_event(run_id, "tool.started", {"i": i})
            with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "running"}):
                snap = plugin_api._run_snapshot(run_id)
        finally:
            plugin_api._RUN_EVENT_LIMIT = original
        self.assertEqual(len(snap["events"]), 25)
        self.assertTrue(snap["truncated"])
        self.assertEqual(snap["events"][0]["data"]["i"], 75)

    def test_oversized_event_data_is_bounded_before_parse(self):
        raw = json.dumps({"blob": "x" * (plugin_api._RUN_EVENT_DATA_LIMIT + 100)})
        data = plugin_api._safe_event_data(raw)
        self.assertIn("raw", data)
        self.assertIn("event payload truncated", data["raw"])

    def test_ttl_pruning_removes_only_stale_projection(self):
        stale = self._seed("stale", time.time() - plugin_api._RUN_TTL - 10)
        fresh = self._seed("fresh")
        plugin_api._prune_runs()
        with plugin_api._RUNS_LOCK:
            self.assertNotIn(stale, plugin_api._RUNS)
            self.assertIn(fresh, plugin_api._RUNS)

    def test_parallel_append_sequence_is_unique_and_monotonic(self):
        run_id = self._seed()
        def append(worker):
            for i in range(100):
                plugin_api._append_run_event(run_id, "event", {"worker": worker, "i": i})
        threads = [threading.Thread(target=append, args=(i,)) for i in range(6)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=5)
        with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "running"}):
            snap = plugin_api._run_snapshot(run_id)
        self.assertEqual([x["seq"] for x in snap["events"]], list(range(1, 601)))

    def test_snapshot_does_not_leak_mutable_event_rows(self):
        run_id = self._seed()
        plugin_api._append_run_event(run_id, "tool.started", {"name": "x"})
        with patch.object(plugin_api, "_hermes_proxy", return_value={"status": "running"}):
            snap = plugin_api._run_snapshot(run_id)
            snap["events"][0]["event"] = "tampered"
            second = plugin_api._run_snapshot(run_id)
        self.assertEqual(second["events"][0]["event"], "tool.started")


class SecurityBoundaryTests(unittest.TestCase):
    def test_loopback_is_default_boundary(self):
        with patch.dict(plugin_api.os.environ, {"HERMES_WORKER_STUDIO_ALLOW_REMOTE": ""}, clear=False):
            plugin_api._validate_upstream(plugin_api.Upstream("http://127.0.0.1:8642", "", "ok"))
            with self.assertRaises(plugin_api.HTTPException):
                plugin_api._validate_upstream(plugin_api.Upstream("https://example.com", "", "remote"))

    def test_remote_opt_in_never_allows_embedded_credentials(self):
        with patch.dict(plugin_api.os.environ, {"HERMES_WORKER_STUDIO_ALLOW_REMOTE": "1"}, clear=False):
            plugin_api._validate_upstream(plugin_api.Upstream("https://example.com", "token", "remote"))
            with self.assertRaises(plugin_api.HTTPException):
                plugin_api._validate_upstream(plugin_api.Upstream("https://u:p@example.com", "", "bad"))


if __name__ == "__main__":
    unittest.main()
