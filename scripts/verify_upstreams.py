#!/usr/bin/env python3
"""Verify the exact Hermes public contracts Worker Studio 2.0 is sealed to."""
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
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as exc:
        fail(f"cannot resolve git HEAD for {root}: {exc.output.strip()}")
        return ""


def require_tokens(path: pathlib.Path, tokens: Iterable[str], label: str) -> None:
    text = read(path)
    for token in tokens:
        if token not in text:
            fail(f"{label} lost required token {token!r} in {path}")


def require_any(root: pathlib.Path, token: str, globs: Iterable[str], label: str) -> None:
    for pattern in globs:
        for path in root.glob(pattern):
            if not path.is_file():
                continue
            try:
                if token in path.read_text(encoding="utf-8", errors="ignore"):
                    return
            except OSError:
                pass
    fail(f"{label} public contract token not found: {token!r}")


def verify_hermes(hermes: pathlib.Path) -> None:
    expected = LOCK["hermes"]
    actual = git_head(hermes)
    if actual != expected["commit"]:
        fail(f"Hermes checkout is not pinned: expected {expected['commit']}, got {actual}")

    pyproject = read(hermes / "pyproject.toml")
    match = re.search(r'^version\s*=\s*"([^"]+)"', pyproject, re.MULTILINE)
    actual_version = match.group(1) if match else "unknown"
    if actual_version != expected["version"]:
        fail(f"Hermes version drift: expected {expected['version']}, got {actual_version}")

    require_tokens(
        hermes / "website" / "docs" / "developer-guide" / "subagent-lifecycle-api.md",
        (
            "Public Subagent Lifecycle API",
            "ctx.subagent_lifecycle",
            "SubagentLaunchRequest",
            "allowed_toolsets",
            "status",
            "wait",
            "cancel",
            "result",
            "reconnect",
            "same host-owned path as `delegate_task`",
        ),
        "Hermes public subagent lifecycle docs",
    )
    require_tokens(
        hermes / "agent" / "subagent_lifecycle.py",
        (
            "PUBLIC_CONTRACT_VERSION = 1",
            "class SubagentLaunchRequest",
            "class SubagentHandle",
            "class SubagentLifecycleService",
            "def launch(",
            "def status(",
            "def wait(",
            "def cancel(",
            "def result(",
        ),
        "Hermes public subagent lifecycle implementation",
    )
    require_tokens(
        hermes / "hermes_cli" / "plugins.py",
        (
            "def subagent_lifecycle",
            "SubagentLifecycleService",
            '"pre_tool_call"',
            '"action": "block"',
            "get_config",
            "set_config",
        ),
        "Hermes PluginContext/policy surface",
    )
    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "features" / "api-server.md",
        (
            "GET /api/model/options",
            "GET /v1/capabilities",
            "POST /v1/runs",
            "GET /v1/runs/\\{run_id\\}",
            "GET /v1/runs/\\{run_id\\}/events",
            "POST /v1/runs/\\{run_id\\}/stop",
            "POST /v1/runs/\\{run_id\\}/approval",
            "GET /health/detailed",
            "model_options",
            "provider",
        ),
        "Hermes API Server docs",
    )
    require_any(hermes, "/steer", ("tests/**/*.py", "gateway/**/*.py", "hermes_cli/**/*.py"), "Hermes Runs steer")
    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "features" / "delegation.md",
        (
            "delegation.model",
            "delegation.provider",
            "delegation.reasoning_effort",
            "subagent_auto_approve",
            "The `/review` Command",
            "auxiliary:",
            "review:",
        ),
        "Hermes delegation/review docs",
    )
    require_tokens(
        hermes / "web" / "src" / "lib" / "api.ts",
        (
            '"/api/model/options"',
            '"/api/config"',
            "/api/providers/custom-endpoints",
            "/api/sessions",
            "/messages",
            "/sessions/search",
        ),
        "Hermes dashboard API client",
    )
    require_any(hermes, "Hardline Blocklist", ("website/docs/**/*.md",), "Hermes hardline security docs")
    require_any(hermes, "unattended_mode", ("website/docs/**/*.md", "tests/**/*.py"), "Hermes unattended approval contract")
    require_any(hermes, "mcp_reload_confirm", ("hermes_cli/**/*.py", "website/docs/**/*.md", "tests/**/*.py"), "Hermes MCP approval contract")

    # Upstream's own behavior tests are part of the archive seam. We do not
    # import private code from Studio; CI runs these files against the pin.
    for required_test in (
        "tests/agent/test_subagent_lifecycle.py",
        "tests/gateway/test_api_server_runs.py",
        "tests/tools/test_approval.py",
    ):
        if not (hermes / required_test).is_file():
            fail(f"Hermes upstream behavior test disappeared: {required_test}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-root", required=True, type=pathlib.Path)
    args = parser.parse_args()
    hermes = args.hermes_root.resolve()
    if set(LOCK) != {"hermes"}:
        fail("tests/upstream-lock.json must contain only the Hermes runtime upstream")
    verify_hermes(hermes)

    if errors:
        print("Pinned Hermes verification FAILED:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    row = LOCK["hermes"]
    print("Pinned Hermes verification passed")
    print(f"  Hermes: {row['repository']}@{row['commit']} ({row['version']}, {row['channel']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
