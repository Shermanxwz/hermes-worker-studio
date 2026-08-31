from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_seal_acceptance", ROOT / "scripts" / "seal_acceptance.py")
assert SPEC and SPEC.loader
seal = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = seal
SPEC.loader.exec_module(seal)


class SealAcceptanceParsingTests(unittest.TestCase):
    def test_canonical_todo_history_is_revisioned_and_deduplicated(self):
        messages = [
            {"role": "tool", "tool_name": "todo", "content": '{"todos":[{"id":"1","status":"pending"}],"revision":1}'},
            {"role": "tool", "tool_name": "terminal", "content": "ignored"},
            {"role": "tool", "name": "todo", "content": {"todos": [{"id": "1", "status": "in_progress"}], "revision": 2}},
            {"role": "tool", "tool_name": "todo", "content": '{"todos":[{"id":"1","status":"completed"}],"revision":2}'},
            {"role": "tool", "tool_name": "todo", "content": '{"todos":[{"id":"1","status":"completed"}],"revision":3}'},
        ]
        history = seal.canonical_todo_history(messages)
        self.assertEqual([row["revision"] for row in history], [1, 2, 3])
        self.assertEqual(history[1]["todos"][0]["status"], "completed")

    def test_projected_todo_events_accepts_official_and_session_projection(self):
        run = {
            "events": [
                {"event": "run.started", "data": {}},
                {"event": "todo.updated", "data": {"revision": 2, "todos": [{"id": "a"}]}},
                {"event": "todo.snapshot", "data": {"revision": 3, "source": "hermes_session_api", "todos": [{"id": "b"}]}},
            ]
        }
        rows = seal.projected_todo_events(run)
        self.assertEqual([row["event"] for row in rows], ["todo.updated", "todo.snapshot"])
        self.assertEqual(rows[-1]["source"], "hermes_session_api")

    def test_session_marker_only_counts_assistant_output(self):
        messages = [
            {"role": "tool", "tool_name": "todo", "content": "HWS_SEAL_RUN_OK_X"},
            {"role": "assistant", "content": [{"type": "text", "text": "HWS_SEAL_RUN_OK_X"}]},
        ]
        self.assertTrue(seal._session_has_marker(messages, "HWS_SEAL_RUN_OK_X"))
        self.assertFalse(seal._session_has_marker(messages[:1], "HWS_SEAL_RUN_OK_X"))


if __name__ == "__main__":
    unittest.main()
