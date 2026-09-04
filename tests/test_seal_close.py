from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hws_seal_close", ROOT / "scripts" / "seal_close.py")
assert SPEC and SPEC.loader
seal = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = seal
SPEC.loader.exec_module(seal)

CANDIDATE = "a" * 40


def args(root: pathlib.Path, *, provider: str = "", model: str = "", reasoning_effort: str = "") -> argparse.Namespace:
    return argparse.Namespace(
        url="http://127.0.0.1:19119",
        api_key="",
        provider=provider,
        model=model,
        reasoning_effort=reasoning_effort,
        http_timeout=30.0,
        run_timeout=180.0,
        evidence_dir=root / ".seal",
        hermes_root=None,
        skip_install=False,
        skip_node_install=False,
        skip_browser_install=False,
    )


class SealCloseContractTests(unittest.TestCase):
    def test_current_evidence_schemas_are_explicit(self) -> None:
        self.assertEqual(seal.TARGET_EVIDENCE_SCHEMA, "hermes-worker-studio.seal-evidence.v2")
        self.assertEqual(seal.SEAL_VERDICT_SCHEMA, "hermes-worker-studio.seal-verdict.v2")

    def test_provider_and_model_must_be_supplied_together(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(seal, "require_clean_candidate", return_value=CANDIDATE):
            with self.assertRaises(seal.SealCloseError):
                seal.close(args(pathlib.Path(tmp), provider="custom", model=""))
            with self.assertRaises(seal.SealCloseError):
                seal.close(args(pathlib.Path(tmp), provider="", model="model-only"))

    def test_reasoning_effort_requires_explicit_provider_and_model(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(seal, "require_clean_candidate", return_value=CANDIDATE):
            with self.assertRaises(seal.SealCloseError):
                seal.close(args(pathlib.Path(tmp), reasoning_effort="xhigh"))
            with self.assertRaises(seal.SealCloseError):
                seal.close(args(pathlib.Path(tmp), provider="newapi", model="gpt-reasoner", reasoning_effort="auto"))


if __name__ == "__main__":
    unittest.main()
