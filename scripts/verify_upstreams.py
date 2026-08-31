#!/usr/bin/env python3
"""Verify the exact upstream revisions Worker Studio is sealed against.

This intentionally checks semantic public-surface tokens in checked-out upstream
repositories instead of importing their private Python/React implementation.
The goal is to fail CI immediately when a pinned upstream no longer exposes a
contract Worker Studio depends on.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
from collections.abc import Iterable

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "tests" / "upstream-lock.json").read_text(encoding="utf-8"))
errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def read(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:
        fail(f"cannot read {path}: {exc}")
        return ""


def git_head(root: pathlib.Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True, stderr=subprocess.STDOUT
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"cannot resolve git HEAD for {root}: {exc.output.strip()}")
        return ""


def require_tokens(path: pathlib.Path, tokens: Iterable[str], label: str) -> None:
    text = read(path)
    for token in tokens:
        if token not in text:
            fail(f"{label} lost required token {token!r} in {path.relative_to(path.parents[1]) if len(path.parents) > 1 else path}")


def require_any(root: pathlib.Path, token: str, globs: Iterable[str], label: str) -> None:
    for pattern in globs:
        for path in root.glob(pattern):
            if path.is_file():
                try:
                    if token in path.read_text(encoding="utf-8", errors="ignore"):
                        return
                except OSError:
                    pass
    fail(f"{label} public contract token not found: {token!r}")


def verify_versions(hermes: pathlib.Path, worker: pathlib.Path) -> None:
    h_pyproject = read(hermes / "pyproject.toml")
    m = re.search(r'^version\s*=\s*"([^"]+)"', h_pyproject, re.MULTILINE)
    if not m or m.group(1) != LOCK["hermes"]["version"]:
        fail(f"Hermes version drift: expected {LOCK['hermes']['version']}, got {m.group(1) if m else 'unknown'}")

    try:
        worker_pkg = json.loads(read(worker / "package.json"))
    except json.JSONDecodeError as exc:
        fail(f"worker package.json invalid: {exc}")
        worker_pkg = {}
    if worker_pkg.get("version") != LOCK["worker"]["version"]:
        fail(f"Worker version drift: expected {LOCK['worker']['version']}, got {worker_pkg.get('version')}")
    if worker_pkg.get("engines", {}).get("node") != ">=20":
        fail("Worker Node engine contract drifted from >=20")
    for script in ("test", "check", "seal:production", "seal:archive"):
        if script not in worker_pkg.get("scripts", {}):
            fail(f"Worker lost release gate script: {script}")


def verify_hermes(hermes: pathlib.Path) -> None:
    require_tokens(
        hermes / "web" / "src" / "plugins" / "sdk.d.ts",
        (
            "__HERMES_PLUGIN_SDK__",
            "__HERMES_PLUGINS__",
            "fetchJSON",
            "authedFetch",
            "register(name: string",
        ),
        "Hermes dashboard SDK",
    )
    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "features" / "extending-the-dashboard.md",
        ("tab.override", "/api/plugins/<name>/", "manifest.json", "plugin_api.py"),
        "Hermes dashboard plugin docs",
    )
    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "security.md",
        (
            "approvals.mode",
            "unattended_mode",
            "single_query_mode",
            "cron_mode",
            "Hardline Blocklist",
            "there's no override flag",
        ),
        "Hermes unattended/security contract",
    )

    globs = (
        "hermes_cli/**/*.py",
        "gateway/**/*.py",
        "web/src/**/*.ts",
        "web/src/**/*.tsx",
        "tests/**/*.py",
    )
    for token in (
        "/sessions/search",
        "archived",
        "/messages",
        "/chat/stream",
        "/api/model/options",
        "/api/providers/custom-endpoints",
        "/v1/capabilities",
    ):
        require_any(hermes, token, globs, "Hermes")

    # Upstream itself must test the exact two most fragile session contracts.
    require_any(hermes, "sessions/search", ("tests/**/*.py",), "Hermes upstream tests")
    require_any(hermes, "chat/stream", ("tests/**/*.py",), "Hermes upstream tests")


def verify_worker(worker: pathlib.Path) -> None:
    server = worker / "src" / "server.mjs"
    require_tokens(
        server,
        (
            "/api/health",
            "/api/state",
            "/api/catalog",
            "/api/provider",
            "/api/provider/probe",
            "/api/provider/connectivity",
            "/api/mode",
            "/api/routing",
            "/api/worker/start",
            "/api/worker/status/",
        ),
        "Worker HTTP control plane",
    )
    require_tokens(
        worker / "src" / "model-capabilities.mjs",
        ("reasoning", "options"),
        "Worker capability registry",
    )
    require_any(worker, "CWD_ALLOW_DANGER_FULL_ACCESS", ("src/**/*.mjs", "scripts/**/*.sh", "docs/**/*.md"), "Worker sandbox policy")
    require_any(worker, "codex app-server", ("src/**/*.mjs", "docs/**/*.md"), "Worker official Codex App Server path")
    require_tokens(
        worker / "docs" / "PRODUCTION_SEAL.md",
        ("seal:production", "seal:archive"),
        "Worker seal documentation",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-root", required=True, type=pathlib.Path)
    parser.add_argument("--worker-root", required=True, type=pathlib.Path)
    args = parser.parse_args()
    hermes = args.hermes_root.resolve()
    worker = args.worker_root.resolve()

    expected_hermes = LOCK["hermes"]["commit"]
    expected_worker = LOCK["worker"]["commit"]
    actual_hermes = git_head(hermes)
    actual_worker = git_head(worker)
    if actual_hermes != expected_hermes:
        fail(f"Hermes checkout is not pinned: expected {expected_hermes}, got {actual_hermes}")
    if actual_worker != expected_worker:
        fail(f"Worker checkout is not pinned: expected {expected_worker}, got {actual_worker}")

    verify_versions(hermes, worker)
    verify_hermes(hermes)
    verify_worker(worker)

    if errors:
        print("Pinned upstream verification FAILED:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print("Pinned upstream verification passed")
    print(f"  Hermes: {LOCK['hermes']['repository']}@{actual_hermes} ({LOCK['hermes']['version']})")
    print(f"  Worker: {LOCK['worker']['repository']}@{actual_worker} ({LOCK['worker']['version']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
