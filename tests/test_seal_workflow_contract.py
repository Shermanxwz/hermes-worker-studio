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
            "pr_number:",
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
            "ref: ${{ inputs.candidate_sha }}",
            "--candidate \"${{ inputs.candidate_sha }}\"",
        ):
            self.assertIn(token, text)

        # The target host must never execute arbitrary PR/push code automatically.
        self.assertNotIn("pull_request_target:", text)
        self.assertNotIn("pull_request:\n", text)
        self.assertNotIn("push:\n", text)

        # A historical PR number must never be silently reused for a future seal.
        before_candidate = text.split("candidate_sha:", 1)[0]
        pr_input = before_candidate.split("pr_number:", 1)[1]
        self.assertIn("required: true", pr_input)
        self.assertNotIn("default:", pr_input)

    def test_finalizer_runs_only_after_real_target_seal_step(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        close_pos = text.index("python scripts/seal_close.py")
        verdict_pos = text.index(".seal/SEALED.json")
        finalize_pos = text.index("python scripts/github_finalize_seal.py")
        self.assertLess(close_pos, verdict_pos)
        self.assertLess(verdict_pos, finalize_pos)

    def test_browser_seal_contract_requires_all_three_viewport_projects(self) -> None:
        playwright = (ROOT / "playwright.seal.config.mjs").read_text(encoding="utf-8")
        verifier = (ROOT / "scripts" / "verify_seal_evidence.py").read_text(encoding="utf-8")
        for project in ("desktop-chromium", "mobile-chromium", "mobile-landscape-chromium"):
            self.assertIn(project, playwright)
            self.assertIn(project, verifier)


if __name__ == "__main__":
    unittest.main()
