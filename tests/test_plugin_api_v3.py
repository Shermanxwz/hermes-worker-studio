from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_plugin_api_v3", ROOT / "dashboard" / "plugin_api_v3.py")
assert SPEC and SPEC.loader
plugin_api_v3 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin_api_v3
SPEC.loader.exec_module(plugin_api_v3)


class ProductRunsBridgeTests(unittest.TestCase):
    def setUp(self):
        with plugin_api_v3._legacy._RUNS_LOCK:
            plugin_api_v3._legacy._RUNS.clear()

    def test_structured_input_is_preserved_verbatim(self):
        structured = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64,AAAA", "detail": "high"},
                    },
                ],
            }
        ]
        captured = {}

        def fake_proxy(path, method="GET", body=None, timeout=None):
            if path.startswith("/api/sessions/"):
                return {"messages": []}
            captured.update({"path": path, "method": method, "body": body})
            return {"id": "run-v3-test", "status": "running"}

        with patch.object(
            plugin_api_v3._legacy,
            "_require_runs",
            return_value={"submission": True, "events": False, "stop": True, "approval": True, "steer": True},
        ), patch.object(plugin_api_v3._legacy, "_hermes_proxy", side_effect=fake_proxy):
            result = plugin_api_v3._start_native_run_v3(
                {
                    "session_id": "session-v3",
                    "input": structured,
                    "provider": "provider-x",
                    "model": "model-x",
                    "model_options": {"reasoning_effort": "deep"},
                }
            )

        self.assertEqual(captured["path"], "/v1/runs")
        self.assertEqual(captured["method"], "POST")
        self.assertIs(captured["body"]["input"], structured)
        self.assertEqual(captured["body"]["session_id"], "session-v3")
        self.assertEqual(captured["body"]["provider"], "provider-x")
        self.assertEqual(captured["body"]["model"], "model-x")
        self.assertEqual(result["transport"], "official_runs")
        self.assertEqual(result["input_mode"], "multimodal")

    def test_text_input_stays_text(self):
        captured = {}

        def fake_proxy(path, method="GET", body=None, timeout=None):
            if path.startswith("/api/sessions/"):
                return {"messages": []}
            captured["body"] = body
            return {"id": "run-text", "status": "running"}

        with patch.object(
            plugin_api_v3._legacy,
            "_require_runs",
            return_value={"submission": True, "events": False, "stop": True, "approval": True, "steer": True},
        ), patch.object(plugin_api_v3._legacy, "_hermes_proxy", side_effect=fake_proxy):
            result = plugin_api_v3._start_native_run_v3({"session_id": "s", "input": "hello"})

        self.assertEqual(captured["body"]["input"], "hello")
        self.assertEqual(result["input_mode"], "text")

    def test_todo_tool_result_parses_as_canonical_snapshot(self):
        snapshot = plugin_api_v3._todo_snapshot_from_message(
            {
                "role": "tool",
                "tool_name": "todo",
                "content": '{"todos":[{"id":"1","content":"Ship","status":"in_progress"}],"revision":7}',
            }
        )
        self.assertEqual(snapshot["revision"], 7)
        self.assertEqual(snapshot["todos"][0]["content"], "Ship")
        self.assertEqual(snapshot["source"], "hermes_session_api")
        self.assertIsNone(plugin_api_v3._todo_snapshot_from_message({"role": "tool", "tool_name": "terminal", "content": "{}"}))

    def test_latest_session_todo_uses_highest_revision_from_public_rows(self):
        payload = {
            "messages": [
                {"role": "tool", "tool_name": "todo", "content": '{"todos":[],"revision":2}'},
                {"role": "tool", "tool_name": "terminal", "content": "pwd"},
                {
                    "role": "tool",
                    "name": "todo",
                    "content": {"todos": [{"id": "a", "content": "Done", "status": "completed"}], "revision": 5},
                },
            ]
        }
        with patch.object(plugin_api_v3._legacy, "_hermes_proxy", return_value=payload) as proxy:
            snapshot = plugin_api_v3._latest_session_todo_snapshot("session x")
        self.assertEqual(snapshot["revision"], 5)
        self.assertEqual(snapshot["todos"][0]["id"], "a")
        self.assertIn("/api/sessions/session%20x/messages?limit=100&order=latest", proxy.call_args.args[0])

    def test_changed_session_todo_projects_once_without_inventing_a_planner(self):
        run_id = "run-todo"
        plugin_api_v3._legacy._new_run_record(run_id, "session-todo", "running")
        plugin_api_v3._seed_todo_baseline(run_id, {"todos": [], "revision": 3})
        next_snapshot = {
            "todos": [{"id": "4", "content": "Verify", "status": "in_progress"}],
            "revision": 4,
            "source": "hermes_session_api",
        }
        with patch.object(plugin_api_v3, "_latest_session_todo_snapshot", return_value=next_snapshot):
            self.assertTrue(plugin_api_v3._project_session_todo_if_changed(run_id))
            with plugin_api_v3._legacy._RUNS_LOCK:
                events = list(plugin_api_v3._legacy._RUNS[run_id]["events"])
                plugin_api_v3._legacy._RUNS[run_id]["todo_polled_at"] = 0.0
            self.assertEqual(events[-1]["event"], "todo.snapshot")
            self.assertEqual(events[-1]["data"]["source"], "hermes_session_api")
            self.assertEqual(events[-1]["data"]["revision"], 4)
            self.assertFalse(plugin_api_v3._project_session_todo_if_changed(run_id))

    def test_official_runs_todo_event_wins_over_session_projection(self):
        run_id = "run-official-todo"
        plugin_api_v3._legacy._new_run_record(run_id, "session-todo", "running")
        plugin_api_v3._seed_todo_baseline(run_id, None)
        plugin_api_v3._legacy._append_run_event(
            run_id,
            "todo.updated",
            {"revision": 1, "todos": [{"id": "1", "content": "Official", "status": "in_progress"}]},
        )
        with patch.object(plugin_api_v3, "_latest_session_todo_snapshot") as session_snapshot:
            self.assertFalse(plugin_api_v3._project_session_todo_if_changed(run_id))
        session_snapshot.assert_not_called()

    def test_start_seeds_old_todo_revision_before_new_run(self):
        baseline = {"todos": [{"id": "old", "content": "Old", "status": "completed"}], "revision": 9}

        def fake_proxy(path, method="GET", body=None, timeout=None):
            if path.startswith("/api/sessions/"):
                return {"messages": [{"role": "tool", "tool_name": "todo", "content": baseline}]}
            return {"id": "run-baseline", "status": "running"}

        with patch.object(
            plugin_api_v3._legacy,
            "_require_runs",
            return_value={"submission": True, "events": False, "stop": True, "approval": True, "steer": True},
        ), patch.object(plugin_api_v3._legacy, "_hermes_proxy", side_effect=fake_proxy):
            plugin_api_v3._start_native_run_v3({"session_id": "s", "input": "continue"})
        with plugin_api_v3._legacy._RUNS_LOCK:
            self.assertEqual(plugin_api_v3._legacy._RUNS["run-baseline"]["todo_revision"], 9)

    def test_product_capabilities_are_explicit(self):
        caps = plugin_api_v3.product_capabilities()
        self.assertEqual(caps["version"], 3)
        self.assertEqual(caps["execution"], "Hermes official /v1/runs")
        self.assertTrue(caps["multimodal_runs"])
        self.assertTrue(caps["session_crud"])
        self.assertTrue(caps["dashboard_return_slot"])
        self.assertEqual(caps["official_plan"]["source"], "Hermes canonical todo")
        self.assertIn("/api/sessions", caps["official_plan"]["fallback"])


if __name__ == "__main__":
    unittest.main()
