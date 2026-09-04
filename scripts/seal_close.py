#!/usr/bin/env python3
"""One-command Product 3 real-target seal closure.

Run this from the exact candidate checkout on the Hermes target machine. It
verifies the exact pinned official Hermes public contracts, atomically installs
that commit (unless explicitly skipped), runs the real Hermes execution/todo
acceptance, runs desktop + portrait-mobile + compact-landscape Playwright
acceptance, stamps the exact candidate commit, and invokes the independent
three-plane evidence verifier. It never changes PR state or merges code.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

SEAL_VERDICT_SCHEMA = "hermes-worker-studio.seal-verdict.v2"
TARGET_EVIDENCE_SCHEMA = "hermes-worker-studio.seal-evidence.v2"


class SealCloseError(RuntimeError):
    pass


def run(command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    print("+", " ".join(command), flush=True)
    try:
        subprocess.run(command, cwd=cwd, env=env, check=True)
    except subprocess.CalledProcessError as exc:
        raise SealCloseError(f"command failed with exit {exc.returncode}: {' '.join(command)}") from exc


def git_output(root: Path, *args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), *args],
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as exc:
        raise SealCloseError(f"git {' '.join(args)} failed: {exc.output.strip()}") from exc


def require_clean_candidate(root: Path) -> str:
    candidate = git_output(root, "rev-parse", "HEAD")
    dirty = git_output(root, "status", "--porcelain", "--untracked-files=no")
    if dirty:
        raise SealCloseError("tracked working tree is dirty; commit or revert changes before sealing")
    if len(candidate) != 40 or any(ch not in "0123456789abcdef" for ch in candidate.lower()):
        raise SealCloseError(f"unexpected candidate SHA: {candidate!r}")
    return candidate


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SealCloseError(f"cannot read generated evidence {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SealCloseError(f"generated evidence root is not an object: {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Close Hermes Worker Studio Product 3 real-target seal evidence")
    parser.add_argument("--url", default=os.getenv("HWS_DASHBOARD_URL", "http://127.0.0.1:19119"))
    parser.add_argument("--api-key", default=os.getenv("API_SERVER_KEY", ""))
    parser.add_argument("--provider", default=os.getenv("HWS_SEAL_PROVIDER", ""))
    parser.add_argument("--model", default=os.getenv("HWS_SEAL_MODEL", ""))
    parser.add_argument("--reasoning-effort", default=os.getenv("HWS_SEAL_REASONING_EFFORT", ""), help="Optional concrete reasoning effort for the real Run; requires provider/model")
    parser.add_argument("--http-timeout", type=float, default=30.0)
    parser.add_argument("--run-timeout", type=float, default=180.0)
    parser.add_argument("--evidence-dir", type=Path, default=Path(".seal"))
    parser.add_argument("--hermes-root", type=Path, default=None, help="Reuse an exact pinned Hermes source checkout for the upstream contract gate")
    parser.add_argument("--skip-install", action="store_true", help="Do not run scripts/install.sh; loaded target candidate must still match")
    parser.add_argument("--skip-node-install", action="store_true", help="Assume npm dependencies are already installed")
    parser.add_argument("--skip-browser-install", action="store_true", help="Assume Playwright Chromium is already installed")
    return parser.parse_args(argv)


def close(args: argparse.Namespace) -> dict[str, Any]:
    root = Path(__file__).resolve().parents[1]
    candidate = require_clean_candidate(root)
    provider = str(args.provider or "").strip()
    model = str(args.model or "").strip()
    reasoning_effort = str(args.reasoning_effort or "").strip()
    if bool(provider) != bool(model):
        raise SealCloseError("--provider and --model must be supplied together, or both omitted, so the seal cannot silently test a different route")
    if reasoning_effort and not (provider and model):
        raise SealCloseError("--reasoning-effort requires explicit --provider and --model")
    if reasoning_effort.lower() == "auto":
        raise SealCloseError("--reasoning-effort must be a concrete non-Auto value")

    evidence_dir = args.evidence_dir if args.evidence_dir.is_absolute() else root / args.evidence_dir
    upstream_path = evidence_dir / "upstream.json"
    target_path = evidence_dir / "target.json"
    ui_path = evidence_dir / "ui-report.json"
    verdict_path = evidence_dir / "SEALED.json"
    evidence_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["HWS_DASHBOARD_URL"] = args.url
    env["HWS_CANDIDATE_SHA"] = candidate
    if args.api_key:
        env["API_SERVER_KEY"] = args.api_key
    if provider:
        env["HWS_SEAL_PROVIDER"] = provider
        env["HWS_SEAL_MODEL"] = model
    if reasoning_effort:
        env["HWS_SEAL_REASONING_EFFORT"] = reasoning_effort

    # Gate 0: official upstream semantics. No install/browser/model work should
    # happen if the pinned Hermes revision still lacks a release-blocking SDK
    # contract such as route-scoped exclusive Dashboard shell takeover.
    upstream_gate = [
        sys.executable,
        "scripts/seal_upstream_gate.py",
        "--evidence",
        str(upstream_path),
        "--cache-dir",
        str(evidence_dir / "upstream" / "hermes"),
    ]
    if args.hermes_root:
        upstream_gate.extend(["--hermes-root", str(args.hermes_root)])
    run(upstream_gate, cwd=root, env=env)
    upstream = load_json(upstream_path)
    if upstream.get("ok") is not True:
        raise SealCloseError("official Hermes upstream contract evidence is not green")

    if not args.skip_install:
        run(["bash", "scripts/install.sh"], cwd=root, env=env)

    acceptance = [
        sys.executable,
        "scripts/seal_acceptance.py",
        "--url",
        args.url,
        "--http-timeout",
        str(args.http_timeout),
        "--run-timeout",
        str(args.run_timeout),
        "--run",
        "--evidence",
        str(target_path),
    ]
    if provider:
        acceptance.extend(["--provider", provider, "--model", model])
    if reasoning_effort:
        acceptance.extend(["--reasoning-effort", reasoning_effort])
    run(acceptance, cwd=root, env=env)

    target = load_json(target_path)
    if target.get("schema") != TARGET_EVIDENCE_SCHEMA:
        raise SealCloseError(f"target evidence schema drifted: {target.get('schema')!r}")
    caps = ((target.get("checks") or {}).get("product_capabilities") or {}) if isinstance(target.get("checks"), dict) else {}
    loaded_candidate = str(caps.get("candidate_sha") or "") if isinstance(caps, dict) else ""
    if loaded_candidate != candidate:
        raise SealCloseError(
            "running Dashboard did not load the installed candidate: "
            f"expected {candidate}, product-capabilities reported {loaded_candidate or '<missing>'}. "
            "Restart/refresh the Hermes Dashboard/plugin runtime and run seal_close.py again."
        )
    target["candidate_sha"] = candidate
    target["installed_candidate_verified"] = True
    write_json(target_path, target)

    if not args.skip_node_install:
        run(["npm", "install", "--ignore-scripts", "--no-fund", "--package-lock=false"], cwd=root, env=env)
    if not args.skip_browser_install:
        run(["npx", "playwright", "install", "chromium"], cwd=root, env=env)

    env["HWS_UI_EVIDENCE"] = str(ui_path)
    run(["npm", "run", "seal:ui"], cwd=root, env=env)
    ui = load_json(ui_path)
    ui["candidate_sha"] = candidate
    ui["dashboard_url"] = args.url
    write_json(ui_path, ui)

    run(
        [
            sys.executable,
            "scripts/verify_seal_evidence.py",
            "--target",
            str(target_path),
            "--ui",
            str(ui_path),
            "--upstream",
            str(upstream_path),
            "--candidate",
            candidate,
            "--write",
            str(verdict_path),
        ],
        cwd=root,
        env=env,
    )
    verdict = load_json(verdict_path)
    if verdict.get("schema") != SEAL_VERDICT_SCHEMA:
        raise SealCloseError(f"final seal verdict schema drifted: {verdict.get('schema')!r}")
    if verdict.get("candidate_sha") != candidate:
        raise SealCloseError("final seal verdict candidate_sha does not match the exact checked-out candidate")
    if verdict.get("eligible") is not True:
        raise SealCloseError(f"final evidence verifier did not close candidate {candidate}")
    return verdict


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        verdict = close(args)
    except SealCloseError as exc:
        print(f"SEAL CLOSE FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(verdict, ensure_ascii=False, indent=2, sort_keys=True))
    print(f"SEAL CANDIDATE ELIGIBLE: {verdict['candidate_sha']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
