from __future__ import annotations

import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException

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

    def test_projection_sanitizes_and_preserves_moa_marker(self):
        previous = {"moa": {"provider": "moa", "preset": "default"}}
        result = plugin_api_v3._sanitize_projection(
            {
                "turns": [{
                    "id": "r1",
                    "last_seq": 7,
                    "gateway_last_seq": 12,
                    "gateway_replay_epoch": "epoch-1",
                    "assistant_message_id": "assistant-1",
                    "user_message_id": "user-1",
                    "events": [{"event": "message.complete"}],
                    "secret": "drop",
                }]
            },
            previous,
        )
        self.assertEqual(result["moa"], previous["moa"])
        self.assertNotIn("secret", result["turns"][0])
        self.assertEqual(result["turns"][0]["assistant_message_id"], "assistant-1")
        self.assertEqual(result["turns"][0]["user_message_id"], "user-1")
        self.assertEqual(result["turns"][0]["gateway_last_seq"], 12)
        self.assertEqual(result["turns"][0]["gateway_replay_epoch"], "epoch-1")
        with self.assertRaises(HTTPException):
            plugin_api_v3._sanitize_projection({"turns": [{}] * 101})

    def test_projection_write_is_atomic_and_readable(self):
        with self.subTest("private projection store"):
            with tempfile.TemporaryDirectory() as directory, patch.object(plugin_api_v3, "_PROJECTION_ROOT", pathlib.Path(directory)):
                plugin_api_v3._write_projection("session/one", {"turns": [], "moa": {"provider": "moa"}})
                result = plugin_api_v3._read_projection("session/one")
                self.assertEqual(result["moa"]["provider"], "moa")
                self.assertTrue(plugin_api_v3._projection_file("session/one").exists())

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

    def test_changed_session_todo_projects_each_new_revision_without_inventing_a_planner(self):
        run_id = "run-todo"
        plugin_api_v3._legacy._new_run_record(run_id, "session-todo", "running")
        plugin_api_v3._seed_todo_baseline(run_id, {"todos": [], "revision": 3})
        revision4 = {
            "todos": [{"id": "4", "content": "Verify", "status": "in_progress"}],
            "revision": 4,
            "source": "hermes_session_api",
        }
        revision5 = {
            "todos": [{"id": "4", "content": "Verify", "status": "completed"}],
            "revision": 5,
            "source": "hermes_session_api",
        }
        with patch.object(plugin_api_v3, "_latest_session_todo_snapshot", return_value=revision4):
            self.assertTrue(plugin_api_v3._project_session_todo_if_changed(run_id))
            with plugin_api_v3._legacy._RUNS_LOCK:
                events = list(plugin_api_v3._legacy._RUNS[run_id]["events"])
                plugin_api_v3._legacy._RUNS[run_id]["todo_polled_at"] = 0.0
            self.assertEqual(events[-1]["event"], "todo.snapshot")
            self.assertEqual(events[-1]["data"]["source"], "hermes_session_api")
            self.assertEqual(events[-1]["data"]["revision"], 4)
            self.assertFalse(plugin_api_v3._project_session_todo_if_changed(run_id))

        with plugin_api_v3._legacy._RUNS_LOCK:
            plugin_api_v3._legacy._RUNS[run_id]["todo_polled_at"] = 0.0
        with patch.object(plugin_api_v3, "_latest_session_todo_snapshot", return_value=revision5):
            self.assertTrue(plugin_api_v3._project_session_todo_if_changed(run_id))
        with plugin_api_v3._legacy._RUNS_LOCK:
            events = list(plugin_api_v3._legacy._RUNS[run_id]["events"])
        self.assertEqual([event["data"]["revision"] for event in events if event["event"] == "todo.snapshot"], [4, 5])

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

    def test_official_context_envelope_normalizes_without_using_billing_totals(self):
        snapshot = plugin_api_v3._normalize_context_snapshot(
            {
                "object": "hermes.session.context",
                "session_id": "s",
                "context": {
                    "used_tokens": 32400,
                    "context_window_tokens": 128000,
                    "usage_percent": 25.31,
                    "compression_threshold_tokens": 96000,
                    "compression_threshold_percent": 75,
                    "compression_progress_percent": 33.75,
                    "tokens_until_compression": 63600,
                    "compression_count": 2,
                    "compression_enabled": True,
                    "compacted": True,
                    "updated_at": 123.5,
                },
                "input_tokens": 999999,
                "total_tokens": 1111111,
            }
        )
        self.assertEqual(snapshot["context_used"], 32400)
        self.assertEqual(snapshot["context_max"], 128000)
        self.assertEqual(snapshot["context_percent"], 25.31)
        self.assertEqual(snapshot["threshold_tokens"], 96000)
        self.assertEqual(snapshot["compression_threshold_percent"], 75)
        self.assertEqual(snapshot["compression_progress_percent"], 33.75)
        self.assertEqual(snapshot["remaining_tokens"], 63600)
        self.assertEqual(snapshot["compression_count"], 2)
        self.assertTrue(snapshot["compression_enabled"])
        self.assertTrue(snapshot["compacted"])

    def test_context_normalizer_rejects_cumulative_usage_only(self):
        self.assertIsNone(
            plugin_api_v3._normalize_context_snapshot(
                {"input_tokens": 50000, "prompt_tokens": 50000, "total_tokens": 90000}
            )
        )

    def test_context_route_absence_fails_closed_instead_of_estimating(self):
        with patch.object(
            plugin_api_v3._legacy,
            "_hermes_proxy",
            side_effect=HTTPException(status_code=404, detail="not found"),
        ):
            self.assertIsNone(plugin_api_v3._session_context_snapshot("session-no-context"))

    def test_changed_official_context_projects_and_deduplicates(self):
        run_id = "run-context"
        plugin_api_v3._legacy._new_run_record(run_id, "session-context", "running")
        plugin_api_v3._seed_context_baseline(
            run_id,
            {"available": True, "context_used": 1000, "context_max": 128000},
        )
        fresh = {
            "available": True,
            "context_used": 32000,
            "context_max": 128000,
            "context_percent": 25,
            "threshold_tokens": 96000,
            "remaining_tokens": 64000,
            "source": "hermes_session_context_api",
        }
        with patch.object(plugin_api_v3, "_session_context_snapshot", return_value=fresh):
            self.assertTrue(plugin_api_v3._project_session_context_if_changed(run_id))
            with plugin_api_v3._legacy._RUNS_LOCK:
                plugin_api_v3._legacy._RUNS[run_id]["context_polled_at"] = 0.0
            self.assertFalse(plugin_api_v3._project_session_context_if_changed(run_id))
        with plugin_api_v3._legacy._RUNS_LOCK:
            events = [e for e in plugin_api_v3._legacy._RUNS[run_id]["events"] if e["event"] == "context.snapshot"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["data"]["context_used"], 32000)

    def test_custom_endpoint_protocol_route_fails_closed_before_probe(self):
        config = {
            "providers": {
                "new-api": {
                    "name": "New API",
                    "api": "https://gateway.example/v1",
                    "models": {"gpt-responses": {}, "chat-model": {}},
                }
            }
        }
        options = {
            "providers": [{
                "slug": "new-api",
                "authenticated": True,
                "models": ["gpt-responses", "chat-model"],
                "capabilities": {},
            }]
        }
        route = plugin_api_v3._protocol_route_snapshot(config, options, "new-api", "gpt-responses")
        self.assertEqual(route["status"], "unresolved")
        self.assertTrue(route["requires_probe"])
        self.assertEqual(route["execution_provider"], "")

    def test_protocol_alias_is_written_through_official_config_without_touching_source(self):
        source = {
            "name": "New API",
            "api": "https://gateway.example/v1",
            "key_env": "NEW_API_KEY",
            "models": {"gpt-responses": {"context_length": 128000}},
        }
        config = {"providers": {"new-api": source}, "approvals": {"mode": "smart"}}
        writes = []

        def fake_proxy(path, method="GET", body=None, timeout=None):
            if method == "PUT":
                writes.append((path, body))
            return {"ok": True}

        with patch.object(plugin_api_v3._legacy, "_hermes_proxy", side_effect=fake_proxy):
            updated, aliases = plugin_api_v3._ensure_protocol_aliases(
                config,
                "new-api",
                "gpt-responses",
                ("codex_responses",),
            )

        alias = aliases["codex_responses"]
        self.assertEqual(source["models"], {"gpt-responses": {"context_length": 128000}})
        self.assertEqual(updated["providers"]["new-api"], source)
        self.assertEqual(updated["providers"][alias]["transport"], "codex_responses")
        self.assertEqual(updated["providers"][alias]["models"], {"gpt-responses": {"context_length": 128000}})
        self.assertEqual(writes[0][0], "/api/config")
        self.assertEqual(set(writes[0][1]["config"]), {"providers"})

    def test_real_protocol_probe_resolves_one_supported_wire_mode(self):
        config = {
            "providers": {
                "new-api": {
                    "name": "New API",
                    "api": "https://gateway.example/v1",
                    "models": {"gpt-responses": {}},
                }
            }
        }
        options = {
            "providers": [{
                "slug": "new-api",
                "authenticated": True,
                "models": ["gpt-responses"],
                "capabilities": {},
            }]
        }

        def fake_proxy(path, method="GET", body=None, timeout=None):
            return {"ok": True} if method == "PUT" else {}

        def fake_start(body, session_required=False):
            return {"id": "probe-chat", "status": "running"} if body["provider"].endswith("-chat") else {"id": "probe-responses", "status": "running"}

        def fake_wait(run_id, timeout):
            return {"status": "completed"} if run_id == "probe-responses" else {"status": "failed", "error": "chat rejected"}

        with tempfile.TemporaryDirectory() as directory, \
            patch.object(plugin_api_v3, "_PROTOCOL_FILE", pathlib.Path(directory) / "protocols.json"), \
            patch.object(plugin_api_v3, "_read_official_config", return_value=config), \
            patch.object(plugin_api_v3, "_read_official_model_options", return_value=options), \
            patch.object(plugin_api_v3._legacy, "_hermes_proxy", side_effect=fake_proxy), \
            patch.object(plugin_api_v3._legacy, "_start_native_run", side_effect=fake_start), \
            patch.object(plugin_api_v3._legacy, "_wait_run", side_effect=fake_wait):
            result = plugin_api_v3._probe_protocols_sync("new-api", "gpt-responses")

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["route"]["mode"], "codex_responses")
        self.assertTrue(result["route"]["execution_provider"].endswith("-responses"))
        self.assertFalse(result["results"]["chat_completions"]["ok"])
        self.assertTrue(result["results"]["codex_responses"]["ok"])

    def test_protocol_route_recreates_missing_managed_alias_for_actual_run(self):
        config = {
            "providers": {
                "new-api": {
                    "name": "New API",
                    "api": "https://gateway.example/v1",
                    "models": {"gpt-responses": {}},
                }
            }
        }
        options = {"providers": [{"slug": "new-api", "models": ["gpt-responses"], "capabilities": {}}]}
        with tempfile.TemporaryDirectory() as directory, \
            patch.object(plugin_api_v3, "_PROTOCOL_FILE", pathlib.Path(directory) / "protocols.json"), \
            patch.object(plugin_api_v3, "_read_official_config", return_value=config), \
            patch.object(plugin_api_v3, "_read_official_model_options", return_value=options), \
            patch.object(plugin_api_v3._legacy, "_hermes_proxy", return_value={"ok": True}) as proxy:
            plugin_api_v3._save_route_state("new-api", "gpt-responses", {
                "source_provider": "new-api",
                "source_model": "gpt-responses",
                "mode": "codex_responses",
                "status": "resolved",
                "execution_provider": "stale-alias",
            })
            route = plugin_api_v3._protocol_route_snapshot(
                config, options, "new-api", "gpt-responses", ensure_alias=True
            )

        self.assertEqual(route["status"], "resolved")
        self.assertTrue(route["execution_provider"].endswith("-responses"))
        self.assertTrue(any(call.args[0] == "/api/config" for call in proxy.call_args_list))

    def test_v3_run_replaces_source_provider_with_resolved_alias_before_official_submission(self):
        config = {
            "providers": {
                "new-api": {
                    "name": "New API",
                    "api": "https://gateway.example/v1",
                    "models": {"gpt-responses": {}},
                }
            }
        }
        options = {
            "providers": [{
                "slug": "new-api",
                "authenticated": True,
                "models": ["gpt-responses"],
                "capabilities": {},
            }]
        }
        submitted = {}

        def fake_proxy(path, method="GET", body=None, timeout=None):
            if path.startswith("/api/sessions/"):
                return {"messages": []}
            if path == "/api/config" and method == "PUT":
                return {"ok": True}
            if path == "/v1/runs" and method == "POST":
                submitted.update(body)
                return {"id": "run-responses", "status": "running"}
            return {}

        with tempfile.TemporaryDirectory() as directory, \
            patch.object(plugin_api_v3, "_PROTOCOL_FILE", pathlib.Path(directory) / "protocols.json"), \
            patch.object(plugin_api_v3, "_read_official_config", return_value=config), \
            patch.object(plugin_api_v3, "_read_official_model_options", return_value=options), \
            patch.object(plugin_api_v3._legacy, "_require_runs", return_value={"submission": True, "events": False, "stop": True, "approval": True, "steer": True}), \
            patch.object(plugin_api_v3._legacy, "_hermes_proxy", side_effect=fake_proxy):
            plugin_api_v3._save_route_state("new-api", "gpt-responses", {
                "source_provider": "new-api",
                "source_model": "gpt-responses",
                "mode": "codex_responses",
                "status": "resolved",
                "execution_provider": "stale-alias",
            })
            result = plugin_api_v3._start_native_run_v3({
                "session_id": "session-v3-route",
                "input": "route this model",
                "provider": "new-api",
                "model": "gpt-responses",
            })

        self.assertTrue(submitted["provider"].endswith("-responses"))
        self.assertEqual(submitted["model"], "gpt-responses")
        self.assertEqual(result["source_route"]["status"], "resolved")
        self.assertEqual(result["source_route"]["mode"], "codex_responses")


    def test_product_capabilities_are_explicit(self):
        caps = plugin_api_v3.product_capabilities()
        self.assertEqual(caps["version"], 3)
        self.assertEqual(caps["execution"], "Hermes official /v1/runs")
        self.assertTrue(caps["multimodal_runs"])
        self.assertTrue(caps["session_crud"])
        self.assertTrue(caps["dashboard_return_slot"])
        self.assertEqual(caps["official_plan"]["source"], "Hermes canonical todo")
        self.assertIn("/api/sessions", caps["official_plan"]["fallback"])
        self.assertIn("/api/sessions/{session_id}/context", caps["context_telemetry"]["source"])
        self.assertIn("never", caps["context_telemetry"]["fallback"])
        self.assertEqual(caps["moa_runtime_resolution"]["source"], "Hermes official /api/model/moa")


if __name__ == "__main__":
    unittest.main()
