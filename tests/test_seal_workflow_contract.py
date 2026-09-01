from __future__ import annotations

import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "seal-real-target.yml"


class RealTargetSealWorkflowContractTests(unittest.TestCase):
    def test_manual_self_hosted_workflow_preserves_exact_candidate_gate(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        for token in (
            "workflow_dispatch:",
            "candidate_sha:",
            "runs-on: [self-hosted, hermes-seal]",
            "scripts/seal_close.py",
            "scripts/github_finalize_seal.py",
            "actions/upload-artifact@v4",
            "actions: read",
            "contents: write",
            "pull-requests: write",
            "git rev-parse HEAD",
            ".seal/SEALED.json",
        ):
            self.assertIn(token, text)

        # The target host must never execute arbitrary PR/push code automatically.
        self.assertNotIn("pull_request_target:", text)
        self.assertNotIn("pull_request:\n", text)
        self.assertNotIn("push:\n", text)

    def test_finalizer_runs_only_after_real_target_seal_step(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        close_pos = text.index("python scripts/seal_close.py")
        verdict_pos = text.index(".seal/SEALED.json")
        finalize_pos = text.index("python scripts/github_finalize_seal.py")
        self.assertLess(close_pos, verdict_pos)
        self.assertLess(verdict_pos, finalize_pos)


if __name__ == "__main__":
    unittest.main()
