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


def good_target():
    return {
        "schema": "hermes-worker-studio.seal-evidence.v1",
        "candidate_sha": CANDIDATE,
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
            },
            "session_crud": {
                "created": True,
                "renamed": True,
                "archived": True,
                "unarchived": True,
                "deleted": True,
            },
            "real_run": {
                "status": "completed",
                "marker_verified": True,
                "canonical_revisions": [1, 2, 3, 4],
                "canonical_revision_count": 4,
                "final_todo_count": 3,
                "final_statuses": ["completed", "completed", "completed"],
                "projection_events": [{"event": "todo.snapshot", "source": "hermes_session_api"}],
            },
        },
    }


def good_ui():
    return {
        "candidate_sha": CANDIDATE,
        "config": {"projects": [{"name": "desktop-chromium"}, {"name": "mobile-chromium"}]},
        "stats": {"expected": 3, "skipped": 1, "unexpected": 0, "flaky": 0, "startTime": "now"},
        "suites": [
            {
                "title": "target_ui.spec.mjs",
                "specs": [
                    {
                        "title": "Worker Studio product shell is usable at the real target",
                        "tests": [{"projectName": "desktop-chromium", "results": [{"status": "passed"}]}],
                    },
                    {
                        "title": "native Hermes Dashboard keeps the Worker Studio return path",
                        "tests": [{"projectName": "desktop-chromium", "results": [{"status": "passed"}]}],
                    },
                    {
                        "title": "Worker Studio product shell is usable at the real target",
                        "tests": [{"projectName": "mobile-chromium", "results": [{"status": "passed"}]}],
                    },
                ],
            }
        ],
    }


class SealEvidenceVerifierTests(unittest.TestCase):
    def test_green_evidence_closes(self):
        verdict = seal.validate(good_target(), good_ui(), CANDIDATE)
        self.assertTrue(verdict["eligible"])
        self.assertEqual(verdict["errors"], [])

    def test_candidate_mismatch_fails_both_evidence_planes(self):
        target = good_target()
        ui = good_ui()
        target["candidate_sha"] = "b" * 40
        ui["candidate_sha"] = "c" * 40
        verdict = seal.validate(target, ui, CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("target evidence candidate_sha" in error for error in verdict["errors"]))
        self.assertTrue(any("browser evidence candidate_sha" in error for error in verdict["errors"]))

    def test_incomplete_todo_or_failed_browser_blocks_seal(self):
        target = good_target()
        ui = good_ui()
        target["checks"]["real_run"]["final_statuses"][1] = "pending"
        ui["stats"]["unexpected"] = 1
        ui["suites"][0]["specs"][0]["tests"][0]["results"][0]["status"] = "failed"
        verdict = seal.validate(target, ui, CANDIDATE)
        self.assertFalse(verdict["eligible"])
        self.assertTrue(any("not fully completed" in error for error in verdict["errors"]))
        self.assertTrue(any("unexpected" in error for error in verdict["errors"]))
        self.assertTrue(any("failed result" in error for error in verdict["errors"]))


if __name__ == "__main__":
    unittest.main()
