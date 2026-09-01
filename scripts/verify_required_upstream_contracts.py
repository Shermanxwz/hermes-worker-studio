#!/usr/bin/env python3
"""Fail-closed Product 3 verifier for upstream contracts not optional at seal time.

This is intentionally separate from verify_upstreams.py. The latter verifies the
current Hermes archive baseline. This verifier represents *release blockers*:
Product 3 must not become SEALED until the pinned official Hermes revision
contains these public contracts.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "tests" / "upstream-lock.json").read_text(encoding="utf-8"))
ISSUE = "https://github.com/NousResearch/hermes-agent/issues/100149"


def read(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:
        raise RuntimeError(f"cannot read {path}: {exc}") from exc


def git_head(root: pathlib.Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"cannot resolve Hermes HEAD: {exc.output.strip()}") from exc


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def verify_exclusive_shell(hermes: pathlib.Path, errors: list[str]) -> None:
    """Require a documented, typed and runtime-enforced route-scoped shell contract.

    The proposed spelling is `tab.shell: "exclusive"`. If upstream chooses an
    equivalent public spelling, Worker Studio should update this verifier *when
    updating the pinned Hermes revision* so semantic review happens together
    with the version bump. We deliberately do not accept undocumented heuristics.
    """
    types_path = hermes / "web" / "src" / "plugins" / "types.ts"
    app_path = hermes / "web" / "src" / "App.tsx"
    docs_path = hermes / "website" / "docs" / "user-guide" / "features" / "extending-the-dashboard.md"

    types = read(types_path)
    app = read(app_path)
    docs = read(docs_path)

    typed_shell = bool(re.search(r"\bshell\??\s*:\s*[^;\n]*exclusive", types, re.IGNORECASE))
    runtime_shell = "exclusive" in app.lower() and bool(
        re.search(r"(?:tab\??\.?shell|\.shell)\s*(?:===|==|\?)", app, re.IGNORECASE)
    )
    documented_shell = "exclusive" in docs.lower() and "shell" in docs.lower() and "override" in docs.lower()

    if not typed_shell:
        fail(errors, "Hermes Dashboard PluginManifest has no typed exclusive-shell contract")
    if not runtime_shell:
        fail(errors, "Hermes Dashboard runtime does not enforce route-scoped exclusive shell takeover")
    if not documented_shell:
        fail(errors, "Hermes Dashboard public docs do not document exclusive shell takeover for overridden routes")

    # Require upstream behavior coverage rather than trusting implementation text alone.
    test_roots = [hermes / "web" / "src", hermes / "tests"]
    test_evidence = False
    for base in test_roots:
        if not base.exists():
            continue
        for path in base.rglob("*test*"):
            if not path.is_file() or path.suffix.lower() not in {".ts", ".tsx", ".py"}:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore").lower()
            except OSError:
                continue
            if "exclusive" in text and "shell" in text and ("plugin" in text or "override" in text):
                test_evidence = True
                break
        if test_evidence:
            break
    if not test_evidence:
        fail(errors, "Hermes upstream has no behavior test proving exclusive plugin shell takeover/restoration")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify seal-blocking official Hermes public contracts")
    parser.add_argument("--hermes-root", required=True, type=pathlib.Path)
    args = parser.parse_args(argv)

    hermes = args.hermes_root.resolve()
    expected = LOCK.get("hermes") if isinstance(LOCK, dict) else None
    if not isinstance(expected, dict):
        print("Required upstream contract verification FAILED: Hermes lock missing", file=sys.stderr)
        return 1

    required = expected.get("required_contracts")
    contract = required.get("dashboard_route_scoped_exclusive_shell") if isinstance(required, dict) else None
    if not isinstance(contract, dict) or contract.get("required_for_seal") is not True:
        print("Required upstream contract verification FAILED: exclusive-shell seal blocker is not pinned", file=sys.stderr)
        return 1

    errors: list[str] = []
    actual = git_head(hermes)
    if actual != expected.get("commit"):
        fail(errors, f"Hermes checkout is not the pinned revision: expected {expected.get('commit')}, got {actual}")

    try:
        verify_exclusive_shell(hermes, errors)
    except RuntimeError as exc:
        fail(errors, str(exc))

    if errors:
        print("Required upstream Product 3 contracts FAILED:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        print(f"  - upstream blocker: {ISSUE}", file=sys.stderr)
        print("Product 3 remains ARCHIVE CANDIDATE; SEALED is forbidden until the official Hermes pin contains this contract.", file=sys.stderr)
        return 1

    print("Required upstream Product 3 contracts passed")
    print(f"  dashboard_route_scoped_exclusive_shell: official @ {actual}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
