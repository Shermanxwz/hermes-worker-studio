from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_verify_seal", ROOT / "scripts" / "verify_seal_evidence.py")
assert SPEC and SPEC.loader
seal = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = seal
SPEC.loader.exec_module(seal)

CANDIDATE = "a" * 40
HERMES_PIN = seal.LOCK["hermes"]["commit"]


def good_upstream():
    return {
        "schema": "hermes-worker-studio.upstream-gate.v1",
        "ok": True,
        "repository": "NousResearch/hermes-agent",
        "commit": HERMES_PIN,
        "version": seal.LOCK["hermes"]["version"],
        "contracts": {
            "dashboard_route_scoped_exclusive_shell": {
                "verified": True,
                "upstream_issue": "https://github.com/NousResearch/hermes-agent/issues/100149",
            }
        },
    }


def good_target():
    return {
        "schema": seal.TARGET_EVIDENCE_SCHEMA,
        "candidate_sha": CANDIDATE,
        "installed_candidate_verified": True,
        "ok": True,
        "started_at": 1,
        "finished_at": 2,
        "checks": {
            "health": {"ok": True},
            "integration": {
                "hermes": {
                    "execution_plane": "official_runs",
                    "worker_plane": "PluginContext.subagent_lifecycle",
                    "model_catalog": "/api/model/options",
                }
            },
            "product_capabilities": {
                "version": 3,
                "execution": "Hermes official /v1/runs",
                "official_plan": {"source": "Hermes canonical todo"},
                "model_protocols": {
                    "per_model": True,
                    "probe": "first-use or explicit real Hermes /v1/runs for Chat Completions and Responses",
                    "unresolved": "fail closed; no model-name or URL guessing",
                },
            },
            "session_crud": {
                "created": True,
                "renamed": True,
                "archived": True,
                "unarchived": True,
                "deleted": True,
            },
            "real_run": {
                "provider": "official",
                "model": "main-model",
                "status": "completed",
                "marker_verified": True,
                "execution_route": {
                    "provider": "official",
                    "model": "main-model",
                    "mode": "",
                    "status": "native",
                    "execution_provider": "official",
                    "source": "hermes_official_provider_runtime",
                },
                "canonical_revisions": [1, 2, 3, 4],
                "canonical_revision_count": 4,
                "final_todo_count": 3,
                "final_statuses": ["completed", "completed", "completed"],
                "projection_events": [{"event": "todo.snapshot", "source": "hermes_session_api"}],
            },
        },
    }


def good_ui():
    product_title = "Worker Studio product shell is usable at the real target"
    return {
        "candidate_sha": CANDIDATE,
        "config": {
            "projects": [
                {"name": "desktop-chromium"},
                {"name": "mobile-chromium"},
                {"name": "mobile-landscape-chromium"},
            ]
        },
        "stats": {"expected": 4, "skipped": 2, "unexpected": 0, "flaky": 0, "startTime": "now"},
        "suites": [
            {
                "title": "target_ui.spec.mjs",
                "specs": [
                    {
                        "title": product_title,
                        "tests": [{"projectName": "desktop-chromium", "results": [{"status": "passed"}]}],
                    },
                    {
                        "title": "native Hermes Dashboard keeps the Worker Studio return path",
                        "tests": [{"projectName": "desktop-chromium", "results": [{"status": "passed"}]}],
                    },
                    {
                        "title": product_title,
                        "tests": [{"projectName": "mobile-chromium", "results": [{"status": "passed"}]}],
                    },
                    {
                        "title": product_title,
                        "tests": [{"projectName": "mobile-landscape-chromium", "results": [{"status": "passed"}]}],
                    },
                ],
            }
        ],
    }


class SealEvidenceVerifierTests(unittest.TestCase):
    def test_green_evidence_closes(self):
        verdict = seal.validate(good_target(), good_ui(), good_upstream(), CANDIDATE)
        self.assertTrue(verdict["eligible"])
        self.assertEqual(verdict["errors"], [])
        self.assertEqual(verdict["upstream_commit"], HERMES_PIN)
        self.assertEqual(verdict["schema"], seal.SEAL_VERDICT_SCHEMA)

    def test_old_target_schema_or_unverified_install_blocks_seal(self):
        target = good_target()
        target["schema"] = "hermes-worker-studio.seal-evidence.v1"
        target["installed_candidate_verified"] = False
        verdict = seal.validate(target, good_ui(), good_upstream(), CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("target evidence schema" in error for error in verdict["errors"]))
        self.assertTrue(any("loaded installed candidate" in error for error in verdict["errors"]))

    def test_candidate_mismatch_fails_both_evidence_planes(self):
        target = good_target()
        ui = good_ui()
        target["candidate_sha"] = "b" * 40
        ui["candidate_sha"] = "c" * 40
        verdict = seal.validate(target, ui, good_upstream(), CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("target evidence candidate_sha" in error for error in verdict["errors"]))
        self.assertTrue(any("browser evidence candidate_sha" in error for error in verdict["errors"]))

    def test_incomplete_todo_or_failed_browser_blocks_seal(self):
        target = good_target()
        ui = good_ui()
        target["checks"]["real_run"]["final_statuses"][1] = "pending"
        ui["stats"]["unexpected"] = 1
        ui["suites"][0]["specs"][0]["tests"][0]["results"][0]["status"] = "failed"
        verdict = seal.validate(target, ui, good_upstream(), CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("not fully completed" in error for error in verdict["errors"]))
        self.assertTrue(any("unexpected" in error for error in verdict["errors"]))
        self.assertTrue(any("failed result" in error for error in verdict["errors"]))

    def test_missing_or_unresolved_execution_route_blocks_seal(self):
        target = good_target()
        target["checks"]["real_run"]["execution_route"] = {
            "provider": "official",
            "model": "main-model",
            "status": "unresolved",
            "execution_provider": "",
        }
        verdict = seal.validate(target, good_ui(), good_upstream(), CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("route is not final/executable" in error for error in verdict["errors"]))
        self.assertTrue(any("no execution_provider" in error for error in verdict["errors"]))

    def test_missing_landscape_browser_project_blocks_seal(self):
        ui = good_ui()
        ui["config"]["projects"] = [
            row for row in ui["config"]["projects"] if row["name"] != "mobile-landscape-chromium"
        ]
        verdict = seal.validate(good_target(), ui, good_upstream(), CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("mobile-landscape-chromium" in error for error in verdict["errors"]))

    def test_skipped_required_viewport_blocks_seal(self):
        ui = good_ui()
        landscape = ui["suites"][0]["specs"][3]["tests"][0]["results"][0]
        landscape["status"] = "skipped"
        verdict = seal.validate(good_target(), ui, good_upstream(), CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("mobile-landscape-chromium product-shell" in error for error in verdict["errors"]))

    def test_skipped_desktop_native_return_blocks_seal(self):
        ui = good_ui()
        native = ui["suites"][0]["specs"][1]["tests"][0]["results"][0]
        native["status"] = "skipped"
        verdict = seal.validate(good_target(), ui, good_upstream(), CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("desktop-chromium native-return" in error for error in verdict["errors"]))

    def test_missing_official_exclusive_shell_contract_blocks_seal(self):
        upstream = good_upstream()
        upstream["contracts"]["dashboard_route_scoped_exclusive_shell"]["verified"] = False
        verdict = seal.validate(good_target(), good_ui(), upstream, CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("exclusive Dashboard shell" in error for error in verdict["errors"]))

    def test_upstream_pin_mismatch_blocks_seal(self):
        upstream = good_upstream()
        upstream["commit"] = "b" * 40
        verdict = seal.validate(good_target(), good_ui(), upstream, CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("pinned Hermes revision" in error for error in verdict["errors"]))


if __name__ == "__main__":
    unittest.main()
