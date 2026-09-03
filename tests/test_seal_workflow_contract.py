from __future__ import annotations

import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "seal-real-target.yml"


class RealTargetSealWorkflowContractTests(unittest.TestCase):
    def test_manual_self_hosted_workflow_seals_only_exact_current_main(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        for token in (
            "workflow_dispatch:",
            "candidate_sha:",
            "Exact 40-character current main HEAD SHA already green in push CI",
            "runs-on: [self-hosted, hermes-seal]",
            "scripts/seal_close.py",
            "scripts/github_finalize_seal.py",
            "actions/upload-artifact@v4",
            "actions: read",
            "contents: read",
            "git rev-parse HEAD",
            "git fetch --no-tags origin main",
            "git rev-parse origin/main",
            ".seal/SEALED.json",
            "ref: ${{ inputs.candidate_sha }}",
            "--candidate \"${{ inputs.candidate_sha }}\"",
        ):
            self.assertIn(token, text)

        # The target host must never execute arbitrary branch/PR code or mutate GitHub state.
        for forbidden in (
            "pull_request_target:",
            "pull_request:\n",
            "push:\n",
            "pr_number:",
            "pull-requests: write",
            "contents: write",
            "merge_method:",
            "finalize:",
            "--merge-method",
            "--pr ",
        ):
            self.assertNotIn(forbidden, text)

    def test_finalizer_runs_only_after_real_target_seal_and_verdict(self) -> None:
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

    def test_browser_seal_reads_running_candidate_instead_of_only_stamping_report(self) -> None:
        spec = (ROOT / "tests" / "target_ui.spec.mjs").read_text(encoding="utf-8")
        for token in (
            "HWS_CANDIDATE_SHA",
            "assertRunningCandidate",
            "/api/plugins/hermes-worker-studio/product-capabilities",
            "caps?.candidate_sha",
        ):
            self.assertIn(token, spec)

    def test_target_and_final_verdict_schemas_are_consistent_end_to_end(self) -> None:
        target_schema = "hermes-worker-studio.seal-evidence.v2"
        verdict_schema = "hermes-worker-studio.seal-verdict.v2"
        acceptance = (ROOT / "scripts" / "seal_acceptance.py").read_text(encoding="utf-8")
        closer = (ROOT / "scripts" / "seal_close.py").read_text(encoding="utf-8")
        verifier = (ROOT / "scripts" / "verify_seal_evidence.py").read_text(encoding="utf-8")
        finalizer = (ROOT / "scripts" / "github_finalize_seal.py").read_text(encoding="utf-8")

        self.assertIn(f'TARGET_EVIDENCE_SCHEMA = "{target_schema}"', acceptance)
        self.assertIn(f'TARGET_EVIDENCE_SCHEMA = "{target_schema}"', closer)
        self.assertIn(f'TARGET_EVIDENCE_SCHEMA = "{target_schema}"', verifier)
        self.assertIn(f'SEAL_VERDICT_SCHEMA = "{verdict_schema}"', closer)
        self.assertIn(f'SEAL_VERDICT_SCHEMA = "{verdict_schema}"', verifier)
        self.assertIn(f'SEAL_VERDICT_SCHEMA = "{verdict_schema}"', finalizer)
        self.assertNotIn("seal-evidence.v1", verifier)
        self.assertNotIn("seal-verdict.v1", finalizer)

    def test_github_finalizer_is_read_only_exact_main_verification(self) -> None:
        finalizer = (ROOT / "scripts" / "github_finalize_seal.py").read_text(encoding="utf-8")
        for token in (
            'CANONICAL_BRANCH = "main"',
            'CI_WORKFLOW_PATH = ".github/workflows/ci.yml"',
            "_require_exact_main",
            "_require_green_exact_main_ci",
            '"event": "push"',
            '"read_only": True',
        ):
            self.assertIn(token, finalizer)
        for forbidden in ("markPullRequestReadyForReview", "/pulls/{pr_number}/merge", "merge_method"):
            self.assertNotIn(forbidden, finalizer)


if __name__ == "__main__":
    unittest.main()
