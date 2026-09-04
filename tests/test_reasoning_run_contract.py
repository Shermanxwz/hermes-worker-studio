from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_reasoning_plugin_api_v3", ROOT / "dashboard" / "plugin_api_v3.py")
assert SPEC and SPEC.loader
plugin_api_v3 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin_api_v3
SPEC.loader.exec_module(plugin_api_v3)


class ReasoningRunContractTests(unittest.TestCase):
    def test_runs_v3_body_preserves_concrete_reasoning_effort_for_hermes(self):
        body = {
            "session_id": "session-reasoning",
            "input": "prove the wire contract",
            "provider": "new-api",
            "model": "gpt-reasoner",
            "model_options": {"reasoning_effort": "xhigh"},
        }
        outgoing = plugin_api_v3._official_run_body_v3(body, body["session_id"], body["input"])
        self.assertEqual(outgoing["provider"], "new-api")
        self.assertEqual(outgoing["model"], "gpt-reasoner")
        self.assertEqual(outgoing["model_options"], {"reasoning_effort": "xhigh"})

    def test_runs_v3_body_does_not_invent_reasoning_when_absent(self):
        outgoing = plugin_api_v3._official_run_body_v3(
            {"session_id": "s", "input": "plain", "provider": "new-api", "model": "plain-model"},
            "s",
            "plain",
        )
        self.assertNotIn("model_options", outgoing)


if __name__ == "__main__":
    unittest.main()
