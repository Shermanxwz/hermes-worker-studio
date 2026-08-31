#!/usr/bin/env python3
"""Verify the exact upstream revisions Worker Studio is sealed against.

The verifier intentionally checks public/documented contracts and upstream's own
tests.  It does not import private implementation modules.  A pin update is not
sufficient: the semantic surface must still match the archive contract.
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


def is_ancestor(root: pathlib.Path, ancestor: str, descendant: str) -> bool:
    try:
        subprocess.check_call(
            ["git", "-C", str(root), "merge-base", "--is-ancestor", ancestor, descendant],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except subprocess.CalledProcessError:
        return False


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


def verify_versions(hermes: pathlib.Path, worker: pathlib.Path) -> None:
    h_pyproject = read(hermes / "pyproject.toml")
    m = re.search(r'^version\s*=\s*"([^"]+)"', h_pyproject, re.MULTILINE)
    if not m or m.group(1) != LOCK["hermes"]["version"]:
        fail(f"Hermes version drift: expected {LOCK['hermes']['version']}, got {m.group(1) if m else 'unknown'}")

    if LOCK["hermes"].get("channel") == "post-release-snapshot":
        release_commit = str(LOCK["hermes"].get("release_commit") or "")
        snapshot = str(LOCK["hermes"].get("commit") or "")
        if not release_commit or not is_ancestor(hermes, release_commit, snapshot):
            fail("Hermes post-release snapshot no longer descends from the recorded official release commit")

    try:
        worker_pkg = json.loads(read(worker / "package.json"))
    except json.JSONDecodeError as exc:
        fail(f"worker package.json invalid: {exc}")
        worker_pkg = {}
    if worker_pkg.get("version") != LOCK["worker"]["version"]:
        fail(f"Worker version drift: expected {LOCK['worker']['version']}, got {worker_pkg.get('version')}")
    if worker_pkg.get("engines", {}).get("node") != ">=20":
        fail("Worker Node engine contract drifted from >=20")
    for script in ("test", "check", "seal:production", "seal:release", "seal:archive"):
        if script not in worker_pkg.get("scripts", {}):
            fail(f"Worker lost release gate script: {script}")


def verify_hermes(hermes: pathlib.Path) -> None:
    require_tokens(
        hermes / "web" / "src" / "plugins" / "sdk.d.ts",
        ("__HERMES_PLUGIN_SDK__", "__HERMES_PLUGINS__", "fetchJSON", "authedFetch", "register(name: string"),
        "Hermes dashboard SDK",
    )
    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "features" / "extending-the-dashboard.md",
        ("tab.override", "/api/plugins/<name>/", "manifest.json", "plugin_api.py"),
        "Hermes dashboard plugin docs",
    )
    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "features" / "api-server.md",
        (
            "/api/model/options",
            "/v1/capabilities",
            "POST /v1/runs",
            "GET /v1/runs/\\{run_id\\}",
            "GET /v1/runs/\\{run_id\\}/events",
            "POST /v1/runs/\\{run_id\\}/stop",
            "POST /v1/runs/\\{run_id\\}/approval",
            "/health/detailed",
        ),
        "Hermes API Server docs",
    )
    require_tokens(
        hermes / "website" / "docs" / "user-guide" / "security.md",
        ("approvals.mode", "unattended_mode", "single_query_mode", "cron_mode", "Hardline Blocklist", "there's no override flag"),
        "Hermes unattended/security contract",
    )

    globs = ("hermes_cli/**/*.py", "gateway/**/*.py", "web/src/**/*.ts", "web/src/**/*.tsx", "tests/**/*.py")
    for token in (
        "/sessions/search",
        "archived",
        "/messages",
        "/chat/stream",
        "/api/model/options",
        "/api/providers/custom-endpoints",
        "/api/skills",
        "/v1/capabilities",
        "/v1/runs",
    ):
        require_any(hermes, token, globs, "Hermes")

    runs_test = hermes / "tests" / "gateway" / "test_api_server_runs.py"
    require_tokens(
        runs_test,
        (
            "POST /v1/runs",
            "GET /v1/runs/{run_id}",
            "GET /v1/runs/{run_id}/events",
            "/approval",
            "/steer",
            "/stop",
            "run_not_accepting_steer",
        ),
        "Hermes upstream Runs tests",
    )
    require_any(hermes, "unattended_mode", ("tests/**/*.py",), "Hermes upstream unattended tests")
    require_any(hermes, "sessions/search", ("tests/**/*.py",), "Hermes upstream session tests")


def verify_worker(worker: pathlib.Path) -> None:
    readme = worker / "README.md"
    require_tokens(
        readme,
        (
            "OFFICIAL：真正的“官方默认”模式",
            "即使本地 `:8788` 控制平面不可用",
            "account/read -> account.type == \"chatgpt\"",
            "Web 中 `WORKER` 对应内部 `DELEGATE`",
            "| `OFFICIAL`",
            "| `AUTO`",
            "| `WORKER` / `DELEGATE`",
            "| `MAIN`",
            "modelProvider/capabilities/read",
            "Reasoning：只相信模型声明，不猜",
            "standalone Main",
            "modelProvider=\"codex_worker_gateway\"",
            "项目不会把第三方线程冒充 native subagent",
        ),
        "Worker README semantics",
    )

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
    require_tokens(worker / "src" / "model-capabilities.mjs", ("reasoning", "options"), "Worker capability registry")
    for token in (
        "providerLocked",
        "account/read",
        "model/list",
        "modelProvider/capabilities/read",
        "DELEGATE",
        "OFFICIAL",
        "MAIN",
    ):
        require_any(worker, token, ("src/**/*.mjs", "test/**/*.mjs", "tests/**/*.mjs", "README.md"), "Worker mode/auth contract")
    require_any(worker, "CWD_ALLOW_DANGER_FULL_ACCESS", ("src/**/*.mjs", "scripts/**/*.sh", "docs/**/*.md"), "Worker sandbox policy")
    require_any(worker, "codex app-server", ("src/**/*.mjs", "docs/**/*.md", "README.md"), "Worker official Codex App Server path")
    require_tokens(worker / "docs" / "PRODUCTION_SEAL.md", ("seal:production", "seal:release", "seal:archive"), "Worker seal documentation")


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
    print(
        f"  Hermes: {LOCK['hermes']['repository']}@{actual_hermes} "
        f"({LOCK['hermes']['version']}, {LOCK['hermes'].get('channel', 'release')})"
    )
    print(f"  Worker: {LOCK['worker']['repository']}@{actual_worker} ({LOCK['worker']['version']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
