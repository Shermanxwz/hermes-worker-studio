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

    def test_product_capabilities_are_explicit(self):
        caps = plugin_api_v3.product_capabilities()
        self.assertEqual(caps["version"], 3)
        self.assertEqual(caps["execution"], "Hermes official /v1/runs")
        self.assertTrue(caps["multimodal_runs"])
        self.assertTrue(caps["session_crud"])
        self.assertTrue(caps["dashboard_return_slot"])


if __name__ == "__main__":
    unittest.main()
