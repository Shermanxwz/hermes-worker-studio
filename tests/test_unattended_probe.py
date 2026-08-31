from __future__ import annotations

import importlib.util
import pathlib
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_unattended_plugin_api", ROOT / "dashboard" / "plugin_api.py")
assert SPEC and SPEC.loader
plugin_api = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin_api
SPEC.loader.exec_module(plugin_api)


class UnattendedProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        app = FastAPI()
        app.include_router(plugin_api.router, prefix="/api/plugins/hermes-worker-studio")
        cls.client = TestClient(app)
        cls.base = "/api/plugins/hermes-worker-studio/hermes/unattended/probe"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()

    def test_explicit_confirmation_is_mandatory(self) -> None:
        response = self.client.post(self.base, json={})
        self.assertEqual(response.status_code, 400)
        self.assertIn("confirmation", response.text)

    def test_completed_hermes_run_plus_marker_returns_ready_and_cleans_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            marker_path: pathlib.Path | None = None

            def hermes_proxy(path, method="GET", body=None):
                nonlocal marker_path
                if path == "/v1/runs" and method == "POST":
                    prompt = str((body or {}).get("input") or "")
                    match = re.search(r">\s+([^'\"\s]+)", prompt)
                    self.assertIsNotNone(match, prompt)
                    marker_path = pathlib.Path(match.group(1))
                    marker_path.write_text("HERMES_WORKER_STUDIO_UNATTENDED_OK", encoding="utf-8")
                    return {"run_id": "run-unattended", "status": "started"}
                if path == "/v1/runs/run-unattended":
                    return {"run_id": "run-unattended", "status": "completed", "output": "done"}
                raise AssertionError((path, method, body))

            with (
                patch.object(plugin_api, "_run_support", return_value={"submission": True}),
                patch.object(plugin_api, "_hermes_proxy", side_effect=hermes_proxy),
                patch.object(plugin_api.tempfile, "gettempdir", return_value=tmp),
            ):
                response = self.client.post(
                    self.base,
                    json={"confirm": "RUN_SAFE_UNATTENDED_PROBE"},
                )

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["status"], "UNATTENDED_READY")
            self.assertEqual(payload["run_id"], "run-unattended")
            self.assertTrue(payload["marker_verified"])
            self.assertIsNotNone(marker_path)
            self.assertFalse(marker_path.exists(), "probe marker must be removed in finally")

    def test_completed_run_without_marker_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            def hermes_proxy(path, method="GET", body=None):
                if path == "/v1/runs" and method == "POST":
                    return {"run_id": "run-no-marker", "status": "started"}
                if path == "/v1/runs/run-no-marker":
                    return {"run_id": "run-no-marker", "status": "completed", "output": "claimed done"}
                raise AssertionError((path, method, body))

            with (
                patch.object(plugin_api, "_run_support", return_value={"submission": True}),
                patch.object(plugin_api, "_hermes_proxy", side_effect=hermes_proxy),
                patch.object(plugin_api.tempfile, "gettempdir", return_value=tmp),
            ):
                response = self.client.post(
                    self.base,
                    json={"confirm": "RUN_SAFE_UNATTENDED_PROBE"},
                )

            self.assertEqual(response.status_code, 409, response.text)
            self.assertIn("marker", response.text.lower())

    def test_native_runs_are_required_for_probe(self) -> None:
        with patch.object(plugin_api, "_run_support", return_value={"submission": False}):
            response = self.client.post(
                self.base,
                json={"confirm": "RUN_SAFE_UNATTENDED_PROBE"},
            )
        self.assertEqual(response.status_code, 409)
        self.assertIn("Runs API", response.text)


if __name__ == "__main__":
    unittest.main()
