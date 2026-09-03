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
    def _verdict(
        self,
        directory: pathlib.Path,
        *,
        eligible: bool = True,
        candidate: str = CANDIDATE,
        schema: str = mod.SEAL_VERDICT_SCHEMA,
    ) -> pathlib.Path:
        path = directory / "SEALED.json"
        path.write_text(
            json.dumps(
                {
                    "schema": schema,
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
            "candidate": CANDIDATE,
            "evidence": evidence,
            "token": "token",
        }
        values.update(patches)
        return argparse.Namespace(**values)

    def test_load_verdict_requires_current_schema_exact_candidate_and_eligibility(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            with self.assertRaises(mod.FinalizeError):
                mod._load_verdict(self._verdict(root, eligible=False), CANDIDATE)
            with self.assertRaises(mod.FinalizeError):
                mod._load_verdict(self._verdict(root, candidate="b" * 40), CANDIDATE)
            with self.assertRaises(mod.FinalizeError):
                mod._load_verdict(
                    self._verdict(root, schema="hermes-worker-studio.seal-verdict.v1"),
                    CANDIDATE,
                )

    def test_exact_main_requires_default_main_and_exact_candidate(self):
        good_repo = {"default_branch": "main"}
        good_branch = {"name": "main", "commit": {"sha": CANDIDATE}}
        with patch.object(mod, "_request", side_effect=[good_repo, good_branch]):
            branch = mod._require_exact_main("owner/repo", CANDIDATE, "token")
        self.assertEqual(branch["commit"]["sha"], CANDIDATE)

        with patch.object(mod, "_request", return_value={"default_branch": "develop"}), self.assertRaises(mod.FinalizeError):
            mod._require_exact_main("owner/repo", CANDIDATE, "token")

        with patch.object(
            mod,
            "_request",
            side_effect=[good_repo, {"name": "main", "commit": {"sha": "b" * 40}}],
        ), self.assertRaises(mod.FinalizeError):
            mod._require_exact_main("owner/repo", CANDIDATE, "token")

    def test_exact_main_ci_uses_latest_matching_canonical_workflow(self):
        payload = {
            "workflow_runs": [
                {
                    "id": 1,
                    "name": "CI",
                    "path": mod.CI_WORKFLOW_PATH,
                    "head_sha": CANDIDATE,
                    "head_branch": "main",
                    "event": "push",
                    "run_number": 10,
                    "status": "completed",
                    "conclusion": "failure",
                },
                {
                    "id": 2,
                    "name": "CI",
                    "path": ".github/workflows/lookalike.yml",
                    "head_sha": CANDIDATE,
                    "head_branch": "main",
                    "event": "push",
                    "run_number": 99,
                    "status": "completed",
                    "conclusion": "success",
                },
                {
                    "id": 3,
                    "name": "CI",
                    "path": mod.CI_WORKFLOW_PATH,
                    "head_sha": CANDIDATE,
                    "head_branch": "main",
                    "event": "push",
                    "run_number": 11,
                    "status": "completed",
                    "conclusion": "success",
                },
            ]
        }
        with patch.object(mod, "_request", return_value=payload):
            row = mod._require_green_exact_main_ci("owner/repo", CANDIDATE, "token")
        self.assertEqual(row["id"], 3)

    def test_exact_main_ci_rejects_pr_or_noncanonical_workflow_results(self):
        payload = {
            "workflow_runs": [
                {
                    "id": 1,
                    "name": "CI",
                    "path": mod.CI_WORKFLOW_PATH,
                    "head_sha": CANDIDATE,
                    "head_branch": "feature",
                    "event": "pull_request",
                    "run_number": 10,
                    "status": "completed",
                    "conclusion": "success",
                }
            ]
        }
        with patch.object(mod, "_request", return_value=payload), self.assertRaises(mod.FinalizeError):
            mod._require_green_exact_main_ci("owner/repo", CANDIDATE, "token")

    def test_finalize_is_read_only_and_binds_verdict_main_and_push_ci(self):
        with tempfile.TemporaryDirectory() as tmp:
            evidence = self._verdict(pathlib.Path(tmp))
            branch = {"name": "main", "commit": {"sha": CANDIDATE}}
            ci = {"id": 42, "run_number": 110, "status": "completed", "conclusion": "success"}
            with patch.object(mod, "_require_exact_main", return_value=branch) as main_gate, patch.object(
                mod, "_require_green_exact_main_ci", return_value=ci
            ) as ci_gate:
                result = mod.finalize(self._args(evidence))
            main_gate.assert_called_once_with("Shermanxwz/hermes-worker-studio", CANDIDATE, "token")
            ci_gate.assert_called_once_with("Shermanxwz/hermes-worker-studio", CANDIDATE, "token")
            self.assertTrue(result["finalized"])
            self.assertTrue(result["read_only"])
            self.assertEqual(result["canonical_branch"], "main")
            self.assertEqual(result["canonical_branch_sha"], CANDIDATE)
            self.assertEqual(result["seal_schema"], mod.SEAL_VERDICT_SCHEMA)


if __name__ == "__main__":
    unittest.main()
