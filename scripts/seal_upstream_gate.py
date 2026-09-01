#!/usr/bin/env python3
"""Prepare and verify the exact pinned Hermes source for Product 3 seal closure.

The real-target seal has three evidence planes: runtime acceptance, real browser
acceptance, and the official upstream public-contract gate. This script owns the
third plane. It can reuse an operator-provided Hermes source checkout or create a
small detached checkout under the seal evidence directory.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "tests" / "upstream-lock.json"


class UpstreamGateError(RuntimeError):
    pass


def run(command: list[str], *, cwd: pathlib.Path) -> None:
    print("+", " ".join(command), flush=True)
    try:
        subprocess.run(command, cwd=cwd, check=True)
    except subprocess.CalledProcessError as exc:
        raise UpstreamGateError(f"command failed with exit {exc.returncode}: {' '.join(command)}") from exc


def output(command: list[str], *, cwd: pathlib.Path) -> str:
    try:
        return subprocess.check_output(command, cwd=cwd, text=True, stderr=subprocess.STDOUT).strip()
    except subprocess.CalledProcessError as exc:
        raise UpstreamGateError(f"command failed: {' '.join(command)}: {exc.output.strip()}") from exc


def load_lock() -> dict[str, Any]:
    try:
        value = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        raise UpstreamGateError(f"cannot read {LOCK_PATH}: {exc}") from exc
    hermes = value.get("hermes") if isinstance(value, dict) else None
    if not isinstance(hermes, dict):
        raise UpstreamGateError("tests/upstream-lock.json has no Hermes lock")
    return hermes


def prepare_checkout(root: pathlib.Path, lock: dict[str, Any]) -> pathlib.Path:
    root.mkdir(parents=True, exist_ok=True)
    repo = str(lock.get("repository") or "").strip()
    pin = str(lock.get("commit") or "").strip()
    if not repo or not pin:
        raise UpstreamGateError("Hermes lock is missing repository/commit")
    git_dir = root / ".git"
    if not git_dir.exists():
        run(["git", "init"], cwd=root)
        run(["git", "remote", "add", "origin", f"https://github.com/{repo}.git"], cwd=root)
    else:
        remotes = output(["git", "remote"], cwd=root).splitlines()
        if "origin" not in remotes:
            run(["git", "remote", "add", "origin", f"https://github.com/{repo}.git"], cwd=root)
        else:
            run(["git", "remote", "set-url", "origin", f"https://github.com/{repo}.git"], cwd=root)
    run(["git", "fetch", "--depth", "1", "origin", pin], cwd=root)
    run(["git", "checkout", "--detach", "--force", "FETCH_HEAD"], cwd=root)
    return root


def write_evidence(path: pathlib.Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify the pinned Hermes upstream contracts required for Product 3 sealing")
    parser.add_argument("--hermes-root", type=pathlib.Path, default=None, help="Reuse an existing exact Hermes source checkout")
    parser.add_argument("--cache-dir", type=pathlib.Path, default=pathlib.Path(".seal/upstream/hermes"))
    parser.add_argument("--evidence", type=pathlib.Path, default=pathlib.Path(".seal/upstream.json"))
    return parser.parse_args(argv)


def close(args: argparse.Namespace) -> dict[str, Any]:
    lock = load_lock()
    evidence_path = args.evidence if args.evidence.is_absolute() else ROOT / args.evidence
    cache_dir = args.cache_dir if args.cache_dir.is_absolute() else ROOT / args.cache_dir
    hermes_root = args.hermes_root.resolve() if args.hermes_root else prepare_checkout(cache_dir, lock)

    expected = str(lock.get("commit") or "")
    actual = output(["git", "rev-parse", "HEAD"], cwd=hermes_root)
    if actual != expected:
        raise UpstreamGateError(f"Hermes source is not pinned: expected {expected}, got {actual}")

    run([sys.executable, "scripts/verify_upstreams.py", "--hermes-root", str(hermes_root)], cwd=ROOT)
    run([sys.executable, "scripts/verify_required_upstream_contracts.py", "--hermes-root", str(hermes_root)], cwd=ROOT)

    contracts = lock.get("required_contracts") if isinstance(lock.get("required_contracts"), dict) else {}
    evidence = {
        "schema": "hermes-worker-studio.upstream-gate.v1",
        "ok": True,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "repository": lock.get("repository"),
        "commit": actual,
        "version": lock.get("version"),
        "contracts": {
            "dashboard_route_scoped_exclusive_shell": {
                "verified": True,
                "upstream_issue": (contracts.get("dashboard_route_scoped_exclusive_shell") or {}).get("upstream_issue")
                if isinstance(contracts.get("dashboard_route_scoped_exclusive_shell"), dict)
                else None,
            }
        },
    }
    write_evidence(evidence_path, evidence)
    return evidence


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        evidence = close(args)
    except UpstreamGateError as exc:
        print(f"UPSTREAM SEAL GATE FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True))
    print("UPSTREAM SEAL GATE CLOSED", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
