from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "hws_github_finalize_seal", ROOT / "scripts" / "github_finalize_seal.py"
)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)

CANDIDATE = "a" * 40


class GitHubSealFinalizerTests(unittest.TestCase):
    def _verdict(self, directory: pathlib.Path, *, eligible: bool = True, candidate: str = CANDIDATE) -> pathlib.Path:
        path = directory / "SEALED.json"
        path.write_text(
            json.dumps(
                {
                    "schema": "hermes-worker-studio.seal-verdict.v1",
                    "candidate_sha": candidate,
                    "eligible": eligible,
                }
            ),
            encoding="utf-8",
        )
        return path

    def _args(self, evidence: pathlib.Path, **patches):
        values = {
            "repo": "Shermanxwz/hermes-worker-studio",
            "pr": 4,
            "candidate": CANDIDATE,
            "evidence": evidence,
            "merge_method": "merge",
            "token": "token",
            "dry_run": False,
        }
        values.update(patches)
        return argparse.Namespace(**values)

    def test_load_verdict_requires_exact_candidate_and_eligibility(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            with self.assertRaises(mod.FinalizeError):
                mod._load_verdict(self._verdict(root, eligible=False), CANDIDATE)
            with self.assertRaises(mod.FinalizeError):
                mod._load_verdict(self._verdict(root, candidate="b" * 40), CANDIDATE)

    def test_exact_head_ci_uses_latest_matching_ci_run(self):
        payload = {
            "workflow_runs": [
                {"id": 1, "name": "CI", "head_sha": CANDIDATE, "run_number": 10, "status": "completed", "conclusion": "failure"},
                {"id": 2, "name": "Other", "head_sha": CANDIDATE, "run_number": 99, "status": "completed", "conclusion": "success"},
                {"id": 3, "name": "CI", "head_sha": CANDIDATE, "run_number": 11, "status": "completed", "conclusion": "success"},
            ]
        }
        with patch.object(mod, "_request", return_value=payload):
            row = mod._require_green_exact_head_ci("owner/repo", CANDIDATE, "token")
        self.assertEqual(row["id"], 3)

    def test_exact_head_ci_fails_when_latest_matching_run_is_not_green(self):
        payload = {
            "workflow_runs": [
                {"id": 1, "name": "CI", "head_sha": CANDIDATE, "run_number": 10, "status": "completed", "conclusion": "success"},
                {"id": 2, "name": "CI", "head_sha": CANDIDATE, "run_number": 11, "status": "in_progress", "conclusion": None},
            ]
        }
        with patch.object(mod, "_request", return_value=payload), self.assertRaises(mod.FinalizeError):
            mod._require_green_exact_head_ci("owner/repo", CANDIDATE, "token")

    def test_finalize_dry_run_never_mutates_pr(self):
        with tempfile.TemporaryDirectory() as tmp:
            evidence = self._verdict(pathlib.Path(tmp))
            pr = {"state": "open", "draft": True, "head": {"sha": CANDIDATE}, "node_id": "PR_node"}
            ci = {"id": 42, "run_number": 110, "status": "completed", "conclusion": "success"}
            with patch.object(mod, "_get_pr", return_value=pr), patch.object(
                mod, "_require_green_exact_head_ci", return_value=ci
            ), patch.object(mod, "_mark_ready") as ready, patch.object(mod, "_merge") as merge:
                result = mod.finalize(self._args(evidence, dry_run=True, token=""))
            self.assertTrue(result["seal_eligible"])
            self.assertFalse(result["merged"])
            ready.assert_not_called()
            merge.assert_not_called()

    def test_finalize_rechecks_head_after_mark_ready_before_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            evidence = self._verdict(pathlib.Path(tmp))
            draft = {"state": "open", "draft": True, "head": {"sha": CANDIDATE}, "node_id": "PR_node"}
            ready = {"state": "open", "draft": False, "head": {"sha": CANDIDATE}, "node_id": "PR_node"}
            ci = {"id": 42, "run_number": 110, "status": "completed", "conclusion": "success"}
            with patch.object(mod, "_get_pr", side_effect=[draft, ready]) as get_pr, patch.object(
                mod, "_require_green_exact_head_ci", return_value=ci
            ), patch.object(mod, "_mark_ready") as mark_ready, patch.object(
                mod, "_merge", return_value={"merged": True, "sha": "m" * 40, "message": "ok"}
            ) as merge:
                result = mod.finalize(self._args(evidence))
            self.assertEqual(get_pr.call_count, 2)
            mark_ready.assert_called_once()
            merge.assert_called_once()
            self.assertTrue(result["ready_transitioned"])
            self.assertTrue(result["merged"])


if __name__ == "__main__":
    unittest.main()
