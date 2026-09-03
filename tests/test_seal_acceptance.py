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

    def test_pick_route_avoids_virtual_moa_unless_explicitly_requested(self):
        options = {
            "provider": "moa",
            "model": "default",
            "providers": [
                {"slug": "moa", "authenticated": True, "models": ["default"]},
                {"slug": "official", "authenticated": True, "models": ["main-model"]},
            ],
        }
        self.assertEqual(seal.pick_route(options, "", ""), ("official", "main-model"))
        self.assertEqual(seal.pick_route(options, "moa", "default"), ("moa", "default"))

    def test_validate_started_route_records_responses_execution_alias(self):
        started = {
            "id": "run-1",
            "source_route": {
                "provider": "custom",
                "model": "gpt-responses",
                "mode": "codex_responses",
                "status": "resolved",
                "requires_probe": False,
                "execution_provider": "hws-protocol-abc-responses",
                "source": "hermes-worker-studio-real-run-probe",
                "probed_at": 123.0,
            },
        }
        route = seal.validate_started_route(started, "custom", "gpt-responses")
        self.assertEqual(route["mode"], "codex_responses")
        self.assertEqual(route["status"], "resolved")
        self.assertEqual(route["execution_provider"], "hws-protocol-abc-responses")

    def test_validate_started_route_rejects_unresolved_or_mismatched_route(self):
        unresolved = {
            "source_route": {
                "provider": "custom",
                "model": "m",
                "status": "unresolved",
                "requires_probe": True,
                "execution_provider": "",
            }
        }
        with self.assertRaises(seal.AcceptanceError):
            seal.validate_started_route(unresolved, "custom", "m")
        resolved_wrong_model = {
            "source_route": {
                "provider": "custom",
                "model": "other",
                "status": "resolved",
                "requires_probe": False,
                "execution_provider": "alias",
            }
        }
        with self.assertRaises(seal.AcceptanceError):
            seal.validate_started_route(resolved_wrong_model, "custom", "m")


if __name__ == "__main__":
    unittest.main()
