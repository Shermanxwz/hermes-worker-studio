from __future__ import annotations

import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "hws_plugin_api_v3_minimax_seal",
    ROOT / "dashboard" / "plugin_api_v3.py",
)
assert SPEC and SPEC.loader
plugin_api_v3 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin_api_v3
SPEC.loader.exec_module(plugin_api_v3)


class MiniMaxReasoningSealTests(unittest.TestCase):
    def setUp(self):
        with plugin_api_v3._legacy._RUNS_LOCK:
            plugin_api_v3._legacy._RUNS.clear()

    def test_resolved_minimax_route_reconciles_native_wire_before_official_run(self):
        source = {
            "name": "New API",
            "api": "https://gateway.example/v1",
            "key_env": "NEW_API_KEY",
            "models": {
                "MiniMax-M3": {
                    "hws_reasoning": {
                        "supports_reasoning": True,
                        "can_disable_reasoning": False,
                        "reasoning_control": "fixed",
                    },
                    "hws_native_reasoning": "minimax_openai",
                },
            },
        }
        config = {"providers": {"new-api": source}}
        options = {
            "providers": [{
                "slug": "new-api",
                "authenticated": True,
                "models": ["MiniMax-M3"],
                "capabilities": {"MiniMax-M3": {"reasoning": True}},
            }]
        }
        submitted: dict[str, object] = {}
        config_writes: list[dict[str, object]] = []

        def fake_proxy(path, method="GET", body=None, timeout=None):
            if path.startswith("/api/sessions/"):
                return {"messages": []}
            if path == "/api/config" and method == "PUT":
                config_writes.append(body)
                return {"ok": True}
            if path == "/v1/runs" and method == "POST":
                submitted.update(body)
                return {"id": "run-minimax-seal", "status": "running"}
            return {}

        with tempfile.TemporaryDirectory() as directory, \
            patch.object(plugin_api_v3, "_PROTOCOL_FILE", pathlib.Path(directory) / "protocols.json"), \
            patch.object(plugin_api_v3, "_read_official_config", return_value=config), \
            patch.object(plugin_api_v3, "_read_official_model_options", return_value=options), \
            patch.object(
                plugin_api_v3._legacy,
                "_require_runs",
                return_value={
                    "submission": True,
                    "events": False,
                    "stop": True,
                    "approval": True,
                    "steer": True,
                },
            ), \
            patch.object(plugin_api_v3._legacy, "_hermes_proxy", side_effect=fake_proxy):
            plugin_api_v3._save_route_state("new-api", "MiniMax-M3", {
                "source_provider": "new-api",
                "source_model": "MiniMax-M3",
                "mode": "chat_completions",
                "status": "resolved",
                "execution_provider": "stale-alias",
            })
            result = plugin_api_v3._start_native_run_v3({
                "session_id": "session-minimax-seal",
                "input": "reason with native MiniMax thinking",
                "provider": "new-api",
                "model": "MiniMax-M3",
            })

        execution_provider = str(submitted["provider"])
        self.assertTrue(execution_provider.endswith("-chat"))
        self.assertEqual(submitted["model"], "MiniMax-M3")
        self.assertEqual(result["source_route"]["status"], "resolved")
        self.assertEqual(result["source_route"]["mode"], "chat_completions")
        self.assertEqual(result["source_route"]["execution_provider"], execution_provider)

        alias = config["providers"][execution_provider]
        self.assertEqual(alias["models"], source["models"])
        self.assertEqual(
            alias["extra_body"],
            {"reasoning_split": True, "thinking": {"type": "adaptive"}},
        )
        self.assertEqual(
            alias["hws_protocol_bridge"],
            {
                "source_provider": "new-api",
                "source_model": "MiniMax-M3",
                "mode": "chat_completions",
                "managed_by": "hermes-worker-studio",
            },
        )
        self.assertEqual(len(config_writes), 1, "stale/missing MiniMax alias must be reconciled before the Run")


if __name__ == "__main__":
    unittest.main()
